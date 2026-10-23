import * as crypto from 'node:crypto';
import * as fs from 'node:fs/promises';import * as http from 'node:http';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ArtifactStore } from '../store/index';
import { StoreError, isStoreError } from '../store/errors';
import { ensureDir, readJson, writeJsonAtomic } from '../store/fs';
import { defaultStoreRoot, defaultViewerPortFile, assertArtifactId } from '../store/paths';
import { isJsonValue } from '../store/schema';
import type { JsonValue } from '../store/types';
import {
  contentTypeFor,
  runtimeCorsHeaders,
  signViewToken,
  verifyViewToken,
  viewHeaders,
} from './policy';

const VIEW_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_JSON_BODY = 128 * 1024;
const HEARTBEAT_MS = 15_000;

interface LibraryRecord {
  file: string;
  bytes: number;
  sha256: string;
}

interface LibraryManifest {
  schema: 1;
  set: string;
  libraries: Record<string, LibraryRecord>;
}

export interface ViewerServerOptions {
  store: ArtifactStore;
  secret: string;
  runtimeFile: string;
  librariesDir: string;
  host?: string;
  port?: number;
  idleMs?: number;
  now?: () => number;
  onIdle?: () => void;
}

export interface ViewerServer {
  server: http.Server;
  host: string;
  port: number;
  secret: string;
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

function injectRuntime(html: string, source: string, libraryTags: string): string {
  const runtimeTag = source.length === 0 ? '' : `<script>${source.replace(/<\/script/gi, '<\\/script')}</script>`;
  const tags = `${libraryTags}${runtimeTag}`;
  if (tags.length === 0) return html;
  const head = /<head[^>]*>/i.exec(html);
  if (head !== null) {
    const at = head.index + head[0].length;
    return html.slice(0, at) + tags + html.slice(at);
  }
  const body = /<body[^>]*>/i.exec(html);
  if (body !== null) {
    const at = body.index + body[0].length;
    return html.slice(0, at) + tags + html.slice(at);
  }
  return tags + html;
}

async function readRuntimeSource(file: string): Promise<string> {
  try {
    return await fs.readFile(file, 'utf8');
  } catch {
    return '';
  }
}

function sendJson(
  response: http.ServerResponse,
  status: number,
  body: unknown,
  extra: Record<string, string> = {},
): void {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': String(Buffer.byteLength(payload, 'utf8')),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...extra,
  });
  response.end(payload);
}

function sendError(
  response: http.ServerResponse,
  status: number,
  code: string,
  message: string,
): void {
  sendJson(response, status, { error: { code, message } }, runtimeCorsHeaders());
}

