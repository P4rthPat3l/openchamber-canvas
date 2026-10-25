import * as path from 'node:path';

import { StoreError } from './errors';
import { ARTIFACT_ID_RE, VERSION_ID_RE, isSafeRelativePath } from './paths';
import type {
  ArtifactFileRecord,
  ArtifactKind,
  ArtifactMeta,
  FeedbackRecord,
  JsonValue,
  LiveSource,
  RuntimeState,
  VersionManifest,
  VersionSummary,
} from './types';

const KINDS: readonly ArtifactKind[] = ['html', 'bundle', 'markdown', 'image', 'pdf', 'data'];
const LIVE_FORMATS: readonly LiveSource['format'][] = ['csv', 'json', 'text'];
const LIVE_SOURCE_ID_RE = /^[a-z][a-z0-9-]{0,31}$/;
const LIBRARY_NAME_RE = /^[a-z0-9-]{1,32}$/;
const FEEDBACK_ID_RE = /^fb_[a-f0-9]{24}$/;
const FEEDBACK_MAX_BYTES = 64 * 1024;
const STATE_MAX_BYTES = 1024 * 1024;
const SHA256_RE = /^[a-f0-9]{64}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function fail(message: string): never {
  throw new StoreError('INVALID_META', message);
}

function isIsoDate(value: unknown): value is string {
  return typeof value === 'string' && value.includes('T') && !Number.isNaN(Date.parse(value));
}

function isKind(value: unknown): value is ArtifactKind {
  return typeof value === 'string' && KINDS.includes(value as ArtifactKind);
}

export function isJsonValue(value: unknown, depth = 0): value is JsonValue {
  if (depth > 20) return false;
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every((entry) => isJsonValue(entry, depth + 1));
  if (isRecord(value)) return Object.values(value).every((entry) => isJsonValue(entry, depth + 1));
  return false;
}

export function jsonByteLength(value: JsonValue): number {
  return Buffer.byteLength(JSON.stringify(value) ?? 'null', 'utf8');
}

function requireString(record: Record<string, unknown>, key: string, maxLength: number): string {
  const value = record[key];
  if (typeof value !== 'string' || value.length === 0 || value.length > maxLength) {
    fail(`${key} must be a string of 1 to ${maxLength} characters`);
  }
  return value;
}

function requireInteger(
  record: Record<string, unknown>,
  key: string,
  minimum: number,
  maximum: number,
): number {
  const value = record[key];
  if (typeof value !== 'number' || !Number.isInteger(value) || value < minimum || value > maximum) {
    fail(`${key} must be an integer from ${minimum} to ${maximum}`);
  }
  return value;
}

function requireBoolean(record: Record<string, unknown>, key: string): boolean {
  const value = record[key];
  if (typeof value !== 'boolean') fail(`${key} must be a boolean`);
  return value;
}

function nullableString(
  record: Record<string, unknown>,
  key: string,
  maxLength: number,
): string | null {
  const value = record[key];
  if (value === null) return null;
  if (typeof value !== 'string' || value.length === 0 || value.length > maxLength) {
    fail(`${key} must be null or a string of 1 to ${maxLength} characters`);
  }
  return value;
}

function parseStringArray(value: unknown, key: string, maximum: number, maxLength: number): string[] {
  if (!Array.isArray(value) || value.length > maximum) {
    fail(`${key} must be an array of at most ${maximum} entries`);
  }
  const result: string[] = [];
  for (const entry of value) {
    if (typeof entry !== 'string' || entry.length === 0 || entry.length > maxLength) {
      fail(`${key} entries must be strings of 1 to ${maxLength} characters`);
    }
    result.push(entry);
  }
  return result;
}

function parseVersionSummary(value: unknown): VersionSummary {
  if (!isRecord(value)) fail('version entry must be an object');
  const id = requireString(value, 'id', 40);
  if (!VERSION_ID_RE.test(id)) fail('version id is invalid');
  const createdAt = requireString(value, 'createdAt', 40);
  if (!isIsoDate(createdAt)) fail('version createdAt is invalid');
  const bytes = requireInteger(value, 'bytes', 0, 100 * 1024 * 1024);
  const files = requireInteger(value, 'files', 1, 10_000);
  const title = requireString(value, 'title', 200);
  const restoredFrom = nullableString(value, 'restoredFrom', 40);
  if (restoredFrom !== null && !VERSION_ID_RE.test(restoredFrom)) fail('restoredFrom is invalid');
  return { id, createdAt, bytes, files, title, restoredFrom, ...renderingReference(value) };
}

