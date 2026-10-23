import { afterEach, describe, expect, test } from 'bun:test';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import { ArtifactStore } from '../src/store/index';
import type { ArtifactStoreOptions } from '../src/store/index';
import type { CreateResult } from '../src/store/types';
import { createViewerServer } from '../src/viewer/server';
import type { ViewerServer } from '../src/viewer/server';

const temporaryRoots: string[] = [];
const viewers: ViewerServer[] = [];

afterEach(async () => {
  for (const viewer of viewers.splice(0)) {
    await viewer.close();
  }
  for (const root of temporaryRoots.splice(0)) {
    await fs.rm(root, { recursive: true, force: true });
  }
});

async function makeRoot(prefix: string): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  temporaryRoots.push(root);
  return root;
}

function makeStore(root: string, overrides: Partial<ArtifactStoreOptions> = {}) {
  let tick = 0;
  let now = new Date('2026-10-23T14:25:01.123Z');
  const store = new ArtifactStore({
    root,
    now: () => now,
    random: (size) => {
      tick += 1;
      const bytes = new Uint8Array(size);
      bytes.fill((tick % 255) + 1);
      return bytes;
    },
    lockRetryMs: 2,
    lockTimeoutMs: 200,
    lockStaleMs: 1000,
    ...overrides,
  });
  return {
    store,
    advance: (milliseconds = 1000) => {
      now = new Date(now.getTime() + milliseconds);
    },
  };
}

function page(body = '<h1>Revenue</h1>'): string {
  return `<!doctype html><html><body>${body}<script>window.__page = true;</script></body></html>`;
}

async function createHtml(store: ArtifactStore): Promise<CreateResult> {
  return store.create({
    title: 'Revenue by region',
    kind: 'html',
    directory: '/home/parth/Project',
    files: [{ path: 'index.html', content: page() }],
  });
}

interface ViewerFixture {
  viewer: ViewerServer;
  store: ArtifactStore;
  created: CreateResult;
  advance: (milliseconds?: number) => void;
  base: string;
  auth: Record<string, string>;
}

async function makeViewer(): Promise<ViewerFixture> {
  const storeRoot = await makeRoot('canvas-viewer-store-');
  const assetsRoot = await makeRoot('canvas-viewer-assets-');
  const { store, advance } = makeStore(storeRoot);
  const created = await createHtml(store);

  const runtimeFile = path.join(assetsRoot, 'runtime.js');
  await fs.writeFile(runtimeFile, 'globalThis.__canvasRuntime = true;\n', 'utf8');
  const librariesDir = path.join(assetsRoot, 'libraries');
  await fs.mkdir(librariesDir, { recursive: true });
  const chartSource = 'globalThis.Chart = {};\n';
  await fs.writeFile(path.join(librariesDir, 'chartjs.js'), chartSource, 'utf8');
  await fs.writeFile(
    path.join(librariesDir, 'manifest.json'),
    JSON.stringify({
      schema: 1,
      set: 'canvas-2026-10',
      libraries: {
        chartjs: {
          file: 'chartjs.js',
          bytes: Buffer.byteLength(chartSource, 'utf8'),
          sha256: crypto.createHash('sha256').update(chartSource).digest('hex'),
        },
      },
    }),
    'utf8',
  );

  const secret = '0123456789abcdef0123456789abcdef';
  const viewer = await createViewerServer({
    store,
    secret,
    runtimeFile,
    librariesDir,
    idleMs: 60_000,
  });
  viewers.push(viewer);
  return {
    viewer,
    store,
    created,
    advance,
    base: `http://127.0.0.1:${viewer.port}`,
    auth: { authorization: `Bearer ${secret}` },
  };
}

async function mint(fixture: ViewerFixture): Promise<{ url: string; expiresAt: number }> {
  return mintFor(fixture, fixture.created.id);
}

async function mintFor(
  fixture: ViewerFixture,
  id: string,
): Promise<{ url: string; expiresAt: number }> {
  const response = await fetch(`${fixture.base}/mint`, {
    method: 'POST',
    headers: { ...fixture.auth, 'content-type': 'application/json' },
    body: JSON.stringify({ id, theme: 'dark' }),
  });
  expect(response.status).toBe(200);
  return (await response.json()) as { url: string; expiresAt: number };
}

