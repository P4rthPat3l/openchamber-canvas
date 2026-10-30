import { z } from 'zod';

import type { ArtifactStore } from '../store/index';
import { StoreError, isStoreError } from '../store/errors';
import { isTextMime } from '../store/fs';
import { normalizeDirectory } from '../store/paths';
import type {
  ArtifactFileInput,
  ArtifactKind,
  ArtifactMeta,
  TextEdit,
  UpdateInput,
} from '../store/types';
import { ViewerUnavailableError, ensureViewer, mintViewUrl, notifyViewer } from '../viewer/ensure';
import { fileSchema, schemas } from './schemas';
import type { OperationName } from './schemas';
import {
  decodeBase64,
  entryContent,
  readDirectorySource,
  readHtmlFile,
  scanExternalReferences,
} from './source';

const MAX_READ_BYTES = 2 * 1024 * 1024;
type PublishArgs = z.infer<typeof schemas.publish>;
type UpdateArgs = z.infer<typeof schemas.update>;

export interface AgentContext {
  directory: string;
  sessionId: string;
  signal: AbortSignal;
}

export interface OperationResult {
  value: unknown;
  isError: boolean;
}

export interface OperationsOptions {
  store: ArtifactStore;
  storeRoot: string;
  portFile: string;
  viewerEntry: string;
  viewerTimeoutMs: number;
}

export interface CanvasOperations {
  execute(name: OperationName, input: unknown, context: AgentContext): Promise<OperationResult>;
}

interface PublishSource {
  kind: ArtifactKind;
  files: ArtifactFileInput[];
  entry: string;
  warnings: string[];
}

type UpdateSource =
  | { mode: 'metadata'; warnings: string[] }
  | { mode: 'replace'; files: ArtifactFileInput[]; entry: string; warnings: string[] }
  | {
      mode: 'merge';
      files: ArtifactFileInput[];
      remove: string[];
      entry: string;
      warnings: string[];
    }
  | { mode: 'edits'; edits: TextEdit[]; path?: string; warnings: string[] }
  | { mode: 'restore'; restoreFrom: string; warnings: string[] };

function projectDirectory(input: string | undefined, context: AgentContext): string {
  return normalizeDirectory(input ?? context.directory, context.directory);
}

function ok(value: unknown): OperationResult {
  return { value, isError: false };
}

function fail(
  code: string,
  message: string,
  details?: Record<string, unknown> | Readonly<Record<string, unknown>>,
): OperationResult {
  return { value: { error: { code, message, ...(details ?? {}) } }, isError: true };
}

function fromError(error: unknown): OperationResult {
  if (error instanceof z.ZodError) return fail('INVALID_INPUT', error.message);
  if (isStoreError(error)) {
    return fail(error.code, error.message, error.details);
  }
  if (error instanceof ViewerUnavailableError) {
    return fail('VIEWER_UNAVAILABLE', error.message);
  }
  if (error instanceof Error) {
    return fail('INTERNAL', error.message);
  }
  return fail('INTERNAL', 'Unknown error');
}

function normalizeInputFile(file: z.infer<typeof fileSchema>): ArtifactFileInput {
  if (file.content !== undefined && file.contentBase64 !== undefined) {
    throw new StoreError('INVALID_ARTIFACT', 'A file takes content or contentBase64, not both');
  }
  if (file.content !== undefined) {
    return { path: file.path, content: file.content };
  }
  if (file.contentBase64 !== undefined) {
    return { path: file.path, content: decodeBase64(file.contentBase64) };
  }
  throw new StoreError('INVALID_ARTIFACT', 'A file needs content or contentBase64');
}

