import * as fs from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import * as path from 'node:path';
import { TextDecoder } from 'node:util';

import { StoreError } from './errors';
import {
  ensureDir,
  isTextMime,
  mimeForPath,
  pathExists,
  randomHex,
  readJson,
  renameWithRetry,
  sha256,
  toBytes,
  writeFileDurable,
  writeJsonAtomic,
  writeJsonDurable,
} from './fs';
import { newArtifactId, newVersionId } from './id';
import { withArtifactLock } from './lock';
import {
  assertArtifactId,
  assertRelativePath,
  assertRealpathWithin,
  assertVersionId,
  defaultStoreRoot,
  errorCode,
  isWithin,
  normalizeDirectory,
  projectNameFromDirectory,
  resolveArtifactDir,
  resolveVersionDir,
  resolveWithin,
} from './paths';
import { parseFeedbackRecord, parseMeta, parseRuntimeState, parseVersionManifest, isJsonValue, jsonByteLength } from './schema';
import type {
  AddFeedbackInput,
  ArtifactFileInput,
  ArtifactFileRecord,
  ArtifactKind,
  ArtifactMeta,
  ArtifactSummary,
  CreateArtifactInput,
  CreateResult,
  FeedbackRecord,
  JsonValue,
  ListFeedbackOptions,
  ListFilter,
  ListResult,
  LiveSource,
  ReadResult,
  ReadVersionResult,
  RuntimeState,
  TextEdit,
  UpdateInput,
  UpdateResult,
  VersionManifest,
  VersionSummary,
} from './types';

const LIVE_SOURCE_ID_RE = /^[a-z][a-z0-9-]{0,31}$/;
const LIBRARY_NAME_RE = /^[a-z0-9-]{1,32}$/;
const FEEDBACK_ID_RE = /^fb_[a-f0-9]{24}$/;

interface Limits {
  maxHtmlBytes: number;
  maxBundleBytes: number;
  maxBundleFiles: number;
  maxFileBytes: number;
}

interface NormalizedFile {
  path: string;
  bytes: Uint8Array;
  mime: string;
}

interface UpdatePlan {
  kind: ArtifactKind;
  title: string;
  tags: string[];
  entry: string;
  files: NormalizedFile[];
  restoredFrom: string | null;
  changedFiles: string[];
}

export interface ArtifactStoreOptions {
  root: string;
  now?: () => Date;
  random?: (size: number) => Uint8Array;
  lockRetryMs?: number;
  lockTimeoutMs?: number;
  lockStaleMs?: number;
  versionsKept?: number;
  maxHtmlBytes?: number;
  maxBundleBytes?: number;
  maxBundleFiles?: number;
  maxFileBytes?: number;
}

export class ArtifactStore {
  private readonly root: string;
  private readonly trashRoot: string;
  private readonly locksRoot: string;
  private readonly now: () => Date;
  private readonly random: (size: number) => Uint8Array;
  private readonly lockRetryMs: number;
  private readonly lockTimeoutMs: number;
  private readonly lockStaleMs: number;
  private readonly versionsKept: number;
  private readonly maxHtmlBytes: number;
  private readonly maxBundleBytes: number;
  private readonly maxBundleFiles: number;
  private readonly maxFileBytes: number;
  private initPromise: Promise<void> | null = null;

  constructor(options: ArtifactStoreOptions) {
    this.root = path.resolve(options.root);
    this.trashRoot = path.join(this.root, 'trash');
    this.locksRoot = path.join(this.root, '.locks');
    this.now = options.now ?? (() => new Date());
    this.random = options.random ?? ((size) => new Uint8Array(randomBytes(size)));
    this.lockRetryMs = options.lockRetryMs ?? 50;
    this.lockTimeoutMs = options.lockTimeoutMs ?? 5000;
    this.lockStaleMs = options.lockStaleMs ?? 30_000;
    this.versionsKept = options.versionsKept ?? 30;
    this.maxHtmlBytes = options.maxHtmlBytes ?? 2 * 1024 * 1024;
    this.maxBundleBytes = options.maxBundleBytes ?? 20 * 1024 * 1024;
    this.maxBundleFiles = options.maxBundleFiles ?? 200;
    this.maxFileBytes = options.maxFileBytes ?? 5 * 1024 * 1024;
  }

  static default(overrides: Partial<ArtifactStoreOptions> = {}): ArtifactStore {
    return new ArtifactStore({ ...overrides, root: overrides.root ?? defaultStoreRoot() });
  }

  get storeRoot(): string {
    return this.root;
  }

  async init(): Promise<void> {
    await ensureDir(this.root);
    await ensureDir(this.trashRoot);
    await ensureDir(this.locksRoot);
  }

