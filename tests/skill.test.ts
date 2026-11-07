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
    const resources = [...source.matchAll(/\]\(((?:\.\.?\/|references\/)[^)]+)\)/g)].map(match => match[1]);
    expect(resources).toEqual(['references/architecture.md', 'references/feature.md', 'references/ui-proposal.md', 'references/decision.md', 'references/investigation.md', 'references/metrics.md', '../../examples/design-system.html', '../../examples/chart.html', '../../examples/diagram.html', '../../examples/mockup.html', '../../examples/report.html', '../../examples/README.md']);
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

test('AC-087 AC-090: scenario references and preview-first guidance stay focused and bounded', async () => {
  for (const phrase of ['## Choose the scenario', '## Verify an unpublished preview', 'canvas_preview', 'previewId', 'at most one confirmation pass', 'expire after 30 minutes', 'Metadata-only updates need no HTML or preview', 'If preview is unavailable']) expect(source).toContain(phrase);
  const scenarios: Record<string, string[]> = {
    architecture: ['starting rows and keys', 'one graph', 'inferred'],
    feature: ['starting conditions', 'alternate', 'observable outcome'],
    'ui-proposal': ['simulated', 'pending', 'retry'],
    decision: ['evidence', 'tradeoffs', 'recommendation'],
    investigation: ['hypotheses', 'evidence', 'historical data'],
    metrics: ['missing data as zero', 'same dataset', 'time range'],
  };
  for (const [name, phrases] of Object.entries(scenarios)) {
    const reference = await Bun.file(path.join(directory, 'references', `${name}.md`)).text();
    expect(reference.length).toBeLessThan(4000);
    for (const phrase of phrases) expect(reference).toContain(phrase);
    expect(reference).toContain('Stop when');
  }
  const plugin = await Bun.file(path.join(project, 'src/plugin/index.ts')).text();
  expect(plugin).toContain('previewId');
  expect(plugin).toContain('never blindly republish');
  expect(plugin).toContain('A returned URL does not prove verification');
});

test('AC-088: starters use the fallback tokens rather than unrelated example palettes', async () => {
  const reference = await Bun.file(path.join(project, 'examples/design-system.html')).text();
  const tokens = (html: string) => [...html.matchAll(/--canvas-[a-z-]+:[^;}]+/g)].map(match => match[0]);
  for (const name of ['chart', 'diagram', 'mockup', 'report']) {
    const html = await Bun.file(path.join(project, 'examples', `${name}.html`)).text();
    for (const token of tokens(html)) expect(tokens(reference)).toContain(token);
    for (const phrase of ['data-theme-switch', 'data-theme-value="light"', 'data-theme-value="dark"', 'document.documentElement.dataset.theme', 'aria-pressed']) expect(html).toContain(phrase);
    expect(html).not.toContain('localStorage');
    expect(html).not.toContain('https://');
  }
});

test('AC-089: evaluation cases include project styling, long labels, empty data and a trace rubric', async () => {
  for (const name of ['project-style', 'long-label-flow', 'empty-data']) {
    const root = path.join(directory, 'evals', name);
    expect(await Bun.file(path.join(root, 'prompt.md')).text()).toContain('tags: [skill-creator]');
    expect(await Bun.file(path.join(root, 'case.yaml')).text()).toContain(`name: ${name}`);
    expect(await Bun.file(path.join(root, 'graders/01-expected-output.md')).text()).toContain('focus: trace');
  }
  const protocol = await Bun.file(path.join(directory, 'evals/README.md')).text();
  for (const phrase of ['not been run', 'skill loading', 'preview', 'publish', 'update', 'elapsed', 'correctness', 'visual', 'same model', 'isolated']) expect(protocol).toContain(phrase);
});