function parseFileRecord(value: unknown): ArtifactFileRecord {
  if (!isRecord(value)) fail('file entry must be an object');
  const filePath = requireString(value, 'path', 512);
  if (!isSafeRelativePath(filePath)) fail('file path is invalid');
  const bytes = requireInteger(value, 'bytes', 0, 100 * 1024 * 1024);
  const hash = requireString(value, 'sha256', 64);
  if (!SHA256_RE.test(hash)) fail('file sha256 is invalid');
  const mime = requireString(value, 'mime', 128);
  return { path: filePath, bytes, sha256: hash, mime };
}

function parseLiveSource(value: unknown): LiveSource {
  if (!isRecord(value)) fail('live source must be an object');
  const id = requireString(value, 'id', 32);
  if (!LIVE_SOURCE_ID_RE.test(id)) fail('live source id is invalid');
  const kind = requireString(value, 'kind', 16);
  if (kind !== 'file') fail('live source kind must be file');
  const sourcePath = requireString(value, 'path', 512);
  if (!isSafeRelativePath(sourcePath)) fail('live source path is invalid');
  const format = requireString(value, 'format', 16);
  if (!LIVE_FORMATS.includes(format as LiveSource['format'])) fail('live source format is invalid');
  const refresh = requireString(value, 'refresh', 16);
  if (refresh !== 'open') fail('live source refresh must be open');
  const maxBytes = requireInteger(value, 'maxBytes', 1, 10 * 1024 * 1024);
  return {
    id,
    kind: 'file',
    path: sourcePath,
    format: format as LiveSource['format'],
    refresh: 'open',
    maxBytes,
  };
}

export function parseVersionManifest(value: unknown): VersionManifest {
  if (!isRecord(value)) fail('version manifest must be an object');
  if (value.schema !== 1) fail('version manifest schema must be 1');
  if (!isKind(value.kind)) fail('version manifest kind is invalid');
  const entry = requireString(value, 'entry', 512);
  if (!isSafeRelativePath(entry)) fail('version manifest entry is invalid');
  const title = requireString(value, 'title', 200);
  const createdAt = requireString(value, 'createdAt', 40);
  if (!isIsoDate(createdAt)) fail('version manifest createdAt is invalid');
  const restoredFrom = nullableString(value, 'restoredFrom', 40);
  if (restoredFrom !== null && !VERSION_ID_RE.test(restoredFrom)) {
    fail('version manifest restoredFrom is invalid');
  }

  const rawFiles = value.files;
  if (!Array.isArray(rawFiles) || rawFiles.length === 0 || rawFiles.length > 200) {
    fail('version manifest files must contain 1 to 200 entries');
  }
  const files = rawFiles.map(parseFileRecord);
  const seen = new Set<string>();
  for (const file of files) {
    if (seen.has(file.path)) fail('version manifest has duplicate file paths');
    seen.add(file.path);
  }
  if (!seen.has(entry)) fail('version manifest entry is not in files');
  if (value.kind === 'html' && files.length !== 1) {
    fail('an html version must have exactly one file');
  }

  return {
    schema: 1,
    kind: value.kind,
    entry,
    title,
    createdAt,
    restoredFrom,
    files,
    ...renderingReference(value),
  };
}

function renderingReference(value: Record<string, unknown>): { rendering?: string } {
  if (value.rendering === undefined) return {};
  if (typeof value.rendering !== 'string' || !SHA256_RE.test(value.rendering)) fail('rendering reference is invalid');
  return { rendering: value.rendering };
}

