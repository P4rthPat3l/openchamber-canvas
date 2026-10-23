import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { StoreError } from './errors';
import { ensureDir, sleep, writeFileDurable } from './fs';
import { errorCode as fsErrorCode } from './paths';

export interface LockOptions {
  retryMs: number;
  timeoutMs: number;
  staleMs: number;
}

interface LockOwner {
  pid: number;
  at: string;
}

async function removeStaleLock(lockDir: string, staleMs: number): Promise<void> {
  try {
    const stats = await fs.stat(lockDir);
    if (Date.now() - stats.mtimeMs > staleMs) {
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

  for (;;) {
    try {
      await fs.mkdir(lockDir, { mode: 0o700 });
      const owner: LockOwner = { pid: process.pid, at: new Date().toISOString() };
      try {
        await writeFileDurable(path.join(lockDir, 'owner.json'), `${JSON.stringify(owner)}\n`);
      } catch (error) {
        await fs.rm(lockDir, { recursive: true, force: true });
        throw error;
      }
      break;
    } catch (error) {
      if (fsErrorCode(error) !== 'EEXIST') throw error;
      await removeStaleLock(lockDir, options.staleMs);
      if (Date.now() - startedAt >= options.timeoutMs) {
        throw new StoreError('LOCK_TIMEOUT', 'Another writer held the artifact lock too long');
      }
      await sleep(options.retryMs);
    }
  }

  try {
    return await action();
  } finally {
    await fs.rm(lockDir, { recursive: true, force: true });
  }
}