function resolvePublishSource(args: PublishArgs, directory: string): Promise<PublishSource> {
  const sources = [
    args.html !== undefined,
    args.files !== undefined,
    args.filePath !== undefined,
    args.directoryPath !== undefined,
  ].filter(Boolean).length;
  if (sources !== 1) {
    throw new StoreError('INVALID_ARTIFACT', 'Use exactly one of html, files, filePath, or directoryPath');
  }

  if (args.html !== undefined) {
    if (args.kind !== undefined && args.kind !== 'html') {
      throw new StoreError('INVALID_ARTIFACT', 'html input creates an html artifact');
    }
    return Promise.resolve({
      kind: 'html',
      files: [{ path: 'index.html', content: args.html }],
      entry: 'index.html',
      warnings: [],
    });
  }

  if (args.files !== undefined) {
    const files = args.files.map(normalizeInputFile);
    const kind = args.kind ?? (files.length > 1 || args.entry !== undefined ? 'bundle' : 'html');
    const entry = args.entry ?? (kind === 'bundle' ? 'index.html' : (files[0]?.path ?? 'index.html'));
    return Promise.resolve({ kind, files, entry, warnings: [] });
  }

  if (args.filePath !== undefined) {
    if (args.kind !== undefined && args.kind !== 'html') {
      throw new StoreError('INVALID_ARTIFACT', 'filePath creates an html artifact');
    }
    return readHtmlFile(directory, args.filePath).then((source) => ({
      kind: 'html',
      files: [{ path: 'index.html', content: source.html }],
      entry: 'index.html',
      warnings: source.warnings,
    }));
  }

  if (args.kind !== undefined && args.kind !== 'bundle') {
    throw new StoreError('INVALID_ARTIFACT', 'directoryPath creates a bundle');
  }
  return readDirectorySource(directory, args.directoryPath ?? '', args.entry ?? 'index.html').then(
    (source) => ({
      kind: 'bundle',
      files: source.files,
      entry: source.entry,
      warnings: source.warnings,
    }),
  );
}

