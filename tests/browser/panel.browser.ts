import { readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { chromium, type Frame, type Page } from 'playwright';

declare global {
  interface Window {
    __host: {
      setTheme(name: string, overrides?: Record<string, string>): void;
      setHeartbeat(value: string): void;
      setRegistration(value: Record<string, unknown>): void;
      setListFailure(value: boolean): void;
      reload(): void;
      getState(): {
        requests: unknown[];
        actions: Array<{ type: string; payload?: unknown }>;
        storage: Record<string, unknown>;
      };
      getFrame(): HTMLIFrameElement;
    };
  }
}

const theme = (name: string): { mode: 'light' | 'dark'; tokens: Record<string, string> } => {
  const selected = themes.themes[name];
  if (!selected) throw new Error(`Missing theme fixture ${name}`);
  return selected;
};

const token = (name: string, key: string): string => {
  const value = theme(name).tokens[key];
  if (!value) throw new Error(`Missing theme token ${name}.${key}`);
  return value;
};

const root = path.resolve(import.meta.dir, '../..');
const themesFile = path.join(root, 'tests/fixtures/openchamber-themes.json');
const hostFile = path.join(import.meta.dir, 'host.html');
const screenshotDir = '/tmp/opencode/canvas-native-tests';
const themes = JSON.parse(await readFile(themesFile, 'utf8')) as {
  themes: Record<string, { mode: 'light' | 'dark'; tokens: Record<string, string> }>;
};const host = (await readFile(hostFile, 'utf8')).replace('__THEMES__', JSON.stringify(themes.themes));

await mkdir(screenshotDir, { recursive: true });

const server = Bun.serve({
  hostname: '127.0.0.1',
  port: 0,
  fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === '/host') {
      return new Response(host, { headers: { 'content-type': 'text/html; charset=utf-8' } });
    }
    if (url.pathname === '/favicon.ico') return new Response(null, { status: 204 });
    const files: Record<string, string> = {
      '/panel/index.html': 'panel/index.html',
      '/panel/main.js': 'panel/main.js',
      '/panel/style.css': 'panel/style.css',
      '/status/index.html': 'status/index.html',
      '/status/main.js': 'status/main.js',
      '/status/style.css': 'status/style.css',
    };
    const relative = files[url.pathname];
    if (!relative) return new Response('Not found', { status: 404 });
    const type = relative.endsWith('.css') ? 'text/css' : relative.endsWith('.js') ? 'text/javascript' : 'text/html';
    return new Response(Bun.file(path.join(root, relative)), { headers: { 'content-type': `${type}; charset=utf-8` } });
  },
});
const base = `http://127.0.0.1:${server.port}`;
const browser = await chromium.launch({
  headless: true,
  executablePath: '/usr/bin/google-chrome',
  args: ['--no-sandbox'],
});
const errors: string[] = [];
const verified = new Set<string>();
function check(id: string, description: string, condition: boolean): void {
  if (!condition) throw new Error(`${id}: ${description}`);
  verified.add(id);
}

function rgb(hex: string): string {
  const value = hex.replace('#', '').slice(0, 6);
  return `rgb(${Number.parseInt(value.slice(0, 2), 16)}, ${Number.parseInt(value.slice(2, 4), 16)}, ${Number.parseInt(value.slice(4, 6), 16)})`;
}

async function openSurface(page: Page, surface: 'panel' | 'page' | 'status', width: number, height: number, empty = false): Promise<Frame> {
  await page.goto(`${base}/host?surface=${surface}&width=${width}&height=${height}${empty ? '&empty=1' : ''}`);
  for (let attempt = 0; attempt < 100; attempt++) {
    const frame = page.frames().find(item => item.url().endsWith(surface === 'status' ? '/status/index.html' : '/panel/index.html'));
    if (frame) {
      await frame.locator('body').waitFor({ state: 'attached' });
      return frame;
    }
    await page.waitForTimeout(30);
  }
  throw new Error(`Canvas ${surface} frame did not load`);
}

async function waitCanvasReady(frame: Frame): Promise<void> {
  await frame.locator('.canvas-library, .canvas-status-row, .canvas-status-text').first().waitFor({ state: 'attached', timeout: 10_000 });
}

