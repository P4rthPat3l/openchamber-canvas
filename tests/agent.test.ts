import { afterEach, describe, expect, test } from 'bun:test';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { z } from 'zod';

import { ArtifactStore } from '../src/store/index';
import { createOperations } from '../src/agent/operations';
import type { CanvasOperations } from '../src/agent/operations';
import { schemas } from '../src/agent/schemas';
import type { OperationName } from '../src/agent/schemas';
import { installedRendering } from '../src/viewer/rendering';

const projectRoot = path.resolve(import.meta.dirname, '..');
const temporaryRoots: string[] = [];

afterEach(async () => {
  for (const root of temporaryRoots.splice(0)) {
    await fs.rm(root, { recursive: true, force: true });
  }
});

interface AgentFixture {
  client: CanvasOperations;
  store: ArtifactStore;
  root: string;
}

async function makeClient(): Promise<AgentFixture> {
  const root = await fs.mkdtemp('/tmp/opencode/canvas-agent-');
  temporaryRoots.push(root);
  const store = new ArtifactStore({ root, renderingSource: installedRendering() });
  await store.init();
  const client = createOperations({
    store, storeRoot: root,
    portFile: path.join(root, '.viewer.json'),
    viewerEntry: path.join(root, 'missing-viewer.js'),
    viewerTimeoutMs: 200,
  });
  return { client, store, root };
}

interface ToolCall {
  isError: boolean;
  value: Record<string, unknown>;
}

async function call(
  client: CanvasOperations,
  name: OperationName,
  args: Record<string, unknown>,
): Promise<ToolCall> {
  const result = await client.execute(name, args, { directory: projectRoot, sessionId: 'ses_canvas_agent_test', signal: new AbortController().signal });
  const value = z.record(z.string(), z.unknown()).parse(result.value);
  return { isError: result.isError === true, value };
}

const page = `<!doctype html><html><body><h1>Revenue</h1><script>const color = '#2563eb';</script></body></html>`;

test.each(['update', 'archive', 'dedupe'] as const)('AC-069: cancellation stops a queued %s before the artifact lock is released', async mode => {
  const { client, store, root } = await makeClient();
  const published = z.object({ id: z.string(), version: z.string() }).parse((await call(client, 'publish', { title: 'Queued', html: page, dedupeKey: 'queued' })).value);
  const lock = path.join(root, '.locks', `${published.id}.lock`);
  await fs.mkdir(lock);
  const entered = Promise.withResolvers<void>();
  if (mode === 'update') {
    const original = store.update.bind(store);
    store.update = (...args) => { entered.resolve(); return original(...args); };
  } else if (mode === 'archive') {
    const original = store.archive.bind(store);
    store.archive = (...args) => { entered.resolve(); return original(...args); };
  } else {
    const original = store.create.bind(store);
    store.create = (...args) => { entered.resolve(); return original(...args); };
  }
  const controller = new AbortController();
  const name = mode === 'dedupe' ? 'publish' : mode;
  const input = mode === 'dedupe'
    ? { title: 'Queued changed', html: '<h1>Changed</h1>', dedupeKey: 'queued', baseVersion: published.version }
    : { id: published.id, baseVersion: published.version, html: '<h1>Changed</h1>' };
  const pending = client.execute(name, input, { directory: projectRoot, sessionId: 'ses_cancelled', signal: controller.signal }).then(
    () => ({ state: 'completed' }),
    (error: unknown) => ({ state: 'aborted', message: error instanceof Error ? error.message : '' }),
  );
  try {
    await entered.promise;
    controller.abort(new Error('Cancelled queued mutation'));
    const outcome = await Promise.race([pending, Bun.sleep(500).then(() => ({ state: 'waiting' }))]);
    expect(outcome.state).toBe('aborted');
    expect((await store.getMeta(published.id)).currentVersion).toBe(published.version);
    expect((await store.getMeta(published.id)).title).toBe('Queued');
    expect((await store.getMeta(published.id)).archivedAt).toBeNull();
  } finally {
    await fs.rm(lock, { recursive: true, force: true });
    await pending;
  }
});