  async create(input: CreateArtifactInput): Promise<CreateResult> {
    await this.ensureInit();
    const now = input.now ?? this.now();
    const title = normalizeTitle(input.title);
    const directory = normalizeDirectory(input.directory);
    const tags = normalizeTags(input.tags);
    const kind = input.kind;
    if (kind !== 'html' && kind !== 'bundle') {
      throw new StoreError('UNSUPPORTED_KIND', `${kind} artifacts are not implemented yet`);
    }

    const files = normalizeFiles(input.files);
    const entry = resolveEntry(kind, files, input.entry);
    validateFileSet(kind, files, entry, this.limits());

    const dedupeKey = normalizeOptional(input.dedupeKey, 200);
    if (dedupeKey !== null) {
      const existing = await this.findByDedupeKey(dedupeKey, kind, directory);
      if (existing !== null) {
        if (await this.hasSameFiles(existing.id, existing.version, files)) {
          return existing;
        }
        // Same dedupeKey but a changed source: append a version instead of
        // silently dropping the new content.
        const updated = await this.update(existing.id, {
          mode: 'replace',
          files: files.map((file) => ({ path: file.path, content: file.bytes })),
          entry,
          title,
          tags,
        });
        return { id: existing.id, version: updated.version, meta: updated.meta, deduped: true };
      }
    }

    const { id, artifactDir } = await this.allocateArtifact(title, now);
    try {
      const version = await this.writeVersion({
        artifactDir,
        kind,
        title,
        entry,
        files,
        now,
        restoredFrom: null,
        existingVersions: [],
      });
      const summary = summarizeVersion(version.id, version.manifest, version.totalBytes);
      const meta: ArtifactMeta = {
        schema: 2,
        id,
        title,
        kind,
        directory,
        projectName: projectNameFromDirectory(directory),
        sessionId: normalizeOptional(input.sessionId, 200),
        tags,
        favorite: false,
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
        archivedAt: null,
        currentVersion: version.id,
        pinnedVersion: null,
        librarySet: normalizeLibrarySet(input.librarySet),
        libraries: normalizeLibraries(input.libraries),
        versions: [summary],
        live: normalizeLiveSources(input.live),
        openCount: 0,
        lastOpenedAt: null,
        dedupeKey,
      };
      await writeJsonAtomic(path.join(artifactDir, 'meta.json'), meta);
      return { id, version: version.id, meta, deduped: false };
    } catch (error) {
      await fs.rm(artifactDir, { recursive: true, force: true });
      throw error;
    }
  }

  async update(id: string, input: UpdateInput): Promise<UpdateResult> {
    await this.ensureInit();
    assertArtifactId(id);
    const artifactDir = resolveArtifactDir(this.root, id);
    const lockDir = this.lockPath(id);

    return withArtifactLock(
      lockDir,
      async () => {
        const meta = await this.getMeta(id);
        this.assertBaseVersion(meta, input.baseVersion, input.mode);
        const now = this.now();
        const plan = await this.planUpdate(id, meta, input);
        const version = await this.writeVersion({
          artifactDir,
          kind: plan.kind,
          title: plan.title,
          entry: plan.entry,
          files: plan.files,
          now,
          restoredFrom: plan.restoredFrom,
          existingVersions: meta.versions.map((entry) => entry.id),
        });
        const summary = summarizeVersion(version.id, version.manifest, version.totalBytes);
        const nextMeta: ArtifactMeta = {
          ...meta,
          title: plan.title,
          tags: plan.tags,
          updatedAt: now.toISOString(),
          currentVersion: version.id,
          versions: [...meta.versions, summary],
        };
        const pruned = this.pruneMeta(nextMeta);
        try {
          await writeJsonAtomic(path.join(artifactDir, 'meta.json'), pruned.meta);
        } catch (error) {
          await fs.rm(path.join(artifactDir, 'versions', version.id), { recursive: true, force: true });
          throw error;
        }
        for (const prunedVersion of pruned.removed) {
          const versionDir = resolveVersionDir(this.root, id, prunedVersion);
          await fs.rm(versionDir, { recursive: true, force: true }).catch(() => undefined);
        }
        return { id, version: version.id, changedFiles: plan.changedFiles, meta: pruned.meta };
      },
      this.lockOptions(),
    );
  }

  async read(id: string, version?: string): Promise<ReadResult> {
    const meta = await this.getMeta(id);
    const versionId = version ?? meta.currentVersion;
    assertVersionId(versionId);
    if (!meta.versions.some((entry) => entry.id === versionId)) {
      throw new StoreError('NOT_FOUND', 'Version not found');
    }
    const manifest = await this.readManifest(id, versionId);
    return { meta, version: versionId, manifest };
  }

  async readVersion(id: string, version?: string): Promise<ReadVersionResult> {
    const result = await this.read(id, version);
    const versionDir = resolveVersionDir(this.root, id, result.version);
    const files = await Promise.all(
      result.manifest.files.map(async (file) => ({
        ...file,
        content: await this.readFileAt(versionDir, file.path),
      })),
    );
    return { ...result, files };
  }

  async readFile(id: string, version: string | undefined, filePath: string): Promise<Uint8Array> {
    const result = await this.read(id, version);
    const record = result.manifest.files.find((file) => file.path === filePath);
    if (record === undefined) {
      throw new StoreError('PATH_NOT_FOUND', 'File not found in this version');
    }
    const versionDir = resolveVersionDir(this.root, id, result.version);
    return this.readFileAt(versionDir, record.path);
  }

  async getMeta(id: string): Promise<ArtifactMeta> {
    await this.ensureInit();
    assertArtifactId(id);
    const artifactDir = resolveArtifactDir(this.root, id);
    try {
      const raw = await readJson(path.join(artifactDir, 'meta.json'));
      const meta = parseMeta(raw);
      if (meta.id !== id) {
        throw new StoreError('INVALID_META', 'meta.id does not match the directory');
      }
      return meta;
    } catch (error) {
      if (errorCode(error) === 'ENOENT') {
        throw new StoreError('NOT_FOUND', 'Artifact not found');
      }
      throw error;
    }
  }

  async getVersions(id: string): Promise<VersionSummary[]> {
    const meta = await this.getMeta(id);
    return meta.versions;
  }