export function createOperations(options: OperationsOptions): CanvasOperations {
const { store, storeRoot, portFile, viewerEntry, viewerTimeoutMs } = options;

async function resolveUpdateSource(args: UpdateArgs, meta: ArtifactMeta, context: AgentContext): Promise<UpdateSource> {
  const sources = [
    args.restoreFrom !== undefined,
    args.edits !== undefined,
    args.html !== undefined,
    args.files !== undefined,
    args.filePath !== undefined,
    args.directoryPath !== undefined,
  ].filter(Boolean).length;
  if (sources !== 1) {
    if (sources === 0 && (args.title !== undefined || args.tags !== undefined) &&
        args.mode === undefined && args.entry === undefined && args.remove === undefined && args.path === undefined) {
      return { mode: 'metadata', warnings: [] };
    }
    throw new StoreError(
      'INVALID_UPDATE',
      'Use exactly one of restoreFrom, edits, html, files, filePath, or directoryPath',
    );
  }

  const directory = projectDirectory(args.directory, context);

  if (args.restoreFrom !== undefined) {
    return { mode: 'restore', restoreFrom: args.restoreFrom, warnings: [] };
  }

  if (args.edits !== undefined) {
    return {
      mode: 'edits',
      edits: args.edits,
      ...(args.path === undefined ? {} : { path: args.path }),
      warnings: [],
    };
  }

  if (args.html !== undefined) {
    return {
      mode: 'replace',
      files: [{ path: 'index.html', content: args.html }],
      entry: 'index.html',
      warnings: [],
    };
  }

  if (args.filePath !== undefined) {
    if (meta.kind !== 'html') {
      throw new StoreError('INVALID_UPDATE', 'filePath replaces a single html artifact');
    }
    const source = await readHtmlFile(directory, args.filePath);
    return {
      mode: 'replace',
      files: [{ path: 'index.html', content: source.html }],
      entry: 'index.html',
      warnings: source.warnings,
    };
  }

  if (args.directoryPath !== undefined) {
    if (meta.kind !== 'bundle') {
      throw new StoreError('INVALID_UPDATE', 'directoryPath replaces a bundle');
    }
    const source = await readDirectorySource(
      directory,
      args.directoryPath,
      args.entry ?? 'index.html',
    );
    return {
      mode: 'replace',
      files: source.files,
      entry: source.entry,
      warnings: source.warnings,
    };
  }

  const files = (args.files ?? []).map(normalizeInputFile);
  const current = await store.read(args.id);
  const mode = args.mode ?? 'merge';
  const entry = args.entry ?? current.manifest.entry;
  if (mode === 'replace') {
    return { mode: 'replace', files, entry, warnings: [] };
  }
  return { mode: 'merge', files, remove: args.remove ?? [], entry, warnings: [] };
}

function scanPublishSource(source: PublishSource): string | null {
  const html = entryContent(source.files, source.entry);
  return html === null ? null : scanExternalReferences(html);
}

function scanUpdateSource(source: UpdateSource): string | null {
  if (source.mode === 'replace' || source.mode === 'merge') {
    const html = entryContent(source.files, source.entry);
    return html === null ? null : scanExternalReferences(html);
  }
  if (source.mode === 'edits') {
    for (const edit of source.edits) {
      const external = scanExternalReferences(edit.replace);
      if (external !== null) return external;
    }
  }
  return null;
}

function summarizeMeta(meta: ArtifactMeta): Record<string, unknown> {
  return {
    tags: meta.tags,
    versions: meta.versions.length,
    currentVersion: meta.currentVersion,
    librarySet: meta.librarySet,
    libraries: meta.libraries,
  };
}

async function openViewer(id: string, signal: AbortSignal): Promise<{ viewUrl: string | null; warnings: string[] }> {
  const warnings: string[] = [];
  try {
    const viewer = await ensureViewer({
      storeRoot,
      portFile,
      viewerEntry,
      timeoutMs: viewerTimeoutMs,
      signal,
    });
    const minted = await mintViewUrl(viewer, { id }, signal);
    return { viewUrl: minted.url, warnings };
  } catch (error) {
    warnings.push(error instanceof Error ? error.message : 'The viewer is unavailable.');
    return { viewUrl: null, warnings };
  }
}

async function notifyChange(id: string, version: string, signal: AbortSignal): Promise<string[]> {
  try {
    const viewer = await ensureViewer({
      storeRoot,
      portFile,
      viewerEntry,
      timeoutMs: viewerTimeoutMs,
      signal,
    });
    await notifyViewer(viewer, { id, event: 'changed', version }, signal);
    return [];
  } catch (error) {
    return [error instanceof Error ? error.message : 'The viewer is unavailable.'];
  }
}

async function publish(args: PublishArgs, context: AgentContext): Promise<OperationResult> {
    try {
      const directory = projectDirectory(args.directory, context);
      const source = await resolvePublishSource(args, directory);
      const external = scanPublishSource(source);
      if (external !== null) {
        return fail(
          'EXTERNAL_REFERENCE',
          `The entry loads ${external} from a URL. Inline it or use a pinned library.`,
        );
      }
      context.signal.throwIfAborted();
      const created = await store.create({
        title: args.title,
        kind: source.kind,
        directory,
        files: source.files,
        entry: source.entry,
        sessionId: context.sessionId,
        tags: args.tags,
        libraries: args.libraries,
         dedupeKey: args.dedupeKey,
          baseVersion: args.baseVersion,
      }, context.signal);
      const viewer = await openViewer(created.id, context.signal);
      const notifyWarnings = created.deduped && created.contentChanged ? await notifyChange(created.id, created.version, context.signal) : [];
      return ok({
        id: created.id,
        title: created.meta.title,
        kind: created.meta.kind,
        version: created.version,
        viewUrl: viewer.viewUrl,
        deduped: created.deduped,
        contentChanged: created.contentChanged,
        warnings: [...source.warnings, ...viewer.warnings, ...notifyWarnings],
      });
    } catch (error) {
      return fromError(error);
    }
}

async function update(args: UpdateArgs, context: AgentContext): Promise<OperationResult> {
    try {
      const meta = await store.getMeta(args.id);
      const source = await resolveUpdateSource(args, meta, context);
      const external = scanUpdateSource(source);
      if (external !== null) {
        return fail(
          'EXTERNAL_REFERENCE',
          `The update loads ${external} from a URL. Inline it or use a pinned library.`,
        );
      }

      const baseVersion = args.baseVersion;
      if (baseVersion === undefined) {
        return fail('INVALID_UPDATE', `baseVersion is required for ${source.mode}`);
      }

      let input: UpdateInput;
      if (source.mode === 'metadata') {
        input = { mode: 'metadata', title: args.title, tags: args.tags, baseVersion };
      } else if (source.mode === 'replace') {
        input = {
          mode: 'replace',
          files: source.files,
          entry: source.entry,
          title: args.title,
          tags: args.tags,
          baseVersion,
        };
      } else if (source.mode === 'merge') {
        input = {
          mode: 'merge',
          files: source.files,
          remove: source.remove,
          entry: source.entry,
          title: args.title,
          tags: args.tags,
           baseVersion,
        };
      } else if (source.mode === 'edits') {
        input = {
          mode: 'edits',
          edits: source.edits,
          path: source.path,
          title: args.title,
          tags: args.tags,
           baseVersion,
        };
      } else {
        input = {
          mode: 'restore',
          restoreFrom: source.restoreFrom,
          title: args.title,
          tags: args.tags,
           baseVersion,
        };
      }

      context.signal.throwIfAborted();
      const updated = await store.update(args.id, input, context.signal);
      const viewer = await openViewer(args.id, context.signal);
      const notifyWarnings =
        viewer.viewUrl === null || source.mode === 'metadata' ? [] : await notifyChange(args.id, updated.version, context.signal);
      return ok({
        id: updated.id,
        version: updated.version,
        changedFiles: updated.changedFiles,
        viewUrl: viewer.viewUrl,
        warnings: [...source.warnings, ...viewer.warnings, ...notifyWarnings],
      });
    } catch (error) {
      return fromError(error);
    }
}

async function list(args: z.infer<typeof schemas.list>, context: AgentContext): Promise<OperationResult> {
      try {
      if (args.allProjects && args.directory !== undefined) return fail('INVALID_PATH', 'Use directory or allProjects, not both');
      const result = await store.list({
        directory: args.allProjects ? undefined : projectDirectory(args.directory, context),
        query: args.query,
        kind: args.kind,
        tag: args.tag,
        limit: args.limit,
        includeArchived: args.includeArchived,
        offset: args.offset,
        sort: args.sort,
      });
      return ok(result);
    } catch (error) {
      return fromError(error);
    }
}

async function read(args: z.infer<typeof schemas.read>): Promise<OperationResult> {
    try {
      const result = await store.read(args.id, args.version);
      const meta = summarizeMeta(result.meta);
      meta.rendering = result.manifest.rendering ?? null;
      meta.warnings = result.manifest.rendering ? [] : ['Legacy version uses installed, unpinned rendering dependencies.'];

      if (args.path !== undefined) {
        const record = result.manifest.files.find((file) => file.path === args.path);
        if (record === undefined) {
          throw new StoreError('PATH_NOT_FOUND', 'File not found in this version');
        }
        const bytes = await store.readFile(args.id, result.version, record.path);
        if (bytes.byteLength > MAX_READ_BYTES) {
          throw new StoreError('TOO_LARGE', 'The file is larger than 2 MiB');
        }
        const encoded = isTextMime(record.mime)
          ? { encoding: 'text' as const, content: new TextDecoder().decode(bytes) }
          : { encoding: 'base64' as const, content: Buffer.from(bytes).toString('base64') };
        return ok({
          id: args.id,
          version: result.version,
          path: record.path,
          ...encoded,
          meta,
        });
      }

      if (args.includeFiles === true) {
        const version = await store.readVersion(args.id, args.version);
        const total = version.files.reduce((sum, file) => sum + file.content.byteLength, 0);
        if (total > MAX_READ_BYTES) {
          throw new StoreError('TOO_LARGE', 'The bundle source is larger than 2 MiB; read one path');
        }
        return ok({
          id: args.id,
          version: version.version,
          kind: version.meta.kind,
          title: version.meta.title,
          files: version.files.map((file) =>
            isTextMime(file.mime)
              ? { path: file.path, encoding: 'text', content: new TextDecoder().decode(file.content) }
              : {
                  path: file.path,
                  encoding: 'base64',
                  content: Buffer.from(file.content).toString('base64'),
                },
          ),
          meta,
        });
      }

      const bytes = await store.readFile(args.id, result.version, result.manifest.entry);
      if (bytes.byteLength > MAX_READ_BYTES) {
        throw new StoreError('TOO_LARGE', 'The entry is larger than 2 MiB');
      }
      let html: string;
      try {
        html = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      } catch {
        throw new StoreError('INVALID_ARTIFACT', 'The entry is not valid UTF-8');
      }
      return ok({
        id: args.id,
        version: result.version,
        kind: result.meta.kind,
        title: result.meta.title,
        html,
        meta,
      });
    } catch (error) {
      return fromError(error);
    }
}

async function archive(args: z.infer<typeof schemas.archive>, context: AgentContext): Promise<OperationResult> {
    try {
      context.signal.throwIfAborted();
      const meta = await store.archive(args.id, true, context.signal);
      return ok({ archived: true, id: meta.id });
    } catch (error) {
      return fromError(error);
    }
}

async function result(args: z.infer<typeof schemas.result>): Promise<OperationResult> {
    try {
      const page = await store.feedbackPage(args.id, {
        since: args.since,
        limit: args.limit,
        offset: args.offset,
      });
      return ok(page);
    } catch (error) {
      return fromError(error);
    }
}

return {
  async execute(name, input, context) {
    context.signal.throwIfAborted();
    try {
      let response: OperationResult;
      switch (name) {
        case 'publish': response = await publish(schemas.publish.parse(input), context); break;
        case 'update': response = await update(schemas.update.parse(input), context); break;
        case 'list': response = await list(schemas.list.parse(input), context); break;
        case 'read': response = await read(schemas.read.parse(input)); break;
        case 'archive': response = await archive(schemas.archive.parse(input), context); break;
        case 'result': response = await result(schemas.result.parse(input)); break;
      }
      if (response.isError) context.signal.throwIfAborted();
      return response;
    } catch (error) {
      context.signal.throwIfAborted();
      return fromError(error);
    }
  },
};
}