async function readJsonBody(request: http.IncomingMessage, maxBytes: number): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.byteLength;
    if (size > maxBytes) {
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

function requireSecret(
  request: http.IncomingMessage,
  response: http.ServerResponse,
  secret: string,
): boolean {
  const header = request.headers.authorization;
  const expected = `Bearer ${secret}`;
  if (
    typeof header !== 'string' ||
    header.length !== expected.length ||
    !crypto.timingSafeEqual(Buffer.from(header), Buffer.from(expected))
  ) {
    sendError(response, 401, 'UNAUTHORIZED', 'Invalid viewer secret');
    return false;
  }
  return true;
}

async function loadLibraries(directory: string): Promise<LibraryManifest | null> {
  try {
    const raw = await readJson(path.join(directory, 'manifest.json'));
    if (!isRecord(raw) || raw.schema !== 1) return null;
    if (typeof raw.set !== 'string' || raw.set.length === 0) return null;
    if (!isRecord(raw.libraries)) return null;
    const libraries: Record<string, LibraryRecord> = {};
    for (const [name, value] of Object.entries(raw.libraries)) {
      if (!isRecord(value)) continue;
      if (typeof value.file !== 'string' || path.basename(value.file) !== value.file) continue;
      if (typeof value.bytes !== 'number' || typeof value.sha256 !== 'string') continue;
      libraries[name] = { file: value.file, bytes: value.bytes, sha256: value.sha256 };
    }
    const verified: Record<string, LibraryRecord> = {};
    for (const [name, record] of Object.entries(libraries)) {
      try {
        const bytes = await fs.readFile(path.join(directory, record.file));
        const hash = crypto.createHash('sha256').update(bytes).digest('hex');
        if (hash !== record.sha256 || bytes.byteLength !== record.bytes) continue;
        verified[name] = record;
      } catch {
        continue;
      }
    }
    return { schema: 1, set: raw.set, libraries: verified };
  } catch {
    return null;
  }
}

export async function createViewerServer(options: ViewerServerOptions): Promise<ViewerServer> {
  const host = options.host ?? '127.0.0.1';
  const now = options.now ?? (() => Date.now());
  const startedAt = now();
  const libraries = await loadLibraries(options.librariesDir);
  const runtimeSource = await readRuntimeSource(options.runtimeFile);
  const libraryTags = (names: string[]): string =>
    names
      .filter((name) => libraries?.libraries[name] !== undefined)
      .map((name) => `<script src="/libraries/${name}.js"></script>`)
      .join('');
  const sseClients = new Map<string, Set<http.ServerResponse>>();
  let port = options.port ?? 0;
  let lastActivity = now();
  let isClosed = false;
  let resolveClosed: (() => void) | null = null;
  const closed = new Promise<void>((resolve) => {
    resolveClosed = resolve;
  });

  const server = http.createServer((request, response) => {
    lastActivity = now();
    void handleRequest(request, response).catch((error: unknown) => {
      if (response.headersSent) {
        response.end();
        return;
      }
      if (error instanceof HttpError) {
        sendError(response, error.status, error.code, error.message);
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
    clearInterval(idleTimer);
    for (const clients of sseClients.values()) {
      for (const client of clients) client.end();
    }
    sseClients.clear();
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
      server.closeAllConnections();
    });
    resolveClosed?.();
  };

  const idleMs = options.idleMs ?? 30 * 60 * 1000;
  const idleTimer = setInterval(
    () => {
      if (isClosed) return;
      if (sseClients.size > 0) {
        lastActivity = now();
        return;
      }
      if (now() - lastActivity >= idleMs) {
        void close().then(() => options.onIdle?.());
      }
    },
    Math.min(Math.max(Math.floor(idleMs / 2), 10), 60_000),
  );
  idleTimer.unref();

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      const address = server.address();
      if (address !== null && typeof address === 'object') {
        port = address.port;
      }
      resolve();
    });
  });

  async function handleRequest(
    request: http.IncomingMessage,
    response: http.ServerResponse,
  ): Promise<void> {
    const url = new URL(request.url ?? '/', `http://${host}`);

    if (request.method === 'OPTIONS') {
      response.writeHead(204, runtimeCorsHeaders());
      response.end();
      return;
    }

    if (url.pathname === '/health') {
      if (!requireSecret(request, response, options.secret)) return;
      sendJson(
        response,
        200,
        {
          ok: true,
          pid: process.pid,
          uptime: now() - startedAt,
          store: path.basename(options.store.storeRoot),
          librarySet: libraries?.set ?? null,
        },
        runtimeCorsHeaders(),
      );
      return;
    }

    if (url.pathname === '/mint') {
      await handleMint(request, response);
      return;
    }
    if (url.pathname === '/notify') {
      await handleNotify(request, response);
      return;
    }
    if (url.pathname === '/runtime/canvas.js') {
      await handleRuntime(response);
      return;
    }
    if (url.pathname.startsWith('/libraries/')) {
      await handleLibrary(url, response);
      return;
    }
    if (url.pathname.startsWith('/view/')) {
      await handleView(url, response);
      return;
    }
    if (url.pathname.startsWith('/events/')) {
      handleEvents(request, response, url);
      return;
    }
    if (url.pathname.startsWith('/api/')) {
      await handleApi(request, response, url);
      return;
    }
    if (url.pathname.startsWith('/data/')) {
      await handleData(url);
      return;
    }
    if (url.pathname.startsWith('/thumb/')) {
      throw new HttpError(404, 'NOT_FOUND', 'Thumbnail not found');
    }
    throw new HttpError(404, 'NOT_FOUND', 'Not found');
  }

  async function handleMint(
    request: http.IncomingMessage,
    response: http.ServerResponse,
  ): Promise<void> {
    if (!requireSecret(request, response, options.secret)) return;
    if (request.method !== 'POST') throw new HttpError(405, 'METHOD_NOT_ALLOWED', 'Use POST');
    const body = await readJsonBody(request, 16 * 1024);
    if (!isRecord(body) || typeof body.id !== 'string') {
      throw new HttpError(400, 'INVALID_REQUEST', 'id is required');
    }
    const versionInput = typeof body.version === 'string' ? body.version : undefined;
    if (body.version !== undefined && versionInput === undefined) {
      throw new HttpError(400, 'INVALID_REQUEST', 'version must be a string');
    }
    const result = await options.store.read(body.id, versionInput);
    const expiresAt = now() + VIEW_TOKEN_TTL_MS;
    const token = signViewToken(options.secret, body.id, result.version, expiresAt);
    const theme =
      body.theme === 'light' || body.theme === 'dark' ? `?theme=${body.theme}` : '';
    sendJson(
      response,
      200,
      {
        url: `http://${host}:${port}/view/${token}/${body.id}/${result.version}/${theme}`,
        expiresAt,
      },
      runtimeCorsHeaders(),
    );
  }

  async function handleNotify(
    request: http.IncomingMessage,
    response: http.ServerResponse,
  ): Promise<void> {
    if (!requireSecret(request, response, options.secret)) return;
    if (request.method !== 'POST') throw new HttpError(405, 'METHOD_NOT_ALLOWED', 'Use POST');
    const body = await readJsonBody(request, 16 * 1024);
    if (!isRecord(body) || typeof body.id !== 'string') {
      throw new HttpError(400, 'INVALID_REQUEST', 'id is required');
    }
    const event = body.event;
    if (event !== 'changed' && event !== 'deleted') {
      throw new HttpError(400, 'INVALID_REQUEST', 'event must be changed or deleted');
    }
    assertArtifactId(body.id);

    let message: Record<string, unknown>;
    if (event === 'changed') {
      if (typeof body.version !== 'string' || body.version.length === 0) {
        throw new HttpError(400, 'INVALID_REQUEST', 'version is required for changed');
      }
      const expiresAt = now() + VIEW_TOKEN_TTL_MS;
      const token = signViewToken(options.secret, body.id, body.version, expiresAt);
      message = {
        event: 'changed',
        id: body.id,
        version: body.version,
        url: `http://${host}:${port}/view/${token}/${body.id}/${body.version}/`,
      };
    } else {
      message = { event: 'deleted', id: body.id };
    }

    const clients = sseClients.get(body.id);
    const payload = `data: ${JSON.stringify(message)}\n\n`;
    for (const client of clients ?? []) {
      try {
        client.write(payload);
      } catch {
        clients?.delete(client);
      }
    }
    sendJson(response, 200, { notified: clients?.size ?? 0 }, runtimeCorsHeaders());
  }

  async function handleView(url: URL, response: http.ServerResponse): Promise<void> {
    const match = /^\/view\/([^/]+)\/([^/]+)\/([^/]+)\/(.*)$/.exec(url.pathname);
    if (!match) throw new HttpError(404, 'NOT_FOUND', 'Not found');
    const token = decode(match[1] ?? '');
    const id = decode(match[2] ?? '');
    const version = decode(match[3] ?? '');
    const rest = match[4] ?? '';
    if (token === null || id === null || version === null) {
      throw new HttpError(404, 'NOT_FOUND', 'Not found');
    }
    const payload = verifyViewToken(options.secret, token, now());
    if (payload === null || payload.id !== id || payload.version !== version) {
      throw new HttpError(404, 'NOT_FOUND', 'Not found');
    }

    const result = await options.store.read(id, version);
    const kind = result.meta.kind;
    if (kind !== 'html' && kind !== 'bundle') {
      throw new HttpError(501, 'UNSUPPORTED_KIND', `${kind} artifacts are not implemented yet`);
    }
    const relative = rest.length === 0 ? result.manifest.entry : rest;
    if (relative === result.manifest.entry) {
      const bytes = await options.store.readFile(id, version, relative);
      let html: string;
      try {
        html = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      } catch {
        throw new HttpError(500, 'INVALID_ARTIFACT', 'Entry is not valid UTF-8');
      }
      const injected = injectRuntime(html, runtimeSource, libraryTags(result.meta.libraries));
      const headers = viewHeaders({ kind, host, port });
      headers['Content-Length'] = String(Buffer.byteLength(injected, 'utf8'));
      response.writeHead(200, headers);
      response.end(injected);
      return;
    }

    const bytes = await options.store.readFile(id, version, relative);
    const headers: Record<string, string> = {
      'Content-Type': contentTypeFor(relative),
      'Content-Length': String(bytes.byteLength),
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Cross-Origin-Resource-Policy': 'cross-origin',
      'Access-Control-Allow-Origin': 'null',
    };
    if (relative.toLowerCase().endsWith('.svg')) {
      headers['Content-Security-Policy'] = "sandbox; default-src 'none'; style-src 'unsafe-inline'";
    }
    response.writeHead(200, headers);
    response.end(bytes);
  }

  async function handleRuntime(response: http.ServerResponse): Promise<void> {
    if (runtimeSource.length === 0) {
      throw new HttpError(404, 'NOT_FOUND', 'Runtime not built');
    }
    const bytes = Buffer.from(runtimeSource, 'utf8');
    response.writeHead(200, {
      'Content-Type': 'text/javascript; charset=utf-8',
      'Content-Length': String(bytes.byteLength),
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Cross-Origin-Resource-Policy': 'cross-origin',
      'Access-Control-Allow-Origin': 'null',
    });
    response.end(bytes);
  }

  async function handleLibrary(url: URL, response: http.ServerResponse): Promise<void> {
    let name = decode(url.pathname.slice('/libraries/'.length));
    if (name === null) throw new HttpError(404, 'NOT_FOUND', 'Not found');
    if (name.endsWith('.js')) name = name.slice(0, -3);
    const library = libraries?.libraries[name];
    if (library === undefined) throw new HttpError(404, 'NOT_FOUND', 'Library not found');
    let bytes: Buffer;
    try {
      bytes = await fs.readFile(path.join(options.librariesDir, library.file));
    } catch {
      throw new HttpError(404, 'NOT_FOUND', 'Library file not found');
    }
    response.writeHead(200, {
      'Content-Type': 'text/javascript; charset=utf-8',
      'Content-Length': String(bytes.byteLength),
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Cross-Origin-Resource-Policy': 'cross-origin',
      'Access-Control-Allow-Origin': 'null',
    });
    response.end(bytes);
  }

  function handleEvents(
    request: http.IncomingMessage,
    response: http.ServerResponse,
    url: URL,
  ): void {
    const match = /^\/events\/([^/]+)\/([^/]+)$/.exec(url.pathname);
    if (!match) throw new HttpError(404, 'NOT_FOUND', 'Not found');
    const token = decode(match[1] ?? '');
    const id = decode(match[2] ?? '');
    if (token === null || id === null) {
      throw new HttpError(404, 'NOT_FOUND', 'Not found');
    }
    const payload = verifyViewToken(options.secret, token, now());
    if (payload === null || payload.id !== id) {
      throw new HttpError(404, 'NOT_FOUND', 'Not found');
    }

    response.writeHead(200, {
      ...runtimeCorsHeaders(),
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-store',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    response.write('data: ready\n\n');
    const clients = sseClients.get(id) ?? new Set<http.ServerResponse>();
    clients.add(response);
    sseClients.set(id, clients);

    let cleaned = false;
    const heartbeat = setInterval(() => {
      try {
        response.write('data: ping\n\n');
      } catch {
        // The connection is gone; the close handler cleans up.
      }
    }, HEARTBEAT_MS);
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      clearInterval(heartbeat);
      clients.delete(response);
      if (clients.size === 0) sseClients.delete(id);
    };
    request.on('close', cleanup);
    response.on('close', cleanup);
  }

  async function handleApi(
    request: http.IncomingMessage,
    response: http.ServerResponse,
    url: URL,
  ): Promise<void> {
    const match = /^\/api\/([^/]+)\/(state|feedback|refresh)$/.exec(url.pathname);
    if (!match) throw new HttpError(404, 'NOT_FOUND', 'Not found');
    const token = decode(match[1] ?? '');
    const action = match[2];
    if (token === null || action === undefined) {
      throw new HttpError(404, 'NOT_FOUND', 'Not found');
    }
    const payload = verifyViewToken(options.secret, token, now());
    if (payload === null) throw new HttpError(404, 'NOT_FOUND', 'Not found');

    if (action === 'state') {
      if (request.method === 'GET') {
        const state = await options.store.readState(payload.id);
        sendJson(response, 200, { state }, runtimeCorsHeaders());
        return;
      }
      if (request.method !== 'POST') {
        throw new HttpError(405, 'METHOD_NOT_ALLOWED', 'Use GET or POST');
      }
      const body = await readJsonBody(request, MAX_JSON_BODY);
      if (!isRecord(body) || typeof body.key !== 'string') {
        throw new HttpError(400, 'INVALID_REQUEST', 'key is required');
      }
      const remove = body.delete === true;
      const value = body.value;
      if (!remove && !isJsonValue(value)) {
        throw new HttpError(400, 'INVALID_REQUEST', 'value must be JSON');
      }
      const state = await options.store.writeStateKey(
        payload.id,
        body.key,
        remove ? undefined : (value as JsonValue),
      );
      sendJson(response, 200, { ok: true, state }, runtimeCorsHeaders());
      return;
    }

    if (action === 'feedback') {
      if (request.method !== 'POST') {
        throw new HttpError(405, 'METHOD_NOT_ALLOWED', 'Use POST');
      }
      const body = await readJsonBody(request, MAX_JSON_BODY);
      if (!isRecord(body) || !isJsonValue(body.data)) {
        throw new HttpError(400, 'INVALID_REQUEST', 'data must be JSON');
      }
      const kind = typeof body.kind === 'string' ? body.kind : 'form';
      const record = await options.store.addFeedback(payload.id, {
        version: payload.version,
        kind,
        data: body.data,
      });
      sendJson(
        response,
        200,
        { id: record.id, createdAt: record.createdAt },
        runtimeCorsHeaders(),
      );
      return;
    }

    if (request.method !== 'POST') {
      throw new HttpError(405, 'METHOD_NOT_ALLOWED', 'Use POST');
    }
    sendJson(response, 200, { ok: true }, runtimeCorsHeaders());
  }

  async function handleData(url: URL): Promise<void> {
    const match = /^\/data\/([^/]+)\/([^/]+)\/([^/]+)$/.exec(url.pathname);
    if (!match) throw new HttpError(404, 'NOT_FOUND', 'Not found');
    const token = decode(match[1] ?? '');
    if (token === null) throw new HttpError(404, 'NOT_FOUND', 'Not found');
    const payload = verifyViewToken(options.secret, token, now());
    if (payload === null) throw new HttpError(404, 'NOT_FOUND', 'Not found');
    throw new HttpError(501, 'UNSUPPORTED', 'Live sources are not implemented yet');
  }

  function sendStoreError(response: http.ServerResponse, error: StoreError): void {
    const status =
      error.code === 'NOT_FOUND' || error.code === 'PATH_NOT_FOUND'
        ? 404
        : error.code === 'INVALID_PATH' || error.code === 'INVALID_ARTIFACT'
          ? 400
          : error.code === 'TOO_LARGE' || error.code === 'TOO_MANY_FILES'
            ? 413
            : 500;
    sendError(response, status, error.code, error.message);
  }

  return {
    server,
    host,
    port,
    secret: options.secret,
    closed,
    close,
  };
}

async function main(): Promise<void> {
  const storeRoot = defaultStoreRoot();
  const portFile = process.env.CANVAS_VIEWER_PORT_FILE ?? defaultViewerPortFile(storeRoot);
  const idleMs = Number(process.env.CANVAS_VIEWER_IDLE_MS ?? 30 * 60 * 1000);
  const store = new ArtifactStore({ root: storeRoot });
  await store.init();
  const secret = crypto.randomBytes(32).toString('hex');
  const viewerDir = path.dirname(fileURLToPath(import.meta.url));
  const viewer = await createViewerServer({
    store,
    secret,
    runtimeFile: path.join(viewerDir, 'runtime', 'canvas.js'),
    librariesDir: path.join(viewerDir, 'libraries'),
    idleMs,
    onIdle: () => process.exit(0),
  });
  await ensureDir(path.dirname(portFile));
  await writeJsonAtomic(portFile, {
    schema: 1,
    port: viewer.port,
    pid: process.pid,
    secret,
    startedAt: new Date().toISOString(),
  });
  console.error(`[canvas viewer] listening on ${viewer.port}`);

  const shutdown = () => {
    void viewer.close();
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  await viewer.closed;
}

const isMain =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  await main();
}
