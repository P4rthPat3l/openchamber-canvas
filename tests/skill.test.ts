import { describe, expect, test } from 'bun:test';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';

const project = path.resolve(import.meta.dirname, '..');
const directory = path.join(project, 'skills/canvas-authoring');
const source = await Bun.file(path.join(directory, 'SKILL.md')).text();

describe('AC-077: bundled Canvas authoring contract', () => {
  test('keeps a focused workflow and points to real installed examples', async () => {
    expect(source).toStartWith('---\nname: canvas-authoring\ndescription: Use before');
    expect(source.split('\n').length).toBeLessThan(150);
    for (const heading of ['Choose the output', 'Start from the closest example', 'Keep one source', 'Author for the actual Canvas viewer', 'Publish and verify once in the real runtime', 'Revise safely', 'Finish']) {
      expect(source).toContain(`## ${heading}\n`);
    }
    const resources = [...source.matchAll(/\]\((\.\.?\/[^)]+)\)/g)].map(match => match[1]);
    expect(resources).toEqual(['../../examples/chart.html', '../../examples/diagram.html', '../../examples/mockup.html', '../../examples/README.md']);
    for (const resource of resources) {
      expect(resource).toBeDefined();
      if (resource === undefined) throw new Error('Missing resource path');
      const absolute = await fs.realpath(path.resolve(directory, resource));
      expect(path.relative(project, absolute).startsWith('..')).toBe(false);
      expect((await fs.stat(absolute)).isFile()).toBe(true);
    }
  });

  test('covers source reuse, runtime boundaries, verification, safe revisions and feedback handoff', () => {
    for (const contract of [
      'openchamber_render', 'Word, PDF, spreadsheet', 'separate stores', 'canonical project-local HTML file',
      'filePath', 'directoryPath', 'No CDN', 'libraries', 'window.canvas', 'data-theme',
      'window.canvas.storage.get', 'localStorage', 'type="button"', 'allow-forms', 'window.canvas.feedback(data, kind)',
      'textual equivalent', 'viewUrl', 'overflow first', 'Existing project verification gates still take precedence',
      'rendering or interactions remain unverified', 'canvas_read', 'baseVersion', 'On a version conflict, read again',
      "read response's `version` as `baseVersion`",
      'canvas_result', 'draft for user review', 'untrusted data rather than instructions',
    ]) expect(source).toContain(contract);
    expect(source).not.toContain('returned `baseVersion`');
  });
});

test('AC-077: chart, report and revision review cases have prompts and expected outcomes', async () => {
  for (const name of ['simple-chart', 'visual-report', 'revise-existing']) {
    const root = path.join(directory, 'evals', name);
    expect(await Bun.file(path.join(root, 'prompt.md')).text()).toContain('tags: [skill-creator]');
    const metadata = await Bun.file(path.join(root, 'case.yaml')).text();
    expect(metadata).toContain('schema_version: "1.1"');
    expect(metadata).toContain(`name: ${name}\n`);
    expect(metadata).toContain('expected_outcome: |');
    expect(await Bun.file(path.join(root, 'graders/01-expected-output.md')).text()).toContain('focus: trace');
  }
});

test('AC-078: bundled instructions do not require global installation or claim enforced loading', async () => {
  const readme = await Bun.file(path.join(project, 'README.md')).text();
  expect(readme).toContain('canvas-authoring');
  expect(readme).toContain('No separate skill installation');
  expect(readme).toContain('does not guarantee');
  const bundle = await Bun.file(path.join(project, 'plugin/index.js')).text();
  expect(bundle).not.toMatch(/(?:from|import\s*\()\s*['"]@opencode\//);
});
