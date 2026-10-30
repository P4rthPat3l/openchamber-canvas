import * as crypto from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as http from 'node:http';
import * as path from 'node:path';

import { zipSync } from 'fflate';

import { ArtifactStore } from '../store/index';
import { StoreError, isStoreError } from '../store/errors';
import { ensureDir } from '../store/fs';
import type { ArtifactKind } from '../store/types';
import {
  ViewerUnavailableError,
  ensureViewer,
  mintViewUrl,
  notifyViewer,
  readViewerState,
  restartViewer,
  viewerStatus,
} from '../viewer/ensure';
import { CANVAS_VERSION } from '../version';

const SERVICE_VERSION = CANVAS_VERSION;
const MAX_JSON_BODY = 128 * 1024;
const KINDS: readonly ArtifactKind[] = ['html', 'bundle', 'markdown', 'image', 'pdf', 'data'];

export interface ServiceServerOptions {
  store: ArtifactStore;
  token: string;
  storeRoot: string;
  portFile: string;
  viewerEntry: string;
  pluginPath: string;
  viewerTimeoutMs?: number;
  host?: string;
  port?: number;
}

export interface ServiceServer {
  server: http.Server;
  host: string;
  port: number;
  closed: Promise<void>;
  close: () => Promise<void>;
}

class HttpError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function decode(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

function sendJson(response: http.ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': String(Buffer.byteLength(payload, 'utf8')),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  response.end(payload);
}

function sendError(
  response: http.ServerResponse,
  status: number,
  code: string,
  message: string,
): void {
  sendJson(response, status, { error: { code, message } });
}

async function readJsonBody(request: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.byteLength;
    if (size > MAX_JSON_BODY) {
      throw new HttpError(413, 'TOO_LARGE', 'Request body is too large');
    }
    chunks.push(buffer);
  }
  if (size === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  } catch {
    throw new HttpError(400, 'INVALID_JSON', 'Request body must be JSON');
  }
}

function requireToken(
  request: http.IncomingMessage,
  response: http.ServerResponse,
  token: string,
): boolean {
  const header = request.headers.authorization;
  const expected = `Bearer ${token}`;
  if (
    typeof header !== 'string' ||
    header.length !== expected.length ||
    !crypto.timingSafeEqual(Buffer.from(header), Buffer.from(expected))
  ) {
    sendError(response, 401, 'UNAUTHORIZED', 'Invalid service token');
    return false;
  }
  return true;
}

function parseInteger(value: string | null, name: string, minimum = 1): number | undefined {
  if (value === null || value.length === 0) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum) {
    throw new HttpError(400, 'INVALID_REQUEST', `${name} must be an integer of at least ${minimum}`);
  }
  return parsed;
}

function isKind(value: string | null): value is ArtifactKind {
  return value !== null && KINDS.includes(value as ArtifactKind);
}

function sendStoreError(response: http.ServerResponse, error: StoreError): void {
  const status =
    error.code === 'NOT_FOUND' || error.code === 'PATH_NOT_FOUND'
      ? 404
      : error.code === 'INVALID_PATH' || error.code === 'INVALID_ARTIFACT' || error.code === 'INVALID_UPDATE'
        ? 400
        : error.code === 'TOO_LARGE' || error.code === 'TOO_MANY_FILES'
          ? 413
          : error.code === 'CONFLICT'
            ? 409
            : 500;
  sendError(response, status, error.code, error.message);
}