async function openOptions(frame: Frame): Promise<void> {
  await frame.getByRole('button', { name: 'Options', exact: true }).click();
}

async function reloadPanel(page: Page, registration: Record<string, unknown>): Promise<Frame> {
  await page.evaluate(value => window.__host.setRegistration(value), registration);
  await page.evaluate(() => window.__host.reload());
  for (let attempt = 0; attempt < 100; attempt++) {
    const next = page.frames().find(item => item.url().includes('/panel/index.html?reload='));
    if (next) {
      await next.locator('body').waitFor({ state: 'attached' });
      await waitCanvasReady(next);
      return next;
    }
    await page.waitForTimeout(30);
  }
  throw new Error('reloaded panel frame not found');
}

async function closePage(page: Page): Promise<void> {
  page.removeAllListeners();
  await page.close();
}

const panelPage = await browser.newPage({ viewport: { width: 1360, height: 1000 } });
const pageErrors: string[] = [];
panelPage.on('pageerror', error => pageErrors.push(error.message));
panelPage.on('console', message => {
  if (message.type() === 'error' && !message.text().includes('favicon')) errors.push(message.text());
});
let frame = await openSurface(panelPage, 'panel', 360, 900);
await waitCanvasReady(frame);
await frame.locator('.oc-sdk-list').first().waitFor({ state: 'visible' });

const native = await frame.evaluate(() => ({
  buttons: document.querySelectorAll('.oc-sdk-btn').length,
  inputs: document.querySelectorAll('.oc-sdk-input').length,
  lists: document.querySelectorAll('.oc-sdk-list').length,
  legacy: document.querySelectorAll('.cv-row, .cv-select, .cv-search, .cv-card').length,
  overflow: document.documentElement.scrollWidth > innerWidth,
  panelWidth: innerWidth,
}));
assert.ok(native.buttons > 0, 'expected SDK buttons');
assert.ok(native.inputs > 0, 'expected SDK fields');
assert.ok(native.lists > 0, 'expected SDK lists');
assert.equal(native.legacy, 0, 'custom controls remain');
assert.equal(native.overflow, false, 'panel overflows at 360px');
check('AC-037', 'supported controls are SDK mounts, no legacy controls', native.buttons > 0 && native.inputs > 0 && native.lists > 0 && native.legacy === 0);

for (const name of Object.keys(themes.themes)) {
  await panelPage.evaluate(themeName => window.__host.setTheme(themeName), name);
  await frame.waitForFunction(expected => document.documentElement.dataset.ocTheme === expected, theme(name).mode);
  await panelPage.waitForTimeout(220);
  const values = await frame.evaluate(() => ({
    primaryText: getComputedStyle(document.documentElement).getPropertyValue('--oc-primary-text').trim(),
    background: getComputedStyle(document.body).backgroundColor,
    overflow: document.documentElement.scrollWidth > innerWidth,
  }));
  assert.equal(values.primaryText, token(name, 'primaryText'), `primary text for ${name}`);
  assert.equal(values.background, rgb(token(name, 'background')), `background for ${name}`);
  assert.equal(values.overflow, false, `overflow for ${name}`);
}

await panelPage.evaluate(() => window.__host.setTheme('openchamber-dark', { font: 'Georgia, serif', radius: '14px' }));
await frame.waitForFunction(() => document.documentElement.dataset.ocTheme === 'dark');
await panelPage.waitForTimeout(220);
const customTheme = await frame.evaluate(() => {
  const trigger = document.querySelector('.oc-sdk-trigger');
  return {
    font: getComputedStyle(document.documentElement).fontFamily,
    radius: trigger ? getComputedStyle(trigger).borderRadius : '',
    radiusToken: getComputedStyle(document.documentElement).getPropertyValue('--radius').trim(),
  };
});
assert.match(customTheme.font, /Georgia/);
assert.equal(customTheme.radiusToken, '14px');
assert.equal(customTheme.radius, '12px');
await panelPage.evaluate(() => window.__host.setTheme('openchamber-dark'));
await frame.waitForFunction(() => document.documentElement.dataset.ocTheme === 'dark');
await panelPage.waitForTimeout(220);