test('AC-069: cancellation after commit retains the artifact and reports viewer interruption as a warning', async () => {
  const { client, store } = await makeClient();
  const controller = new AbortController();
  const original = store.create.bind(store);
  store.create = async (...args) => {
    const result = await original(...args);
    controller.abort(new Error('Cancelled after commit'));
    return result;
  };
  const result = await client.execute('publish', { title: 'Committed', html: page }, { directory: projectRoot, sessionId: 'ses_committed', signal: controller.signal });
  expect(result.isError).toBe(false);
  const value = z.object({ id: z.string(), viewUrl: z.null(), warnings: z.array(z.string()) }).parse(result.value);
  expect(value.warnings).toContain('Cancelled after commit');
  expect((await store.getMeta(value.id)).title).toBe('Committed');
});

test('AC-068: bundle merge, replacement, restore, source escapes and read limits survive the adapter change', async () => {
  const { client, root } = await makeClient();
  const published = z.object({ id: z.string(), version: z.string() }).parse((await call(client, 'publish', {
    title: 'Bundle modes', kind: 'bundle', files: [{ path: 'index.html', content: '<h1>Original</h1>' }, { path: 'app.js', content: 'original' }],
  })).value);
  const merged = await call(client, 'update', { id: published.id, baseVersion: published.version, files: [{ path: 'app.js', content: 'merged' }] });
  expect(merged.isError).toBe(false);
  const mergedRead = z.object({ files: z.array(z.object({ path: z.string(), content: z.string() })) }).parse((await call(client, 'read', { id: published.id, includeFiles: true })).value);
  expect(mergedRead.files.find(file => file.path === 'index.html')?.content).toBe('<h1>Original</h1>');
  expect(mergedRead.files.find(file => file.path === 'app.js')?.content).toBe('merged');
  const replaced = await call(client, 'update', { id: published.id, baseVersion: merged.value.version, mode: 'replace', files: [{ path: 'index.html', content: '<h1>Replacement</h1>' }] });
  expect(replaced.isError).toBe(false);
  const restored = await call(client, 'update', { id: published.id, baseVersion: replaced.value.version, restoreFrom: published.version });
  expect(restored.isError).toBe(false);
  expect((await call(client, 'read', { id: published.id })).value.html).toBe('<h1>Original</h1>');
  const directory = path.join(root, 'project');
  await fs.mkdir(directory);
  await fs.writeFile(path.join(root, 'outside.html'), '<h1>Outside</h1>');
  await fs.symlink(path.join(root, 'outside.html'), path.join(directory, 'link.html'));
  for (const filePath of ['../outside.html', 'link.html']) {
    const rejected = await call(client, 'publish', { title: 'Escape', directory, filePath });
    expect(rejected.isError).toBe(true);
    expect(z.object({ code: z.string() }).parse(rejected.value.error).code).toBe('INVALID_PATH');
  }
  const large = await call(client, 'publish', { title: 'Read limits', kind: 'bundle', files: [{ path: 'index.html', content: '<h1>Large bundle</h1>' }, { path: 'data.txt', content: 'x'.repeat(2 * 1024 * 1024 + 1) }] });
  expect(large.isError).toBe(false);
  for (const args of [{ id: large.value.id, includeFiles: true }, { id: large.value.id, path: 'data.txt' }]) {
    const rejected = await call(client, 'read', args);
    expect(rejected.isError).toBe(true);
    expect(z.object({ code: z.string() }).parse(rejected.value.error).code).toBe('TOO_LARGE');
  }
});

test('AC-068: feedback pagination through native operations returns every record', async () => {
  const { client, store } = await makeClient();
  const published = z.object({ id: z.string(), version: z.string() }).parse((await call(client, 'publish', { title: 'Feedback pages', html: page })).value);
  for (let index = 0; index < 3; index++) await store.addFeedback(published.id, { version: published.version, data: { index } });
  const shape = z.object({ responses: z.array(z.object({ id: z.string() })), total: z.number() });
  const first = shape.parse((await call(client, 'result', { id: published.id, limit: 2, offset: 0 })).value);
  const second = shape.parse((await call(client, 'result', { id: published.id, limit: 2, offset: 2 })).value);
  expect(first.total).toBe(3);
  expect(second.total).toBe(3);
  expect(new Set([...first.responses, ...second.responses].map(record => record.id)).size).toBe(3);
});

