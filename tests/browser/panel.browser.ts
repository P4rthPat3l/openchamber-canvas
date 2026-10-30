import { readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { chromium, type Frame, type Page } from 'playwright';

declare global {
  interface Window {
    __host: {
      setTheme(name: string, overrides?: Record<string, string>): void;
      setPluginPath(value: string): void;
      setListFailure(value: boolean): void;
      setFailure(kind: string, value: boolean): void;
      scenario(name: string): void;
      release(): void;
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

async function reloadPanel(page: Page): Promise<Frame> {
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
await frame.evaluate(() => Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' }));
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
await frame.evaluate(() => { Reflect.deleteProperty(document, 'visibilityState'); });
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
await frame.getByRole('heading', { name: 'OpenCode plugin' }).waitFor();
await frame.getByText('Running', { exact: true }).waitFor();
const copyConfig = frame.getByRole('button', { name: 'Copy plugin config' });
assert.equal(await copyConfig.isEnabled(), true);
const configText = await frame.locator('pre').evaluate(node => node.textContent ?? '');
assert.deepEqual(JSON.parse(configText).plugins, ['/home/parth/Production/openchamber-canvas']);
check('AC-071', 'setup shows native plugin JSON for the installed package', true);
const sample = frame.getByRole('button', { name: 'Add sample prompt to chat' });
assert.equal(await sample.isEnabled(), true, 'AC-071: the user can test tools without a guessed connection state');
await frame.locator('body').screenshot({ path: path.join(screenshotDir, 'setup.png') });
await copyConfig.click();
await panelPage.waitForFunction(() => window.__host.getState().actions.filter(action => action.type === 'clipboard').length === 1);
const copiedConfig = await panelPage.evaluate(() => window.__host.getState().actions.filter(action => action.type === 'clipboard').at(-1));
assert.ok(JSON.stringify(copiedConfig).includes('plugins'), 'copy config should copy the plugin entry');
await frame.getByRole('button', { name: 'Copy path' }).click();
await panelPage.waitForFunction(() => window.__host.getState().actions.filter(action => action.type === 'clipboard').length === 2);
const copied = await panelPage.evaluate(() => window.__host.getState().actions.filter(action => action.type === 'clipboard').at(-1));
assert.ok(JSON.stringify(copied).includes('/home/parth/Production/openchamber-canvas'));
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

const rowOpen = frame.locator('.canvas-list-bar').getByRole('button', { name: 'Open', exact: true });
assert.equal(await rowOpen.isDisabled(), false, 'row open stayed disabled after selection');
const openedBefore = await widePanelPage.evaluate(() => window.__host.getState().actions.filter(action => action.type === 'open-url').length);
await rowOpen.click();
await widePanelPage.waitForFunction(count => window.__host.getState().actions.filter(action => action.type === 'open-url').length > count, openedBefore);
check('AC-048', 'the library toolbar opens the selected row', true);

const openedBeforeDouble = await widePanelPage.evaluate(() => window.__host.getState().actions.filter(action => action.type === 'open-url').length);
await frame.getByRole('option', { name: /Onboarding flow/ }).dblclick();
await widePanelPage.waitForFunction(count => window.__host.getState().actions.filter(action => action.type === 'open-url').length > count, openedBeforeDouble);
check('AC-048', 'double-clicking a row opens it directly', true);
await frame.locator('body').screenshot({ path: path.join(screenshotDir, 'panel-wide.png') });
await closePage(widePanelPage);

const setupPage = await browser.newPage({ viewport: { width: 720, height: 900 } });
setupPage.on('pageerror', error => pageErrors.push(error.message));
frame = await openSurface(setupPage, 'panel', 620, 900);
await waitCanvasReady(frame);
await openOptions(frame);
await frame.getByRole('menuitem', { name: 'Setup' }).click();
await frame.getByRole('heading', { name: 'OpenCode plugin' }).waitFor();
await setupPage.evaluate(() => window.__host.setFailure('failHealth', true));
await frame.getByRole('button', { name: 'Check again' }).click();
await frame.getByText('Could not check setup', { exact: true }).waitFor();
assert.equal(await frame.getByRole('button', { name: 'Copy plugin config' }).isDisabled(), true);
assert.equal(await frame.getByRole('button', { name: 'Add sample prompt to chat' }).isEnabled(), true);
await frame.locator('body').screenshot({ path: path.join(screenshotDir, 'setup-service-error.png') });
await setupPage.evaluate(() => window.__host.setFailure('failHealth', false));
await frame.getByRole('button', { name: 'Check again' }).click();
await frame.getByText('Running', { exact: true }).waitFor();
assert.equal(await frame.getByRole('button', { name: 'Copy plugin config' }).isEnabled(), true);
const setupState = await setupPage.evaluate(() => window.__host.getState());
assert.equal(setupState.requests.some(request => JSON.stringify(request).includes('/mcp-')), false);
assert.equal(await frame.getByText('Connected', { exact: true }).count(), 0);
check('AC-071', 'native setup retries service errors without a config scan or false connection status', true);
await closePage(setupPage);

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
await frame.getByText('2 artifacts').waitFor();
await statusPage.evaluate(() => window.__host.setTheme('openchamber-dark'));
await frame.waitForFunction(() => document.documentElement.dataset.ocTheme === 'dark');
await statusPage.waitForTimeout(220);
assert.match(await frame.locator('.canvas-status-text').innerText(), /2 artifacts/);
assert.match(await frame.locator('.canvas-status-text').innerText(), /Revenue by region/);
assert.equal(await frame.locator('.oc-sdk-badge').count(), 0, 'AC-071: status has no guessed tool connection badge');
await frame.locator('body').screenshot({ path: path.join(screenshotDir, 'status.png') });
await statusPage.evaluate(() => window.__host.setTheme('openchamber-light'));
await closePage(statusPage);

const revisionPage = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
revisionPage.on('pageerror', error => pageErrors.push(error.message));
frame = await openSurface(revisionPage, 'panel', 360, 900);
await waitCanvasReady(frame);
await revisionPage.evaluate(() => { window.__host.scenario('many'); window.__host.scenario('history'); window.__host.scenario('feedback55'); });
frame = await reloadPanel(revisionPage);
await frame.getByText('Showing 50 of 212 artifacts', { exact: true }).waitFor();
await frame.getByRole('button', { name: 'Load more', exact: true }).click();
await frame.getByText('Showing 100 of 212 artifacts', { exact: true }).waitFor();
await frame.getByRole('searchbox', { name: 'Search artifacts' }).fill('Old searchable artifact');
await frame.getByRole('option', { name: /Old searchable artifact/ }).waitFor();
check('AC-059', 'server search finds an artifact outside the latest 200 and pagination exposes older results', true);
await frame.getByRole('searchbox', { name: 'Search artifacts' }).fill('no-such-old-artifact');
await frame.getByRole('heading', { name: 'No matching artifacts' }).waitFor();
assert.equal(await frame.getByRole('searchbox', { name: 'Search artifacts' }).isVisible(), true);
await frame.getByRole('searchbox', { name: 'Search artifacts' }).fill('');
await frame.getByRole('option', { name: /Revenue by region/ }).click();
await frame.getByRole('textbox', { name: 'What should change?' }).fill('Keep the revenue draft');
await frame.getByRole('button', { name: 'Back', exact: true }).click();
await frame.getByRole('searchbox', { name: 'Search artifacts' }).fill('Onboarding');
await frame.getByRole('option', { name: /Onboarding flow/ }).click();
await frame.getByRole('textbox', { name: 'What should change?' }).fill('Keep a different draft');
await frame.getByRole('button', { name: 'Back', exact: true }).click();
await frame.getByRole('searchbox', { name: 'Search artifacts' }).fill('');
await openOptions(frame);
await frame.getByRole('menuitem', { name: 'Setup', exact: true }).click();
await frame.getByRole('heading', { name: 'OpenCode plugin' }).waitFor();
assert.equal(await frame.getByRole('button', { name: 'Add sample prompt to chat' }).isEnabled(), true);
await frame.getByRole('button', { name: 'Add sample prompt to chat' }).click();
const sampleActions = await revisionPage.evaluate(() => window.__host.getState().actions.filter(action => action.type === 'compose'));
assert.ok(sampleActions.length > 0);
assert.equal(JSON.stringify(sampleActions).includes('"send":true'), false);
check('AC-071', 'sample prompt composes for review without requiring a connection claim', true);
await frame.getByRole('button', { name: 'Back to gallery' }).click();
await frame.getByRole('option', { name: /Revenue by region/ }).click();
assert.equal(await frame.getByRole('textbox', { name: 'What should change?' }).inputValue(), 'Keep the revenue draft');
check('AC-053', 'artifact drafts survive Back, another artifact, and Setup without leaking', true);
assert.equal(await frame.locator('.canvas-version').count(), 3);
assert.equal(await frame.getByRole('button', { name: 'Open v1', exact: true }).count(), 0);
await frame.getByRole('button', { name: 'Show older versions' }).click();
assert.equal(await frame.locator('.canvas-version').count(), 5);
assert.equal(await frame.getByRole('textbox', { name: 'What should change?' }).inputValue(), 'Keep the revenue draft');
const revisionOrder = await frame.evaluate(() => {
  const instructions = document.querySelector('.canvas-instruction');
  const history = document.querySelector('.canvas-version-rows');
  return Boolean(instructions && history && (instructions.compareDocumentPosition(history) & Node.DOCUMENT_POSITION_FOLLOWING));
});
check('AC-054', 'revision precedes bounded expandable history', revisionOrder);
await frame.getByText('10 of 55 responses', { exact: true }).waitFor();
assert.equal(await frame.locator('.canvas-feedback-row').count(), 10);
await frame.getByRole('button', { name: 'Load more feedback' }).click();
await frame.getByText('20 of 55 responses', { exact: true }).waitFor();
check('AC-051', 'feedback pages expose version and state', (await frame.locator('.canvas-feedback-row').count()) === 20);
await frame.getByRole('checkbox', { name: 'Select feedback fb_0', exact: true }).check();
await revisionPage.evaluate(() => window.__host.setFailure('failCompose', true));
const beforeFailure = await revisionPage.evaluate(() => window.__host.getState().actions.filter(action => action.type === 'compose').length);
await frame.getByRole('button', { name: 'Add feedback to chat' }).click();
await frame.getByRole('button', { name: 'Add feedback to chat' }).waitFor({ state: 'visible' });
assert.equal(await revisionPage.evaluate(() => window.__host.getState().actions.filter(action => action.type === 'compose').length), beforeFailure);
await revisionPage.evaluate(() => { window.__host.setFailure('failCompose', false); window.__host.setFailure('failMark', true); });
await frame.getByRole('button', { name: 'Add feedback to chat' }).click();
await revisionPage.waitForFunction(() => window.__host.getState().actions.some(action => action.type === 'toast' && JSON.stringify(action.payload).includes('status could not be saved')));
await revisionPage.evaluate(() => window.__host.setFailure('failMark', false));
await frame.getByRole('checkbox', { name: 'Select feedback fb_1', exact: true }).check();
await frame.getByRole('button', { name: 'Add feedback to chat' }).click();
await frame.getByText('Added to chat', { exact: true }).waitFor();
assert.equal(await frame.locator('.canvas-feedback-row').first().getByText('Pending', { exact: true }).count(), 1);
const composedFeedback = await revisionPage.evaluate(() => window.__host.getState().actions.filter(action => action.type === 'compose').at(-1));
assert.ok(JSON.stringify(composedFeedback).includes('version v1'));
assert.ok(JSON.stringify(composedFeedback).includes('fb_1'));
assert.ok(!JSON.stringify(composedFeedback).includes('fb_0'));
check('AC-052', 'compose failure preserves pending state and partial success does not silently recompose', true);
assert.ok(await frame.getByText('Legacy version. Rendering dependencies are not pinned.', { exact: true }).count() > 0);
check('AC-062', 'legacy versions are explicitly labelled', true);
await revisionPage.evaluate(() => window.__host.setFailure('delayCompose', true));
await frame.getByRole('textbox', { name: 'What should change?' }).fill('Submit this revision');
await frame.getByRole('button', { name: 'Add to chat', exact: true }).click();
await frame.getByRole('button', { name: 'Back', exact: true }).click();
await frame.getByRole('option', { name: /Revenue by region/ }).click();
await frame.getByRole('textbox', { name: 'What should change?' }).waitFor();
await revisionPage.evaluate(() => { window.__host.setFailure('delayCompose', false); window.__host.release(); });
await frame.waitForFunction(() => document.querySelector<HTMLTextAreaElement>('.canvas-instruction textarea')?.value === '');
assert.equal(await frame.getByRole('button', { name: 'Add to chat', exact: true }).isDisabled(), true);
check('AC-053', 'delayed composition updates the reopened inspector rather than a disposed field', true);
await revisionPage.evaluate(() => window.__host.setFailure('delayCompose', true));
await frame.getByRole('textbox', { name: 'What should change?' }).fill('First draft');
await frame.getByRole('button', { name: 'Add to chat', exact: true }).click();
await frame.getByRole('textbox', { name: 'What should change?' }).fill('New draft while saving');
await revisionPage.evaluate(() => { window.__host.setFailure('delayCompose', false); window.__host.release(); });
assert.equal(await frame.getByRole('textbox', { name: 'What should change?' }).inputValue(), 'New draft while saving');
await revisionPage.evaluate(() => { window.__host.setFailure('delayFavorite', true); window.__host.setFailure('delayDetail', true); });
await frame.getByRole('button', { name: 'Actions', exact: true }).click();
await frame.getByRole('menuitem', { name: 'Remove from favorites', exact: true }).click();
await frame.getByRole('button', { name: 'Back', exact: true }).click();
await frame.getByRole('searchbox', { name: 'Search artifacts' }).fill('Onboarding');
await frame.getByRole('option', { name: /Onboarding flow/ }).click();
await revisionPage.evaluate(() => { window.__host.setFailure('delayFavorite', false); window.__host.setFailure('delayDetail', false); window.__host.release(); });
await frame.getByRole('heading', { name: 'Onboarding flow', exact: true }).waitFor();
check('AC-053', 'a delayed action for another artifact cannot strand the selected detail request', true);
await frame.locator('body').screenshot({ path: path.join(screenshotDir, 'revision-rail.png') });
await closePage(revisionPage);

const gates: Array<{ width: number; theme: string; overflow: string; tokens: string; accessibility: string; semantics: string; layout: string }> = [];
for (const width of [320, 375, 390, 768, 1024, 1280, 1440, 2048]) {
  const page = await browser.newPage({ viewport: { width: width + 44, height: 1000 } });
  page.on('pageerror', error => pageErrors.push(error.message));
  const view = await openSurface(page, width >= 768 ? 'page' : 'panel', width, 940);
  await waitCanvasReady(view);
  await openOptions(view);
  await view.getByRole('menuitem', { name: 'Setup', exact: true }).click();
  await view.getByRole('button', { name: 'Copy plugin config' }).waitFor();
  for (const theme of ['openchamber-light', 'openchamber-dark']) {
    await page.evaluate(name => window.__host.setTheme(name), theme);
    await page.waitForTimeout(220);
    const result = await view.evaluate(() => {
      const setup = document.querySelector('.canvas-setup');
      const buttons = [...document.querySelectorAll('button')].filter(button => button.getClientRects().length > 0);
      const headings = [...document.querySelectorAll('.canvas-setup h1,.canvas-setup h2')].map(heading => heading.tagName);
      return {
        overflow: document.documentElement.scrollWidth > innerWidth || Boolean(setup && setup.scrollWidth > setup.clientWidth),
        tokens: Boolean(getComputedStyle(document.documentElement).getPropertyValue('--oc-primary-text').trim()),
        names: buttons.every(button => Boolean(button.getAttribute('aria-label') || button.textContent?.trim())),
        targets: buttons.every(button => button.getBoundingClientRect().height >= 24),
        headings: headings[0] === 'H1' && headings.slice(1).every(heading => heading === 'H2'),
        layout: setup !== null && setup.getBoundingClientRect().width <= innerWidth,
      };
    });
    assert.equal(result.overflow, false, `AC-071: Setup overflow at ${width}/${theme}`);
    assert.equal(result.tokens, true, `AC-071: host tokens at ${width}/${theme}`);
    assert.equal(result.names && result.targets, true, `AC-071: labelled SDK targets at ${width}/${theme}`);
    assert.equal(result.headings, true, `AC-071: heading hierarchy at ${width}/${theme}`);
    assert.equal(result.layout, true, `AC-071: Setup containment at ${width}/${theme}`);
    gates.push({ width, theme, overflow: 'pass', tokens: 'pass', accessibility: 'label/24px checks pass', semantics: 'pass', layout: 'pass' });
    await view.locator('body').screenshot({ path: path.join(screenshotDir, `native-setup-${width}-${theme}.png`) });
  }
  await page.evaluate(() => window.__host.setPluginPath('/installed/' + 'long path with spaces/'.repeat(20)));
  await view.getByRole('button', { name: 'Check again' }).click();
  await view.getByRole('button', { name: 'Copy plugin config' }).waitFor({ state: 'visible' });
  assert.equal(await view.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `AC-071: long installed path stays within its code scroller at ${width}`);
  await view.getByLabel('OpenCode plugin configuration').focus();
  assert.equal(await view.getByLabel('OpenCode plugin configuration').evaluate(node => node === document.activeElement), true);
  await closePage(page);
}
check('AC-071', 'native Setup renders at required and awkward widths in both themes', true);

await browser.close();
server.stop();
if (errors.length > 0) throw new Error(`Browser console errors:\n${errors.join('\n')}`);
if (pageErrors.length > 0) throw new Error(`Page errors:\n${pageErrors.join('\n')}`);
console.log(JSON.stringify({
  screenshots: ['panel.png', 'panel-detail.png', 'panel-wide.png', 'grid.png', 'page.png', 'page-light.png', 'page-empty.png', 'setup.png', 'setup-page.png', 'empty.png', 'dialog.png', 'dialog-dark.png', 'status.png'],
  verified: [...verified].sort(),
  verification: gates,
  checks: [
    'actual bundled panel and status in an opaque sandbox',
    'native SDK controls only',
    'controlled search, list selection, and retained draft/focus across theme switch',
    'six official theme fixtures plus host-supplied font/radius, no refetch on theme-only ready',
    'host.storage view/sort persistence across reload',
    'native plugin config/path, reviewed test prompt, and service error/retry',
    'empty, grid, error/retry, menu, dialog, and action coverage',
    '320px panel, 720px wide panel, and 1200px page layout',
  ],
}, null, 2));
