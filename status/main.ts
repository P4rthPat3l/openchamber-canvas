import { connectHost } from '@openchamber/sdk';
import { applyHostReady, mountBanner, mountSpinner } from '@openchamber/sdk/ui';
import type { ListResult } from '../src/store/types';

const host = connectHost();
let directory: string | null = null;
let generation = 0;
let started = false;
let refreshing = false;
let ui: ReturnType<typeof mountStatus> | null = null;

async function request<T>(path: string): Promise<T> {
  const response = await host.serviceRequest({ method: 'GET', path });
  if (response.status >= 400) throw new Error(`Canvas service error (${response.status})`);
  return JSON.parse(response.body) as T;
}

function mountStatus(root: HTMLElement) {
  const loading = document.createElement('div');
  const spinner = mountSpinner(loading, { label: 'Loading artifacts', size: 'sm' });
  const row = document.createElement('div');
  row.className = 'canvas-status-row';
  row.hidden = true;
  const text = document.createElement('div');
  text.className = 'canvas-status-text';
  const count = document.createElement('p');
  count.className = 'canvas-status-count';
  const latest = document.createElement('p');
  latest.className = 'canvas-status-latest';
  text.append(count, latest);
  row.append(text);
  const errorRoot = document.createElement('div');
  errorRoot.hidden = true;
  const error = mountBanner(errorRoot, { title: 'Canvas service unavailable', tone: 'error', action: { label: 'Retry', onClick: () => { void refresh(); } } });
  root.append(loading, row, errorRoot);
  return { loading, row, count, latest, errorRoot,
    dispose: () => { spinner.dispose(); error.dispose(); root.replaceChildren(); },
  };
}

async function refresh(): Promise<void> {
  const owner = ++generation;
  refreshing = true;
  try {
    const params = new URLSearchParams({ limit: '200' });
    if (directory !== null) params.set('directory', directory);
    const data = await request<ListResult>(`/list?${params}`);
    if (owner !== generation || !ui) return;
    ui.count.textContent = `${data.artifacts.length} ${data.artifacts.length === 1 ? 'artifact' : 'artifacts'}`;
    ui.latest.textContent = data.artifacts[0]?.title ?? 'No artifacts yet';
    ui.latest.title = ui.latest.textContent;
    ui.row.hidden = false;
    ui.errorRoot.hidden = true;
  } catch {
    if (owner === generation && ui) { ui.row.hidden = true; ui.errorRoot.hidden = false; }
  } finally {
    if (owner === generation) {
      refreshing = false;
      if (ui) ui.loading.hidden = true;
    }
  }
}

host.onReady(context => {
  applyHostReady(context, document.documentElement);
  if (started) {
    if (context.directory !== directory) { directory = context.directory; void refresh(); }
    return;
  }
  started = true;
  directory = context.directory;
  const root = document.querySelector<HTMLElement>('#root');
  if (root === null) throw new Error('Canvas status root is missing');
  ui = mountStatus(root);
  void host.setHeight(76).catch(() => undefined);
  void refresh();
});
host.onDirectory(next => {
  if (next === directory) return;
  directory = next;
  void refresh();
});
const poll = window.setInterval(() => {
  if (started && !refreshing && document.visibilityState === 'visible') void refresh();
}, 5000);
window.addEventListener('pagehide', () => { clearInterval(poll); ui?.dispose(); host.dispose(); });
