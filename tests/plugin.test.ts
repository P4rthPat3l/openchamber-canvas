import { afterEach, describe, expect, test } from 'bun:test';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { z } from 'zod';
import { ArtifactStore } from '../src/store/index';
import { readViewerState } from '../src/viewer/ensure';
import { randomBytes } from 'node:crypto';

const roots: string[] = [];
const project = path.resolve(import.meta.dirname, '..');
const record = z.record(z.string(), z.unknown());

afterEach(async () => {
  for (const root of roots.splice(0)) {
    const viewer = await readViewerState(path.join(root, 'store/.viewer.json'));
    if (viewer) await fetch(`http://127.0.0.1:${viewer.port}/shutdown`, { method: 'POST', headers: { authorization: `Bearer ${viewer.secret}` }, signal: AbortSignal.timeout(3000) });
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('AC-066 AC-067 AC-069: native registration, moving session context, errors, cancellation and cleanup', async () => {
  const root = await fs.mkdtemp('/tmp/opencode/canvas-plugin-');
  roots.push(root);
  const child = Bun.spawn(['node', path.join(project, 'tests/fixtures/plugin-host.mjs'), path.join(project, 'plugin/index.js')], {
    cwd: root,
    env: { ...process.env, CANVAS_STORE: root, CANVAS_VIEWER_ENTRY: path.join(root, 'missing.js'), CANVAS_VIEWER_PORT_FILE: path.join(root, '.viewer.json'), CANVAS_VIEWER_TIMEOUT_MS: '100' },
    stdin: 'pipe', stdout: 'pipe', stderr: 'pipe',
  });
  child.stdin.write(JSON.stringify({ scenario: 'all', directory: '/projects/first', movedDirectory: '/projects/moved' }));
  child.stdin.end();
  const [stdout, stderr, exit] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  expect(stderr).toBe('');
  expect(exit).toBe(0);
  const result = record.parse(JSON.parse(stdout));
  const catalog = z.array(z.object({ name: z.string(), options: z.object({ namespace: z.string(), permission: z.string(), codemode: z.boolean() }), input: record })).parse(result.catalog);
  expect(catalog.map(tool => tool.name).sort()).toEqual(['archive', 'list', 'publish', 'read', 'result', 'update']);
  for (const tool of catalog) {
    expect(tool.options).toEqual({ namespace: 'canvas', permission: `canvas_${tool.name}`, codemode: true });
  }
  const first = z.object({ id: z.string() }).parse(result.first);
  const second = z.object({ id: z.string() }).parse(result.second);
  const store = new ArtifactStore({ root });
  expect((await store.getMeta(first.id)).directory).toBe('/projects/first');
  expect((await store.getMeta(second.id)).directory).toBe('/projects/moved');
  expect((await store.getMeta(first.id)).sessionId).toBe('ses_canvas_native_test');
  expect(z.object({ total: z.number() }).parse(result.local).total).toBe(1);
  expect((await store.list()).total).toBe(2);
  expect(result.cancellation).toBe('Cancelled before write');
  expect(result.sessionError).toBe('Session unavailable');
  expect(z.object({ error: z.object({ code: z.string() }) }).parse(result.invalid).error.code).toBe('INVALID_INPUT');
  expect(result.unloaded).toBe(0);
  expect(result.unloadedError).toBe('AbortError');
  expect(result.reloaded).toBe(6);
  expect(result.registrations).toBe(1);
});

describe('AC-072 AC-073: native distribution contract', () => {
  test('exports the plugin, styles native tools, and has no MCP package or transport', async () => {
    const pkg = z.object({ version: z.string(), exports: record, dependencies: record, openchamber: record }).parse(await Bun.file(path.join(project, 'package.json')).json());
    expect(pkg.version).toBe('0.3.0');
    expect(pkg.exports['.']).toBe('./plugin/index.js');
    expect(pkg.dependencies['@modelcontextprotocol/sdk']).toBeUndefined();
    expect(await Bun.file(path.join(project, 'mcp/server.js')).exists()).toBe(false);
    const contributes = z.object({ contributes: record }).parse(pkg.openchamber).contributes;
    expect(z.array(z.object({ match: z.string() })).parse(contributes.tools)[0]?.match).toBe('canvas_*');
    expect(contributes.capabilities).toBeUndefined();
  });
});

test('AC-070: relocated built plugin without node_modules publishes pinned HTML through the real viewer', async () => {
  const root = await fs.mkdtemp('/tmp/opencode/canvas-relocated-');
  roots.push(root);
  const distribution = path.join(root, 'distribution');
  await fs.mkdir(distribution);
  for (const file of ['package.json', 'plugin', 'viewer']) {
    await fs.cp(path.join(project, file), path.join(distribution, file), { recursive: true });
  }
  const storeRoot = path.join(root, 'store');
  const child = Bun.spawn(['node', path.join(project, 'tests/fixtures/plugin-host.mjs'), path.join(distribution, 'plugin/index.js')], {
    cwd: root,
    env: { ...process.env, CANVAS_STORE: storeRoot, CANVAS_VIEWER_ENTRY: path.join(distribution, 'viewer/server.js'), CANVAS_VIEWER_PORT_FILE: path.join(storeRoot, '.viewer.json') },
    stdin: 'pipe', stdout: 'pipe', stderr: 'pipe',
  });
  child.stdin.write(JSON.stringify({ scenario: 'call', name: 'publish', args: { title: 'Relocated', html: '<h1>Relocated native artifact</h1>', libraries: ['chartjs'] }, directory: root }));
  child.stdin.end();
  const [output, error, exit] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  expect(error).toBe('');
  expect(exit).toBe(0);
  const result = z.object({ id: z.string(), version: z.string(), viewUrl: z.string() }).parse(JSON.parse(output));
  const response = await fetch(result.viewUrl);
  expect(response.status).toBe(200);
  expect(response.headers.get('content-security-policy')).toContain('sandbox allow-scripts');
  expect(await response.text()).toContain('Relocated native artifact');
  expect((await new ArtifactStore({ root: storeRoot }).read(result.id)).manifest.rendering).toMatch(/^[a-f0-9]{64}$/);
  expect(await Bun.file(path.join(distribution, 'node_modules')).exists()).toBe(false);
}, 15000);

const opencode = Bun.which('opencode');
test.skipIf(opencode === null)('AC-066 AC-070: actual OpenCode registers Canvas and cold-starts a working viewer without MCP', async () => {
  if (opencode === null) throw new Error('OpenCode CLI is required');
  const root = await fs.mkdtemp('/tmp/opencode/canvas-opencode-');
  roots.push(root);
  const work = path.join(root, 'project');
  await fs.mkdir(work);
  await fs.mkdir(path.join(root, 'config'));
  // Configured plugin entries must be directories, so give the observer its own package.
  const observer = path.join(root, 'observer');
  await fs.mkdir(observer);
  await fs.copyFile(path.join(project, 'tests/fixtures/native-observer.mjs'), path.join(observer, 'index.js'));
  await fs.writeFile(path.join(observer, 'package.json'), JSON.stringify({ name: 'canvas-test-observer', type: 'module', exports: { '.': './index.js' } }));
  await fs.writeFile(path.join(root, 'config/opencode.json'), JSON.stringify({ plugins: [project, observer] }));
  const env = {
    PATH: process.env.PATH ?? '/usr/bin:/bin',
    HOME: path.join(root, 'home'), XDG_CONFIG_HOME: path.join(root, 'xdg-config'),
    XDG_DATA_HOME: path.join(root, 'data'), XDG_CACHE_HOME: path.join(root, 'cache'), XDG_STATE_HOME: path.join(root, 'state'),
    OPENCODE_CONFIG: path.join(root, 'config/opencode.json'), OPENCODE_PASSWORD: randomBytes(32).toString('hex'),
    CANVAS_STORE: path.join(root, 'store'), CANVAS_VIEWER_PORT_FILE: path.join(root, 'store/.viewer.json'),
    CANVAS_VIEWER_ENTRY: path.join(project, 'viewer/server.js'), CANVAS_VIEWER_TIMEOUT_MS: '3000',
  };
  const reserved = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => new Response('reserved') });
  const port = reserved.port;
  reserved.stop(true);
  const server = Bun.spawn([opencode, 'serve', '--hostname', '127.0.0.1', '--port', String(port)], { cwd: work, env, stdout: 'ignore', stderr: 'ignore' });
  try {
    const reportFile = path.join(work, 'native-result.json');
    for (let attempt = 0; attempt < 40 && !await Bun.file(reportFile).exists(); attempt++) {
      const request = Bun.spawn([opencode, 'api', '--server', `http://127.0.0.1:${port}`, 'get', '/api/plugin'], { cwd: work, env, stdout: 'ignore', stderr: 'ignore' });
      await request.exited;
      await Bun.sleep(200);
    }
    const report = z.object({ version: z.string(), names: z.array(z.string()), directory: z.string(), result: z.object({ id: z.string(), viewUrl: z.string(), warnings: z.array(z.string()) }) }).parse(await Bun.file(reportFile).json());
    expect(report.names).toEqual(['canvas_archive', 'canvas_list', 'canvas_publish', 'canvas_read', 'canvas_result', 'canvas_update']);
    expect(report.directory).toBe(work);
    expect((await new ArtifactStore({ root: env.CANVAS_STORE }).getMeta(report.result.id)).directory).toBe(work);
    expect(report.result.warnings).toEqual([]);
    const view = await fetch(report.result.viewUrl);
    expect(view.status).toBe(200);
    expect(await view.text()).toContain('Native plugin');
  } finally {
    server.kill('SIGTERM');
    await server.exited;
  }
}, 45000);