export function parseMeta(value: unknown): ArtifactMeta {  if (!isRecord(value)) fail('meta must be an object');
  if (value.schema !== 2) fail('meta schema must be 2');

  const id = requireString(value, 'id', 80);
  if (!ARTIFACT_ID_RE.test(id)) fail('meta id is invalid');
  const title = requireString(value, 'title', 200);
  if (!isKind(value.kind)) fail('meta kind is invalid');
  const directory = requireString(value, 'directory', 4096);
  if (!path.isAbsolute(directory)) fail('meta directory must be absolute');
  const projectName = requireString(value, 'projectName', 80);
  const sessionId = nullableString(value, 'sessionId', 200);
  const tags = parseStringArray(value.tags, 'tags', 16, 32);
  const favorite = requireBoolean(value, 'favorite');

  const createdAt = requireString(value, 'createdAt', 40);
  if (!isIsoDate(createdAt)) fail('meta createdAt is invalid');
  const updatedAt = requireString(value, 'updatedAt', 40);
  if (!isIsoDate(updatedAt)) fail('meta updatedAt is invalid');

  const archivedAt = nullableString(value, 'archivedAt', 40);
  if (archivedAt !== null && !isIsoDate(archivedAt)) fail('meta archivedAt is invalid');
  const lastOpenedAt = nullableString(value, 'lastOpenedAt', 40);
  if (lastOpenedAt !== null && !isIsoDate(lastOpenedAt)) fail('meta lastOpenedAt is invalid');

  const currentVersion = requireString(value, 'currentVersion', 40);
  if (!VERSION_ID_RE.test(currentVersion)) fail('meta currentVersion is invalid');
  const pinnedVersion = nullableString(value, 'pinnedVersion', 40);
  if (pinnedVersion !== null && !VERSION_ID_RE.test(pinnedVersion)) {
    fail('meta pinnedVersion is invalid');
  }
  const librarySet = requireString(value, 'librarySet', 64);
  const rawLibraries = value.libraries;
  let libraries: string[] = [];
  if (rawLibraries !== undefined) {
    if (!Array.isArray(rawLibraries) || rawLibraries.length > 16) {
      fail('meta libraries must contain at most 16 entries');
    }
    const seen = new Set<string>();
    for (const name of rawLibraries) {
      if (typeof name !== 'string' || !LIBRARY_NAME_RE.test(name)) {
        fail('meta library names are invalid');
      }
      seen.add(name);
    }
    libraries = [...seen];
  }
  const openCount = requireInteger(value, 'openCount', 0, 1_000_000);
  const dedupeKey = nullableString(value, 'dedupeKey', 200);

  const rawVersions = value.versions;
  if (!Array.isArray(rawVersions) || rawVersions.length === 0 || rawVersions.length > 10_000) {
    fail('meta versions must contain 1 to 10000 entries');
  }
  const versions = rawVersions.map(parseVersionSummary);
  if (!versions.some((version) => version.id === currentVersion)) {
    fail('meta currentVersion is not in versions');
  }
  if (pinnedVersion !== null && !versions.some((version) => version.id === pinnedVersion)) {
    fail('meta pinnedVersion is not in versions');
  }

  const rawLive = value.live;
  if (!Array.isArray(rawLive) || rawLive.length > 8) {
    fail('meta live must contain at most 8 entries');
  }
  const live = rawLive.map(parseLiveSource);

  return {
    schema: 2,
    id,
    title,
    kind: value.kind,
    directory,
    projectName,
    sessionId,
    tags,
    favorite,
    createdAt,
    updatedAt,
    archivedAt,
    currentVersion,
    pinnedVersion,
    librarySet,
    libraries,
    versions,
    live,
    openCount,
    lastOpenedAt,
    dedupeKey,
  };
}

export function parseFeedbackRecord(value: unknown): FeedbackRecord {
  if (!isRecord(value)) fail('feedback record must be an object');
  if (value.schema !== 1) fail('feedback schema must be 1');
  const id = requireString(value, 'id', 27);
  if (!FEEDBACK_ID_RE.test(id)) fail('feedback id is invalid');
  const artifactId = requireString(value, 'artifactId', 80);
  if (!ARTIFACT_ID_RE.test(artifactId)) fail('feedback artifactId is invalid');
  const version = requireString(value, 'version', 40);
  if (!VERSION_ID_RE.test(version)) fail('feedback version is invalid');
  const createdAt = requireString(value, 'createdAt', 40);
  if (!isIsoDate(createdAt)) fail('feedback createdAt is invalid');
  const kind = requireString(value, 'kind', 64);
  const data = value.data;
  if (!isJsonValue(data)) fail('feedback data must be JSON');
  if (jsonByteLength(data) > FEEDBACK_MAX_BYTES) fail('feedback data is too large');
  const deliveredAt = nullableString(value, 'deliveredAt', 40);
  if (deliveredAt !== null && !isIsoDate(deliveredAt)) fail('feedback deliveredAt is invalid');
  return { schema: 1, id, artifactId, version, createdAt, kind, data, deliveredAt };
}

export function parseRuntimeState(value: unknown): RuntimeState {
  if (!isRecord(value)) fail('runtime state must be an object');
  const state: RuntimeState = {};
  for (const [key, entry] of Object.entries(value)) {
    if (key.length === 0 || key.length > 128) {
      fail('runtime state keys must be 1 to 128 characters');
    }
    if (!isJsonValue(entry)) fail('runtime state values must be JSON');
    state[key] = entry;
  }
  if (Buffer.byteLength(JSON.stringify(state) ?? '{}', 'utf8') > STATE_MAX_BYTES) {
    fail('runtime state is too large');
  }
  return state;
}
