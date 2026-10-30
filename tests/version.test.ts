import { afterEach, describe, expect, test } from 'bun:test';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import { versionFrom } from '../src/version';

const projectRoot = path.resolve(import.meta.dirname, '..');
const temporaryRoots: string[] = [];

afterEach(async () => {
  for (const root of temporaryRoots.splice(0)) {
    await fs.rm(root, { recursive: true, force: true });
  }
});

async function makeRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'canvas-version-'));
  temporaryRoots.push(root);
  return root;
}

describe('AC-070: version resolution', () => {
  test('reads the package version from the src directory layout', async () => {
    const pkg = JSON.parse(
      await fs.readFile(path.join(projectRoot, 'package.json'), 'utf8'),
    ) as { version: string };
    expect(versionFrom(path.join(projectRoot, 'src'))).toBe(pkg.version);
  });

  test('reads the package version from a bundled service or plugin directory', async () => {
    const root = await makeRoot();
    await fs.writeFile(path.join(root, 'package.json'), '{"version":"9.9.9"}', 'utf8');
    await fs.mkdir(path.join(root, 'service'), { recursive: true });
    await fs.mkdir(path.join(root, 'plugin'), { recursive: true });

    expect(versionFrom(path.join(root, 'service'))).toBe('9.9.9');
    expect(versionFrom(path.join(root, 'plugin'))).toBe('9.9.9');
  });

  test('skips a malformed package.json and keeps walking up', async () => {
    const root = await makeRoot();
    await fs.writeFile(path.join(root, 'package.json'), '{"version":"1.2.3"}', 'utf8');
    await fs.mkdir(path.join(root, 'service'), { recursive: true });
    await fs.writeFile(path.join(root, 'service', 'package.json'), '{not json', 'utf8');

    expect(versionFrom(path.join(root, 'service'))).toBe('1.2.3');
  });
});
