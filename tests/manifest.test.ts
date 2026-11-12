import { expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import * as path from 'node:path';
import { requestedGuestCapabilities } from '@openchamber/sdk';
import { parseManifestJson } from '@openchamber/sdk/schemas';

const project = path.resolve(import.meta.dirname, '..');

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

test('AC-091: the manifest ships the OpenCode plugin and asks only for service and opencodePlugin', async () => {
  const parsed = parseManifestJson(await Bun.file(path.join(project, 'package.json')).text());
  if (!parsed.ok) throw new Error(`${parsed.code}: ${parsed.message}`);
  const { contributes, engines } = parsed.manifest;

  expect(engines?.openchamber).toBe('>=2.7.0');
  expect(contributes.opencodePlugin).toBe('plugin');
  expect([...requestedGuestCapabilities(contributes)].sort()).toEqual(['opencodePlugin', 'service']);
});

test('AC-091: the contributed folder is the entry the host resolves', async () => {
  const folder = path.join(project, 'plugin');
  expect(existsSync(folder)).toBe(true);

  const manifestFile = path.join(folder, 'package.json');
  if (existsSync(manifestFile)) {
    const manifest: unknown = JSON.parse(await Bun.file(manifestFile).text());
    if (!isRecord(manifest)) throw new Error('plugin/package.json must be an object');
    expect(typeof manifest.name).toBe('string');
    const exported = manifest.exports;
    const target = isRecord(exported) ? exported['.'] : exported;
    expect(target).toBe('./index.js');
  } else {
    expect(existsSync(path.join(folder, 'index.js'))).toBe(true);
  }

  const loaded: unknown = await import(path.join(folder, 'index.js'));
  if (!isRecord(loaded) || !isRecord(loaded.default)) throw new Error('The built plugin has no default export');
  expect(loaded.default.id).toBe('openchamber-canvas');
  expect(typeof loaded.default.setup).toBe('function');
});