  async list(filter: ListFilter = {}): Promise<ListResult> {
    await this.ensureInit();
    const directory = filter.directory === undefined ? undefined : normalizeDirectory(filter.directory);
    const tag = filter.tag?.toLowerCase();
    const query = filter.query?.toLowerCase();
    const entries = await fs.readdir(this.root, { withFileTypes: true });
    const artifacts: ArtifactSummary[] = [];
    let errors = 0;

    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.') || entry.name === 'trash' || entry.name === 'exports') continue;
      let meta: ArtifactMeta;
      try {
        const raw = await readJson(path.join(this.root, entry.name, 'meta.json'));
        meta = parseMeta(raw);
      } catch {
        errors += 1;
        continue;
      }
      if (meta.id !== entry.name) {
        errors += 1;
        continue;
      }
      if (filter.includeArchived !== true && meta.archivedAt !== null) continue;
      if (directory !== undefined && !isWithin(directory, meta.directory)) continue;
      if (filter.kind !== undefined && meta.kind !== filter.kind) continue;
      if (tag !== undefined && !meta.tags.some((entryTag) => entryTag.toLowerCase() === tag)) continue;
      if (query !== undefined) {
        const matchesTitle = meta.title.toLowerCase().includes(query);
        const matchesTag = meta.tags.some((entryTag) => entryTag.toLowerCase().includes(query));
        if (!matchesTitle && !matchesTag) continue;
      }
      artifacts.push({
        id: meta.id,
        title: meta.title,
        kind: meta.kind,
        directory: meta.directory,
        projectName: meta.projectName,
        updatedAt: meta.updatedAt,
        versions: meta.versions.length,
        currentVersion: meta.currentVersion,
        tags: meta.tags,
        favorite: meta.favorite,
        archived: meta.archivedAt !== null,
        feedbackCount: await this.countFeedback(meta.id),
      });
    }

