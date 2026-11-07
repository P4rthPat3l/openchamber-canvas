import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';

import { StoreError } from './errors';
import { ensureDir, sleep, writeFileDurable } from './fs';
import { errorCode as fsErrorCode } from './paths';

export interface LockOptions {
  retryMs: number;
  timeoutMs: number;
  staleMs: number;
  signal?: AbortSignal;
  protectLiveOwner?: boolean;
}

interface LockOwner {
  pid: number;
  at: string;
  token?: string;
}

async function readOwner(lockDir: string): Promise<LockOwner | null> {
  try {
    const value: unknown = JSON.parse(await fs.readFile(path.join(lockDir, 'owner.json'), 'utf8'));
    if (typeof value !== 'object' || value === null || !('pid' in value) || typeof value.pid !== 'number' || !Number.isSafeInteger(value.pid) || value.pid <= 0 || !('at' in value) || typeof value.at !== 'string') return null;
    return { pid: value.pid, at: value.at, token: 'token' in value && typeof value.token === 'string' ? value.token : undefined };
  } catch (error) {
    if (fsErrorCode(error) === 'ENOENT' || error instanceof SyntaxError) return null;
    throw error;
  }
}

function ownerIsAlive(owner: LockOwner): boolean {
  try { process.kill(owner.pid, 0); return true; }
  catch (error) {
    if (fsErrorCode(error) === 'ESRCH') return false;
    if (fsErrorCode(error) === 'EPERM') return true;
    throw error;
  }
}

async function removeStaleLock(lockDir: string, options: LockOptions): Promise<void> {
  try {
    const stats = await (options.protectLiveOwner ? fs.lstat(lockDir) : fs.stat(lockDir));
    if (options.protectLiveOwner && stats.isSymbolicLink()) throw new StoreError('INVALID_PATH', 'Preview lock cannot be a symlink');
    if (Date.now() - stats.mtimeMs > options.staleMs) {
      if (options.protectLiveOwner) {
        const owner = await readOwner(lockDir);
        if (owner && ownerIsAlive(owner)) return;
        const current = await fs.lstat(lockDir);
        if (current.ino !== stats.ino || current.dev !== stats.dev || current.mtimeMs !== stats.mtimeMs) return;
      }
      await fs.rm(lockDir, { recursive: true, force: true });
    }
  } catch (error) {
    if (fsErrorCode(error) !== 'ENOENT') throw error;
  }
}

export async function withArtifactLock<T>(
  lockDir: string,
  action: () => Promise<T>,
  options: LockOptions,
): Promise<T> {
  await ensureDir(path.dirname(lockDir));
  const startedAt = Date.now();
  const token = options.protectLiveOwner ? randomUUID() : undefined;

  for (;;) {
    options.signal?.throwIfAborted();
    try {
      await fs.mkdir(lockDir, { mode: 0o700 });
      const owner: LockOwner = { pid: process.pid, at: new Date().toISOString(), ...(token ? { token } : {}) };
      try {
        await writeFileDurable(path.join(lockDir, 'owner.json'), `${JSON.stringify(owner)}\n`);
      } catch (error) {
        if (!options.protectLiveOwner || (await readOwner(lockDir))?.token === token) {
          await fs.rm(lockDir, { recursive: true, force: true });
        }
        throw error;
      }
      break;
    } catch (error) {
      options.signal?.throwIfAborted();
      if (fsErrorCode(error) !== 'EEXIST') throw error;
      await removeStaleLock(lockDir, options);
      if (Date.now() - startedAt >= options.timeoutMs) {
        throw new StoreError('LOCK_TIMEOUT', 'Another writer held the artifact lock too long');
      }
      await sleep(options.retryMs);
    }
  }

  try {
    options.signal?.throwIfAborted();
    return await action();
  } finally {
    if (!options.protectLiveOwner || (await readOwner(lockDir))?.token === token) {
      await fs.rm(lockDir, { recursive: true, force: true });
    }
  }
}