export async function createServiceServer(options: ServiceServerOptions): Promise<ServiceServer> {
  const host = options.host ?? '127.0.0.1';
  let port = options.port ?? 0;
  let isClosed = false;
  let resolveClosed: (() => void) | null = null;
  const closed = new Promise<void>((resolve) => {
    resolveClosed = resolve;
  });
  const startedAt = Date.now();

  const server = http.createServer((request, response) => {
    void handleRequest(request, response).catch((error: unknown) => {
      if (response.headersSent) {
        response.end();
        return;
      }
      if (error instanceof HttpError) {
        sendError(response, error.status, error.code, error.message);
        return;
      }
      if (error instanceof ViewerUnavailableError) {
        sendError(response, 503, error.code, error.message);
        return;
      }
      if (isStoreError(error)) {
        sendStoreError(response, error);
        return;
      }
      sendError(
        response,
        500,
        'INTERNAL',
        error instanceof Error ? error.message : 'Internal error',
      );
    });
  });

  const close = async (): Promise<void> => {
    if (isClosed) return;
    isClosed = true;
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
      server.closeAllConnections();
    });
    resolveClosed?.();
  };

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      const address = server.address();
      if (address !== null && typeof address === 'object') port = address.port;
      resolve();
    });
  });

  async function handleRequest(
    request: http.IncomingMessage,
    response: http.ServerResponse,
  ): Promise<void> {
    if (!requireToken(request, response, options.token)) return;
    const url = new URL(request.url ?? '/', `http://${host}`);

    if (request.method === 'OPTIONS') {
      response.writeHead(204);
      response.end();
      return;
    }

    if (url.pathname === '/health' && request.method === 'GET') {
      sendJson(response, 200, {
        ok: true,
        pid: process.pid,
        uptime: Date.now() - startedAt,
        store: path.basename(options.storeRoot),
        version: SERVICE_VERSION,
        pluginPath: options.pluginPath,
      });
      return;
    }

    if ((url.pathname === '/list' || url.pathname === '/trash') && request.method === 'GET') {
      const directory = url.searchParams.get('directory') ?? undefined;
      const query = url.searchParams.get('query') ?? undefined;
      const kindValue = url.searchParams.get('kind');
      const tag = url.searchParams.get('tag') ?? undefined;
      const limit = parseInteger(url.searchParams.get('limit'), 'limit');
      const archived = url.searchParams.get('archived');
      const offset = parseInteger(url.searchParams.get('offset'), 'offset', 0);
      const sort = url.searchParams.get('sort') ?? 'updated';
      if (sort !== 'updated' && sort !== 'title') throw new HttpError(400, 'INVALID_REQUEST', 'sort is invalid');
      if (kindValue !== null && !isKind(kindValue)) {
        throw new HttpError(400, 'INVALID_REQUEST', 'kind is invalid');
      }
      const result = await options.store.list({
        directory,
        query,
        kind: kindValue === null ? undefined : kindValue,
        tag,
        limit,
        includeArchived: archived === 'true' || archived === '1',
        archivedOnly: archived === 'true' || archived === '1',
        offset,
        sort,
        trash: url.pathname === '/trash',
      });
      sendJson(response, 200, result);
      return;
    }

    const artifactMatch = /^\/artifact\/([^/]+)$/.exec(url.pathname);
    if (artifactMatch !== null && request.method === 'GET') {
      const id = decode(artifactMatch[1] ?? '');
      if (id === null) throw new HttpError(404, 'NOT_FOUND', 'Not found');
      sendJson(response, 200, await options.store.getMeta(id));
      return;
    }

    const versionsMatch = /^\/versions\/([^/]+)$/.exec(url.pathname);
    if (versionsMatch !== null && request.method === 'GET') {
      const id = decode(versionsMatch[1] ?? '');
      if (id === null) throw new HttpError(404, 'NOT_FOUND', 'Not found');
      sendJson(response, 200, { versions: await options.store.getVersions(id) });
      return;
    }

    if (url.pathname === '/view-url' && request.method === 'POST') {
      const body = await readJsonBody(request);
      if (!isRecord(body) || typeof body.id !== 'string') {
        throw new HttpError(400, 'INVALID_REQUEST', 'id is required');
      }
      const version = typeof body.version === 'string' ? body.version : undefined;
      const theme =
        body.theme === 'light' || body.theme === 'dark' ? body.theme : undefined;
      const viewer = await ensureViewer({
        storeRoot: options.storeRoot,
        portFile: options.portFile,
        viewerEntry: options.viewerEntry,
        timeoutMs: options.viewerTimeoutMs,
      });
      const minted = await mintViewUrl(viewer, { id: body.id, version, theme, follow: typeof body.follow === 'boolean' ? body.follow : undefined });
      sendJson(response, 200, minted);
      return;
    }

    const feedbackMatch = /^\/feedback\/([^/]+)$/.exec(url.pathname);
    if (feedbackMatch !== null) {
      const id = decode(feedbackMatch[1] ?? '');
      if (id === null) throw new HttpError(404, 'NOT_FOUND', 'Not found');
      if (request.method === 'GET') {
        const since = url.searchParams.get('since') ?? undefined;
        const limit = parseInteger(url.searchParams.get('limit'), 'limit');
        const offset = parseInteger(url.searchParams.get('offset'), 'offset', 0);
        sendJson(response, 200, await options.store.feedbackPage(id, { since, limit, offset }));
        return;
      }
      if (request.method === 'POST') {
        const body = await readJsonBody(request);
        if (!isRecord(body) || !Array.isArray(body.ids)) {
          throw new HttpError(400, 'INVALID_REQUEST', 'ids must be an array');
        }
        const ids = body.ids.filter((value): value is string => typeof value === 'string');
        const delivered = await options.store.markFeedbackDelivered(id, ids);
        sendJson(response, 200, { delivered });
        return;
      }
      throw new HttpError(405, 'METHOD_NOT_ALLOWED', 'Use GET or POST');
    }

    const archiveMatch = /^\/archive\/([^/]+)$/.exec(url.pathname);
    if (archiveMatch !== null && request.method === 'POST') {
      const id = decode(archiveMatch[1] ?? '');
      if (id === null) throw new HttpError(404, 'NOT_FOUND', 'Not found');
      const body = await readJsonBody(request);
      const archived = !isRecord(body) || body.archived !== false;
      sendJson(response, 200, await options.store.archive(id, archived));
      return;
    }

    const favoriteMatch = /^\/favorite\/([^/]+)$/.exec(url.pathname);
    if (favoriteMatch !== null && request.method === 'POST') {
      const id = decode(favoriteMatch[1] ?? '');
      if (id === null) throw new HttpError(404, 'NOT_FOUND', 'Not found');
      const body = await readJsonBody(request);
      const favorite = !isRecord(body) || body.favorite !== false;
      sendJson(response, 200, await options.store.setFavorite(id, favorite));
      return;
    }

    const restoreMatch = /^\/restore\/([^/]+)$/.exec(url.pathname);
    if (restoreMatch !== null && request.method === 'POST') {
      const id = decode(restoreMatch[1] ?? '');
      if (id === null) throw new HttpError(404, 'NOT_FOUND', 'Not found');
      const body = await readJsonBody(request);
      if (
        !isRecord(body) ||
        typeof body.version !== 'string' ||
        typeof body.baseVersion !== 'string'
      ) {
        throw new HttpError(400, 'INVALID_REQUEST', 'version and baseVersion are required');
      }
      const updated = await options.store.update(id, {
        mode: 'restore',
        restoreFrom: body.version,
        baseVersion: body.baseVersion,
      });
      const viewer = await readViewerState(options.portFile);
      const warnings: string[] = [];
      if (viewer) {
        try { await notifyViewer(viewer, { id, event: 'changed', version: updated.version }); }
        catch { warnings.push('Version restored, but open views could not refresh. Reopen from the gallery.'); }
      }
      sendJson(response, 200, { version: updated.version, warnings });
      return;
    }

    if (url.pathname === '/viewer-status' && request.method === 'GET') {
      sendJson(response, 200, await viewerStatus(options.portFile));
      return;
    }
    if (url.pathname === '/viewer-restart' && request.method === 'POST') {
      await restartViewer({ storeRoot: options.storeRoot, portFile: options.portFile, viewerEntry: options.viewerEntry, timeoutMs: options.viewerTimeoutMs });
      sendJson(response, 200, { ok: true });
      return;
    }

    const trashMatch = /^\/trash\/([^/]+)$/.exec(url.pathname);
    if (trashMatch !== null && request.method === 'POST') {
      const id = decode(trashMatch[1] ?? '');
      if (id === null) throw new HttpError(404, 'NOT_FOUND', 'Not found');
      await options.store.trash(id);
      sendJson(response, 200, { trashed: true });
      return;
    }

    const untrashMatch = /^\/untrash\/([^/]+)$/.exec(url.pathname);
    if (untrashMatch !== null && request.method === 'POST') {
      const id = decode(untrashMatch[1] ?? '');
      if (id === null) throw new HttpError(404, 'NOT_FOUND', 'Not found');
      sendJson(response, 200, await options.store.untrash(id));
      return;
    }

    const exportMatch = /^\/export\/([^/]+)$/.exec(url.pathname);
    if (exportMatch !== null && request.method === 'POST') {
      const id = decode(exportMatch[1] ?? '');
      if (id === null) throw new HttpError(404, 'NOT_FOUND', 'Not found');
      const body = await readJsonBody(request);
      const version = isRecord(body) && typeof body.version === 'string' ? body.version : undefined;
      const requestedFormat =
        isRecord(body) && (body.format === 'html' || body.format === 'zip')
          ? body.format
          : undefined;
      sendJson(response, 200, await exportArtifact(options.store, options.storeRoot, id, version, requestedFormat));
      return;
    }

    const thumbMatch = /^\/thumb\/([^/]+)$/.exec(url.pathname);
    if (thumbMatch !== null && request.method === 'GET') {
      throw new HttpError(404, 'NOT_FOUND', 'Thumbnails are not implemented yet');
    }

    throw new HttpError(404, 'NOT_FOUND', 'Not found');
  }

  return { server, host, port, closed, close };
}