    artifacts.sort((left, right) => {
      const updated = right.updatedAt.localeCompare(left.updatedAt);
      return updated !== 0 ? updated : left.id.localeCompare(right.id);
    });
    const limit = Math.min(Math.max(filter.limit ?? 50, 1), 200);
    return { artifacts: artifacts.slice(0, limit), errors };
  }

  async listTrash(): Promise<ArtifactSummary[]> {
    await this.ensureInit();
    let entries: Dirent[];
    try {
      entries = await fs.readdir(this.trashRoot, { withFileTypes: true });
    } catch {
      return [];
    }
    const artifacts: ArtifactSummary[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      try {
        const raw = await readJson(path.join(this.trashRoot, entry.name, 'meta.json'));
        const meta = parseMeta(raw);
        artifacts.push({
          id: meta.id,
          title: meta.title,
          kind: meta.kind,
          directory: meta.directory,
          projectName: meta.projectName,
          updatedAt: meta.updatedAt,
          versions: meta.versions.length,
          currentVersion: meta.currentVersion,
          tags: meta.tags,
          favorite: meta.favorite,
          archived: meta.archivedAt !== null,
          feedbackCount: 0,
        });
      } catch {
        continue;
      }
    }
    artifacts.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    return artifacts;
  }

  async archive(id: string, archived: boolean): Promise<ArtifactMeta> {
    return this.updateMeta(id, (meta, now) => ({
      ...meta,
      archivedAt: archived ? now.toISOString() : null,
    }));
  }

  async setFavorite(id: string, favorite: boolean): Promise<ArtifactMeta> {
    return this.updateMeta(id, (meta) => ({ ...meta, favorite }));
  }

  async setPinned(id: string, version: string | null): Promise<ArtifactMeta> {
    if (version !== null) assertVersionId(version);
    return this.updateMeta(id, (meta) => {
      if (version !== null && !meta.versions.some((entry) => entry.id === version)) {
        throw new StoreError('NOT_FOUND', 'Version not found');
      }
      return { ...meta, pinnedVersion: version };
    });
  }

  async trash(id: string): Promise<void> {
    await this.ensureInit();
    assertArtifactId(id);
    const artifactDir = resolveArtifactDir(this.root, id);
    const lockDir = this.lockPath(id);

    await withArtifactLock(
      lockDir,
      async () => {
        await this.getMeta(id);
        const stamp = this.now().getTime();
        let target = path.join(this.trashRoot, `${id}-${stamp}`);
        for (let attempt = 1; await pathExists(target); attempt += 1) {
          target = path.join(this.trashRoot, `${id}-${stamp}-${attempt}`);
        }
        await renameWithRetry(artifactDir, target);
      },
      this.lockOptions(),
    );
  }

  async untrash(id: string): Promise<ArtifactMeta> {
    await this.ensureInit();
    assertArtifactId(id);
    const artifactDir = resolveArtifactDir(this.root, id);
    const lockDir = this.lockPath(id);

    return withArtifactLock(
      lockDir,
      async () => {
        if (await pathExists(artifactDir)) {
          throw new StoreError('CONFLICT', 'An artifact with this id already exists');
        }
        const entries = await fs.readdir(this.trashRoot, { withFileTypes: true });
        const candidates = entries
          .filter((entry) => entry.isDirectory() && entry.name.startsWith(`${id}-`))
          .map((entry) => entry.name)
          .sort()
          .reverse();
        const source = candidates[0];
        if (source === undefined) {
          throw new StoreError('NOT_FOUND', 'No trashed artifact found');
        }
        await renameWithRetry(path.join(this.trashRoot, source), artifactDir);
        return this.getMeta(id);
      },
      this.lockOptions(),
    );
  }

  async countFeedback(id: string): Promise<number> {
    try {
      const entries = await fs.readdir(path.join(this.root, id, 'feedback'), { withFileTypes: true });
      return entries.filter((entry) => entry.isFile() && entry.name.endsWith('.json')).length;
    } catch (error) {
      if (errorCode(error) === 'ENOENT') return 0;
      throw error;
    }
  }

  async addFeedback(id: string, input: AddFeedbackInput): Promise<FeedbackRecord> {
    await this.ensureInit();
    assertArtifactId(id);
    assertVersionId(input.version);
    const kind = input.kind ?? 'form';
    if (typeof kind !== 'string' || kind.length === 0 || kind.length > 64) {
      throw new StoreError('INVALID_ARTIFACT', 'Feedback kind must be 1 to 64 characters');
    }
    if (!isJsonValue(input.data)) {
      throw new StoreError('INVALID_ARTIFACT', 'Feedback data must be JSON');
    }
    if (jsonByteLength(input.data) > 64 * 1024) {
      throw new StoreError('TOO_LARGE', 'Feedback is limited to 64 KiB');
    }

    return withArtifactLock(
      this.lockPath(id),
      async () => {
        const meta = await this.getMeta(id);
        if (!meta.versions.some((version) => version.id === input.version)) {
          throw new StoreError('NOT_FOUND', 'Version not found');
        }
        const record: FeedbackRecord = {
          schema: 1,
          id: `fb_${randomHex(12)}`,
          artifactId: id,
          version: input.version,
          createdAt: this.now().toISOString(),
          kind,
          data: input.data,
          deliveredAt: null,
        };
        const feedbackDir = path.join(resolveArtifactDir(this.root, id), 'feedback');
        await ensureDir(feedbackDir);
        await writeJsonAtomic(path.join(feedbackDir, `${record.id}.json`), record);
        return record;
      },
      this.lockOptions(),
    );
  }

  async listFeedback(id: string, options: ListFeedbackOptions = {}): Promise<FeedbackRecord[]> {
    await this.ensureInit();
    assertArtifactId(id);
    const feedbackDir = path.join(resolveArtifactDir(this.root, id), 'feedback');
    let entries: Dirent[];
    try {
      entries = await fs.readdir(feedbackDir, { withFileTypes: true });
    } catch (error) {
      if (errorCode(error) === 'ENOENT') return [];
      throw error;
    }
    const records: FeedbackRecord[] = [];
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
      try {
        const raw = await readJson(path.join(feedbackDir, entry.name));
        const record = parseFeedbackRecord(raw);
        if (record.artifactId !== id) continue;
        if (options.since !== undefined && record.createdAt <= options.since) continue;
        records.push(record);
      } catch {
        continue;
      }
    }
    records.sort(
      (left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id),
    );
    const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
    return records.slice(0, limit);
  }

  async markFeedbackDelivered(id: string, feedbackIds: string[]): Promise<number> {
    await this.ensureInit();
    assertArtifactId(id);
    if (!Array.isArray(feedbackIds) || feedbackIds.length === 0) return 0;

    return withArtifactLock(
      this.lockPath(id),
      async () => {
        await this.getMeta(id);
        const feedbackDir = path.join(resolveArtifactDir(this.root, id), 'feedback');
        const deliveredAt = this.now().toISOString();
        let count = 0;
        for (const feedbackId of feedbackIds) {
          if (typeof feedbackId !== 'string' || !FEEDBACK_ID_RE.test(feedbackId)) continue;
          const feedbackPath = path.join(feedbackDir, `${feedbackId}.json`);
          try {
            const raw = await readJson(feedbackPath);
            const record = parseFeedbackRecord(raw);
            if (record.artifactId !== id || record.deliveredAt !== null) continue;
            await writeJsonAtomic(feedbackPath, { ...record, deliveredAt });
            count += 1;
          } catch {
            continue;
          }
        }
        return count;
      },
      this.lockOptions(),
    );
  }

  async readState(id: string): Promise<RuntimeState> {
    await this.getMeta(id);
    const statePath = path.join(resolveArtifactDir(this.root, id), 'state.json');
    try {
      const raw = await readJson(statePath);
      return parseRuntimeState(raw);
    } catch (error) {
      if (errorCode(error) === 'ENOENT') return {};
      throw error;
    }
  }

  async writeStateKey(id: string, key: string, value: JsonValue | undefined): Promise<RuntimeState> {
    await this.ensureInit();
    assertArtifactId(id);
    if (typeof key !== 'string' || key.length === 0 || key.length > 128 || key.includes('\0')) {
      throw new StoreError('INVALID_ARTIFACT', 'State key must be 1 to 128 characters');
    }
    if (value !== undefined && !isJsonValue(value)) {
      throw new StoreError('INVALID_ARTIFACT', 'State value must be JSON');
    }

    return withArtifactLock(
      this.lockPath(id),
      async () => {
        await this.getMeta(id);
        const statePath = path.join(resolveArtifactDir(this.root, id), 'state.json');
        let state: RuntimeState = {};
        try {
          const raw = await readJson(statePath);
          state = parseRuntimeState(raw);
        } catch (error) {
          if (errorCode(error) !== 'ENOENT') throw error;
        }
        if (value === undefined) {
          delete state[key];
        } else {
          state[key] = value;
        }
        if (Buffer.byteLength(JSON.stringify(state) ?? '{}', 'utf8') > 1024 * 1024) {
          throw new StoreError('TOO_LARGE', 'Runtime state is limited to 1 MiB');
        }
        await writeJsonAtomic(statePath, state);
        return state;
      },
      this.lockOptions(),
    );
  }

  async clearState(id: string): Promise<void> {
    await this.ensureInit();
    assertArtifactId(id);
    await withArtifactLock(
      this.lockPath(id),
      async () => {
        await this.getMeta(id);
        await fs.rm(path.join(resolveArtifactDir(this.root, id), 'state.json'), { force: true });
      },
      this.lockOptions(),
    );
  }

  private async ensureInit(): Promise<void> {
    this.initPromise ??= this.init();
    await this.initPromise;
  }

  private lockPath(id: string): string {
    return path.join(this.locksRoot, `${id}.lock`);
  }

  private lockOptions(): { retryMs: number; timeoutMs: number; staleMs: number } {
    return {
      retryMs: this.lockRetryMs,
      timeoutMs: this.lockTimeoutMs,
      staleMs: this.lockStaleMs,
    };
  }

  private limits(): Limits {
    return {
      maxHtmlBytes: this.maxHtmlBytes,
      maxBundleBytes: this.maxBundleBytes,
      maxBundleFiles: this.maxBundleFiles,
      maxFileBytes: this.maxFileBytes,
    };
  }

  private async allocateArtifact(title: string, now: Date): Promise<{ id: string; artifactDir: string }> {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const id = newArtifactId(title, now.getTime(), this.random(10));
      assertArtifactId(id);
      const artifactDir = resolveArtifactDir(this.root, id);
      try {
        await fs.mkdir(artifactDir, { mode: 0o700 });
        return { id, artifactDir };
      } catch (error) {
        if (errorCode(error) === 'EEXIST') continue;
        throw error;
      }
    }
    throw new StoreError('STORE_UNAVAILABLE', 'Could not allocate an artifact id');
  }

  private async findByDedupeKey(
    key: string,
    kind: ArtifactKind,
    directory: string,
  ): Promise<CreateResult | null> {
    const metas = await this.readAllMetas();
    const found = metas.find((meta) => meta.dedupeKey === key && meta.directory === directory);
    if (found === undefined || found.kind !== kind) return null;
    return { id: found.id, version: found.currentVersion, meta: found, deduped: true };
  }

  private async hasSameFiles(
    id: string,
    version: string,
    files: { path: string; bytes: Uint8Array }[],
  ): Promise<boolean> {
    const current = await this.readVersion(id, version);
    if (current.files.length !== files.length) return false;
    for (const file of current.files) {
      const source = files.find((entry) => entry.path === file.path);
      if (source === undefined) return false;
      if (!Buffer.from(source.bytes).equals(Buffer.from(file.content))) return false;
    }
    return true;
  }

  private async readAllMetas(): Promise<ArtifactMeta[]> {
    const entries = await fs.readdir(this.root, { withFileTypes: true });
    const metas: ArtifactMeta[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.') || entry.name === 'trash' || entry.name === 'exports') continue;
      try {
        const raw = await readJson(path.join(this.root, entry.name, 'meta.json'));
        const meta = parseMeta(raw);
        if (meta.id === entry.name) metas.push(meta);
      } catch {
        continue;
      }
    }
    return metas;
  }

  private assertBaseVersion(
    meta: ArtifactMeta,
    baseVersion: string | undefined,
    mode: UpdateInput['mode'],
  ): void {
    const required = mode === 'merge' || mode === 'edits' || mode === 'restore';
    if (baseVersion === undefined) {
      if (required) {
        throw new StoreError('INVALID_UPDATE', `baseVersion is required for ${mode}`);
      }
      return;
    }
    assertVersionId(baseVersion);
    if (baseVersion !== meta.currentVersion) {
      throw new StoreError('CONFLICT', 'The artifact has a newer version', {
        currentVersion: meta.currentVersion,
      });
    }
  }

  private async planUpdate(
    id: string,
    meta: ArtifactMeta,
    input: UpdateInput,
  ): Promise<UpdatePlan> {
    const title = input.title === undefined ? meta.title : normalizeTitle(input.title);
    const tags = input.tags === undefined ? meta.tags : normalizeTags(input.tags);
    const kind = meta.kind;
    if (kind !== 'html' && kind !== 'bundle') {
      throw new StoreError('UNSUPPORTED_KIND', `${kind} artifacts are not implemented yet`);
    }

    switch (input.mode) {
      case 'replace': {
        const files = normalizeFiles(input.files);
        const entry = resolveEntry(kind, files, input.entry);
        validateFileSet(kind, files, entry, this.limits());
        return {
          kind,
          title,
          tags,
          entry,
          files,
          restoredFrom: null,
          changedFiles: await this.changedFiles(meta, files),
        };
      }
      case 'merge': {
        const current = await this.readVersion(id, meta.currentVersion);
        const merged = new Map<string, NormalizedFile>();
        for (const file of current.files) {
          merged.set(file.path, { path: file.path, bytes: file.content, mime: file.mime });
        }
        for (const file of normalizeFiles(input.files, true)) {
          merged.set(file.path, file);
        }
        for (const removePath of input.remove ?? []) {
          assertRelativePath(removePath);
          merged.delete(removePath);
        }
        const files = [...merged.values()].sort((left, right) => left.path.localeCompare(right.path));
        let entry = current.manifest.entry;
        if (input.entry !== undefined) {
          assertRelativePath(input.entry);
          entry = input.entry;
        }
        validateFileSet(kind, files, entry, this.limits());
        return {
          kind,
          title,
          tags,
          entry,
          files,
          restoredFrom: null,
          changedFiles: await this.changedFiles(meta, files),
        };
      }
      case 'edits': {
        const current = await this.readVersion(id, meta.currentVersion);
        const targetPath = input.path ?? current.manifest.entry;
        assertRelativePath(targetPath);
        const record = current.manifest.files.find((file) => file.path === targetPath);
        if (record === undefined) {
          throw new StoreError('PATH_NOT_FOUND', 'File not found in this version');
        }
        if (!isTextMime(record.mime)) {
          throw new StoreError('UNSUPPORTED_FILE_TYPE', 'Edits require a text file');
        }
        const target = current.files.find((file) => file.path === targetPath);
        if (target === undefined) {
          throw new StoreError('PATH_NOT_FOUND', 'File not found in this version');
        }
        let source: string;
        try {
          source = new TextDecoder('utf-8', { fatal: true }).decode(target.content);
        } catch {
          throw new StoreError('INVALID_ARTIFACT', 'File is not valid UTF-8');
        }
        const edited = applyEdits(source, input.edits);
        const files = current.files.map((file) =>
          file.path === targetPath
            ? { path: file.path, bytes: Buffer.from(edited, 'utf8'), mime: file.mime }
            : { path: file.path, bytes: file.content, mime: file.mime },
        );
        validateFileSet(kind, files, current.manifest.entry, this.limits());
        return {
          kind,
          title,
          tags,
          entry: current.manifest.entry,
          files,
          restoredFrom: null,
          changedFiles: await this.changedFiles(meta, files),
        };
      }
      case 'restore': {
        const source = await this.readVersion(id, input.restoreFrom);
        const files = source.files.map((file) => ({
          path: file.path,
          bytes: file.content,
          mime: file.mime,
        }));
        validateFileSet(kind, files, source.manifest.entry, this.limits());
        return {
          kind,
          title,
          tags,
          entry: source.manifest.entry,
          files,
          restoredFrom: input.restoreFrom,
          changedFiles: await this.changedFiles(meta, files),
        };
      }
      default:
        throw new StoreError('INVALID_UPDATE', 'Unknown update mode');
    }
  }

  private async changedFiles(meta: ArtifactMeta, files: NormalizedFile[]): Promise<string[]> {
    const current = await this.readManifest(meta.id, meta.currentVersion);
    const oldByPath = new Map(current.files.map((file) => [file.path, file.sha256]));
    const newByPath = new Map(files.map((file) => [file.path, sha256(file.bytes)]));
    const changed = new Set<string>();
    for (const file of files) {
      if (oldByPath.get(file.path) !== newByPath.get(file.path)) changed.add(file.path);
    }
    for (const file of current.files) {
      if (!newByPath.has(file.path)) changed.add(file.path);
    }
    return [...changed].sort();
  }

  private async writeVersion(input: {
    artifactDir: string;
    kind: ArtifactKind;
    title: string;
    entry: string;
    files: NormalizedFile[];
    now: Date;
    restoredFrom: string | null;
    existingVersions: string[];
  }): Promise<{ id: string; manifest: VersionManifest; totalBytes: number }> {
    const versionsDir = path.join(input.artifactDir, 'versions');
    await ensureDir(versionsDir);
    const version = newVersionId(input.now, input.existingVersions.at(-1));
    assertVersionId(version);
    const tempDir = path.join(input.artifactDir, `.tmp-${version}-${randomHex(6)}`);
    await fs.mkdir(tempDir, { mode: 0o700 });

    try {
      const records: ArtifactFileRecord[] = [];
      let totalBytes = 0;
      for (const file of input.files) {
        const target = resolveWithin(tempDir, file.path);
        await writeFileDurable(target, file.bytes, 0o600);
        records.push({
          path: file.path,
          bytes: file.bytes.byteLength,
          sha256: sha256(file.bytes),
          mime: file.mime,
        });
        totalBytes += file.bytes.byteLength;
      }
      const manifest: VersionManifest = {
        schema: 1,
        kind: input.kind,
        entry: input.entry,
        title: input.title,
        createdAt: input.now.toISOString(),
        restoredFrom: input.restoredFrom,
        files: records,
      };
      await writeJsonDurable(path.join(tempDir, 'manifest.json'), manifest);
      await renameWithRetry(tempDir, path.join(versionsDir, version));
      return { id: version, manifest, totalBytes };
    } catch (error) {
      await fs.rm(tempDir, { recursive: true, force: true });
      throw error;
    }
  }

  private async readManifest(id: string, version: string): Promise<VersionManifest> {
    assertVersionId(version);
    const versionDir = resolveVersionDir(this.root, id, version);
    try {
      const raw = await readJson(path.join(versionDir, 'manifest.json'));
      return parseVersionManifest(raw);
    } catch (error) {
      if (errorCode(error) === 'ENOENT') {
        throw new StoreError('NOT_FOUND', 'Version not found');
      }
      throw error;
    }
  }

  private async updateMeta(
    id: string,
    mutate: (meta: ArtifactMeta, now: Date) => ArtifactMeta,
  ): Promise<ArtifactMeta> {
    await this.ensureInit();
    assertArtifactId(id);
    const artifactDir = resolveArtifactDir(this.root, id);
    const lockDir = this.lockPath(id);

    return withArtifactLock(
      lockDir,
      async () => {
        const meta = await this.getMeta(id);
        const next = mutate(meta, this.now());
        await writeJsonAtomic(path.join(artifactDir, 'meta.json'), next);
        return next;
      },
      this.lockOptions(),
    );
  }

  private async readFileAt(versionDir: string, filePath: string): Promise<Uint8Array> {
    try {
      const absolute = resolveWithin(versionDir, filePath);
      await assertRealpathWithin(versionDir, absolute);
      return await fs.readFile(absolute);
    } catch (error) {
      if (errorCode(error) === 'ENOENT') {
        throw new StoreError('NOT_FOUND', 'File not found');
      }
      throw error;
    }
  }

  private pruneMeta(meta: ArtifactMeta): { meta: ArtifactMeta; removed: string[] } {
    if (meta.versions.length <= this.versionsKept) return { meta, removed: [] };
    const protectedIds = new Set<string>();
    protectedIds.add(meta.currentVersion);
    if (meta.pinnedVersion !== null) protectedIds.add(meta.pinnedVersion);

    const removable = meta.versions.filter((version) => !protectedIds.has(version.id));
    const excess = meta.versions.length - this.versionsKept;
    const toRemove = removable.slice(0, Math.max(0, excess));
    if (toRemove.length === 0) return { meta, removed: [] };

    const removed = toRemove.map((version) => version.id);
    const removedSet = new Set(removed);
    return {
      meta: { ...meta, versions: meta.versions.filter((version) => !removedSet.has(version.id)) },
      removed,
    };
  }
}