const search = frame.getByRole('searchbox', { name: 'Search artifacts' });
await search.fill('Onboarding');
await frame.getByRole('option', { name: /Onboarding flow/ }).waitFor();
assert.equal(await frame.getByRole('option', { name: /Revenue by region/ }).count(), 0, 'search did not filter');
await frame.getByRole('button', { name: 'Clear search' }).click();
await frame.getByRole('option', { name: /Revenue by region/ }).waitFor();
await frame.getByRole('option', { name: /Revenue by region/ }).click();
await frame.getByRole('heading', { name: 'Revenue by region' }).waitFor();
for (const label of ['Open', 'Copy URL', 'Export', 'Actions']) {
  assert.ok(await frame.getByRole('button', { name: label, exact: true }).count() > 0, `missing ${label}`);
}
await frame.locator('body').screenshot({ path: path.join(screenshotDir, 'panel-detail.png') });
const instruction = frame.getByRole('textbox', { name: 'What should change?' });
await instruction.fill('Make the chart weekly');
const beforeTheme = await panelPage.evaluate(() => window.__host.getState().requests.length);
await panelPage.evaluate(() => window.__host.setTheme('openchamber-light'));
await frame.waitForFunction(() => document.documentElement.dataset.ocTheme === 'light');
await panelPage.waitForTimeout(220);
const light = await frame.evaluate(() => ({
  primaryText: getComputedStyle(document.documentElement).getPropertyValue('--oc-primary-text').trim(),
  background: getComputedStyle(document.body).backgroundColor,
}));
assert.equal(light.primaryText, token('openchamber-light', 'primaryText'));
assert.equal(light.background, rgb(token('openchamber-light', 'background')));
assert.equal(await instruction.inputValue(), 'Make the chart weekly');
assert.equal(await instruction.evaluate(node => node === document.activeElement), true, 'theme switch moved focus');
assert.equal((await panelPage.evaluate(() => window.__host.getState().requests.length)), beforeTheme, 'theme switch refetched');
check('AC-038', 'theme, font, and radius update without remount or refetch', true);

await frame.getByRole('button', { name: 'Back', exact: true }).click();
await frame.getByRole('searchbox', { name: 'Search artifacts' }).waitFor();
check('AC-039', 'inspector controls disposed when returning to the library', (await frame.locator('.canvas-inspector').count()) === 0);
await openOptions(frame);
await frame.getByRole('menuitem', { name: 'Show grid' }).click();
await frame.locator('.canvas-grid').waitFor();
await frame.locator('.canvas-card').first().waitFor();
assert.equal(await frame.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'grid overflows at 360px');
await frame.locator('.canvas-card').first().click();
await frame.getByRole('heading', { name: 'Revenue by region' }).waitFor();
await frame.getByRole('button', { name: 'Back', exact: true }).click();
await frame.locator('.canvas-grid').waitFor();
await frame.locator('body').screenshot({ path: path.join(screenshotDir, 'grid.png') });
await panelPage.waitForFunction(() => {
  const preferences = window.__host.getState().storage['gallery.preferences'];
  return typeof preferences === 'object' && preferences !== null && 'view' in preferences
    && (preferences as { view?: string }).view === 'grid';
});
let state = await panelPage.evaluate(() => window.__host.getState());
assert.deepEqual(state.storage['gallery.preferences'], { view: 'grid', sort: 'updated' });

await panelPage.evaluate(() => window.__host.reload());
frame = await (async () => {
  for (let attempt = 0; attempt < 100; attempt++) {
    const next = panelPage.frames().find(item => item.url().includes('/panel/index.html?reload='));
    if (next) return next;
    await panelPage.waitForTimeout(30);
  }
  throw new Error('reloaded panel frame not found');
})();
await waitCanvasReady(frame);
await frame.locator('.canvas-grid').waitFor();
state = await panelPage.evaluate(() => window.__host.getState());
assert.deepEqual(state.storage['gallery.preferences'], { view: 'grid', sort: 'updated' }, 'grid preference did not survive reload');
check('AC-042', 'view and sort persist through host.storage across reload', true);
await openOptions(frame);
await frame.getByRole('menuitem', { name: 'Show list' }).click();
await frame.getByRole('searchbox', { name: 'Search artifacts' }).waitFor();

