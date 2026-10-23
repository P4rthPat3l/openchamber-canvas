import * as crypto from 'node:crypto';

import { StoreError } from '../store/errors';
import { mimeForPath } from '../store/fs';
import {
  ARTIFACT_ID_RE,
  VERSION_ID_RE,
  assertArtifactId,
  assertRelativePath,
  assertRealpathWithin,
  assertVersionId,
  errorCode,
  resolveWithin,
} from '../store/paths';
import type { ArtifactKind } from '../store/types';

export interface ViewHeaderInput {
  kind: ArtifactKind;
  host: string;
  port: number;
}

export interface ViewToken {
  id: string;
  version: string;
}

const PERMISSIONS_POLICY = [
  'camera=()',
  'microphone=()',
  'geolocation=()',
  'payment=()',
  'usb=()',
  'clipboard-read=()',
  'clipboard-write=()',
].join(', ');

export function isLoopbackHost(host: string): boolean {
  return host === '127.0.0.1' || host === 'localhost' || host === '::1' || host === '[::1]';
}

export function assertLoopbackHost(host: string): void {
  if (!isLoopbackHost(host)) {
    throw new StoreError('INVALID_PATH', 'The viewer host must be loopback');
  }
}

function normalizeHost(host: string): string {
  return host === '::1' ? '[::1]' : host;
}

function buildCsp(kind: ArtifactKind, host: string, port: number): string | null {
  const origin = `http://${normalizeHost(host)}:${port}`;
  if (kind === 'html' || kind === 'bundle' || kind === 'data') {
    return [
      'sandbox allow-scripts',
      "default-src 'none'",
      `script-src ${origin} 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval'`,
      `style-src ${origin} 'unsafe-inline'`,
      `img-src ${origin} data: blob:`,
      `font-src ${origin} data:`,
      `media-src ${origin} data: blob:`,
      `connect-src ${origin}`,
      "worker-src 'none'",
      "frame-src 'none'",
      "object-src 'none'",
      "form-action 'none'",
      "base-uri 'none'",
      "manifest-src 'none'",
    ].join('; ');
  }
  if (kind === 'markdown') {
    return [
      'sandbox',
      "default-src 'none'",
      "style-src 'unsafe-inline'",
      `img-src ${origin} data:`,
      `font-src ${origin} data:`,
      "connect-src 'none'",
      "frame-src 'none'",
      "form-action 'none'",
      "base-uri 'none'",
    ].join('; ');
  }
  if (kind === 'image') {
    return ['sandbox', "default-src 'none'", "style-src 'unsafe-inline'"].join('; ');
  }
  return null;
}

export function viewHeaders(input: ViewHeaderInput): Record<string, string> {
  assertLoopbackHost(input.host);
  if (!Number.isInteger(input.port) || input.port < 1 || input.port > 65535) {
    throw new StoreError('INVALID_PATH', 'The viewer port is invalid');
  }

  const headers: Record<string, string> = {
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Permissions-Policy': PERMISSIONS_POLICY,
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Resource-Policy': 'cross-origin',
  };

  const csp = buildCsp(input.kind, input.host, input.port);
  if (csp !== null) headers['Content-Security-Policy'] = csp;

  if (input.kind === 'html' || input.kind === 'bundle' || input.kind === 'markdown' || input.kind === 'data') {
    headers['Content-Type'] = 'text/html; charset=utf-8';
  } else if (input.kind === 'pdf') {
    headers['Content-Type'] = 'application/pdf';
    headers['Content-Disposition'] = 'inline';
  }

  return headers;
}

export function runtimeCorsHeaders(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': 'null',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'content-type',
    'Access-Control-Max-Age': '600',
    Vary: 'Origin',
  };
}

export function contentTypeFor(filePath: string): string {
  return mimeForPath(filePath) ?? 'application/octet-stream';
}

export async function resolveViewFile(versionDir: string, relativePath: string): Promise<string> {
  assertRelativePath(relativePath);
  const absolute = resolveWithin(versionDir, relativePath);
  try {
    return await assertRealpathWithin(versionDir, absolute);
  } catch (error) {
    if (errorCode(error) === 'ENOENT') {
      throw new StoreError('NOT_FOUND', 'File not found');
    }
    throw error;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function encodePayload(payload: { id: string; version: string; expiresAt: number }): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

export function signViewToken(
  secret: string,
  id: string,
  version: string,
  expiresAt: number,
): string {
  assertArtifactId(id);
  assertVersionId(version);
  if (!Number.isFinite(expiresAt) || expiresAt <= 0) {
    throw new StoreError('INVALID_PATH', 'The view token expiry is invalid');
  }
  const payload = encodePayload({ id, version, expiresAt });
  const signature = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

export function verifyViewToken(secret: string, token: string, now = Date.now()): ViewToken | null {
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const payload = parts[0];
  const signature = parts[1];
  if (payload === undefined || signature === undefined) return null;

  const expected = crypto.createHmac('sha256', secret).update(payload).digest();
  const provided = Buffer.from(signature, 'base64url');
  if (provided.length !== expected.length || !crypto.timingSafeEqual(provided, expected)) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;
  const { id, version, expiresAt } = parsed;
  if (typeof id !== 'string' || !ARTIFACT_ID_RE.test(id)) return null;
  if (typeof version !== 'string' || !VERSION_ID_RE.test(version)) return null;
  if (typeof expiresAt !== 'number' || !Number.isFinite(expiresAt) || expiresAt <= now) return null;
  return { id, version };
}