function randomBytes(size: number): Uint8Array {
  return Buffer.from(randomHex(size), 'hex');
}

function normalizeTitle(title: string): string {
  if (typeof title !== 'string') {
    throw new StoreError('INVALID_ARTIFACT', 'Title must be a string');
  }
  const normalized = title.trim().replace(/\s+/g, ' ');
  if (normalized.length === 0 || normalized.length > 200) {
    throw new StoreError('INVALID_ARTIFACT', 'Title must be 1 to 200 characters');
  }
  return normalized;
}

function normalizeTags(tags: string[] | undefined): string[] {
  if (tags === undefined) return [];
  if (!Array.isArray(tags)) {
    throw new StoreError('INVALID_ARTIFACT', 'Tags must be an array');
  }
  const result: string[] = [];
  const seen = new Set<string>();
  for (const tag of tags) {
    if (typeof tag !== 'string') {
      throw new StoreError('INVALID_ARTIFACT', 'Tags must be strings');
    }
    const normalized = tag.trim();
    if (normalized.length === 0) continue;
    if (normalized.length > 32) {
      throw new StoreError('INVALID_ARTIFACT', 'Tags must be at most 32 characters');
    }
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(normalized);
  }
  if (result.length > 16) {
    throw new StoreError('INVALID_ARTIFACT', 'At most 16 tags are allowed');
  }
  return result;
}