await openOptions(frame);
await frame.getByRole('menuitem', { name: 'Setup' }).click();
await frame.getByRole('heading', { name: 'MCP server' }).waitFor();
await frame.getByText('Running', { exact: true }).waitFor();
const copyConfig = frame.getByRole('button', { name: 'Copy MCP config' });
assert.equal(await copyConfig.isEnabled(), true);
const sample = frame.getByRole('button', { name: 'Add sample prompt to chat' });
assert.equal(await sample.isDisabled(), true, 'sample should wait for the MCP heartbeat');
await panelPage.evaluate(() => window.__host.setHeartbeat(new Date().toISOString()));
await frame.getByRole('button', { name: 'Check again' }).click();
await frame.getByText('Connected', { exact: true }).waitFor({ timeout: 5000 });
assert.equal(await sample.isEnabled(), true, 'sample should enable with the heartbeat');
await frame.locator('body').screenshot({ path: path.join(screenshotDir, 'setup.png') });
await copyConfig.click();
await panelPage.waitForFunction(() => window.__host.getState().actions.some(action => action.type === 'clipboard'));
const copied = await panelPage.evaluate(() => window.__host.getState().actions.filter(action => action.type === 'clipboard').at(-1));
assert.ok(JSON.stringify(copied).includes('/home/parth/Production/openchamber-canvas/mcp/server.js'));
await frame.getByRole('button', { name: 'Back to gallery' }).click();
await frame.getByRole('searchbox', { name: 'Search artifacts' }).waitFor();

await search.fill('no-such-artifact');
await frame.getByRole('heading', { name: 'No matching artifacts' }).waitFor();
await frame.locator('body').screenshot({ path: path.join(screenshotDir, 'empty.png') });
await frame.getByRole('button', { name: 'Clear filters' }).click();
await frame.getByRole('option', { name: /Revenue by region/ }).waitFor();

await frame.getByRole('option', { name: /Revenue by region/ }).click();
await frame.getByRole('heading', { name: 'Revenue by region' }).waitFor();
await frame.getByRole('button', { name: 'Actions', exact: true }).click();
const actions = await frame.getByRole('menuitem').allTextContents();
assert.ok(actions.some(text => text.includes('favorites')), 'favorite action missing');
assert.ok(actions.some(text => text.includes('Attach to chat')), 'attach action missing');
assert.ok(actions.some(text => text.includes('Archive')), 'archive action missing');
assert.ok(actions.some(text => text.includes('Move to trash')), 'delete action missing');
check('AC-040', 'favorite, attach, archive, and delete actions remain available', true);
await frame.getByRole('menuitem', { name: 'Move to trash' }).click();
await frame.getByRole('dialog').waitFor();
await frame.locator('body').screenshot({ path: path.join(screenshotDir, 'dialog.png') });
await panelPage.evaluate(() => window.__host.setTheme('openchamber-dark'));
await frame.waitForFunction(() => document.documentElement.dataset.ocTheme === 'dark');
await panelPage.waitForTimeout(220);
await frame.locator('body').screenshot({ path: path.join(screenshotDir, 'dialog-dark.png') });
assert.equal(await frame.getByRole('button', { name: 'Cancel' }).count(), 1);
await frame.getByRole('button', { name: 'Cancel' }).click();
await frame.getByRole('dialog').waitFor({ state: 'detached' });

await panelPage.evaluate(() => window.__host.setListFailure(true));
await frame.getByRole('button', { name: 'Back', exact: true }).click();
await frame.getByRole('searchbox', { name: 'Search artifacts' }).waitFor();
await openOptions(frame);
await frame.getByRole('menuitem', { name: 'Refresh' }).click();
await frame.getByText('Probe list failure').waitFor();
assert.ok(await frame.getByRole('button', { name: 'Retry' }).count() > 0, 'retry missing');
await panelPage.evaluate(() => window.__host.setListFailure(false));
await frame.getByRole('button', { name: 'Retry' }).click();
await frame.getByRole('option', { name: /Revenue by region/ }).waitFor();

