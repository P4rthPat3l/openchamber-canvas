import * as crypto from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { StoreError } from './errors';
import { errorCode } from './paths';

const MIME_TYPES = new Map<string, string>([
  ['.html', 'text/html; charset=utf-8'],
  ['.htm', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.txt', 'text/plain; charset=utf-8'],
  ['.md', 'text/markdown; charset=utf-8'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.webp', 'image/webp'],
  ['.gif', 'image/gif'],
  ['.svg', 'image/svg+xml'],
  ['.woff', 'font/woff'],
  ['.woff2', 'font/woff2'],
  ['.wasm', 'application/wasm'],
  ['.pdf', 'application/pdf'],
]);

export function mimeForPath(filePath: string): string | undefined {
  return MIME_TYPES.get(path.extname(filePath).toLowerCase());
}

export function isTextMime(mime: string): boolean {
  const base = mime.split(';', 1)[0]?.trim().toLowerCase() ?? '';
  return base.startsWith('text/') || base === 'application/json' || base === 'application/javascript';
}

export function toBytes(content: string | Uint8Array): Uint8Array {
  return typeof content === 'string' ? Buffer.from(content, 'utf8') : content;
}

export function sha256(data: Uint8Array): string {
  return crypto.createHash('sha256').update(data).digest('hex');
}

export function randomHex(bytes: number): string {
  return crypto.randomBytes(bytes).toString('hex');
}

export async function ensureDir(directory: string): Promise<void> {
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
}

export async function pathExists(target: string): Promise<boolean> {
  try {
    await fs.access(target);
    return true;
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return false;
    throw error;
  }
}

export async function writeFileDurable(
  filePath: string,
  data: string | Uint8Array,
  mode = 0o600,
): Promise<void> {
  await ensureDir(path.dirname(filePath));
  const handle = await fs.open(filePath, 'w', mode);
  try {
    await handle.writeFile(data);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

export async function writeJsonDurable(filePath: string, value: unknown): Promise<void> {
  await writeFileDurable(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

export async function renameWithRetry(from: string, to: string, attempts = 5): Promise<void> {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await fs.rename(from, to);
      return;
    } catch (error) {
      const code = errorCode(error);
      if ((code === 'EPERM' || code === 'EBUSY' || code === 'EACCES') && attempt < attempts) {
        await sleep(20 * attempt);
        continue;
      }
      throw error;
    }
  }
}

export async function writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
  const temporary = `${filePath}.tmp-${randomHex(6)}`;
  try {
    await writeJsonDurable(temporary, value);
    await renameWithRetry(temporary, filePath);
  } catch (error) {
    await fs.rm(temporary, { force: true });
    throw error;
  }
}

export async function readJson(filePath: string): Promise<unknown> {
  const text = await fs.readFile(filePath, 'utf8');
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed;
  } catch {
    throw new StoreError('INVALID_META', `${path.basename(filePath)} is not valid JSON`);
  }
}

export function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