async function exportArtifact(
  store: ArtifactStore,
  storeRoot: string,
  id: string,
  version: string | undefined,
  requestedFormat: 'html' | 'zip' | undefined,
): Promise<{ path: string; format: 'html' | 'zip'; bytes: number }> {
  const result = await store.readVersion(id, version);
  const format = requestedFormat ?? (result.meta.kind === 'html' ? 'html' : 'zip');
  const exportsDir = path.join(storeRoot, 'exports');
  await ensureDir(exportsDir);

  if (format === 'html') {
    const entry = result.files.find((file) => file.path === result.manifest.entry);
    if (entry === undefined) {
      throw new StoreError('ENTRY_NOT_FOUND', 'The entry file is missing');
    }
    const target = path.join(exportsDir, `${id}-${result.version}.html`);
    await fs.writeFile(target, entry.content, { mode: 0o600 });
    return { path: target, format, bytes: entry.content.byteLength };
  }

  const entries: Record<string, Uint8Array> = {};
  for (const file of result.files) {
    entries[file.path] = file.content;
  }
  const zipped = zipSync(entries);
  const target = path.join(exportsDir, `${id}-${result.version}.zip`);
  await fs.writeFile(target, zipped, { mode: 0o600 });
  return { path: target, format, bytes: zipped.byteLength };
}