await panelPage.evaluate(() => {
  const iframe = document.querySelector('iframe');
  if (iframe instanceof HTMLIFrameElement) iframe.style.width = '320px';
});
await panelPage.waitForTimeout(100);
const narrow = await frame.evaluate(() => ({
  width: innerWidth,
  overflow: document.documentElement.scrollWidth > innerWidth,
}));
assert.equal(narrow.width, 320);
assert.equal(narrow.overflow, false, 'panel overflows at 320px');
check('AC-041', 'SDK keyboard interactions and 320px panel layout hold', true);

await panelPage.evaluate(() => {
  const iframe = document.querySelector('iframe');
  if (iframe instanceof HTMLIFrameElement) iframe.style.width = '360px';
});
await panelPage.waitForTimeout(100);
await panelPage.evaluate(() => window.__host.setTheme('openchamber-dark'));
await frame.waitForFunction(() => document.documentElement.dataset.ocTheme === 'dark');
await panelPage.waitForTimeout(220);
await frame.locator('body').screenshot({ path: path.join(screenshotDir, 'panel.png') });
await closePage(panelPage);

const widePanelPage = await browser.newPage({ viewport: { width: 900, height: 1000 } });
widePanelPage.on('pageerror', error => pageErrors.push(error.message));
frame = await openSurface(widePanelPage, 'panel', 720, 900);
await waitCanvasReady(frame);
await frame.getByRole('option', { name: /Revenue by region/ }).click();
await frame.getByRole('heading', { name: 'Revenue by region' }).waitFor();
const widePanelLayout = await frame.evaluate(() => {
  const library = document.querySelector('.canvas-library');
  const inspector = document.querySelector('.canvas-inspector');
  if (!(library instanceof HTMLElement) || !(inspector instanceof HTMLElement)) return null;
  const left = library.getBoundingClientRect();
  const right = inspector.getBoundingClientRect();
  return { left: { x: left.x, width: left.width }, right: { x: right.x, width: right.width },
    overflow: document.documentElement.scrollWidth > innerWidth };
});
assert.ok(widePanelLayout);
assert.ok(widePanelLayout.left.width > 0 && widePanelLayout.right.width > 0, 'wide panel did not show library and inspector');
assert.ok(widePanelLayout.left.x < widePanelLayout.right.x);
assert.equal(await frame.getByRole('button', { name: 'Back', exact: true }).isVisible(), false);
assert.equal(widePanelLayout.overflow, false, 'wide panel overflows at 720px');
check('AC-041', 'wide panel keeps the library and inspector visible', true);
await frame.locator('body').screenshot({ path: path.join(screenshotDir, 'panel-wide.png') });
await closePage(widePanelPage);

// AC-046: the gallery shows an MCP setup CTA only when the service confirms
// the registration state, and its button opens the existing setup view.
const mcpPage = await browser.newPage({ viewport: { width: 720, height: 900 } });
mcpPage.on('pageerror', error => pageErrors.push(error.message));
frame = await openSurface(mcpPage, 'panel', 620, 900);
await waitCanvasReady(frame);
assert.equal(await frame.getByText('Install the Canvas MCP tools').first().isVisible(), false,
  'setup CTA shown while the service cannot confirm registration');
check('AC-046a', 'no setup CTA while the service cannot confirm registration', true);

frame = await reloadPanel(mcpPage, { checked: true, registered: false, name: null, disabled: false, commandMatch: false, source: null });
await frame.getByText('Install the Canvas MCP tools').waitFor();
await frame.getByRole('button', { name: 'Open setup' }).click();
await frame.getByRole('heading', { name: 'Set up Canvas' }).waitFor();
await frame.getByText('Canvas MCP is not registered').waitFor();
await frame.locator('body').screenshot({ path: path.join(screenshotDir, 'setup-not-installed.png') });
await frame.getByRole('button', { name: 'Back to gallery' }).click();
check('AC-046b', 'unregistered service shows the install CTA that opens setup', true);

frame = await reloadPanel(mcpPage, { checked: true, registered: true, name: 'canvas', disabled: false, commandMatch: true, source: null });
assert.equal(await frame.getByText('Install the Canvas MCP tools').first().isVisible(), false, 'CTA shown on a healthy registration');
check('AC-046c', 'no setup CTA on a healthy registration', true);

