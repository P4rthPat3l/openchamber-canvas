import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import { StoreError } from './errors';

export const ARTIFACT_ID_RE = /^[0-9A-HJKMNP-TV-Z]{26}-[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const VERSION_ID_RE = /^\d{8}T\d{9}Z$/;

const MAX_PATH_LENGTH = 512;
const MAX_SEGMENTS = 8;
const MAX_SEGMENT_LENGTH = 64;
const SEGMENT_RE = /^[A-Za-z0-9._-]+$/;
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;

export function assertArtifactId(id: string): void {
  if (typeof id !== 'string' || id.length === 0 || id.length > 80 || !ARTIFACT_ID_RE.test(id)) {
    throw new StoreError('INVALID_PATH', 'Invalid artifact id');
  }
}

export function assertVersionId(version: string): void {
  if (typeof version !== 'string' || !VERSION_ID_RE.test(version)) {
    throw new StoreError('INVALID_PATH', 'Invalid version id');
  }
}

export function assertRelativePath(input: string): void {
  if (typeof input !== 'string' || input.length === 0 || input.length > MAX_PATH_LENGTH) {
    throw new StoreError('INVALID_PATH', 'Invalid file path');
  }
  if (input.includes('\0') || input.includes('\\') || input.startsWith('/')) {
    throw new StoreError('INVALID_PATH', 'Invalid file path');
  }

  const segments = input.split('/');
  if (segments.length === 0 || segments.length > MAX_SEGMENTS) {
    throw new StoreError('INVALID_PATH', 'Invalid file path');
  }

  for (const segment of segments) {
    if (
      segment.length === 0 ||
      segment.length > MAX_SEGMENT_LENGTH ||
      segment === '.' ||
      segment === '..' ||
      !SEGMENT_RE.test(segment) ||
      WINDOWS_RESERVED.test(segment) ||
      segment.endsWith('.') ||
      segment.endsWith(' ')
    ) {
      throw new StoreError('INVALID_PATH', 'Invalid file path');
    }
  }
}

export function isSafeRelativePath(input: string): boolean {
  try {
    assertRelativePath(input);
    return true;
  } catch {
    return false;
  }
}

export function errorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? code : undefined;
}

export function isWithin(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

export function normalizeDirectory(input: string, cwd = process.cwd()): string {
  if (typeof input !== 'string' || input.trim().length === 0 || input.length > 4096 || input.includes('\0')) {
    throw new StoreError('INVALID_PATH', 'Invalid directory');
  }
  const resolved = path.resolve(cwd, input);
  const parsed = path.parse(resolved);
  return resolved === parsed.root ? resolved : resolved.replace(/[\\/]+$/, '');
}

export function projectNameFromDirectory(directory: string): string {
  const base = path.basename(directory);
  if (base.length === 0 || base === '.' || base === path.sep) return 'Uncategorized';
  return base.slice(0, 80);
}

export function defaultStoreRoot(
  env: Record<string, string | undefined> = process.env,
  home = os.homedir(),
): string {
  const configured = env.CANVAS_STORE?.trim();
  if (configured) return path.resolve(configured);
  return path.join(home, '.config', 'openchamber', 'artifacts');
}

export function defaultViewerPortFile(root: string): string {
  return path.join(root, '.viewer.json');
}

export function resolveWithin(root: string, relativePath: string): string {
  assertRelativePath(relativePath);
  const resolved = path.resolve(root, ...relativePath.split('/'));
  if (!isWithin(root, resolved)) {
    throw new StoreError('INVALID_PATH', 'Path escapes the allowed root');
  }
  return resolved;
}

export function resolveArtifactDir(root: string, id: string): string {
  assertArtifactId(id);
  const resolved = path.resolve(root, id);
  if (!isWithin(root, resolved)) {
    throw new StoreError('INVALID_PATH', 'Artifact path escapes the store');
  }
  return resolved;
}

export function resolveVersionDir(root: string, id: string, version: string): string {
  assertVersionId(version);
  const artifactDir = resolveArtifactDir(root, id);
  const resolved = path.resolve(artifactDir, 'versions', version);
  if (!isWithin(artifactDir, resolved)) {
    throw new StoreError('INVALID_PATH', 'Version path escapes the artifact');
  }
  return resolved;
}

export async function assertRealpathWithin(root: string, target: string): Promise<string> {
  const [realRoot, realTarget] = await Promise.all([fs.realpath(root), fs.realpath(target)]);
  if (!isWithin(realRoot, realTarget)) {
    throw new StoreError('INVALID_PATH', 'Path escapes the allowed root');
  }
  return realTarget;
}

export async function resolveExistingFile(root: string, relativePath: string): Promise<string> {
  const resolved = resolveWithin(root, relativePath);
  try {
    return await assertRealpathWithin(root, resolved);
  } catch (error) {
    if (errorCode(error) === 'ENOENT') {
      throw new StoreError('NOT_FOUND', 'File not found');
    }
    throw error;
  }
}
