import { afterEach, describe, expect, test } from 'bun:test';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

import { ArtifactStore } from '../src/store/index';

const projectRoot = path.resolve(import.meta.dirname, '..');
const temporaryRoots: string[] = [];
const clients: Client[] = [];

afterEach(async () => {
  for (const client of clients.splice(0)) {
    await client.close().catch(() => undefined);
  }
  for (const root of temporaryRoots.splice(0)) {
    await fs.rm(root, { recursive: true, force: true });
  }
});

function baseEnv(): Record<string, string> {
  return Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined),
  );
}

interface McpFixture {
  client: Client;
  store: ArtifactStore;
  root: string;
}

async function makeClient(): Promise<McpFixture> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'canvas-mcp-'));
  temporaryRoots.push(root);
  const store = new ArtifactStore({ root });
  await store.init();
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.join(projectRoot, 'src', 'mcp', 'server.ts')],
    cwd: projectRoot,
    env: {
      ...baseEnv(),
      CANVAS_STORE: root,
      CANVAS_VIEWER_PORT_FILE: path.join(root, '.viewer.json'),
      CANVAS_VIEWER_ENTRY: path.join(root, 'missing-viewer.js'),
      CANVAS_VIEWER_TIMEOUT_MS: '200',
    },
  });
  const client = new Client({ name: 'canvas-mcp-test', version: '1.0.0' });
  await client.connect(transport);
  clients.push(client);
  return { client, store, root };
}

interface ToolCall {
  isError: boolean;
  value: Record<string, unknown>;
}

async function call(
  client: Client,
  name: string,
  args: Record<string, unknown>,
): Promise<ToolCall> {
  const result = await client.callTool({ name, arguments: args });
  const content = result.content as Array<{ type: string; text?: string }>;
  const text = content.find((item) => item.type === 'text')?.text ?? '';
  const value = JSON.parse(text) as Record<string, unknown>;
  return { isError: result.isError === true, value };
}

const page = `<!doctype html><html><body><h1>Revenue</h1><script>const color = '#2563eb';</script></body></html>`;

describe('canvas MCP', () => {
  test('lists the six tools', async () => {
    const { client } = await makeClient();
    const tools = await client.listTools();
    expect(tools.tools.map((tool) => tool.name).sort()).toEqual([
      'archive',
      'list',
      'publish',
      'read',
      'result',
      'update',
    ]);
  });

  test('publishes without a viewer and still stores the artifact', async () => {
    const { client, store, root } = await makeClient();
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

    const heartbeat = JSON.parse(
      await fs.readFile(path.join(root, '.mcp-heartbeat.json'), 'utf8'),
    ) as { pid: number; version: string };
    expect(heartbeat.version).toBe('0.1.0');
    expect(heartbeat.pid).toBeGreaterThan(0);

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
