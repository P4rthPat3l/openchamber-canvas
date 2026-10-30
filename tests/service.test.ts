import { afterEach, describe, expect, test } from 'bun:test';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import { unzipSync } from 'fflate';

import { ArtifactStore } from '../src/store/index';
import type { ArtifactStoreOptions } from '../src/store/index';
import type { CreateResult } from '../src/store/types';
import { createServiceServer } from '../src/service/routes';
import type { ServiceServer, ServiceServerOptions } from '../src/service/routes';
import { CANVAS_VERSION } from '../src/version';

const temporaryRoots: string[] = [];
const services: ServiceServer[] = [];
const token = 'service-token-0123456789abcdef';

afterEach(async () => {
  for (const service of services.splice(0)) {
    await service.close();
  }
  for (const root of temporaryRoots.splice(0)) {
    await fs.rm(root, { recursive: true, force: true });
  }
});

async function makeRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'canvas-service-'));
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

const page = '<!doctype html><html><body><h1>Service</h1></body></html>';

interface ServiceFixture {
  service: ServiceServer;
  store: ArtifactStore;
  root: string;
  created: CreateResult;
  bundle: CreateResult;
  base: string;
  auth: Record<string, string>;
}

async function makeService(overrides: Partial<ServiceServerOptions> = {}): Promise<ServiceFixture> {
  const root = await makeRoot();
  const { store } = makeStore(root);
  const created = await store.create({
    title: 'Service',
    kind: 'html',
    directory: '/home/parth/Project',
    files: [{ path: 'index.html', content: page }],
  });
  const bundle = await store.create({
    title: 'Bundle',
    kind: 'bundle',
    directory: '/home/parth/Project',
    entry: 'index.html',
    files: [
      { path: 'index.html', content: page },
      { path: 'app.js', content: 'console.log(1);' },
    ],
  });
  const service = await createServiceServer({
    store,
    token,
    storeRoot: root,
    portFile: path.join(root, '.viewer.json'),
    viewerEntry: path.join(root, 'missing-viewer.js'),
    pluginPath: path.join(root, 'installed'),
    viewerTimeoutMs: 200,
    ...overrides,
  });
  services.push(service);
  return {
    service,
    store,
    root,
    created,
    bundle,
    base: `http://127.0.0.1:${service.port}`,
    auth: { authorization: `Bearer ${token}` },
  };
}

function get(fixture: ServiceFixture, pathname: string): Promise<Response> {
  return fetch(`${fixture.base}${pathname}`, { headers: fixture.auth });
}