describe('AC-068: Canvas operations', () => {
  test('AC-055 AC-057 AC-067 AC-061: guarded metadata updates, project default, and pinned production versions', async () => {
    const { client, store } = await makeClient();
    const published = await call(client, 'publish', { title: 'Local', html: page });
    expect(published.isError).toBe(false);
    const id = String(published.value.id);
    const baseVersion = String(published.value.version);
    expect((await store.read(id)).manifest.rendering).toMatch(/^[a-f0-9]{64}$/);
    const metadata = await call(client, 'update', { id, baseVersion, tags: ['metadata'] });
    expect(metadata.isError).toBe(false);
    expect(metadata.value.version).toBe(baseVersion);
    expect(metadata.value.changedFiles).toEqual([]);
    await call(client, 'publish', { title: 'Other project', directory: '/other/project', html: page });
    const local = await call(client, 'list', {});
    expect(local.value.total).toBe(1);
    expect((await call(client, 'list', { allProjects: true })).value.total).toBe(2);
    expect((await call(client, 'list', { allProjects: true, directory: projectRoot })).isError).toBe(true);
    const missing = await call(client, 'update', { id, html: page });
    expect(missing.isError).toBe(true);
  });
  test('lists the six tools', async () => {
    expect(Object.keys(schemas).sort()).toEqual([
      'archive',
      'list',
      'publish',
      'read',
      'result',
      'update',
    ]);
  });

  test('publishes without a viewer and still stores the artifact', async () => {
    const { client, store } = await makeClient();
    const published = await call(client, 'publish', {
      title: 'Revenue',
      html: page,
      directory: '/home/parth/Project',
      tags: ['q3'],
    });
    expect(published.isError).toBe(false);
    const id = published.value.id as string;
    const version = published.value.version as string;
    expect(id).toBeTruthy();
    expect(published.value.viewUrl).toBeNull();
    expect((published.value.warnings as string[]).length).toBeGreaterThan(0);

    const listed = await call(client, 'list', { directory: '/home/parth/Project' });
    const artifacts = (listed.value.artifacts as Array<{ id: string; tags: string[] }>) ?? [];
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0]?.id).toBe(id);
    expect(artifacts[0]?.tags).toEqual(['q3']);

    const read = await call(client, 'read', { id });
    expect(read.value.html).toBe(page);
    expect(read.value.version).toBe(version);

    expect((await store.getMeta(id)).sessionId).toBe('ses_canvas_agent_test');

    const stored = await store.read(id);
    expect(stored.version).toBe(version);
  });

  test('updates with exact edits and reads the new source', async () => {
    const { client } = await makeClient();
    const published = await call(client, 'publish', {
      title: 'Editable',
      html: page,
      directory: '/home/parth/Project',
    });
    const id = published.value.id as string;
    const baseVersion = published.value.version as string;

    const updated = await call(client, 'update', {
      id,
      baseVersion,
      edits: [{ find: "const color = '#2563eb';", replace: "const color = '#db2777';" }],
    });
    expect(updated.isError).toBe(false);
    const version = updated.value.version as string;
    expect(version).not.toBe(baseVersion);
    expect(updated.value.changedFiles).toEqual(['index.html']);

    const read = await call(client, 'read', { id, version });
    const html = read.value.html as string;
    expect(html).toContain("const color = '#db2777';");
    expect(html.replace("const color = '#db2777';", "const color = '#2563eb';")).toBe(page);
  });

  test('returns conflict on a stale baseVersion', async () => {
    const { client } = await makeClient();
    const published = await call(client, 'publish', {
      title: 'Conflict',
      html: page,
      directory: '/home/parth/Project',
    });
    const id = published.value.id as string;
    const baseVersion = published.value.version as string;
    await call(client, 'update', {
      id,
      baseVersion,
      html: page.replace('Revenue', 'Second'),
    });

    const conflict = await call(client, 'update', {
      id,
      baseVersion,
      html: page.replace('Revenue', 'Third'),
    });
    expect(conflict.isError).toBe(true);
    expect((conflict.value.error as { code: string }).code).toBe('CONFLICT');
  });

  test('rejects external references at publish', async () => {
    const { client, store } = await makeClient();
    const result = await call(client, 'publish', {
      title: 'Remote',
      html: '<!doctype html><html><body><script src="https://example.com/x.js"></script></body></html>',
      directory: '/home/parth/Project',
    });
    expect(result.isError).toBe(true);
    expect((result.value.error as { code: string }).code).toBe('EXTERNAL_REFERENCE');
    expect((await store.list()).artifacts).toHaveLength(0);
  });

  test('publishes a filePath and a directoryPath source', async () => {
    const { client, root } = await makeClient();
    const projectDir = path.join(root, 'project');
    await fs.mkdir(path.join(projectDir, 'dist'), { recursive: true });
    await fs.writeFile(path.join(projectDir, 'report.html'), page, 'utf8');
    await fs.writeFile(path.join(projectDir, 'dist', 'index.html'), page, 'utf8');
    await fs.writeFile(path.join(projectDir, 'dist', 'app.js'), 'console.log(1);', 'utf8');

    const single = await call(client, 'publish', {
      title: 'From a file',
      filePath: 'report.html',
      directory: projectDir,
    });
    expect(single.isError).toBe(false);
    const singleRead = await call(client, 'read', { id: single.value.id });
    expect(singleRead.value.html).toBe(page);

    const bundle = await call(client, 'publish', {
      title: 'From a folder',
      kind: 'bundle',
      directoryPath: 'dist',
      entry: 'index.html',
      directory: projectDir,
    });
    expect(bundle.isError).toBe(false);
    const bundleRead = await call(client, 'read', {
      id: bundle.value.id,
      includeFiles: true,
    });
    const files = bundleRead.value.files as Array<{ path: string; content: string }>;
    expect(files.map((file) => file.path).sort()).toEqual(['app.js', 'index.html']);
  });

  test('warns when a bundle skips hidden files, node_modules, and symlinks', async () => {
    const { client, root } = await makeClient();
    const projectDir = path.join(root, 'project-b');
    await fs.mkdir(path.join(projectDir, 'dist', 'node_modules'), { recursive: true });
    await fs.writeFile(path.join(projectDir, 'dist', 'index.html'), page, 'utf8');
    await fs.writeFile(path.join(projectDir, 'dist', 'app.js'), 'console.log(1);', 'utf8');
    await fs.writeFile(path.join(projectDir, 'dist', 'node_modules', 'bundle-only.js'), 'x', 'utf8');
    await fs.writeFile(path.join(projectDir, 'dist', '.env.txt'), 'hidden', 'utf8');
    await fs.symlink(
      path.join(projectDir, 'dist', 'app.js'),
      path.join(projectDir, 'dist', 'link.js'),
    );

    const published = await call(client, 'publish', {
      title: 'Skips warning click',
      kind: 'bundle',
      directoryPath: 'dist',
      directory: projectDir,
    });
    expect(published.isError).toBe(false);
    const warnings = published.value.warnings as string[];
    const read = await call(client, 'read', { id: published.value.id, includeFiles: true });
    const files = read.value.files as Array<{ path: string }>;

    expect(files.map((file) => file.path).sort()).toEqual(['app.js', 'index.html']);
    expect(warnings).toContain('Skipped .env.txt');
    expect(warnings).toContain('Skipped node_modules');
    expect(warnings.some((warning) => warning.includes('link.js'))).toBe(true);
  });

  test('reads feedback and archives', async () => {
    const { client, store } = await makeClient();
    const published = await call(client, 'publish', {
      title: 'Feedback',
      html: page,
      directory: '/home/parth/Project',
    });
    const id = published.value.id as string;
    const version = published.value.version as string;
    await store.addFeedback(id, {
      version,
      kind: 'form',
      data: { region: 'EMEA' },
    });

    const result = await call(client, 'result', { id });
    const responses = (result.value.responses as Array<{ data: unknown }>) ?? [];
    expect(responses).toHaveLength(1);
    expect(responses[0]?.data).toEqual({ region: 'EMEA' });

    const archived = await call(client, 'archive', { id });
    expect(archived.value.archived).toBe(true);
    expect((await call(client, 'list', { directory: '/home/parth/Project' })).value.artifacts).toEqual(
      [],
    );
    expect(
      (await call(client, 'list', {
        directory: '/home/parth/Project',
        includeArchived: true,
      })).value.artifacts,
    ).toHaveLength(1);
  });
});
