import { test, expect } from 'bun:test';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { createViewerServer } from '../src/viewer/server';
import { ArtifactStore } from '../src/store/index';
import { ensureViewer, readViewerState, viewerStatus, restartViewer, mintViewUrl, notifyViewer, viewerBuild } from '../src/viewer/ensure';

test('AC-063: compatible reuse, authenticated build replacement, and serialized startup', async () => {
  const root = await fs.mkdtemp('/tmp/opencode/canvas-ensure-');
  const portFile = path.join(root, '.viewer.json');
  const store = new ArtifactStore({ root });
  const viewer = await createViewerServer({ store, secret: 'ensure-secret-with-at-least-32-characters', runtimeFile: path.join(root, 'absent'), librariesDir: root, build: 'old-build' });
  const options = { storeRoot: root, portFile, viewerEntry: path.resolve('viewer/server.js') };
  await fs.writeFile(portFile, JSON.stringify({ schema: 1, pid: process.pid, port: viewer.port, secret: viewer.secret, startedAt: new Date().toISOString() }));
  try {
    expect((await viewerStatus(portFile)).restartable).toBe(true);
    const [left, right] = await Promise.all([ensureViewer(options), ensureViewer(options)]);
    expect(left.pid).toBe(right.pid);
    expect(left.port).toBe(right.port);
    expect(left.port).not.toBe(viewer.port);
    expect((await viewerStatus(portFile)).status).toBe('Compatible');
    expect((await ensureViewer(options)).pid).toBe(left.pid);
    const [restartLeft, restartRight] = await Promise.all([restartViewer(options), restartViewer(options)]);
    expect(restartLeft.pid).toBe(restartRight.pid);
    expect(restartLeft.port).toBe(restartRight.port);
    expect((await viewerStatus(portFile)).status).toBe('Compatible');
  } finally {
    await viewer.close();
    const current = await readViewerState(portFile);
    if (current && current.pid !== process.pid) await fetch(`http://127.0.0.1:${current.port}/shutdown`, { method: 'POST', headers: { authorization: `Bearer ${current.secret}` } });
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('AC-069 AC-070: cancelled cold startup stays serialized until its detached viewer is ready', async () => {
  const root = await fs.mkdtemp('/tmp/opencode/canvas-startup-cancel-');
  const entry = path.join(root, 'delayed-viewer.mjs');
  const marker = path.join(root, 'spawns');
  const release = path.join(root, 'release');
  const states = path.join(root, 'states');
  await fs.mkdir(states);
  await fs.writeFile(entry, `
    import * as fs from 'node:fs/promises';
    import * as http from 'node:http';
    await fs.appendFile(${JSON.stringify(marker)}, process.pid + '\\n');
    for (;;) { try { await fs.access(${JSON.stringify(release)}); break; } catch { await new Promise(resolve => setTimeout(resolve, 10)); } }
    const secret = 'startup-fixture-secret-with-32-characters';
    const server = http.createServer((request, response) => {
      if (request.headers.authorization !== 'Bearer ' + secret) { response.writeHead(401).end(); return; }
      response.setHeader('content-type', 'application/json');
      if (request.url === '/shutdown') { response.end('{}'); server.close(() => process.exit(0)); return; }
      response.end(JSON.stringify({pid: process.pid, protocol: 2, build: ${JSON.stringify(viewerBuild())}}));
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const state = {schema: 1, pid: process.pid, port: server.address().port, secret, startedAt: new Date().toISOString()};
    await fs.writeFile(${JSON.stringify(states)} + '/' + process.pid + '.json', JSON.stringify(state));
    await fs.writeFile(process.env.CANVAS_VIEWER_PORT_FILE, JSON.stringify(state));
  `);
  const controller = new AbortController();
  const options = { storeRoot: root, portFile: path.join(root, '.viewer.json'), viewerEntry: entry, timeoutMs: 3000 };
  const first = ensureViewer({ ...options, signal: controller.signal }).then(() => 'completed', () => 'cancelled');
  let second: Promise<Awaited<ReturnType<typeof ensureViewer>>> | undefined;
  try {
    for (let attempt = 0; attempt < 100 && !await Bun.file(marker).exists(); attempt++) await Bun.sleep(10);
    expect(await Bun.file(marker).exists()).toBe(true);
    controller.abort(new Error('Cancelled startup caller'));
    second = ensureViewer(options);
    await Bun.sleep(200);
    await fs.writeFile(release, 'ready');
    const ready = await second;
    expect(await first).toBe('cancelled');
    expect((await fs.readFile(marker, 'utf8')).trim().split('\n')).toHaveLength(1);
    expect((await readViewerState(options.portFile))?.pid).toBe(ready.pid);
    expect((await ensureViewer(options)).pid).toBe(ready.pid);
  } finally {
    await fs.writeFile(release, 'ready');
    await Promise.allSettled([first, ...(second ? [second] : [])]);
    for (const file of await fs.readdir(states)) {
      const state = await readViewerState(path.join(states, file));
      if (state) await fetch(`http://127.0.0.1:${state.port}/shutdown`, { method: 'POST', headers: { authorization: `Bearer ${state.secret}` } });
    }
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('AC-063: mint and notify deadlines include stalled response bodies', async () => {
  const servers: ReturnType<typeof Bun.serve>[] = [];
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('{')); } }), { headers: { 'content-type': 'application/json' } }) });
  servers.push(server);
  const state = { schema: 1 as const, port: server.port ?? 0, pid: process.pid, secret: 'deadline-secret-32-characters-long', startedAt: new Date().toISOString() };
  try {
    const started = Date.now();
    const results = await Promise.allSettled([mintViewUrl(state, { id: 'probe' }), notifyViewer(state, { id: 'probe', event: 'deleted' })]);
    expect(results.every(result => result.status === 'rejected')).toBe(true);
    expect(Date.now() - started).toBeLessThan(4500);
  } finally { for (const server of servers) server.stop(true); }
}, 6000);

test('AC-063: legacy viewers are not reused or stopped, and rejected restarts fail visibly', async () => {
  const root = await fs.mkdtemp('/tmp/opencode/canvas-legacy-');
  let shutdowns = 0;
  let known = false;
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch(request) {
    if (new URL(request.url).pathname === '/shutdown') { shutdowns++; return new Response('Denied', { status: 403 }); }
    return Response.json({ pid: process.pid, ...(known ? { protocol: 2, build: 'outdated' } : {}) });
  } });
  const portFile = path.join(root, 'viewer.json');
  await fs.writeFile(portFile, JSON.stringify({ schema: 1, pid: process.pid, port: server.port, secret: 'legacy-test-secret-with-32-characters', startedAt: new Date().toISOString() }));
  const options = { storeRoot: root, portFile, viewerEntry: path.join(root, 'missing.js'), timeoutMs: 200 };
  try {
    await expect(ensureViewer(options)).rejects.toThrow('Legacy viewer');
    expect(shutdowns).toBe(0);
    known = true;
    await expect(ensureViewer(options)).rejects.toThrow('rejected');
    expect(shutdowns).toBe(1);
    server.stop(true);
    await expect(ensureViewer(options)).rejects.toThrow('timeout');
  } finally { server.stop(true); await fs.rm(root, { recursive: true, force: true }); }
});
