import { afterEach, describe, expect, test } from 'bun:test';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  contentTypeFor,
  isLoopbackHost,
  resolveViewFile,
  runtimeCorsHeaders,
  signViewToken,
  verifyViewToken,
  viewHeaders,
} from '../src/viewer/policy';
import { expectStoreError } from './helpers';

const temporaryRoots: string[] = [];

afterEach(async () => {
  for (const root of temporaryRoots.splice(0)) {
    await fs.rm(root, { recursive: true, force: true });
  }
});

const artifactId = '01J8Z3K4Q7ABCDEFGHJKMNPQRS-revenue-by-region';
const version = '20261023T142501123Z';
const secret = '0123456789abcdef0123456789abcdef';

describe('view policy', () => {
  test('builds the html policy with the viewer origin and a sandbox', () => {
    const headers = viewHeaders({ kind: 'html', host: '127.0.0.1', port: 43117 });
    const csp = headers['Content-Security-Policy'] ?? '';

    expect(csp).toContain('sandbox allow-scripts');
    expect(csp).toContain('connect-src http://127.0.0.1:43117');
    expect(csp).toContain('script-src http://127.0.0.1:43117');
    expect(csp).toContain('style-src http://127.0.0.1:43117');
    expect(csp).toContain('img-src http://127.0.0.1:43117');
    expect(csp).toContain("frame-src 'none'");
    expect(csp).toContain("form-action 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).not.toContain("connect-src 'none'");
    expect(headers['Content-Type']).toBe('text/html; charset=utf-8');
    expect(headers['Cache-Control']).toBe('no-store');
    expect(headers['X-Content-Type-Options']).toBe('nosniff');
    expect(headers['Permissions-Policy']).toContain('camera=()');
    expect(headers['Access-Control-Allow-Origin']).toBeUndefined();
  });

  test('builds the markdown policy without scripts', () => {
    const headers = viewHeaders({ kind: 'markdown', host: '127.0.0.1', port: 43117 });
    const csp = headers['Content-Security-Policy'] ?? '';
    expect(csp).toContain('sandbox');
    expect(csp).toContain("connect-src 'none'");
    expect(csp).not.toContain('allow-scripts');
  });

  test('builds the image policy without scripts or a document type', () => {
    const headers = viewHeaders({ kind: 'image', host: '127.0.0.1', port: 43117 });
    const csp = headers['Content-Security-Policy'] ?? '';
    expect(csp).toContain("default-src 'none'");
    expect(csp).not.toContain('allow-scripts');
    expect(headers['Content-Type']).toBeUndefined();
  });

  test('builds the pdf policy without a CSP', () => {
    const headers = viewHeaders({ kind: 'pdf', host: '127.0.0.1', port: 43117 });
    expect(headers['Content-Security-Policy']).toBeUndefined();
    expect(headers['Content-Type']).toBe('application/pdf');
    expect(headers['Content-Disposition']).toBe('inline');
  });

  test('rejects a non-loopback host and a bad port', async () => {
    await expectStoreError(
      Promise.resolve().then(() => viewHeaders({ kind: 'html', host: '0.0.0.0', port: 43117 })),
      'INVALID_PATH',
    );
    await expectStoreError(
      Promise.resolve().then(() => viewHeaders({ kind: 'html', host: 'example.com', port: 43117 })),
      'INVALID_PATH',
    );
    await expectStoreError(
      Promise.resolve().then(() => viewHeaders({ kind: 'html', host: '127.0.0.1', port: 0 })),
      'INVALID_PATH',
    );
  });

  test('returns CORS headers for the opaque-origin runtime routes', () => {
    const headers = runtimeCorsHeaders();
    expect(headers['Access-Control-Allow-Origin']).toBe('null');
    expect(headers['Access-Control-Allow-Methods']).toContain('POST');
    expect(headers['Access-Control-Allow-Headers']).toContain('content-type');
    expect(headers.Vary).toBe('Origin');
  });

  test('signs and verifies a view token', () => {
    const token = signViewToken(secret, artifactId, version, 2000);
    expect(verifyViewToken(secret, token, 1000)).toEqual({ id: artifactId, version });
    expect(verifyViewToken(secret, token, 2001)).toBeNull();
    expect(verifyViewToken('another-secret-0123456789abcdef', token, 1000)).toBeNull();
    expect(verifyViewToken(secret, 'not-a-token', 1000)).toBeNull();
  });

  test('rejects a tampered token', () => {
    const token = signViewToken(secret, artifactId, version, 2000);
    const [payload, signature] = token.split('.');
    expect(payload).toBeDefined();
    expect(signature).toBeDefined();
    const last = signature?.slice(-1) ?? '';
    const tampered = `${payload}.${signature?.slice(0, -1)}${last === 'A' ? 'B' : 'A'}`;
    expect(verifyViewToken(secret, tampered, 1000)).toBeNull();
  });

  test('rejects invalid ids and versions when signing', async () => {
    await expectStoreError(
      Promise.resolve().then(() => signViewToken(secret, 'bad-id', version, 2000)),
      'INVALID_PATH',
    );
    await expectStoreError(
      Promise.resolve().then(() => signViewToken(secret, artifactId, 'bad-version', 2000)),
      'INVALID_PATH',
    );
  });

  test('resolves a safe file and blocks traversal and symlinks', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'canvas-view-'));
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'canvas-outside-'));
    temporaryRoots.push(root, outside);
    await fs.mkdir(path.join(root, 'assets'));
    await fs.writeFile(path.join(root, 'index.html'), '<html></html>', 'utf8');
    await fs.writeFile(path.join(root, 'assets', 'app.js'), 'x', 'utf8');
    await fs.writeFile(path.join(outside, 'secret.txt'), 'secret', 'utf8');

    const resolved = await resolveViewFile(root, 'assets/app.js');
    expect(resolved).toBe(await fs.realpath(path.join(root, 'assets', 'app.js')));

    await expectStoreError(resolveViewFile(root, '../secret.txt'), 'INVALID_PATH');
    await expectStoreError(resolveViewFile(root, '/etc/passwd'), 'INVALID_PATH');
    await expectStoreError(resolveViewFile(root, 'missing.html'), 'NOT_FOUND');

    if (process.platform !== 'win32') {
      await fs.symlink(path.join(outside, 'secret.txt'), path.join(root, 'link.txt'));
      await expectStoreError(resolveViewFile(root, 'link.txt'), 'INVALID_PATH');
    }
  });

  test('maps content types and loopback hosts', () => {
    expect(contentTypeFor('index.html')).toBe('text/html; charset=utf-8');
    expect(contentTypeFor('app.js')).toBe('text/javascript; charset=utf-8');
    expect(contentTypeFor('logo.png')).toBe('image/png');
    expect(contentTypeFor('file.unknown')).toBe('application/octet-stream');

    expect(isLoopbackHost('127.0.0.1')).toBe(true);
    expect(isLoopbackHost('localhost')).toBe(true);
    expect(isLoopbackHost('::1')).toBe(true);
    expect(isLoopbackHost('[::1]')).toBe(true);
    expect(isLoopbackHost('0.0.0.0')).toBe(false);
    expect(isLoopbackHost('example.com')).toBe(false);
    expect(isLoopbackHost('10.0.0.1')).toBe(false);
  });
});