function normalizeOptional(value: string | null | undefined, maxLength: number): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') {
    throw new StoreError('INVALID_ARTIFACT', 'Expected a string or null');
  }
  const normalized = value.trim();
  if (normalized.length === 0) return null;
  if (normalized.length > maxLength) {
    throw new StoreError('INVALID_ARTIFACT', `Value must be at most ${maxLength} characters`);
  }
  return normalized;
}

function normalizeLibrarySet(value: string | undefined): string {
  if (value === undefined) return 'canvas-2026-10';
  if (typeof value !== 'string') {
    throw new StoreError('INVALID_ARTIFACT', 'librarySet must be a string');
  }
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > 64) {
    throw new StoreError('INVALID_ARTIFACT', 'librarySet must be 1 to 64 characters');
  }
  return normalized;
}

function normalizeLibraries(libraries: string[] | undefined): string[] {
  if (libraries === undefined) return [];
  if (!Array.isArray(libraries) || libraries.length > 16) {
    throw new StoreError('INVALID_ARTIFACT', 'libraries must contain at most 16 entries');
  }
  const seen = new Set<string>();
  const result: string[] = [];
  for (const name of libraries) {
    if (typeof name !== 'string' || !LIBRARY_NAME_RE.test(name)) {
      throw new StoreError('INVALID_ARTIFACT', 'Library names must be lowercase letters, digits, or hyphens');
    }
    if (seen.has(name)) continue;
    seen.add(name);
    result.push(name);
  }
  return result;
}

