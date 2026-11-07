import * as fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { builtViewer } from './viewer-fixture';

const fixture = await builtViewer();
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
try {
  for (const name of ['design-system', 'chart', 'diagram', 'mockup', 'report']) {
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
      await page.waitForFunction(() => document.querySelector('[data-theme-value][aria-pressed="true"]')?.getAttribute('data-theme-value') === document.documentElement.dataset.theme);
      const opposite = theme === 'dark' ? 'light' : 'dark';
      const switchButton = page.getByRole('button', { name: opposite === 'dark' ? 'Dark' : 'Light', exact: true });
      await switchButton.focus();
      await page.keyboard.press('Enter');
      assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), opposite, 'AC-088: every starter supports keyboard theme switching');
      await page.getByRole('button', { name: theme === 'dark' ? 'Dark' : 'Light', exact: true }).click();
      if (name === 'design-system') {
        const expectedBg = { light: 'rgb(243, 239, 231)', dark: 'rgb(23, 20, 17)' } as const;
        const expectedCard = { light: 'rgb(255, 253, 248)', dark: 'rgb(32, 28, 23)' } as const;
        const bodyBackground = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
        const cardBackground = () => page.evaluate(() => {
          const card = document.querySelector('.canvas-card');
          return card ? getComputedStyle(card).backgroundColor : '';
        });
        assert.equal(await page.locator('table tbody tr').count(), 3, 'AC-081: data primitives render');
        assert.equal(await page.locator('table thead th').count(), 4, 'AC-081: table header renders');
        assert.equal(await page.locator('table tbody th[scope="row"]').count(), 3, 'AC-081: table row headers render');
        assert.equal(await page.locator('table tfoot').count(), 1, 'AC-081: table summary renders');
        await page.waitForFunction(() => {
          const active = document.querySelector('[data-theme-switch] button[aria-pressed="true"]');
          return active?.getAttribute('data-theme-value') === new URLSearchParams(location.search).get('theme');
        });
        const currentButton = page.getByRole('button', { name: theme === 'dark' ? 'Dark' : 'Light', exact: true });
        const next = theme === 'dark' ? 'light' : 'dark';
        const nextButton = page.getByRole('button', { name: next === 'dark' ? 'Dark' : 'Light', exact: true });
        assert.equal(await currentButton.getAttribute('aria-pressed'), 'true', 'AC-081: switcher seeds from the viewer theme');
        assert.equal(await nextButton.getAttribute('aria-pressed'), 'false', 'AC-081: inactive switcher is unpressed');
        assert.equal(await bodyBackground(), expectedBg[theme], 'AC-081: page token renders');
        assert.equal(await cardBackground(), expectedCard[theme], 'AC-081: surface token renders');
        await nextButton.focus();
        await page.keyboard.press('Enter');
        assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), next, 'AC-081: keyboard switcher changes the theme');
        assert.equal(await bodyBackground(), expectedBg[next], 'AC-081: page token changes with the theme');
        assert.equal(await cardBackground(), expectedCard[next], 'AC-081: surface token changes with the theme');
        assert.equal(await nextButton.getAttribute('aria-pressed'), 'true', 'AC-081: active switcher is pressed');
        assert.equal(await currentButton.getAttribute('aria-pressed'), 'false', 'AC-081: previous switcher clears');
        await currentButton.click();
        assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), theme, 'AC-081: switcher restores the theme');
        assert.equal(await bodyBackground(), expectedBg[theme], 'AC-081: page token restores');
        assert.equal(await currentButton.getAttribute('aria-pressed'), 'true', 'AC-081: restored switcher is pressed');
        assert.equal(await nextButton.getAttribute('aria-pressed'), 'false', 'AC-081: inactive switcher clears');
      } else if (name === 'chart') {
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
      } else if (name === 'mockup') {
        await page.getByLabel('Email address').fill('invalid');
        await page.getByRole('button', { name: 'Save sample preferences' }).click();
        assert.equal(await page.getByLabel('Email address').evaluate(input => input instanceof HTMLInputElement && input.validity.valid), false, 'AC-088: invalid email stays invalid');
        await page.getByLabel('Email address').fill('sample@example.com');
        let release: (() => void) | undefined;
        const held = new Promise<void>(resolve => { release = resolve; });
        await page.route('**/api/**/feedback', async route => { await held; await route.fulfill({ status: 500, body: '{}' }); });
        await page.getByRole('button', { name: 'Save sample preferences' }).click();
        assert.equal(await page.getByRole('button', { name: 'Save sample preferences' }).isDisabled(), true, 'AC-088: pending action is disabled');
        release?.();
        await page.getByRole('status').filter({ hasText: 'Could not save' }).waitFor();
        assert.equal(await page.getByLabel('Email address').inputValue(), 'sample@example.com', 'AC-088: failed submission retains input');
        await page.unroute('**/api/**/feedback');
        await page.getByRole('button', { name: 'Save sample preferences' }).click();
        assert.deepEqual(errors, [], `AC-065: ${name} script errors`);
        await page.getByRole('status').filter({ hasText: 'Sample preferences saved' }).waitFor();
        assert.ok((await fixture.store.feedbackPage(artifact.id)).total > 0);
      } else {
        assert.equal(await page.getByRole('heading', { name: 'What we know' }).count(), 1, 'AC-088: static report has evidence');
        assert.equal(await page.locator('tbody tr').count(), 3);
      }
      await fs.mkdir('/tmp/opencode/canvas-examples', { recursive: true });
      for (const width of [390, 1280]) {
        await page.setViewportSize({ width, height: 800 });
        await page.waitForFunction(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true, `AC-088: ${name} contains overflow at ${width}`);
        assert.equal(await page.evaluate(() => getComputedStyle(document.body).backgroundColor), theme === 'light' ? 'rgb(243, 239, 231)' : 'rgb(23, 20, 17)', 'AC-088: shared fallback background renders');
        await page.screenshot({ path: `/tmp/opencode/canvas-examples/${name}-${theme}-${width}.png`, fullPage: true });
      }
      if (name === 'report') {
        const staticPage = await browser.newPage({ javaScriptEnabled: false });
        await staticPage.goto((await fixture.mint(artifact.id, undefined, theme)).url);
        assert.equal(await staticPage.getByRole('heading', { name: 'What we know' }).count(), 1, 'AC-088: report remains readable without scripts');
        assert.equal(await staticPage.locator('tbody tr').count(), 3);
        await staticPage.close();
      }
    }
    assert.deepEqual(outside, [], 'AC-065: examples make no outside requests');
    assert.deepEqual(errors, [], 'AC-065: examples have no script errors');
    await page.close();
  }
  console.log('AC-065 AC-081 AC-088: design system, chart, diagram, mockup, and report passed light/dark and narrow/wide checks');
} finally { await browser.close(); await fixture.close(); }