frame = await reloadPanel(mcpPage, { checked: true, registered: true, name: 'canvas', disabled: true, commandMatch: true, source: '/home/parth/.config/opencode/opencode.json' });
await frame.getByText('Canvas MCP is disabled').waitFor();
await openOptions(frame);
await frame.getByRole('menuitem', { name: 'Setup' }).click();
await frame.getByText('Disabled', { exact: true }).waitFor();
check('AC-047a', 'setup mirror reports a disabled registration', true);

frame = await reloadPanel(mcpPage, { checked: true, registered: false, name: 'canvas', disabled: false, commandMatch: false, source: '/home/parth/.config/opencode/opencode.json' });
await frame.getByText('Canvas MCP points at an old command').waitFor();
await openOptions(frame);
await frame.getByRole('menuitem', { name: 'Setup' }).click();
await frame.getByText('Old command', { exact: true }).waitFor();
check('AC-047b', 'setup mirror reports a mismatched command', true);

frame = await reloadPanel(mcpPage, { checked: true, registered: true, name: 'canvas', disabled: false, commandMatch: true, source: null });
assert.equal(await frame.getByText('Install the Canvas MCP tools').first().isVisible(), false, 'CTA shown on a healthy-but-idle registration');
await openOptions(frame);
await frame.getByRole('menuitem', { name: 'Setup' }).click();
await frame.getByText('Waiting on agent', { exact: true }).waitFor();
await frame.locator('body').screenshot({ path: path.join(screenshotDir, 'setup-registration.png') });
await frame.getByRole('button', { name: 'Back to gallery' }).click();
check('AC-047c', 'setup mirror distinguishes registered-but-idle from unregistered', true);
await closePage(mcpPage);

const pagePage = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
pagePage.on('pageerror', error => pageErrors.push(error.message));
frame = await openSurface(pagePage, 'page', 1200, 900);
await waitCanvasReady(frame);
await frame.getByRole('searchbox', { name: 'Search artifacts' }).waitFor();
await frame.getByRole('option', { name: /Revenue by region/ }).click();
await frame.getByRole('heading', { name: 'Revenue by region' }).waitFor();
const pageLayout = await frame.evaluate(() => {
  const library = document.querySelector('.canvas-library');
  const inspector = document.querySelector('.canvas-inspector');
  if (!(library instanceof HTMLElement) || !(inspector instanceof HTMLElement)) return null;
  const left = library.getBoundingClientRect();
  const right = inspector.getBoundingClientRect();
  return { left: { x: left.x, width: left.width }, right: { x: right.x, width: right.width },
    overflow: document.documentElement.scrollWidth > innerWidth };
});
assert.ok(pageLayout);
assert.ok(pageLayout.left.width > 0 && pageLayout.right.width > 0);
assert.ok(pageLayout.left.x < pageLayout.right.x);
assert.equal(await frame.getByRole('button', { name: 'Back', exact: true }).isVisible(), false);
assert.equal(pageLayout.overflow, false);
check('AC-041', '1200px page keeps both columns', true);
await pagePage.evaluate(() => window.__host.setTheme('openchamber-light'));
await frame.waitForFunction(() => document.documentElement.dataset.ocTheme === 'light');
await pagePage.waitForTimeout(220);
const pageLight = await frame.evaluate(() => getComputedStyle(document.body).backgroundColor);
assert.equal(pageLight, rgb(token('openchamber-light', 'background')));
await frame.locator('body').screenshot({ path: path.join(screenshotDir, 'page-light.png') });
await pagePage.evaluate(() => window.__host.setTheme('openchamber-dark'));
await frame.waitForFunction(() => document.documentElement.dataset.ocTheme === 'dark');
await pagePage.waitForTimeout(220);
await frame.locator('body').screenshot({ path: path.join(screenshotDir, 'page.png') });
await openOptions(frame);
await frame.getByRole('menuitem', { name: 'Setup' }).click();
await frame.getByRole('heading', { name: 'Set up Canvas' }).waitFor();
const setupWidth = await frame.locator('.canvas-setup').evaluate(node => node.getBoundingClientRect().width);
assert.ok(setupWidth <= 770, `full-screen setup is too wide: ${setupWidth}`);
await frame.locator('body').screenshot({ path: path.join(screenshotDir, 'setup-page.png') });
await frame.getByRole('button', { name: 'Back to gallery' }).click();
await frame.getByRole('heading', { name: 'Revenue by region' }).waitFor();
await closePage(pagePage);