function postJson(fixture: ServiceFixture, pathname: string, body: unknown): Promise<Response> {
  return fetch(`${fixture.base}${pathname}`, {
    method: 'POST',
    headers: { ...fixture.auth, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('canvas service', () => {
  test('AC-051 AC-052 AC-059 AC-063: feedback pages, pending totals, filtered list pages, and viewer status', async () => {
    const fixture = await makeService();
    for (let index = 0; index < 3; index++) await fixture.store.addFeedback(fixture.created.id, { version: fixture.created.version, data: { index } });
    const first = await get(fixture, `/feedback/${fixture.created.id}?limit=2&offset=0`).then(response => response.json());
    const second = await get(fixture, `/feedback/${fixture.created.id}?limit=2&offset=2`).then(response => response.json());
    expect(first.total).toBe(3);
    expect(first.responses.length + second.responses.length).toBe(3);
    await postJson(fixture, `/feedback/${fixture.created.id}`, { ids: [first.responses[0].id] });
    const listed = await get(fixture, '/list?query=Service&sort=title&limit=1&offset=0').then(response => response.json());
    expect(listed.total).toBe(1);
    expect(listed.pendingFeedbackCount).toBe(2);
    expect((await get(fixture, '/list?query=Service&offset=1').then(response => response.json())).artifacts).toHaveLength(0);
    expect((await get(fixture, '/viewer-status').then(response => response.json())).status).toBe('Not running');
    expect((await fetch(`${fixture.base}/viewer-restart`, { method: 'POST' })).status).toBe(401);
  });
  test('answers health only with the service token', async () => {
    const fixture = await makeService();
    const health = await get(fixture, '/health');
    expect(health.status).toBe(200);
    const body = (await health.json()) as { ok: boolean; version: string };
    expect(body.ok).toBe(true);
    expect(body.version).toBe(CANVAS_VERSION);
    expect((await fetch(`${fixture.base}/health`)).status).toBe(401);
  });

  test('lists artifacts, reads metadata, and lists versions', async () => {
    const fixture = await makeService();
    const query = new URLSearchParams({ directory: '/home/parth/Project' });
    const list = await get(fixture, `/list?${query.toString()}`);
    expect(list.status).toBe(200);
    const listed = (await list.json()) as { artifacts: Array<{ id: string }> };
    expect(listed.artifacts.map((item) => item.id).sort()).toEqual(
      [fixture.created.id, fixture.bundle.id].sort(),
    );

    const artifact = await get(fixture, `/artifact/${fixture.created.id}`);
    expect(((await artifact.json()) as { id: string }).id).toBe(fixture.created.id);

    const versions = await get(fixture, `/versions/${fixture.created.id}`);
    expect(((await versions.json()) as { versions: unknown[] }).versions).toHaveLength(1);
  });

  test('reads and marks feedback delivered', async () => {
    const fixture = await makeService();
    const record = await fixture.store.addFeedback(fixture.created.id, {
      version: fixture.created.version,
      kind: 'form',
      data: { region: 'EMEA' },
    });

    const list = await get(fixture, `/feedback/${fixture.created.id}`);
    const listed = (await list.json()) as { responses: Array<{ id: string }> };
    expect(listed.responses).toHaveLength(1);

    const delivered = await postJson(fixture, `/feedback/${fixture.created.id}`, {
      ids: [record.id],
    });
    expect(delivered.status).toBe(200);
    expect(((await delivered.json()) as { delivered: number }).delivered).toBe(1);
    const after = await fixture.store.listFeedback(fixture.created.id);
    expect(after[0]?.deliveredAt).not.toBeNull();
  });

  test('archives, favorites, restores, trashes, and untrashes', async () => {
    const fixture = await makeService();
    const id = fixture.created.id;

    const archived = await postJson(fixture, `/archive/${id}`, { archived: true });
    expect(archived.status).toBe(200);
    const query = new URLSearchParams({ directory: '/home/parth/Project' });
    expect(
      ((await (await get(fixture, `/list?${query.toString()}`)).json()) as { artifacts: unknown[] })
        .artifacts,
    ).toHaveLength(1);

    const unarchived = await postJson(fixture, `/archive/${id}`, { archived: false });
    expect(unarchived.status).toBe(200);
    const favorite = await postJson(fixture, `/favorite/${id}`, { favorite: true });
    expect(((await favorite.json()) as { favorite: boolean }).favorite).toBe(true);

    const updated = await fixture.store.update(id, {
      mode: 'replace',
      baseVersion: fixture.created.version,
      files: [{ path: 'index.html', content: page.replace('Service', 'Service 2') }],
    });
    const restored = await postJson(fixture, `/restore/${id}`, {
      version: fixture.created.version,
      baseVersion: updated.version,
    });
    expect(restored.status).toBe(200);
    expect(((await restored.json()) as { version: string }).version).not.toBe(updated.version);

    const trashed = await postJson(fixture, `/trash/${id}`, {});
    expect(trashed.status).toBe(200);
    expect((await get(fixture, `/artifact/${id}`)).status).toBe(404);
    const trashList = await get(fixture, '/trash');
    expect(((await trashList.json()) as { artifacts: unknown[] }).artifacts).toHaveLength(1);
    const untrashed = await postJson(fixture, `/untrash/${id}`, {});
    expect(untrashed.status).toBe(200);
    expect((await get(fixture, `/artifact/${id}`)).status).toBe(200);
  });

  test('exports html and a zip bundle', async () => {
    const fixture = await makeService();
    const html = await postJson(fixture, `/export/${fixture.created.id}`, { format: 'html' });
    expect(html.status).toBe(200);
    const htmlBody = (await html.json()) as { path: string; format: string; bytes: number };
    expect(htmlBody.format).toBe('html');
    expect(await fs.readFile(htmlBody.path, 'utf8')).toBe(page);

    const zip = await postJson(fixture, `/export/${fixture.bundle.id}`, { format: 'zip' });
    expect(zip.status).toBe(200);
    const zipBody = (await zip.json()) as { path: string; format: string; bytes: number };
    expect(zipBody.format).toBe('zip');
    const entries = unzipSync(await fs.readFile(zipBody.path));
    expect(Object.keys(entries).sort()).toEqual(['app.js', 'index.html']);
    expect(Buffer.from(entries['index.html'] ?? new Uint8Array()).toString('utf8')).toBe(page);
  });

  test('AC-071 AC-072: serves the plugin directory, removes MCP status, and reports a missing viewer', async () => {
    const fixture = await makeService();
    const health = await get(fixture, '/health').then(response => response.json());
    expect(health.pluginPath).toBe(path.join(fixture.root, 'installed'));
    expect(health.mcpPath).toBeUndefined();
    expect((await get(fixture, '/mcp-status')).status).toBe(404);
    expect((await get(fixture, '/mcp-registration')).status).toBe(404);

    const view = await postJson(fixture, '/view-url', { id: fixture.created.id });
    expect(view.status).toBe(503);
    expect(((await view.json()) as { error: { code: string } }).error.code).toBe(
      'VIEWER_UNAVAILABLE',
    );
    expect((await get(fixture, `/thumb/${fixture.created.id}`)).status).toBe(404);
  });
});
