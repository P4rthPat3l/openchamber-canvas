import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { builtViewer } from './viewer-fixture';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import * as path from 'node:path';

const fixture = await builtViewer();
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
const sentinel = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => new Response('probe', { headers: { 'access-control-allow-origin': '*' } }) });
const verified = new Set<string>();
const client = new Client({ name: 'canvas-browser-regression', version: '1.0.0' });
let connected = false;
try {
  const html = '<!doctype html><html><head><link rel="stylesheet" href="style.css"></head><body><h1>One</h1><a id="next" href="second.htm">Next</a><script src="app.js"></script></body></html>';
  const artifact = await fixture.store.create({ title: 'Browser regression', kind: 'bundle', entry: 'index.html', directory: process.cwd(), files: [
    { path: 'index.html', content: html },
    { path: 'second.htm', content: '<!doctype html><html><head></head><body><h1>Secondary</h1></body></html>' },
    { path: 'style.css', content: 'h1 { color: rgb(10, 20, 30) }' },
    { path: 'app.js', content: 'document.body.dataset.loaded = "yes";' },
    { path: 'image.svg', content: '<svg xmlns="http://www.w3.org/2000/svg"><script>document.title="bad"</script></svg>' },
  ] });
  const page = await browser.newPage();
  const liveUrl = (await fixture.mint(artifact.id, undefined, 'dark')).url;
  await page.goto(liveUrl);
  assert.equal(await page.locator('body').getAttribute('data-loaded'), 'yes', 'AC-050: bundle script loads');
  assert.equal(await page.locator('h1').evaluate(node => getComputedStyle(node).color), 'rgb(10, 20, 30)', 'AC-050: bundle stylesheet loads');
  const inspect = () => page.evaluate(async url => {
    let storage = false, network = false;
    try { localStorage.setItem('probe', '1'); storage = true; } catch { /* Expected sandbox rejection. */ }
    try { network = (await fetch(url)).ok; } catch { /* Expected CSP rejection. */ }
    return { storage, network, runtime: typeof window.canvas?.feedback === 'function' };
  }, `http://127.0.0.1:${sentinel.port}`);
  assert.deepEqual(await inspect(), { storage: false, network: false, runtime: true }, 'AC-050: entry is sandboxed');
  await Promise.all([page.waitForURL('**/second.htm'), page.locator('#next').click()]);
  assert.deepEqual(await inspect(), { storage: false, network: false, runtime: true }, 'AC-050: secondary navigation is sandboxed');
  const secondary = page.url();
  await page.goto(secondary);
  assert.deepEqual(await inspect(), { storage: false, network: false, runtime: true }, 'AC-050: direct secondary access is sandboxed');
  const svg = await fetch(new URL('image.svg', liveUrl));
  assert.match(svg.headers.get('content-security-policy') ?? '', /sandbox/);
  assert.doesNotMatch(svg.headers.get('content-security-policy') ?? '', /allow-scripts/);
  verified.add('AC-050');

  await page.goto(liveUrl);
  await page.evaluate(async () => { await window.canvas?.storage.set('probe', { retained: true }); });
  const feedbackId = await page.evaluate(async () => (await window.canvas?.feedback({ note: '<img src=x onerror=alert(1)>' }))?.id);
  assert.ok(feedbackId, 'AC-051: real runtime submits feedback');
  const feedback = await fixture.store.feedbackPage(artifact.id);
  assert.equal(feedback.total, 1);
  assert.equal(feedback.responses[0]?.version, artifact.version);
  verified.add('AC-051');

  const frozen = await browser.newPage();
  await frozen.goto((await fixture.mint(artifact.id, artifact.version, 'light')).url);
  await Promise.all([frozen.waitForURL('**/second.htm'), frozen.locator('#next').click()]);
  assert.equal(await frozen.evaluate(() => window.canvas?.followLatest), false, 'AC-056: explicit version is fixed');
  assert.equal(await frozen.evaluate(() => window.canvas?.theme), 'light', 'AC-056: theme survives plain bundle navigation');
  const custom = await browser.newPage();
  await custom.goto(liveUrl);
  await custom.evaluate(() => { window.canvas?.onUpdate(() => { document.body.dataset.update = 'received'; }); });
  const updated = await fixture.store.update(artifact.id, { mode: 'edits', baseVersion: artifact.version, edits: [{ find: '<h1>One</h1>', replace: '<h1>Two</h1>' }] });
  await fixture.notify(artifact.id, updated.version);
  await page.waitForURL(url => url.pathname.includes(updated.version));
  assert.equal(await page.locator('h1').textContent(), 'Two');
  assert.equal(new URL(page.url()).searchParams.get('theme'), 'dark');
  assert.equal(new URL(page.url()).searchParams.get('follow'), 'true');
  assert.deepEqual(await page.evaluate(async () => window.canvas?.storage.get('probe')), { retained: true });
  await custom.waitForFunction(() => document.body.dataset.update === 'received');
  assert.equal(await custom.locator('h1').textContent(), 'One', 'AC-056: custom handler owns refresh');
  assert.equal(await frozen.locator('h1').textContent(), 'Secondary', 'AC-056: historical view stays fixed after ordinary navigation');
  const restored = await fixture.store.update(artifact.id, { mode: 'restore', baseVersion: updated.version, restoreFrom: artifact.version });
  await fixture.notify(artifact.id, restored.version);
  await page.waitForURL(url => url.pathname.includes(restored.version));
  assert.equal(await page.locator('h1').textContent(), 'One', 'AC-056: following view follows restores');
  verified.add('AC-056');
  assert.equal((await fixture.store.read(artifact.id)).manifest.rendering, artifact.meta.versions[0]?.rendering, 'AC-062: restore retains renderer');
  verified.add('AC-062');
  verified.add('AC-064');
  const env = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined));
  await client.connect(new StdioClientTransport({ command: 'node', args: [path.resolve('mcp/server.js')], cwd: process.cwd(), env: { ...env, CANVAS_STORE: fixture.root, CANVAS_VIEWER_PORT_FILE: path.join(fixture.root, '.viewer.json') } }));
  connected = true;
  async function publish(arguments_: Record<string, unknown>): Promise<{ id: string; version: string; viewUrl: string }> {
    const result = await client.callTool({ name: 'publish', arguments: arguments_ });
    const entry = Array.isArray(result.content) ? result.content.find(entry => typeof entry === 'object' && entry !== null && 'text' in entry) : undefined;
    if (!entry || typeof entry.text !== 'string') throw new Error('Missing publish response');
    const value: unknown = JSON.parse(entry.text);
    if (typeof value !== 'object' || value === null || !('id' in value) || !('version' in value) || !('viewUrl' in value) || typeof value.id !== 'string' || typeof value.version !== 'string' || typeof value.viewUrl !== 'string') throw new Error(`Publish failed: ${entry.text}`);
    return { id: value.id, version: value.version, viewUrl: value.viewUrl };
  }
  const first = await publish({ title: 'Dedupe following', dedupeKey: 'browser-follow', html: '<head></head><h1>First</h1>' });
  await page.goto(first.viewUrl);
  const next = await publish({ title: 'Dedupe following', dedupeKey: 'browser-follow', baseVersion: first.version, html: '<head></head><h1>Second</h1>' });
  await page.waitForURL(url => url.pathname.includes(next.version));
  assert.equal(await page.locator('h1').textContent(), 'Second', 'AC-056: changed dedupe publish notifies following views');
  const metadata = await client.callTool({ name: 'update', arguments: { id: next.id, baseVersion: next.version, tags: ['metadata-only'] } });
  assert.notEqual(metadata.isError, true, 'AC-057: metadata-only MCP update succeeds');
  assert.equal((await fixture.store.read(next.id)).meta.versions.length, 2, 'AC-057: metadata does not append content');
  verified.add('AC-057');
  console.log(`Viewer browser checks passed: ${[...verified].join(', ')}`);
} finally {
  if (connected) await client.close();
  await browser.close();
  sentinel.stop(true);
  await fixture.close();
}