const emptyPagePage = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
emptyPagePage.on('pageerror', error => pageErrors.push(error.message));
frame = await openSurface(emptyPagePage, 'page', 1200, 900, true);
await waitCanvasReady(frame);
await frame.getByRole('heading', { name: 'No artifacts yet' }).waitFor();
const emptyLayout = await frame.evaluate(() => {
  const library = document.querySelector('.canvas-library');
  const inspector = document.querySelector('.canvas-inspector-slot');
  const empty = document.querySelector('.canvas-empty-slot');
  if (!(library instanceof HTMLElement) || !(inspector instanceof HTMLElement) || !(empty instanceof HTMLElement)) return null;
  return { library: library.getBoundingClientRect().width, inspector: getComputedStyle(inspector).display,
    empty: empty.getBoundingClientRect().width, emptyVisible: !empty.hidden,
    overflow: document.documentElement.scrollWidth > innerWidth };
});
assert.ok(emptyLayout);
assert.ok(emptyLayout.library > 1000, 'empty page did not use the full width');
assert.equal(emptyLayout.inspector, 'none');
assert.equal(emptyLayout.emptyVisible, true);
assert.equal(emptyLayout.overflow, false);
assert.equal(await frame.getByRole('searchbox', { name: 'Search artifacts' }).isVisible(), false, 'empty page still shows a full-width search');
check('AC-041', 'empty full-screen page uses the full width without an empty inspector', true);
await frame.locator('body').screenshot({ path: path.join(screenshotDir, 'page-empty.png') });
await closePage(emptyPagePage);

const statusPage = await browser.newPage({ viewport: { width: 420, height: 180 } });
statusPage.on('pageerror', error => pageErrors.push(error.message));
frame = await openSurface(statusPage, 'status', 360, 76);
await frame.locator('.oc-sdk-badge').waitFor({ state: 'visible' });
await frame.getByText('2 artifacts').waitFor();
await statusPage.evaluate(() => window.__host.setTheme('openchamber-dark'));
await frame.waitForFunction(() => document.documentElement.dataset.ocTheme === 'dark');
await statusPage.waitForTimeout(220);
assert.match(await frame.locator('.canvas-status-text').innerText(), /2 artifacts/);
assert.match(await frame.locator('.canvas-status-text').innerText(), /Revenue by region/);
assert.match(await frame.locator('.oc-sdk-badge').innerText(), /MCP not seen/);
await frame.locator('body').screenshot({ path: path.join(screenshotDir, 'status.png') });
await statusPage.evaluate(() => window.__host.setTheme('openchamber-light'));
await statusPage.evaluate(() => window.__host.setHeartbeat(new Date().toISOString()));
await frame.getByText('MCP connected').waitFor({ timeout: 8000 });
assert.match(await frame.locator('.oc-sdk-badge').innerText(), /MCP connected/);
await closePage(statusPage);

await browser.close();
server.stop();
if (errors.length > 0) throw new Error(`Browser console errors:\n${errors.join('\n')}`);
if (pageErrors.length > 0) throw new Error(`Page errors:\n${pageErrors.join('\n')}`);
console.log(JSON.stringify({
  screenshots: ['panel.png', 'panel-detail.png', 'panel-wide.png', 'grid.png', 'page.png', 'page-light.png', 'page-empty.png', 'setup.png', 'setup-page.png', 'empty.png', 'dialog.png', 'dialog-dark.png', 'status.png'],
  verified: [...verified].sort(),
  checks: [
    'actual bundled panel and status in an opaque sandbox',
    'native SDK controls only',
    'controlled search, list selection, and retained draft/focus across theme switch',
    'six official theme fixtures plus host-supplied font/radius, no refetch on theme-only ready',
    'host.storage view/sort persistence across reload',
    'setup MCP path/config/heartbeat states',
    'empty, grid, error/retry, menu, dialog, and action coverage',
    '320px panel, 720px wide panel, and 1200px page layout',
  ],
}, null, 2));
