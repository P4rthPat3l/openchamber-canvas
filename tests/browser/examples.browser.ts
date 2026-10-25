import * as fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { builtViewer } from './viewer-fixture';

const fixture = await builtViewer();
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
try {
  for (const name of ['chart', 'diagram', 'mockup']) {
    const html = await fs.readFile(`examples/${name}.html`, 'utf8');
    const artifact = await fixture.store.create({ title: name, kind: 'html', directory: process.cwd(), libraries: name === 'chart' ? ['chartjs'] : [], files: [{ path: 'index.html', content: html }] });
    const page = await browser.newPage({ viewport: { width: 900, height: 800 } });
    const outside: string[] = [];
    const errors: string[] = [];
    page.on('request', request => { if (!request.url().startsWith(`http://127.0.0.1:${fixture.state.port}/`)) outside.push(request.url()); });
    page.on('pageerror', error => errors.push(error.message));
    for (const theme of ['light', 'dark'] as const) {
      await page.goto((await fixture.mint(artifact.id, undefined, theme)).url);
      await page.waitForFunction(() => document.documentElement.dataset.theme === new URLSearchParams(location.search).get('theme'));
      if (name === 'chart') {
        assert.equal(await page.locator('tbody tr').count(), 5, 'AC-065: table uses all chart values');
        assert.equal(await page.locator('canvas').evaluate(node => node instanceof HTMLCanvasElement && node.width > 0 && node.height > 0), true);
        await page.getByLabel('What should change?').fill('First note');
        let release: (() => void) | undefined;
        const held = new Promise<void>(resolve => { release = resolve; });
        await page.route('**/api/**/feedback', async route => { await held; await route.continue(); });
        await page.getByRole('button', { name: 'Send feedback', exact: true }).click();
        await page.getByLabel('What should change?').fill('Keep this next note');
        release?.();
        await page.getByRole('status').filter({ hasText: 'Feedback saved' }).waitFor();
        assert.equal(await page.getByLabel('What should change?').inputValue(), 'Keep this next note', 'AC-065: new feedback draft survives submission');
        await page.unroute('**/api/**/feedback');
      } else if (name === 'diagram') {
        const ids = await page.locator('tbody tr').evaluateAll(rows => rows.map(row => row.getAttribute('data-flow')));
        assert.equal(ids.length, 8);
        assert.equal(new Set(ids).size, ids.length);
        for (const view of ['Publishing', 'Discovery', 'Viewings']) {
          await page.getByRole('button', { name: view, exact: true }).click();
          for (const id of await page.locator('svg [data-flow]').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-flow')))) assert.ok(ids.includes(id));
        }
        const node = page.locator('svg [data-node]').first();
        await node.focus(); await page.keyboard.press('Enter');
        assert.notEqual(await page.locator('#details h2').textContent(), 'Choose a node or flow');
        await page.getByRole('button', { name: 'Listing draft and price', exact: true }).click();
        assert.equal(await page.locator('#details h2').textContent(), 'Listing draft and price');
      } else {
        await page.getByLabel('Email address').fill('sample@example.com');
        await page.getByRole('button', { name: 'Save sample preferences' }).click();
        await page.waitForFunction(() => Boolean(document.querySelector('#status')?.textContent));
        assert.deepEqual(errors, [], `AC-065: ${name} script errors`);
        assert.match(await page.locator('#status').innerText(), /Sample preferences saved/, 'AC-065: sample preferences were saved');
        await page.getByRole('status').filter({ hasText: 'Sample preferences saved' }).waitFor();
        assert.ok((await fixture.store.feedbackPage(artifact.id)).total > 0);
      }
      await fs.mkdir('/tmp/opencode/canvas-examples', { recursive: true });
      await page.screenshot({ path: `/tmp/opencode/canvas-examples/${name}-${theme}.png`, fullPage: true });
    }
    assert.deepEqual(outside, [], 'AC-065: examples make no outside requests');
    assert.deepEqual(errors, [], 'AC-065: examples have no script errors');
    await page.close();
  }
  console.log('AC-065: chart, diagram, and mockup examples passed in light and dark themes');
} finally { await browser.close(); await fixture.close(); }
