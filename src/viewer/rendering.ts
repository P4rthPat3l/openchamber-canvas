import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { StoreError } from '../store/errors';
import { readJson, sha256, writeFileDurable, writeJsonDurable } from '../store/fs';
import { assertRealpathWithin, errorCode } from '../store/paths';
import { withArtifactLock } from '../store/lock';

export const RUNTIME_API = 1;
export interface RenderingSource { runtimeFile: string; librariesDir: string }
interface Library { file: string; bytes: number; sha256: string }
interface RenderingManifest { api: number; runtime: Library; libraries: Record<string, Library> }
export interface Rendering { runtime: string; libraries: Record<string, Buffer>; id: string }

export function packageRoot(): string {
  let directory = path.dirname(fileURLToPath(import.meta.url));
  for (let depth = 0; depth < 4; depth++) {
    if (path.basename(directory) === 'src') return path.dirname(directory);
    if (['mcp', 'service', 'viewer'].includes(path.basename(directory)) && path.basename(path.dirname(directory)) !== 'src') return path.dirname(directory);
    directory = path.dirname(directory);
  }
  throw new StoreError('RENDERING_UNAVAILABLE', 'Cannot locate the Canvas package');
}

export function installedRendering(): RenderingSource {
  const root = packageRoot();
  return { runtimeFile: path.join(root, 'viewer/runtime/canvas.js'), librariesDir: path.join(root, 'viewer/libraries') };
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function library(value: unknown): Library {
  if (!record(value) || typeof value.file !== 'string' || path.basename(value.file) !== value.file ||
      typeof value.bytes !== 'number' || typeof value.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(value.sha256)) {
    throw new StoreError('RENDERING_UNAVAILABLE', 'Invalid rendering file record');
  }
  return { file: value.file, bytes: value.bytes, sha256: value.sha256 };
}

function manifest(value: unknown): RenderingManifest {
  if (!record(value) || value.api !== RUNTIME_API || !record(value.libraries)) {
    throw new StoreError('RENDERING_UNAVAILABLE', 'Unsupported rendering API. Update Canvas or restore a compatible version.');
  }
  const libraries: Record<string, Library> = {};
  for (const [name, entry] of Object.entries(value.libraries).sort(([a], [b]) => a.localeCompare(b))) {
    if (!/^[a-z0-9-]{1,32}$/.test(name)) throw new StoreError('RENDERING_UNAVAILABLE', 'Invalid library name');
    libraries[name] = library(entry);
  }
  return { api: value.api, runtime: library(value.runtime), libraries };
}

async function verified(directory: string, entry: Library): Promise<Buffer> {
  const target = await assertRealpathWithin(directory, path.join(directory, entry.file));
  const bytes = await fs.readFile(target);
  if (bytes.byteLength !== entry.bytes || sha256(bytes) !== entry.sha256) {
    throw new StoreError('RENDERING_UNAVAILABLE', 'Rendering dependencies failed verification. Restore the original files or republish.');
  }
  return bytes;
}

export async function captureRendering(root: string, source: RenderingSource, names: string[]): Promise<string> {
  const raw = await readJson(path.join(source.librariesDir, 'manifest.json'));
  if (!record(raw) || !record(raw.libraries)) throw new StoreError('RENDERING_UNAVAILABLE', 'Library manifest is unavailable');
  const runtime = await fs.readFile(source.runtimeFile);
  const libraries: Record<string, Library> = {};
  const files = new Map<string, Buffer>([['runtime.js', runtime]]);
  for (const name of [...new Set(names)].sort()) {
    const entry = library(raw.libraries[name]);
    const bytes = await verified(source.librariesDir, entry);
    const filename = `${name}.js`;
    libraries[name] = { ...entry, file: filename };
    files.set(filename, bytes);
  }
  const content: RenderingManifest = { api: RUNTIME_API, runtime: { file: 'runtime.js', bytes: runtime.byteLength, sha256: sha256(runtime) }, libraries };
  const id = sha256(Buffer.from(JSON.stringify(content)));
  const base = path.join(root, '.rendering');
  await ensureContainedDir(root, base);
  const directory = path.join(base, id);
  await ensureContainedDir(root, path.join(root, '.locks'));
  await withArtifactLock(path.join(root, '.locks', `rendering-${id}.lock`), async () => {
    try { await fs.lstat(directory); await loadRendering(root, id); return; }
    catch (error) { if (errorCode(error) !== 'ENOENT') throw error; }
    const temporary = await fs.mkdtemp(path.join(base, '.tmp-'));
    try {
      await assertRealpathWithin(root, temporary);
      for (const [filename, bytes] of files) await writeFileDurable(path.join(temporary, filename), bytes);
      await writeJsonDurable(path.join(temporary, 'manifest.json'), content);
      await fs.rename(temporary, directory);
    } finally { await fs.rm(temporary, { recursive: true, force: true }); }
  }, { retryMs: 50, timeoutMs: 5000, staleMs: 30_000 });
  return id;
}

async function ensureContainedDir(root: string, target: string): Promise<void> {
  try {
    await fs.lstat(target);
  } catch (error) {
    if (errorCode(error) !== 'ENOENT') throw error;
    await fs.mkdir(target, { recursive: true, mode: 0o700 });
  }
  await assertRealpathWithin(root, target);
}

export async function loadRendering(root: string, id: string): Promise<Rendering> {
  if (!/^[a-f0-9]{64}$/.test(id)) throw new StoreError('RENDERING_UNAVAILABLE', 'Invalid rendering snapshot');
  try { return await readRendering(root, id); }
  catch (error) {
    if (errorCode(error) === 'ENOENT') throw new StoreError('RENDERING_UNAVAILABLE', 'Pinned rendering files are missing. Restore the original snapshot or republish the artifact.');
    throw error;
  }
}

async function readRendering(root: string, id: string): Promise<Rendering> {
  const directory = await assertRealpathWithin(root, path.join(root, '.rendering', id));
  const filename = await assertRealpathWithin(directory, path.join(directory, 'manifest.json'));
  const content = manifest(await readJson(filename));
  if (sha256(Buffer.from(JSON.stringify(content))) !== id) throw new StoreError('RENDERING_UNAVAILABLE', 'Rendering manifest failed verification');
  const runtime = await verified(directory, content.runtime);
  const libraries: Record<string, Buffer> = {};
  for (const [name, entry] of Object.entries(content.libraries)) libraries[name] = await verified(directory, entry);
  return { id, runtime: runtime.toString('utf8'), libraries };
}
