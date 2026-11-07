import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { ArtifactStore } from '../store/index';
import { StoreError } from '../store/errors';
import { sha256 } from '../store/fs';
import { withArtifactLock } from '../store/lock';
import { ARTIFACT_ID_RE, assertArtifactId, assertRealpathWithin, errorCode } from '../store/paths';
import type { ArtifactMeta, CreateArtifactInput, CreateResult, ReadVersionResult } from '../store/types';
import type { RenderingSource } from '../viewer/rendering';
import { loadRendering } from '../viewer/rendering';

export const PREVIEW_TTL_MS = 30 * 60 * 1000;

export interface PreviewOwner { directory: string; sessionId: string }
interface PreviewOptions { root: string; renderingSource?: RenderingSource; now?: () => Date }

export class PreviewStore {
  readonly storeRoot: string;
  private readonly store: ArtifactStore;
  private readonly root: string;
  private readonly now: () => Date;

  constructor(options: PreviewOptions) {
    this.root = path.resolve(options.root);
    this.storeRoot = path.join(this.root, '.previews');
    this.now = options.now ?? (() => new Date());
    this.store = new ArtifactStore({ root: this.storeRoot, renderingSource: options.renderingSource, now: this.now });
  }

  private async init(): Promise<void> {
    await fs.mkdir(this.root, { recursive: true });
    for (const directory of [this.storeRoot, path.join(this.storeRoot, '.locks'), path.join(this.storeRoot, 'trash')]) {
      await fs.mkdir(directory, { recursive: true });
      if ((await fs.lstat(directory)).isSymbolicLink()) throw new StoreError('INVALID_PATH', 'Preview directories cannot be symlinks');
      await assertRealpathWithin(this.root, directory);
    }
  }

  expiresAt(meta: ArtifactMeta): number {
    return Date.parse(meta.createdAt) + PREVIEW_TTL_MS;
  }

  async create(input: CreateArtifactInput, signal?: AbortSignal): Promise<CreateResult> {
    signal?.throwIfAborted();
    await this.cleanup(signal);
    return this.store.create(input, signal);
  }

  async use<T>(id: string, action: (store: ArtifactStore, meta: ArtifactMeta) => Promise<T>, signal?: AbortSignal): Promise<T> {
    await this.init();
    assertArtifactId(id);
    return withArtifactLock(this.lockPath(id), async () => {
      const directory = path.join(this.storeRoot, id);
      try {
        if ((await fs.lstat(directory)).isSymbolicLink()) throw new StoreError('INVALID_PATH', 'Preview cannot be a symlink');
        await assertRealpathWithin(this.storeRoot, directory);
      } catch (error) {
        if (errorCode(error) === 'ENOENT') throw new StoreError('NOT_FOUND', 'Preview not found. Create a new preview.');
        throw error;
      }
      const meta = await this.store.getMeta(id);
      if (this.expiresAt(meta) <= this.now().getTime()) throw new StoreError('PREVIEW_EXPIRED', 'Preview expired. Create and verify a new preview before publishing.');
      signal?.throwIfAborted();
      return action(this.store, meta);
    }, { retryMs: 25, timeoutMs: 5000, staleMs: 30_000, protectLiveOwner: true, signal });
  }

  async promote<T>(id: string, owner: PreviewOwner, action: (snapshot: ReadVersionResult) => Promise<T>, signal?: AbortSignal): Promise<T> {
    return this.use(id, async (store, meta) => {
      if (meta.directory !== owner.directory || meta.sessionId !== owner.sessionId) {
        throw new StoreError('PREVIEW_OWNERSHIP', 'Preview belongs to another project or session. Create a preview in this session.');
      }
      const snapshot = await store.readVersion(id);
      for (const file of snapshot.files) {
        if (file.bytes !== file.content.byteLength || file.sha256 !== sha256(file.content)) {
          throw new StoreError('INVALID_ARTIFACT', 'Preview content changed. Create and verify a new preview.');
        }
      }
      if (!snapshot.manifest.rendering) throw new StoreError('RENDERING_UNAVAILABLE', 'Preview has no pinned rendering');
      await loadRendering(this.storeRoot, snapshot.manifest.rendering);
      signal?.throwIfAborted();
      return action(snapshot);
    }, signal);
  }

  async cleanup(signal?: AbortSignal): Promise<void> {
    await this.init();
    for (const entry of await fs.readdir(this.storeRoot, { withFileTypes: true })) {
      signal?.throwIfAborted();
      if (!entry.isDirectory() || !ARTIFACT_ID_RE.test(entry.name)) continue;
      let initial: ArtifactMeta;
      try { initial = await this.store.getMeta(entry.name); }
      catch (error) { if (errorCode(error) === 'NOT_FOUND') continue; throw error; }
      if (this.expiresAt(initial) > this.now().getTime()) continue;
      try { await withArtifactLock(this.lockPath(entry.name), async () => {
        let meta: ArtifactMeta;
        try { meta = await this.store.getMeta(entry.name); }
        catch (error) { if (errorCode(error) === 'NOT_FOUND') return; throw error; }
        if (this.expiresAt(meta) > this.now().getTime()) return;
        const directory = path.join(this.storeRoot, entry.name);
        if ((await fs.lstat(directory)).isSymbolicLink()) return;
        await assertRealpathWithin(this.storeRoot, directory);
        signal?.throwIfAborted();
        await fs.rm(directory, { recursive: true });
      }, { retryMs: 25, timeoutMs: 0, staleMs: 30_000, protectLiveOwner: true, signal }); }
      catch (error) { if (errorCode(error) !== 'LOCK_TIMEOUT') throw error; }
    }
  }

  private lockPath(id: string): string {
    return path.join(this.storeRoot, '.locks', `preview-${id}.lock`);
  }
}