describe('viewer server', () => {
  test('serves health only with the viewer secret', async () => {
    const fixture = await makeViewer();
    const health = await fetch(`${fixture.base}/health`, { headers: fixture.auth });
    expect(health.status).toBe(200);
    const body = (await health.json()) as { ok: boolean; librarySet: string };
    expect(body.ok).toBe(true);
    expect(body.librarySet).toBe('canvas-2026-10');

    const unauthorized = await fetch(`${fixture.base}/health`);
    expect(unauthorized.status).toBe(401);
  });

  test('mints a view URL and serves the entry with the runtime injected', async () => {
    const fixture = await makeViewer();
    const minted = await mint(fixture);
    expect(minted.url).toContain('/view/');
    expect(minted.url).toContain('?theme=dark');

    const view = await fetch(minted.url);
    expect(view.status).toBe(200);
    const csp = view.headers.get('content-security-policy') ?? '';
    expect(csp).toContain(`connect-src http://127.0.0.1:${fixture.viewer.port}`);
    expect(csp).toContain('sandbox allow-scripts');
    expect(view.headers.get('cross-origin-resource-policy')).toBe('cross-origin');
    const html = await view.text();
    expect(html).toContain('globalThis.__canvasRuntime = true;');
    const runtimeIndex = html.indexOf('__canvasRuntime');
    const pageIndex = html.indexOf('__page');
    expect(runtimeIndex).toBeGreaterThanOrEqual(0);
    expect(pageIndex).toBeGreaterThan(runtimeIndex);
    expect(html).toContain('<h1>Revenue</h1>');
  });

  test('serves the runtime script and a pinned library', async () => {
    const fixture = await makeViewer();
    const runtime = await fetch(`${fixture.base}/runtime/canvas.js`);
    expect(runtime.status).toBe(200);
    expect(runtime.headers.get('content-type')).toContain('text/javascript');
    expect(await runtime.text()).toContain('__canvasRuntime');

    const library = await fetch(`${fixture.base}/libraries/chartjs.js`);
    expect(library.status).toBe(200);
    expect(await library.text()).toContain('globalThis.Chart');

    const unknown = await fetch(`${fixture.base}/libraries/unknown.js`);
    expect(unknown.status).toBe(404);
  });

  test('serves a bundle asset from the same version', async () => {    const fixture = await makeViewer();
    const bundle = await fixture.store.create({
      title: 'Bundle',
      kind: 'bundle',
      directory: '/home/parth/Project',
      entry: 'index.html',
      files: [
        { path: 'index.html', content: page() },
        { path: 'app.js', content: 'console.log(1);' },
      ],
    });
    const minted = await mintFor(fixture, bundle.id);
    const view = await fetch(minted.url);
    expect(view.status).toBe(200);
    expect(await view.text()).toContain('<h1>Revenue</h1>');

    const parsed = new URL(minted.url);
    const assetUrl = `${fixture.base}${parsed.pathname.replace(/\/$/, '')}/app.js${parsed.search}`;
    const asset = await fetch(assetUrl);
    expect(asset.status).toBe(200);
    expect(asset.headers.get('content-type')).toContain('text/javascript');
    expect(asset.headers.get('cross-origin-resource-policy')).toBe('cross-origin');
    expect(await asset.text()).toBe('console.log(1);');

    const missingUrl = `${fixture.base}${parsed.pathname.replace(/\/$/, '')}/missing.js${parsed.search}`;
    expect((await fetch(missingUrl)).status).toBe(404);
  });

  test('injects a pinned library tag before the artifact scripts', async () => {
    const fixture = await makeViewer();
    const withLibrary = await fixture.store.create({
      title: 'Chart',
      kind: 'html',
      directory: '/home/parth/Project',
      libraries: ['chartjs'],
      files: [{ path: 'index.html', content: page() }],
    });
    const minted = await mintFor(fixture, withLibrary.id);
    const html = await (await fetch(minted.url)).text();
    const libraryIndex = html.indexOf('/libraries/chartjs.js');
    const pageIndex = html.indexOf('__page');
    expect(libraryIndex).toBeGreaterThanOrEqual(0);
    expect(pageIndex).toBeGreaterThan(libraryIndex);
    expect(html).toContain('__canvasRuntime');
  });

  test('streams a change notification to an open artifact', async () => {
    const fixture = await makeViewer();
    const minted = await mint(fixture);
    const token = new URL(minted.url).pathname.split('/')[2] ?? '';
    const controller = new AbortController();
    const events = await fetch(`${fixture.base}/events/${token}/${fixture.created.id}`, {
      signal: controller.signal,
    });
    expect(events.status).toBe(200);
    const reader = events.body?.getReader();
    expect(reader).toBeDefined();
    const decoder = new TextDecoder();
    let buffer = '';

    async function readUntil(fragment: string): Promise<void> {
      for (;;) {
        const chunk = await reader?.read();
        if (!chunk || chunk.done) throw new Error(`Stream ended before ${fragment}`);
        buffer += decoder.decode(chunk.value, { stream: true });
        if (buffer.includes(fragment)) return;
      }
    }

    await readUntil('data: ready');
    fixture.advance();
    const updated = await fixture.store.update(fixture.created.id, {
      mode: 'replace',
      baseVersion: fixture.created.version,
      files: [{ path: 'index.html', content: page('<h1>Second</h1>') }],
    });
    const notify = await fetch(`${fixture.base}/notify`, {
      method: 'POST',
      headers: { ...fixture.auth, 'content-type': 'application/json' },
      body: JSON.stringify({ id: fixture.created.id, event: 'changed', version: updated.version }),
    });
    expect(notify.status).toBe(200);
    await readUntil('"event":"changed"');
    expect(buffer).toContain(`"version":"${updated.version}"`);
    expect(buffer).toContain('"url":"http://127.0.0.1:');
    controller.abort();
  });

  test('writes feedback for the version in the token', async () => {
    const fixture = await makeViewer();
    const minted = await mint(fixture);
    const token = new URL(minted.url).pathname.split('/')[2] ?? '';
    const response = await fetch(`${fixture.base}/api/${token}/feedback`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kind: 'form', data: { region: 'EMEA' } }),
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { id: string };
    expect(body.id).toMatch(/^fb_/);

    const feedback = await fixture.store.listFeedback(fixture.created.id);
    expect(feedback).toHaveLength(1);
    expect(feedback[0]?.data).toEqual({ region: 'EMEA' });
    expect(feedback[0]?.version).toBe(fixture.created.version);
  });

  test('reads, writes, and deletes runtime state', async () => {
    const fixture = await makeViewer();
    const minted = await mint(fixture);
    const token = new URL(minted.url).pathname.split('/')[2] ?? '';

    const empty = await fetch(`${fixture.base}/api/${token}/state`);
    expect(await empty.json()).toEqual({ state: {} });

    const write = await fetch(`${fixture.base}/api/${token}/state`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ key: 'filter', value: { region: 'EMEA' } }),
    });
    expect(write.status).toBe(200);

    const read = await fetch(`${fixture.base}/api/${token}/state`);
    const readBody = (await read.json()) as { state: Record<string, unknown> };
    expect(readBody.state.filter).toEqual({ region: 'EMEA' });

    const remove = await fetch(`${fixture.base}/api/${token}/state`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ key: 'filter', delete: true }),
    });
    expect(remove.status).toBe(200);
    const after = await fetch(`${fixture.base}/api/${token}/state`);
    expect(await after.json()).toEqual({ state: {} });
  });

  test('rejects traversal, missing tokens, and live data', async () => {
    const fixture = await makeViewer();
    const minted = await mint(fixture);
    const token = new URL(minted.url).pathname.split('/')[2] ?? '';

    const parsed = new URL(minted.url);
    const traversalUrl = `${fixture.base}${parsed.pathname.replace(/\/$/, '')}/%2e%2e/%2e%2e/etc/passwd${parsed.search}`;
    const traversal = await fetch(traversalUrl);
    expect([400, 404]).toContain(traversal.status);

    const badToken = await fetch(`${fixture.base}/api/not-a-token/state`);
    expect(badToken.status).toBe(404);

    const data = await fetch(`${fixture.base}/data/${token}/${fixture.created.id}/sales`);
    expect(data.status).toBe(501);
  });

  test('closes cleanly', async () => {
    const fixture = await makeViewer();
    await fixture.viewer.close();
    await expect(fetch(`${fixture.base}/health`, { headers: fixture.auth })).rejects.toThrow();
  });
});
