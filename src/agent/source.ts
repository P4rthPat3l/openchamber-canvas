import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { StoreError } from '../store/errors';
import { assertRelativePath, isWithin } from '../store/paths';
import type { ArtifactFileInput } from '../store/types';

export const MAX_SOURCE_FILE_BYTES = 5 * 1024 * 1024;
export const MAX_SOURCE_BUNDLE_BYTES = 20 * 1024 * 1024;
export const MAX_SOURCE_FILES = 200;
const MAX_DEPTH = 8;
const SKIP_DIRECTORIES = new Set(['node_modules', '.git', '.hg', '.svn']);

export interface HtmlSource {
  html: string;
  warnings: string[];
}

export interface DirectorySource {
  files: ArtifactFileInput[];
  entry: string;
  warnings: string[];
}

async function resolveExisting(directory: string, input: string): Promise<string> {
  const base = path.resolve(directory);
  const target = path.resolve(base, input);
  if (!isWithin(base, target)) {
    throw new StoreError('INVALID_PATH', 'The source path is outside the project');
  }
  try {
    const [realBase, realTarget] = await Promise.all([fs.realpath(base), fs.realpath(target)]);
    if (!isWithin(realBase, realTarget)) {
      throw new StoreError('INVALID_PATH', 'The source path escapes the project');
    }
    return realTarget;
  } catch (error) {
    if (error instanceof StoreError) throw error;
    throw new StoreError('NOT_FOUND', 'The source path does not exist');
  }
}

export async function readHtmlFile(directory: string, filePath: string): Promise<HtmlSource> {
  const absolute = await resolveExisting(directory, filePath);
  const stats = await fs.stat(absolute);
  if (!stats.isFile()) {
    throw new StoreError('INVALID_PATH', 'filePath must name a file');
  }
  if (stats.size > MAX_SOURCE_FILE_BYTES) {
    throw new StoreError('TOO_LARGE', 'The HTML source is limited to 5 MiB');
  }
  const bytes = await fs.readFile(absolute);
  try {
    return {
      html: new TextDecoder('utf-8', { fatal: true }).decode(bytes),
      warnings: [],
    };
  } catch {
    throw new StoreError('INVALID_ARTIFACT', 'filePath must be UTF-8 HTML');
  }
}

async function walk(
  root: string,
  relative: string,
  files: ArtifactFileInput[],
  warnings: string[],
  state: { total: number },
): Promise<void> {
  const entries = await fs.readdir(path.join(root, relative), { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith('.')) {
      warnings.push(`Skipped ${relative === '' ? entry.name : `${relative}/${entry.name}`}`);
      continue;
    }
    if (SKIP_DIRECTORIES.has(entry.name)) {
      if (entry.isDirectory() || entry.isSymbolicLink()) {
        warnings.push(`Skipped ${relative === '' ? entry.name : `${relative}/${entry.name}`}`);
      }
      continue;
    }
    const childRelative = relative === '' ? entry.name : `${relative}/${entry.name}`;
    const absolute = path.join(root, relative, entry.name);
    if (entry.isSymbolicLink()) {
      warnings.push(`Skipped symlink ${childRelative}`);
      continue;
    }
    if (entry.isDirectory()) {
      if (childRelative.split('/').length >= MAX_DEPTH) {
        throw new StoreError('INVALID_PATH', `The bundle is deeper than ${MAX_DEPTH} folders`);
      }
      await walk(root, childRelative, files, warnings, state);
      continue;
    }
    if (!entry.isFile()) {
      warnings.push(`Skipped ${childRelative}`);
      continue;
    }
    assertRelativePath(childRelative);
    if (files.length >= MAX_SOURCE_FILES) {
      throw new StoreError('TOO_MANY_FILES', `A bundle is limited to ${MAX_SOURCE_FILES} files`);
    }
    const stats = await fs.stat(absolute);
    if (stats.size > MAX_SOURCE_FILE_BYTES) {
      throw new StoreError('TOO_LARGE', `A bundle file is limited to 5 MiB: ${childRelative}`);
    }
    state.total += stats.size;
    if (state.total > MAX_SOURCE_BUNDLE_BYTES) {
      throw new StoreError('TOO_LARGE', 'A bundle is limited to 20 MiB');
    }
    files.push({ path: childRelative, content: await fs.readFile(absolute) });
  }
}

export async function readDirectorySource(
  directory: string,
  directoryPath: string,
  entry = 'index.html',
): Promise<DirectorySource> {
  const root = await resolveExisting(directory, directoryPath);
  const stats = await fs.stat(root);
  if (!stats.isDirectory()) {
    throw new StoreError('INVALID_PATH', 'directoryPath must name a directory');
  }
  const files: ArtifactFileInput[] = [];
  const warnings: string[] = [];
  await walk(root, '', files, warnings, { total: 0 });

  const normalizedEntry = entry.trim();
  assertRelativePath(normalizedEntry);
  if (!files.some((file) => file.path === normalizedEntry)) {
    throw new StoreError('ENTRY_NOT_FOUND', `The bundle has no entry file: ${normalizedEntry}`);
  }
  return { files, entry: normalizedEntry, warnings };
}

export function scanExternalReferences(html: string): string | null {
  const tag = /<(script|link|iframe)\b[^>]*\b(?:src|href)\s*=\s*(?:"|')?\s*(?:https?:)?\/\//i.exec(html);
  if (tag !== null) return `<${tag[1]}>`;
  if (/@import\s+(?:url\()?\s*(?:"|')?\s*(?:https?:)?\/\//i.test(html)) return '@import';
  return null;
}

export function decodeBase64(value: string): Uint8Array {
  if (value.length === 0 || value.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) {
    throw new StoreError('INVALID_ARTIFACT', 'contentBase64 is not valid base64');
  }
  return Buffer.from(value, 'base64');
}

export function entryContent(files: ArtifactFileInput[], entry: string): string | null {
  const file = files.find((candidate) => candidate.path === entry);
  if (file === undefined) return null;
  if (typeof file.content === 'string') return file.content;
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(file.content);
  } catch {
    return null;
  }
}
