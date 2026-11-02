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
    for (const heading of ['Choose the output', 'Start from the closest example', "Use the project's design system", 'Keep one source', 'Author for the actual Canvas viewer', 'Preflight before publishing', 'Publish once, then verify the real runtime', 'Revise safely', 'Finish']) {
      expect(source).toContain(`## ${heading}\n`);
    }
    const resources = [...source.matchAll(/\]\((\.\.?\/[^)]+)\)/g)].map(match => match[1]);
    expect(resources).toEqual(['../../examples/design-system.html', '../../examples/chart.html', '../../examples/diagram.html', '../../examples/mockup.html', '../../examples/README.md']);
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
      '`canvas_publish` is not a preview, draft, or iteration surface',
      'Batch all concrete failures from that pass into one `canvas_update`',
      'Stop when the request is met and the actual view passes',
      'Another update needs a new user request or a new concrete defect',
      'Batch all requested changes into one update',
      'inspect the project for its design language', 'CSS custom properties', 'Tailwind or theme config',
      'the Canvas default', 'One system per artifact', 'Light/Dark switcher',
      'document.documentElement.dataset.theme', 'aria-pressed', 'per-view switch', 'both themes',
    ]) expect(source).toContain(contract);
    expect(source).not.toContain('returned `baseVersion`');
    expect(source).not.toContain('Publish the first coherent version');
    expect(source).not.toContain('Do not repeat a second complete local-preview review');
  });
});

test('AC-079: built tool descriptions carry the preflight, publish-once and batched-update contract', async () => {
  const plugin = await Bun.file(path.join(project, 'src/plugin/index.ts')).text();
  const bundle = await Bun.file(path.join(project, 'plugin/index.js')).text();
  for (const text of [plugin, bundle]) {
    for (const contract of [
      'Complete its preflight before publishing',
      'publish one complete artifact',
      'Do not use publishing as a preview or draft loop',
      'Open the returned viewUrl once',
      'Batch related fixes into one update',
      'Publish, revise, and reopen versioned Canvas artifacts',
      'Preflight before publishing, publish one complete artifact, and batch concrete corrections into one update',
    ]) expect(text).toContain(contract);
  }
});

test('AC-077: chart, report and revision review cases have prompts and expected outcomes', async () => {
  const expectations: Record<string, string[]> = {
    'simple-chart': ['completes the preflight', 'publishes one complete Canvas artifact', 'batches any concrete runtime fix into one update'],
    'visual-report': ['completes the preflight', 'without repeatedly restyling', 'publishing intermediate drafts'],
    'revise-existing': ['batches the requested content changes', 'preflights the changed source', 'updates the same ID once'],
  };
  for (const name of Object.keys(expectations)) {
    const root = path.join(directory, 'evals', name);
    expect(await Bun.file(path.join(root, 'prompt.md')).text()).toContain('tags: [skill-creator]');
    const metadata = await Bun.file(path.join(root, 'case.yaml')).text();
    expect(metadata).toContain('schema_version: "1.1"');
    expect(metadata).toContain(`name: ${name}\n`);
    expect(metadata).toContain('expected_outcome: |');
    const outcome = metadata.replace(/\s+/g, ' ');
    expect(outcome).not.toContain('publish the first coherent version');
    expect(outcome).not.toContain('fixes concrete failures through updates');
    for (const phrase of expectations[name] ?? []) expect(outcome).toContain(phrase);
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