function normalizeLiveSources(live: LiveSource[] | undefined): LiveSource[] {
  if (live === undefined) return [];
  if (!Array.isArray(live) || live.length > 8) {
    throw new StoreError('INVALID_ARTIFACT', 'live must contain at most 8 entries');
  }
  const seen = new Set<string>();
  return live.map((source) => {
    if (typeof source !== 'object' || source === null) {
      throw new StoreError('INVALID_ARTIFACT', 'Each live source must be an object');
    }
    if (!LIVE_SOURCE_ID_RE.test(source.id)) {
      throw new StoreError('INVALID_ARTIFACT', 'Live source id is invalid');
    }
    if (seen.has(source.id)) {
      throw new StoreError('INVALID_ARTIFACT', 'Live source ids must be unique');
    }
    seen.add(source.id);
    if (source.kind !== 'file') {
      throw new StoreError('INVALID_ARTIFACT', 'Only file live sources are supported');
    }
    assertRelativePath(source.path);
    if (!['csv', 'json', 'text'].includes(source.format)) {
      throw new StoreError('INVALID_ARTIFACT', 'Live source format is invalid');
    }
    if (source.refresh !== 'open') {
      throw new StoreError('INVALID_ARTIFACT', 'Live source refresh must be open');
    }
    if (!Number.isInteger(source.maxBytes) || source.maxBytes < 1 || source.maxBytes > 10 * 1024 * 1024) {
      throw new StoreError('INVALID_ARTIFACT', 'Live source maxBytes is invalid');
    }
    return { ...source };
  });
}

function normalizeFiles(input: ArtifactFileInput[], allowEmpty = false): NormalizedFile[] {
  if (!Array.isArray(input)) {
    throw new StoreError('INVALID_ARTIFACT', 'Files must be an array');
  }
  if (input.length === 0) {
    if (allowEmpty) return [];
    throw new StoreError('INVALID_ARTIFACT', 'At least one file is required');
  }
  const seen = new Set<string>();
  const files: NormalizedFile[] = [];
  for (const file of input) {
    if (typeof file !== 'object' || file === null || typeof file.path !== 'string') {
      throw new StoreError('INVALID_ARTIFACT', 'Each file needs a path');
    }
    assertRelativePath(file.path);
    if (seen.has(file.path)) {
      throw new StoreError('INVALID_ARTIFACT', `Duplicate file path: ${file.path}`);
    }
    seen.add(file.path);
    if (typeof file.content !== 'string' && !(file.content instanceof Uint8Array)) {
      throw new StoreError('INVALID_ARTIFACT', 'Each file needs text or bytes');
    }
    if (file.mime !== undefined && typeof file.mime !== 'string') {
      throw new StoreError('INVALID_ARTIFACT', 'Each file mime must be a string');
    }
    const mime = file.mime?.trim() || mimeForPath(file.path);
    if (mime === undefined || mime.length === 0 || mime.length > 128) {
      throw new StoreError('UNSUPPORTED_FILE_TYPE', `Unsupported file type: ${path.extname(file.path) || file.path}`);
    }
    files.push({ path: file.path, bytes: toBytes(file.content), mime });
  }
  files.sort((left, right) => left.path.localeCompare(right.path));
  return files;
}

function resolveEntry(kind: ArtifactKind, files: NormalizedFile[], inputEntry: string | undefined): string {
  if (inputEntry !== undefined) {
    assertRelativePath(inputEntry);
    if (!files.some((file) => file.path === inputEntry)) {
      throw new StoreError('ENTRY_NOT_FOUND', 'Entry is not in files');
    }
    return inputEntry;
  }
  if (kind === 'html') {
    const only = files[0];
    if (only === undefined) {
      throw new StoreError('INVALID_ARTIFACT', 'An html artifact needs one file');
    }
    return only.path;
  }
  throw new StoreError('ENTRY_NOT_FOUND', 'A bundle needs an entry file');
}

function validateFileSet(kind: ArtifactKind, files: NormalizedFile[], entry: string, limits: Limits): void {
  if (files.length > limits.maxBundleFiles) {
    throw new StoreError('TOO_MANY_FILES', `A bundle is limited to ${limits.maxBundleFiles} files`);
  }
  let totalBytes = 0;
  for (const file of files) {
    if (file.bytes.byteLength > limits.maxFileBytes) {
      throw new StoreError('TOO_LARGE', `A file is limited to ${limits.maxFileBytes} bytes`);
    }
    totalBytes += file.bytes.byteLength;
  }
  if (kind === 'html') {
    if (files.length !== 1) {
      throw new StoreError('INVALID_ARTIFACT', 'An html artifact takes exactly one file; use bundle');
    }
    if (totalBytes > limits.maxHtmlBytes) {
      throw new StoreError('TOO_LARGE', `An html artifact is limited to ${limits.maxHtmlBytes} bytes`);
    }
  } else if (kind === 'bundle') {
    if (totalBytes > limits.maxBundleBytes) {
      throw new StoreError('TOO_LARGE', `A bundle is limited to ${limits.maxBundleBytes} bytes`);
    }
  } else {
    throw new StoreError('UNSUPPORTED_KIND', `${kind} artifacts are not implemented yet`);
  }

  const entryFile = files.find((file) => file.path === entry);
  if (entryFile === undefined) {
    throw new StoreError('ENTRY_NOT_FOUND', 'Entry is not in files');
  }
  if (entryFile.bytes.byteLength === 0) {
    throw new StoreError('INVALID_ARTIFACT', 'Entry is empty');
  }
  if (!/\.html?$/i.test(entry)) {
    throw new StoreError('INVALID_ARTIFACT', 'Entry must be an HTML file');
  }
}

function summarizeVersion(
  id: string,
  manifest: VersionManifest,
  totalBytes: number,
): VersionSummary {
  return {
    id,
    createdAt: manifest.createdAt,
    bytes: totalBytes,
    files: manifest.files.length,
    title: manifest.title,
    restoredFrom: manifest.restoredFrom,
  };
}

function countOccurrences(haystack: string, needle: string): number {
  let count = 0;
  let from = 0;
  for (;;) {
    const at = haystack.indexOf(needle, from);
    if (at === -1) return count;
    count += 1;
    from = at + needle.length;
  }
}

function applyEdits(source: string, edits: TextEdit[]): string {
  if (!Array.isArray(edits) || edits.length === 0 || edits.length > 20) {
    throw new StoreError('INVALID_UPDATE', 'edits must contain 1 to 20 entries');
  }
  let result = source;
  for (let index = 0; index < edits.length; index += 1) {
    const edit = edits[index];
    if (edit === undefined || typeof edit.find !== 'string' || edit.find.length === 0 || edit.find.length > 4096) {
      throw new StoreError('INVALID_UPDATE', `edits[${index}].find must be 1 to 4096 characters`);
    }
    if (typeof edit.replace !== 'string' || edit.replace.length > 65536) {
      throw new StoreError('INVALID_UPDATE', `edits[${index}].replace must be 0 to 65536 characters`);
    }
    const matches = countOccurrences(result, edit.find);
    if (matches !== 1) {
      throw new StoreError('EDIT_CONFLICT', `Edit ${index} matched ${matches} times`, {
        index,
        matches,
      });
    }
    const at = result.indexOf(edit.find);
    result = result.slice(0, at) + edit.replace + result.slice(at + edit.find.length);
  }
  return result;
}
