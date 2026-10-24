import { connectHost } from '@openchamber/sdk';
import {
  applyHostReady, mountBadge, mountBanner, mountButton, mountEmpty, mountList,
  mountMenu, mountSearchField, mountSelect, mountSpinner, mountTextField,
} from '@openchamber/sdk/ui';
import type { ButtonHandle, ButtonVariant, ListItem, MenuItem } from '@openchamber/sdk/ui';
import type { ArtifactKind, ArtifactMeta, ArtifactSummary, ListResult } from '../src/store/types';

type Scope = 'project' | 'all' | 'archived' | 'trash';
type ViewMode = 'list' | 'grid';
type SortMode = 'updated' | 'title';
interface Disposable { dispose(): void }
interface ViewUrl { url: string }
interface ExportResult { path: string }
interface Health { store: string; mcpPath?: string }
interface Heartbeat { seenAt: string }
interface McpRegistration {
  checked: boolean;
  registered: boolean;
  name: string | null;
  disabled: boolean;
  commandMatch: boolean;
  source: string | null;
}
type IconName =
  | 'arrow-up-right' | 'copy' | 'download' | 'message'
  | 'history' | 'code' | 'server' | 'terminal' | 'refresh'
  | 'chevron-left' | 'ellipsis' | 'star' | 'file-text';

const SVG_NS = 'http://www.w3.org/2000/svg';
const ICONS: Record<IconName, string> = {
  'arrow-up-right': '<path d="M7 17 17 7"/><path d="M8 7h9v9"/>',
  copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  download: '<path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/>',
  message: '<path d="M21 15a4 4 0 0 1-4 4H7l-4 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4Z"/>',
  history: '<path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 3v5h5"/><path d="M12 8v4l3 2"/>',
  code: '<path d="m8 8-4 4 4 4"/><path d="m16 8 4 4-4 4"/><path d="M14 4l-4 16"/>',
  server: '<rect x="2" y="3" width="20" height="8" rx="2"/><rect x="2" y="13" width="20" height="8" rx="2"/><path d="M6 7h.01"/><path d="M6 17h.01"/>',
  terminal: '<path d="m4 17 6-6-6-6"/><path d="M12 19h8"/>',
  refresh: '<path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 3v5h-5"/>',
  'chevron-left': '<path d="m15 18-6-6 6-6"/>',
  ellipsis: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
  star: '<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3 6.4 20.2l1.1-6.2L3 9.6l6.2-.9Z"/>',
  'file-text': '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6"/><path d="M8 13h8M8 17h6"/>',
};

const KINDS: Record<ArtifactKind, string> = {
  html: 'HTML', bundle: 'Bundle', markdown: 'Markdown', image: 'Image', pdf: 'PDF', data: 'Data',
};
const CREATE_PROMPT = 'Create a Canvas artifact for this project: a chart, dashboard, report, or interface mockup. Use the Canvas tools to publish it, then open the result.';
const SAMPLE_PROMPT = 'Publish a small Canvas test artifact: a one-page chart with three sample values and a short title. Use canvas_publish with the chartjs library, then open it.';
const host = connectHost();

let directory: string | null = null;
let surface = 'panel';
let locale = 'en';
let scope: Scope = 'project';
let view: ViewMode = 'list';
let sort: SortMode = 'updated';
let query = '';
let tag = '';
let artifacts: ArtifactSummary[] = [];
let selectedId: string | null = null;
let detail: ArtifactMeta | null = null;
let detailError: string | null = null;
let draft = '';
let loading = true;
let refreshing = false;
let listError: string | null = null;
let showSetup = false;
let preferenceRevision = 0;
let listRequest = 0;
let detailRequest = 0;
let knownIds: Set<string> | null = null;
let newId: string | null = null;
let detailSignature = '';
let mcpRegistration: McpRegistration | null = null;
let mcpRequest = 0;
let app: ReturnType<typeof mountApp> | null = null;
let inspector: ReturnType<typeof mountInspector> | null = null;
let setupView: ReturnType<typeof mountSetup> | null = null;
let dialog: HTMLDialogElement | null = null;
let dialogHandles: Disposable[] = [];
let setupRequest = 0;
const remote = !['127.0.0.1', 'localhost', '::1', '[::1]'].includes(location.hostname);

function element<K extends keyof HTMLElementTagNameMap>(
  tagName: K, parent: Element, className = '', text = '',
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tagName);
  node.className = className;
  node.textContent = text;
  parent.append(node);
  return node;
}

function svgIcon(name: IconName, className = 'canvas-icon'): SVGSVGElement {
  const node = document.createElementNS(SVG_NS, 'svg');
  node.setAttribute('viewBox', '0 0 24 24');
  node.setAttribute('fill', 'none');
  node.setAttribute('stroke', 'currentColor');
  node.setAttribute('stroke-width', '1.7');
  node.setAttribute('stroke-linecap', 'round');
  node.setAttribute('stroke-linejoin', 'round');
  node.setAttribute('aria-hidden', 'true');
  node.setAttribute('focusable', 'false');
  node.setAttribute('class', className);
  node.innerHTML = ICONS[name];
  return node;
}

/** Decorative icon inside a kit button or heading; the kit still owns the control's geometry and label. */
function mountButtonWithIcon(parent: Element, props: Parameters<typeof mountButton>[1], icon?: IconName): ButtonHandle {
  const handle = mountButton(parent, props);
  if (icon) {
    const button = parent.lastElementChild;
    button?.prepend(svgIcon(icon, 'canvas-control-icon'));
  }
  return handle;
}

function iconMenu(parent: Element, props: Parameters<typeof mountMenu>[1], icon: IconName = 'ellipsis') {
  const handle = mountMenu(parent, props);
  const button = parent.lastElementChild?.querySelector?.('button');
  button?.prepend(svgIcon(icon, 'canvas-control-icon'));
  return handle;
}

function sectionHeading(parent: Element, icon: IconName, label: string, meta?: string): HTMLElement {
  const heading = element('header', parent, 'canvas-section-heading');
  heading.append(svgIcon(icon, 'canvas-section-icon'));
  element('h2', heading, '', label);
  if (meta) element('span', heading, 'canvas-section-meta', meta);
  return heading;
}

function metaItem(parent: Element, icon: IconName, text: string): HTMLElement {
  const item = element('span', parent, 'canvas-meta-item');
  item.append(svgIcon(icon, 'canvas-status-icon'), document.createTextNode(text));
  return item;
}

function groupHeading(parent: Element, icon: IconName, label: string): HTMLElement {
  const heading = element('header', parent, 'canvas-list-heading');
  heading.append(svgIcon(icon, 'canvas-list-icon'), element('span', heading, '', label));
  return heading;
}

function dispose(handles: Disposable[]): void {
  for (const handle of handles.splice(0)) handle.dispose();
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function request<T>(path: string, body?: unknown): Promise<T> {
  const response = await host.serviceRequest({
    method: body === undefined ? 'GET' : 'POST', path,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const parsed: unknown = response.body ? JSON.parse(response.body) : null;
  if (response.status >= 400) {
    const text = isRecord(parsed) && isRecord(parsed.error) && typeof parsed.error.message === 'string'
      ? parsed.error.message : `Canvas service error (${response.status})`;
    throw new Error(text);
  }
  return parsed as T;
}

async function run(work: () => Promise<void>): Promise<void> {
  try { await work(); }
  catch (error) { await host.toast({ kind: 'error', message: message(error) }); }
}

function action(
  parent: Element, handles: Disposable[], label: string, work: () => Promise<void>,
  variant: ButtonVariant = 'ghost', size: 'default' | 'sm' | 'xs' = 'sm', icon?: IconName,
): ButtonHandle {
  const button = mountButtonWithIcon(parent, { label, variant, size, onClick: () => {
    button.update({ loading: true });
    void run(work).finally(() => button.update({ loading: false }));
  } }, icon);
  handles.push(button);
  return button;
}

function shellArg(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function renderShellCommand(target: HTMLElement, command: string, path: string): void {
  target.replaceChildren();
  const quoted = shellArg(path);
  const inner = quoted.slice(1, -1);
  target.append(document.createTextNode(command.slice(0, command.length - quoted.length) + (quoted[0] ?? '')));
  let start = 0;
  for (let index = 0; index < inner.length; index++) {
    if (inner[index] !== '/') continue;
    target.append(document.createTextNode(inner.slice(start, index + 1)), document.createElement('wbr'));
    start = index + 1;
  }
  target.append(document.createTextNode(inner.slice(start) + (quoted.at(-1) ?? '')));
}

async function copy(text: string, label: string): Promise<void> {
  await host.writeClipboard(text);
  await host.toast({ kind: 'success', message: `${label} copied.` });
}

function date(iso: string): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));
}

function relativeDate(iso: string): string {
  const elapsed = Math.max(0, Date.now() - Date.parse(iso));
  if (elapsed < 60_000) return 'now';
  if (elapsed < 3_600_000) return `${Math.floor(elapsed / 60_000)}m`;
  if (elapsed < 86_400_000) return `${Math.floor(elapsed / 3_600_000)}h`;
  return `${Math.floor(elapsed / 86_400_000)}d`;
}

function bytes(value: number): string {
  return value < 1024 ? `${value} B` : `${(value / 1024).toFixed(1)} KiB`;
}

function summarySignature(): string {
  const item = artifacts.find(entry => entry.id === selectedId);
  return item ? JSON.stringify(item) : '';
}

function visibleArtifacts(): ArtifactSummary[] {
  const needle = query.trim().toLowerCase();
  return artifacts.filter(item =>
    (!tag || item.tags.includes(tag)) &&
    (!needle || [item.title, item.projectName, ...item.tags].some(value => value.toLowerCase().includes(needle))),
  ).sort((left, right) => sort === 'title'
    ? left.title.localeCompare(right.title, locale)
    : right.updatedAt.localeCompare(left.updatedAt));
}

async function savePreferences(): Promise<void> {
  preferenceRevision++;
  try { await host.storage.set('gallery.preferences', { view, sort }); }
  catch { await host.toast({ kind: 'info', message: 'View preferences will last for this panel session only.' }); }
}

async function loadPreferences(): Promise<void> {
  const revision = preferenceRevision;
  try {
    const saved = await host.storage.get('gallery.preferences');
    if (revision !== preferenceRevision || !isRecord(saved)) return;
    if (saved.view === 'list' || saved.view === 'grid') view = saved.view;
    if (saved.sort === 'updated' || saved.sort === 'title') sort = saved.sort;
    paint();
  } catch {
    // Instance storage may be unavailable; the current panel remains usable.
  }
}

function clearSelection(): void {
  detailRequest++;
  selectedId = null;
  detail = null;
  detailError = null;
  detailSignature = '';
  draft = '';
  closeDialog();
  inspector?.dispose();
  inspector = null;
}

function changeScope(next: string): void {
  if (next !== 'project' && next !== 'all' && next !== 'archived' && next !== 'trash') return;
  scope = next === 'project' && directory === null ? 'all' : next;
  artifacts = [];
  knownIds = null;
  newId = null;
  query = '';
  tag = '';
  listError = null;
  loading = true;
  clearSelection();
  app?.library.search.update({ value: query });
  paint();
  void refresh();
}

async function refresh(): Promise<void> {
  const owner = ++listRequest;
  refreshing = true;
  try {
    const params = new URLSearchParams({ limit: '200' });
    if (scope === 'project' && directory !== null) params.set('directory', directory);
    if (scope === 'archived') params.set('archived', 'true');
    const result = await request<ListResult>(scope === 'trash' ? '/trash' : `/list?${params}`);
    if (owner !== listRequest) return;
    artifacts = result.artifacts;
    if (knownIds !== null && (scope === 'project' || scope === 'all')) {
      const fresh = artifacts.find(item => !knownIds?.has(item.id));
      if (fresh) newId = fresh.id;
    }
    knownIds = new Set(artifacts.map(item => item.id));
    listError = null;
    if (selectedId !== null && detail !== null && summarySignature() !== detailSignature) {
      void loadDetail(selectedId, false);
    }
    if (scope !== 'trash') {
      const count = artifacts.reduce((sum, item) => sum + item.feedbackCount, 0);
      void host.setBadge(count ? Math.min(999, count) : null).catch(() => undefined);
    }
  } catch (error) {
    if (owner === listRequest) listError = message(error);
  } finally {
    if (owner === listRequest) {
      refreshing = false;
      loading = false;
      paint();
    }
  }
  void syncMcpRegistration();
}

async function syncMcpRegistration(): Promise<void> {
  const owner = ++mcpRequest;
  let next: McpRegistration | null = null;
  try {
    next = await request<McpRegistration>('/mcp-registration');
  } catch {
    next = null; // Older service install without the endpoint: fall back to heartbeat-only wording.
  }
  if (owner !== mcpRequest) return;
  mcpRegistration = next;
  paint();
}

function mcpCtaState(): { title: string; body: string } | null {
  const registration = mcpRegistration;
  if (registration === null || !registration.checked) return null;
  if (registration.registered && !registration.disabled) return null;
  if (registration.registered && registration.disabled) {
    return { title: 'Canvas MCP is disabled', body: 'Enable Canvas in Settings → MCP to let the agent publish and refine artifacts.' };
  }
  if (registration.name !== null) {
    return { title: 'Canvas MCP points at an old command', body: 'The registered command no longer matches this install. Open setup and re-add Canvas in Settings → MCP.' };
  }
  return { title: 'Install the Canvas MCP tools', body: 'The agent cannot publish or refine artifacts until Canvas is added in Settings → MCP.' };
}

async function loadDetail(id: string, focus: boolean): Promise<void> {
  const owner = ++detailRequest;
  try {
    const meta = await request<ArtifactMeta>(`/artifact/${encodeURIComponent(id)}`);
    if (owner !== detailRequest || selectedId !== id) return;
    detail = meta;
    detailError = null;
    detailSignature = summarySignature();
  } catch (error) {
    if (owner !== detailRequest || selectedId !== id) return;
    detailError = message(error);
  }
  paint();
  if (focus) app?.inspectorSlot.querySelector<HTMLElement>('h1')?.focus();
}

function selectArtifact(id: string): void {
  if (id === selectedId) return;
  clearSelection();
  selectedId = id;
  if (newId === id) newId = null;
  paint();
  void loadDetail(id, true);
}

function backToLibrary(): void {
  clearSelection();
  paint();
  app?.library.focusList();
}

async function askAgent(text = CREATE_PROMPT): Promise<void> {
  await host.compose({ text, mode: 'append' });
  await host.toast({ kind: 'info', message: 'Prompt added to the composer. Review it before sending.' });
}

async function openArtifact(id: string, version?: string): Promise<void> {
  const result = await request<ViewUrl>('/view-url', { id, ...(version ? { version } : {}) });
  await host.openUrl(result.url);
}

async function copyUrl(id: string): Promise<void> {
  const result = await request<ViewUrl>('/view-url', { id });
  await copy(result.url, 'Local, expiring view URL');
}

async function exportArtifact(meta: ArtifactMeta): Promise<void> {
  const result = await request<ExportResult>(`/export/${encodeURIComponent(meta.id)}`, {
    format: meta.kind === 'html' ? 'html' : 'zip',
  });
  await host.toast({ kind: 'success', message: `Exported to ${result.path}`, copy: { text: result.path }, persistent: true });
}

async function attachArtifact(meta: ArtifactMeta): Promise<void> {
  const result = await request<ViewUrl>('/view-url', { id: meta.id });
  await host.attach({ providerId: 'canvas', id: meta.id, title: meta.title, url: result.url, data: { artifactId: meta.id } });
  await host.toast({ kind: 'success', message: 'Artifact attached to chat.' });
}

async function restoreVersion(meta: ArtifactMeta, version: string): Promise<void> {
  await request(`/restore/${encodeURIComponent(meta.id)}`, { version, baseVersion: meta.currentVersion });
  if (selectedId === meta.id) await loadDetail(meta.id, false);
  await refresh();
}

async function archiveArtifact(meta: ArtifactMeta): Promise<void> {
  await request(`/archive/${encodeURIComponent(meta.id)}`, { archived: meta.archivedAt === null });
  if (selectedId === meta.id) clearSelection();
  await refresh();
}

function closeDialog(): void {
  const previous = dialog;
  dialog = null;
  previous?.close();
  dispose(dialogHandles);
  previous?.remove();
}

function confirmDelete(meta: ArtifactMeta): void {
  if (app === null) return;
  closeDialog();
  const modal = element('dialog', app.root, 'canvas-dialog');
  dialog = modal;
  modal.setAttribute('aria-labelledby', 'delete-title');
  const title = element('h2', modal, '', 'Move to trash?');
  title.id = 'delete-title';
  element('p', modal, 'canvas-muted', `"${meta.title}" can be restored from Trash for 30 days.`);
  const errorSlot = element('div', modal);
  errorSlot.hidden = true;
  const errorBanner = mountBanner(errorSlot, { tone: 'error', title: 'Could not move artifact' });
  dialogHandles.push(errorBanner);
  const actions = element('div', modal, 'canvas-actions');
  dialogHandles.push(mountButton(actions, { label: 'Cancel', variant: 'outline', size: 'sm', onClick: closeDialog }));
  const remove = mountButton(actions, { label: 'Move to trash', variant: 'destructive', size: 'sm', onClick: () => {
    remove.update({ loading: true });
    void (async () => {
      try {
        await request(`/trash/${encodeURIComponent(meta.id)}`, {});
        if (selectedId === meta.id) clearSelection();
        else closeDialog();
        await refresh();
      } catch (error) {
        errorSlot.hidden = false;
        errorBanner.update({ body: message(error) });
        remove.update({ loading: false });
      }
    })();
  } });
  dialogHandles.push(remove);
  modal.addEventListener('close', () => { if (dialog === modal) closeDialog(); });
  modal.showModal();
}

function mountLibrary(parent: Element) {
  const handles: Disposable[] = [];
  const node = element('section', parent, 'canvas-library');
  node.setAttribute('aria-label', 'Artifact library');
  const toolbar = element('div', node, 'canvas-toolbar');
  const scopeControl = mountSelect(toolbar, { label: 'Scope', value: scope, options: [], onChange: changeScope });
  const tagRoot = element('div', toolbar, 'canvas-filter');
  const tagControl = mountSelect(tagRoot, { label: 'Tag', value: 'all', options: [], onChange: value => {
    tag = value === 'all' ? '' : value.slice(4);
    tagControl.update({ value });
    update();
  } });
  const optionsRoot = element('div', toolbar, 'canvas-options');
  const options = iconMenu(optionsRoot, { label: 'Options', variant: 'outline', size: 'sm', items: [], onSelect: id => {
    if (id === 'refresh') void refresh();
    else if (id === 'ask') void run(() => askAgent());
    else if (id === 'setup') setSetup(true);
    else if (id === 'view') { view = view === 'list' ? 'grid' : 'list'; void savePreferences(); update(); }
    else if (id === 'sort') { sort = sort === 'updated' ? 'title' : 'updated'; void savePreferences(); update(); }
  } });
  const searchRoot = element('div', node, 'canvas-search');
  const search = mountSearchField(searchRoot, { value: query, placeholder: 'Search artifacts', onChange: value => {
    query = value;
    search.update({ value });
    update();
  } });
  const listBar = element('div', node, 'canvas-list-bar');
  const count = element('p', listBar, 'canvas-count canvas-muted');
  count.setAttribute('aria-live', 'polite');
  const openSelected = mountButtonWithIcon(listBar, {
    label: remote ? 'Copy URL' : 'Open',
    variant: 'outline',
    size: 'sm',
    disabled: true,
    onClick: () => {
      const id = selectedId;
      if (id === null) return;
      void run(() => (remote ? copyUrl(id) : openArtifact(id)));
    },
  }, remote ? 'copy' : 'arrow-up-right');
  handles.push(openSelected);
  const scroll = element('div', node, 'canvas-library-scroll');
  const spinnerRoot = element('div', scroll, 'canvas-state');
  const spinner = mountSpinner(spinnerRoot, { label: 'Loading artifacts' });
  const emptyRoot = element('div', scroll, 'canvas-empty-slot');
  const empty = mountEmpty(emptyRoot, { title: 'No artifacts yet' });
  const favoritesRoot = element('section', scroll);
  groupHeading(favoritesRoot, 'star', 'Favorites');
  const favorites = mountList(favoritesRoot, { ariaLabel: 'Favorite artifacts', items: [], onSelect: selectArtifact });
  const listRoot = element('section', scroll);
  groupHeading(listRoot, 'file-text', 'Artifacts');
  const list = mountList(listRoot, { ariaLabel: 'Artifacts', items: [], onSelect: selectArtifact });
  const gridRoot = element('div', scroll, 'canvas-grid');
  let gridHandles: Disposable[] = [];
  let rowsSignature = '';
  let controlsSignature = '';

  // The kit list rebuilds its rows on every selection change, so the two
  // clicks of a double-click land on different elements. Track the last row
  // click and use it when the double-click target is the list itself.
  let lastRowClick: { id: string; at: number } | null = null;
  const rowIdAt = (event: Event): string | null => {
    const target = event.target instanceof Element ? event.target.closest('[role="option"]') : null;
    if (!(target instanceof HTMLElement)) return null;
    return artifacts.find(item => target.id.endsWith(`-${item.id}`))?.id ?? null;
  };
  const onRowClick = (event: MouseEvent): void => {
    const id = rowIdAt(event);
    if (id !== null) lastRowClick = { id, at: Date.now() };
  };
  const onRowDoubleClick = (event: MouseEvent): void => {
    const inList = event.target instanceof Element && event.target.closest('.oc-sdk-list') !== null;
    const recent = lastRowClick !== null && Date.now() - lastRowClick.at < 700 ? lastRowClick.id : null;
    const id = rowIdAt(event) ?? (inList ? recent : null);
    if (id === null || scope === 'trash') return;
    event.preventDefault();
    lastRowClick = null;
    void run(() => (remote ? copyUrl(id) : openArtifact(id)));
  };
  scroll.addEventListener('click', onRowClick);
  scroll.addEventListener('dblclick', onRowDoubleClick);
  handles.push(scopeControl, tagControl, options, search, spinner, empty, favorites, list);

  function update(): void {
    const availableTags = [...new Set(artifacts.flatMap(item => item.tags))].sort();
    if (tag && !availableTags.includes(tag)) tag = '';
    const visible = visibleArtifacts();
    openSelected.update({ label: remote ? 'Copy URL' : 'Open', disabled: selectedId === null || scope === 'trash' });
    const nextControls = JSON.stringify([scope, tag, directory, availableTags, view, sort]);
    if (nextControls !== controlsSignature) {
      controlsSignature = nextControls;
      scopeControl.update({ value: scope, options: [
        ...(directory === null ? [] : [{ id: 'project', label: 'This project' }]),
        { id: 'all', label: 'All projects' }, { id: 'archived', label: 'Archived' }, { id: 'trash', label: 'Trash' },
      ] });
      tagControl.update({ value: tag ? `tag:${tag}` : 'all', options: [{ id: 'all', label: 'All tags' }, ...availableTags.map(value => ({ id: `tag:${value}`, label: value }))] });
      options.update({ items: [
        { id: 'ask', label: 'Ask the agent for an artifact' }, { id: 'refresh', label: 'Refresh' },
        { separator: true }, { id: 'view', label: view === 'list' ? 'Show grid' : 'Show list' },
        { id: 'sort', label: sort === 'updated' ? 'Sort by title' : 'Sort by updated' },
        { separator: true }, { id: 'setup', label: 'Setup' },
      ] });
    }
    tagRoot.hidden = availableTags.length === 0;
    const blocked = listError !== null && artifacts.length === 0;
    const noItems = artifacts.length === 0 && !loading && listError === null;
    searchRoot.hidden = noItems;
    count.hidden = noItems;
    spinnerRoot.hidden = !loading || artifacts.length > 0;
    emptyRoot.hidden = loading || blocked || visible.length > 0;
    count.textContent = loading && artifacts.length === 0 ? 'Loading artifacts'
      : `${visible.length} ${visible.length === 1 ? 'artifact' : 'artifacts'}`;
    if (visible.length === 0 && !loading && !blocked) {
      const filtered = Boolean(query || tag);
      empty.update({ title: filtered ? 'No matching artifacts' : scope === 'trash' ? 'Trash is empty'
        : scope === 'archived' ? 'No archived artifacts' : 'No artifacts yet',
      body: filtered ? 'Try another search or clear the filters.'
        : scope === 'trash' ? 'Deleted artifacts can be restored for 30 days.'
          : scope === 'archived' ? 'Archived artifacts stay available here.' : 'Ask the agent to publish a chart, dashboard, or mockup.',
      action: filtered ? { label: 'Clear filters', onClick: () => { query = ''; tag = ''; search.update({ value: '' }); update(); } }
        : scope === 'project' || scope === 'all' ? { label: 'Ask the agent', onClick: () => { void run(() => askAgent()); } } : undefined,
      });
    }
    const useGrid = view === 'grid' || scope === 'trash';
    const favoriteItems = visible.filter(item => item.favorite && scope !== 'archived');
    const otherItems = visible.filter(item => !favoriteItems.includes(item));
    favoritesRoot.hidden = useGrid || favoriteItems.length === 0 || loading || blocked;
    listRoot.hidden = useGrid || otherItems.length === 0 || loading || blocked;
    gridRoot.hidden = !useGrid || visible.length === 0 || loading || blocked;
    const nextRows = JSON.stringify([visible, selectedId, newId, view, scope, locale]);
    if (nextRows === rowsSignature) return;
    rowsSignature = nextRows;
    const rows = (items: ArtifactSummary[]): ListItem[] => items.map(item => ({
      id: item.id, title: item.title,
      subtitle: [KINDS[item.kind], scope === 'project' ? '' : item.projectName,
        `${item.versions} ${item.versions === 1 ? 'version' : 'versions'}`,
        item.feedbackCount ? `${item.feedbackCount} responses` : ''].filter(Boolean).join(', '),
      meta: relativeDate(item.updatedAt),
      ...(item.id === newId ? { badge: { label: 'New', tone: 'info' } } : {}),
    }));
    favorites.update({ items: rows(favoriteItems), selectedId });
    list.update({ items: rows(otherItems), selectedId });
    dispose(gridHandles);
    gridRoot.replaceChildren();
    if (!useGrid) return;
    for (const item of visible) {
      const card = element('article', gridRoot, scope === 'trash' ? 'canvas-trash-row' : 'canvas-card');
      card.setAttribute('aria-label', item.title);
      card.dataset.selected = String(item.id === selectedId);
      if (scope !== 'trash') {
        card.dataset.clickable = 'true';
        card.addEventListener('click', event => {
          if (event.target instanceof Element && event.target.closest('button') !== null) return;
          selectArtifact(item.id);
        });
      }
      const content = element('div', card, 'canvas-card-content');
      element('h2', content, 'canvas-item-title', item.title).dir = 'auto';
      element('p', content, 'canvas-muted', `${KINDS[item.kind]}, ${item.versions} ${item.versions === 1 ? 'version' : 'versions'}, ${relativeDate(item.updatedAt)}`);
      if (scope !== 'project') element('p', content, 'canvas-muted', item.projectName);
      if (item.favorite || item.id === newId) gridHandles.push(mountBadge(content, {
        label: item.id === newId ? 'New' : 'Favorite', tone: item.id === newId ? 'info' : 'neutral',
      }));
      if (scope === 'trash') action(card, gridHandles, 'Restore', async () => {
        await request(`/untrash/${encodeURIComponent(item.id)}`, {}); await refresh();
      }, 'outline');
      else gridHandles.push(mountButton(card, { label: 'Inspect', variant: 'outline', size: 'sm', onClick: () => selectArtifact(item.id) }));
      card.querySelector<HTMLButtonElement>('.oc-sdk-btn')?.setAttribute('aria-label',
        scope === 'trash' ? `Restore ${item.title}` : `Inspect ${item.title}`);
    }
  }
  return { node, search, update,
    focusSearch: () => searchRoot.querySelector('input')?.focus(),
    focusList: () => node.querySelector<HTMLElement>('[role="listbox"]')?.focus(),
    dispose: () => {
      scroll.removeEventListener('click', onRowClick);
      scroll.removeEventListener('dblclick', onRowDoubleClick);
      dispose(gridHandles);
      dispose(handles);
      node.remove();
    },
  };
}

function mountInspector(parent: Element, id: string) {
  const handles: Disposable[] = [];
  const versionHandles: Disposable[] = [];
  const node = element('section', parent, 'canvas-inspector');
  node.setAttribute('aria-label', 'Artifact inspector');
  const toolbar = element('div', node, 'canvas-toolbar');
  const backRoot = element('div', toolbar, 'canvas-back');
  handles.push(mountButtonWithIcon(backRoot, { label: 'Back', variant: 'ghost', size: 'sm', onClick: backToLibrary }, 'chevron-left'));
  const titleRow = element('div', node, 'canvas-title-row');
  const title = element('h1', titleRow, 'canvas-title');
  title.tabIndex = -1;
  title.dir = 'auto';
  const titleActions = element('div', titleRow, 'canvas-title-actions');
  const menu = iconMenu(titleActions, { label: 'Actions', variant: 'ghost', size: 'sm', items: [], onSelect: value => {
    const meta = detail;
    if (meta === null || meta.id !== id) return;
    if (value === 'delete') confirmDelete(meta);
    else void run(async () => {
      if (value === 'favorite') {
        await request(`/favorite/${encodeURIComponent(id)}`, { favorite: !meta.favorite });
        await loadDetail(id, false); await refresh();
      } else if (value === 'archive') await archiveArtifact(meta);
      else if (value === 'attach') await attachArtifact(meta);
      else if (value === 'copy-id') await copy(id, 'Artifact ID');
    });
  } });
  const subtitle = element('p', node, 'canvas-muted');
  const errorRoot = element('div', node);
  const error = mountBanner(errorRoot, { tone: 'error', title: 'Could not load artifact', action: {
    label: 'Retry', onClick: () => { void loadDetail(id, false); },
  } });
  const spinnerRoot = element('div', node, 'canvas-state');
  const spinner = mountSpinner(spinnerRoot, { label: 'Loading artifact' });
  const content = element('div', node, 'canvas-detail-content');
  const overview = element('section', content, 'canvas-section canvas-overview');
  const actions = element('div', overview, 'canvas-actions');
  action(actions, handles, remote ? 'Copy URL' : 'Open', async () => {
    if (remote) await copyUrl(id); else await openArtifact(id);
  }, 'default', 'default', 'arrow-up-right');
  if (!remote) action(actions, handles, 'Copy URL', () => copyUrl(id), 'outline', 'sm', 'copy');
  action(actions, handles, 'Export', async () => { if (detail?.id === id) await exportArtifact(detail); }, 'outline', 'sm', 'download');
  const metadata = element('div', overview, 'canvas-meta canvas-muted');
  const tagRow = element('div', overview, 'canvas-tags');
  let tagHandles: Disposable[] = [];
  let tagSignature = '';
  const versions = element('section', content, 'canvas-section');
  const versionHeading = sectionHeading(versions, 'history', 'Versions');
  const versionRows = element('div', versions, 'canvas-version-rows');
  let versionsSignature = '';
  const technical = element('section', content, 'canvas-section');
  const technicalToggle = mountButtonWithIcon(technical, { label: 'Show details', variant: 'ghost', size: 'xs', onClick: () => {
    technicalText.hidden = !technicalText.hidden;
    technicalToggle.update({ label: technicalText.hidden ? 'Show details' : 'Hide details' });
  } }, 'code');
  const technicalText = element('dl', technical, 'canvas-details');
  technicalText.hidden = true;
  const instructions = element('section', content, 'canvas-section');
  instructions.append(sectionHeading(instructions, 'message', 'Ask the agent'));
  const instruction = element('div', instructions, 'canvas-instruction');
  const field = mountTextField(instruction, { label: 'What should change?', value: draft,
    placeholder: 'Describe the change', helper: 'Adds a draft to chat. It does not send it.', multiline: true, rows: 2,
    onChange: value => { draft = value; field.update({ value }); add.update({ disabled: !value.trim() }); },
  });
  const add = action(instruction, handles, 'Add to chat', async () => {
    const currentDraft = draft.trim();
    if (!currentDraft || detail?.id !== id) return;
    await host.compose({ text: `Canvas artifact ${id} ("${detail.title}"). ${currentDraft}\n\nRead it with canvas_read first, then update it with canvas_update and the current baseVersion.`, mode: 'append' });
    if (selectedId === id && draft.trim() === currentDraft) {
      draft = ''; field.update({ value: '' }); add.update({ disabled: true });
    }
    await host.toast({ kind: 'info', message: 'Instruction added to the composer. Review it before sending.' });
  }, 'outline', 'sm', 'message');
  add.update({ disabled: !draft.trim() });
  handles.push(error, spinner, menu, field, technicalToggle);

  function update(): void {
    const meta = detail?.id === id ? detail : null;
    spinnerRoot.hidden = meta !== null || detailError !== null;
    errorRoot.hidden = detailError === null;
    error.update({ body: detailError ?? undefined });
    content.hidden = meta === null;
    title.textContent = meta?.title ?? 'Artifact';
    subtitle.textContent = meta ? `${meta.projectName}, updated ${date(meta.updatedAt)}` : '';
    if (!meta) return;
    const summary = artifacts.find(item => item.id === id);
    metadata.replaceChildren();
    metaItem(metadata, 'file-text', KINDS[meta.kind]);
    metaItem(metadata, 'message', `${summary?.feedbackCount ?? 0} responses`);
    if (meta.favorite) metaItem(metadata, 'star', 'Favorite');
    const items: MenuItem[] = [
      { id: 'favorite', label: meta.favorite ? 'Remove from favorites' : 'Add to favorites' },
      { id: 'attach', label: 'Attach to chat' }, { id: 'copy-id', label: 'Copy artifact ID' },
      { separator: true }, { id: 'archive', label: meta.archivedAt === null ? 'Archive' : 'Unarchive' },
      { id: 'delete', label: 'Move to trash', destructive: true },
    ];
    menu.update({ items });
    const nextTags = JSON.stringify([meta.tags]);
    if (nextTags !== tagSignature) {
      tagSignature = nextTags;
      dispose(tagHandles); tagRow.replaceChildren();
      for (const label of meta.tags) tagHandles.push(mountBadge(tagRow, { label }));
    }
    const nextVersions = JSON.stringify([meta.versions, meta.currentVersion, locale]);
    if (nextVersions !== versionsSignature) {
      versionsSignature = nextVersions;
      const count = versionHeading.querySelector('.canvas-section-meta');
      if (count instanceof HTMLElement) count.textContent = `${meta.versions.length}`;
      else versionHeading.append(element('span', versionHeading, 'canvas-section-meta', `${meta.versions.length}`));
      dispose(versionHandles); versionRows.replaceChildren();
      for (let index = meta.versions.length - 1; index >= 0; index--) {
        const version = meta.versions[index];
        if (!version) continue;
        const row = element('div', versionRows, 'canvas-version');
        row.dataset.version = version.id;
        const info = element('div', row, 'canvas-version-info');
        const heading = element('div', info, 'canvas-version-heading');
        element('span', heading, '', `v${index + 1}`);
        if (version.id === meta.currentVersion) versionHandles.push(mountBadge(heading, { label: 'Current' }));
        element('p', info, 'canvas-muted', date(version.createdAt));
        element('p', info, 'canvas-muted', `${version.files} ${version.files === 1 ? 'file' : 'files'}, ${bytes(version.bytes)}`);
        if (version.restoredFrom) {
          const restored = meta.versions.findIndex(item => item.id === version.restoredFrom);
          element('p', info, 'canvas-muted', restored < 0 ? 'Restored version' : `Restored from v${restored + 1}`);
        }
        if (version.id !== meta.currentVersion) {
          const actions = element('div', row, 'canvas-version-actions');
          if (!remote) action(actions, versionHandles, `Open v${index + 1}`, () => openArtifact(id, version.id), 'ghost', 'xs', 'arrow-up-right');
          action(actions, versionHandles, `Restore v${index + 1}`, () => restoreVersion(meta, version.id), 'outline', 'xs', 'refresh');
        }
      }
    }
    const values = [
      ['Artifact ID', meta.id], ['Session', meta.sessionId ?? 'None'],
      ['Libraries', meta.libraries.join(', ') || 'None'], ['Created', date(meta.createdAt)],
    ];
    technicalText.replaceChildren();
    for (const [label, value] of values) {
      element('dt', technicalText, 'canvas-muted', label);
      element('dd', technicalText, '', value);
    }
  }
  return { id, node, update, dispose: () => { dispose(tagHandles); dispose(versionHandles); dispose(handles); node.remove(); } };
}

function mountSetup(parent: Element) {
  const handles: Disposable[] = [];
  const node = element('section', parent, 'canvas-setup');
  node.setAttribute('aria-label', 'Canvas setup');
  const toolbar = element('div', node, 'canvas-toolbar');
  handles.push(mountButtonWithIcon(element('div', toolbar, 'canvas-back'), { label: 'Back to gallery', variant: 'ghost', size: 'sm', onClick: () => setSetup(false) }, 'chevron-left'));
  const recheck = action(toolbar, handles, 'Check again', load, 'outline', 'sm', 'refresh');
  const intro = element('header', node, 'canvas-setup-intro');
  element('h1', intro, 'canvas-title', 'Set up Canvas');
  element('p', intro, 'canvas-muted', 'The gallery works without the MCP server. Connect it to let the agent publish and update artifacts.');
  const errorRoot = element('div', node);
  errorRoot.hidden = true;
  const error = mountBanner(errorRoot, { tone: 'error', title: 'Could not check setup' });
  const extension = element('section', node, 'canvas-setup-section');
  const extensionRow = element('header', extension, 'canvas-section-heading');
  extensionRow.append(svgIcon('server', 'canvas-section-icon'));
  element('h2', extensionRow, '', 'Extension service');
  const extensionBadge = mountBadge(extensionRow, { label: 'Checking' });
  const store = element('p', extension, 'canvas-muted');
  const mcp = element('section', node, 'canvas-setup-section');
  const mcpRow = element('header', mcp, 'canvas-section-heading');
  mcpRow.append(svgIcon('terminal', 'canvas-section-icon'));
  element('h2', mcpRow, '', 'MCP server');
  const mcpBadge = mountBadge(mcpRow, { label: 'Checking' });
  const mcpNotice = mountBanner(mcp, { tone: 'info', title: 'Checking the MCP heartbeat' });
  element('p', mcp, 'canvas-muted', 'The extension cannot register an MCP server. Run this once on the OpenChamber server, or paste the JSON in Settings → MCP.');
  const command = element('pre', mcp, 'canvas-code canvas-command');
  const config = element('pre', mcp, 'canvas-code');
  config.hidden = true;
  let mcpPath = '';
  let mcpConfig = '';
  let mcpCommand = '';
  const configActions = element('div', mcp, 'canvas-actions');
  const copyCommand = action(configActions, handles, 'Copy command', () => copy(mcpCommand, 'MCP command'), 'default', 'sm', 'copy');
  const copyConfig = action(configActions, handles, 'Copy MCP config', () => copy(mcpConfig, 'MCP config'), 'outline', 'sm', 'copy');
  const copyPath = action(configActions, handles, 'Copy path', () => copy(mcpPath, 'MCP path'), 'ghost', 'sm', 'copy');
  const showConfig = mountButtonWithIcon(configActions, { label: 'Show JSON', variant: 'ghost', size: 'sm', onClick: () => {
    config.hidden = !config.hidden;
    showConfig.update({ label: config.hidden ? 'Show JSON' : 'Hide JSON' });
  } }, 'code');
  const agent = element('section', node, 'canvas-setup-section');
  sectionHeading(agent, 'message', 'Try Canvas');
  element('p', agent, 'canvas-muted', 'Publish a small test chart from the chat after the MCP server is connected.');
  const sample = action(agent, handles, 'Add sample prompt to chat', () => askAgent(SAMPLE_PROMPT), 'outline', 'sm', 'message');
  handles.push(error, extensionBadge, mcpBadge, mcpNotice, showConfig);
  copyCommand.update({ disabled: true }); copyConfig.update({ disabled: true }); copyPath.update({ disabled: true }); sample.update({ disabled: true });

  async function load(): Promise<void> {
    const owner = ++setupRequest;
    recheck.update({ loading: true });
    errorRoot.hidden = true;
    try {
      const [status, health, heartbeat] = await Promise.all([
        host.serviceStatus(), request<Health>('/health'), request<Heartbeat | null>('/mcp-status'),
      ]);
      let registration: McpRegistration | null = null;
      try {
        registration = await request<McpRegistration>('/mcp-registration');
      } catch {
        registration = null; // Older service without the endpoint.
      }
      if (owner !== setupRequest) return;
      extensionBadge.update({ label: status.status === 'ready' ? 'Running' : status.status, tone: status.status === 'ready' ? 'success' : 'warning' });
      store.textContent = `Store: ${health.store}`;
      const seen = heartbeat ? Date.parse(heartbeat.seenAt) : NaN;
      const live = Number.isFinite(seen) && Date.now() - seen < 180_000;
      const reg = registration !== null && registration.checked ? registration : null;
      if (reg !== null && reg.name === null && !reg.registered) {
        mcpBadge.update({ label: 'Not installed', tone: 'warning' });
        mcpNotice.update({ tone: 'warning', title: 'Canvas MCP is not registered',
          body: 'Add Canvas in Settings → MCP with the path below. The server starts on the first agent request.' });
      } else if (reg !== null && reg.disabled) {
        mcpBadge.update({ label: 'Disabled', tone: 'warning' });
        mcpNotice.update({ tone: 'warning', title: 'Canvas MCP is disabled',
          body: `Enable Canvas in Settings → MCP${reg.source ? ` (currently registered in ${reg.source})` : ''}.` });
      } else if (reg !== null && !reg.registered) {
        mcpBadge.update({ label: 'Old command', tone: 'warning' });
        mcpNotice.update({ tone: 'warning', title: 'Canvas MCP points at an old command',
          body: `The registered command no longer matches this install. Re-add Canvas in Settings → MCP with the path below.${reg.source ? ` Currently registered in ${reg.source}.` : ''}` });
      } else if (reg !== null && reg.registered && !live) {
        mcpBadge.update({ label: 'Waiting on agent', tone: 'warning' });
        mcpNotice.update({ tone: 'warning', title: 'Registered — waiting for the first agent request',
          body: `Canvas runs only while an agent request needs it. Open a chat and ask for an artifact.${reg.source ? ` Registered in ${reg.source}.` : ''}` });
      } else if (live && heartbeat) {
        mcpBadge.update({ label: 'Connected', tone: 'success' });
        mcpNotice.update({ tone: 'success', title: 'Heartbeat received', body: `Last seen ${date(heartbeat.seenAt)}.` });
      } else {
        mcpBadge.update({ label: 'Not seen recently', tone: 'warning' });
        mcpNotice.update({ tone: 'warning', title: 'No recent heartbeat',
          body: 'Check the local server in Settings → MCP. An idle server may need an agent request to start.' });
      }
      mcpPath = health.mcpPath ?? '';
      mcpCommand = mcpPath ? `opencode mcp add canvas --global -- node ${shellArg(mcpPath)}` : '';
      if (mcpCommand) renderShellCommand(command, mcpCommand, mcpPath);
      else command.textContent = 'Restart the extension service to obtain its exact MCP path.';
      mcpConfig = JSON.stringify({ mcp: { servers: { canvas: { type: 'local', command: ['node', mcpPath] } } } }, null, 2);
      config.textContent = mcpConfig;
      copyCommand.update({ disabled: !mcpPath }); copyConfig.update({ disabled: !mcpPath }); copyPath.update({ disabled: !mcpPath });
      sample.update({ disabled: !live });
    } catch (caught) {
      if (owner !== setupRequest) return;
      errorRoot.hidden = false;
      error.update({ body: message(caught) });
      extensionBadge.update({ label: 'Unavailable', tone: 'error' });
      mcpBadge.update({ label: 'Unknown', tone: 'neutral' });
    } finally { if (owner === setupRequest) recheck.update({ loading: false }); }
  }
  return { node, load, dispose: () => { setupRequest++; dispose(handles); node.remove(); } };
}

function setSetup(next: boolean): void {
  if (!app) return;
  showSetup = next;
  closeDialog();
  if (next && !setupView) setupView = mountSetup(app.root);
  if (setupView) setupView.node.hidden = !next;
  app.workspace.hidden = next;
  app.notices.hidden = next;
  if (next) void setupView?.load();
  else app.library.focusList();
}

function mountApp(root: HTMLElement) {
  const handles: Disposable[] = [];
  const notices = element('div', root, 'canvas-notices');
  const errorRoot = element('div', notices);
  const error = mountBanner(errorRoot, { tone: 'error', title: 'Could not load artifacts', action: { label: 'Retry', onClick: () => { void refresh(); } } });
  const remoteRoot = element('div', notices);
  remoteRoot.hidden = !remote;
  const remoteNotice = mountBanner(remoteRoot, { tone: 'warning', title: 'Remote instance', body: 'Use Copy URL or Export. This browser cannot open the server’s loopback address.' });
  const mcpCtaRoot = element('div', notices);
  mcpCtaRoot.hidden = true;
  const mcpCta = mountBanner(mcpCtaRoot, { tone: 'warning', title: 'Install the Canvas MCP tools', body: mcpCtaState()?.body ?? '', action: { label: 'Open setup', onClick: () => setSetup(true) } });
  const workspace = element('div', root, 'canvas-workspace');
  const library = mountLibrary(workspace);
  const inspectorSlot = element('div', workspace, 'canvas-inspector-slot');
  const placeholderRoot = element('div', inspectorSlot, 'canvas-placeholder');
  const placeholder = mountEmpty(placeholderRoot, { title: 'Select an artifact', body: 'Inspect its versions or ask the agent for a change.' });
  handles.push(error, remoteNotice, mcpCta, placeholder);
  return { root, notices, workspace, library, inspectorSlot, placeholderRoot, errorRoot, error, mcpCtaRoot, mcpCta,
    dispose: () => { library.dispose(); dispose(handles); root.replaceChildren(); },
  };
}

function paint(): void {
  if (!app) return;
  app.errorRoot.hidden = listError === null;
  app.error.update({ body: listError ?? undefined });
  const cta = mcpCtaState();
  app.mcpCtaRoot.hidden = cta === null;
  if (cta !== null) app.mcpCta.update(cta);
  app.workspace.dataset.selected = String(selectedId !== null);
  app.workspace.dataset.empty = String(artifacts.length === 0 && selectedId === null);
  app.library.update();
  app.placeholderRoot.hidden = selectedId !== null;
  if (selectedId !== null && inspector?.id !== selectedId) {
    inspector?.dispose();
    inspector = mountInspector(app.inspectorSlot, selectedId);
  }
  inspector?.update();
}

function setDirectory(next: string | null): void {
  if (directory === next) return;
  directory = next;
  if (directory === null && scope === 'project') scope = 'all';
  artifacts = [];
  knownIds = null;
  newId = null;
  loading = true;
  tag = '';
  listError = null;
  clearSelection();
  paint();
  void refresh();
}

host.onReady(context => {
  applyHostReady(context, document.documentElement);
  const surfaceChanged = surface !== context.surface;
  const localeChanged = locale !== context.locale;
  surface = context.surface;
  locale = context.locale;
  document.body.dataset.surface = surface;
  if (app) {
    if (surfaceChanged || localeChanged) paint();
    setDirectory(context.directory);
    return;
  }
  const root = document.querySelector<HTMLElement>('#root');
  if (root === null) throw new Error('Canvas root is missing');
  directory = context.directory;
  if (directory === null) scope = 'all';
  app = mountApp(root);
  paint();
  void loadPreferences();
  void refresh();
});
host.onDirectory(setDirectory);

const poll = window.setInterval(() => {
  if (app && !refreshing && !showSetup && document.visibilityState === 'visible') void refresh();
}, 3000);

document.addEventListener('keydown', event => {
  if (event.defaultPrevented || dialog?.open || document.querySelector('.oc-sdk-popup')) return;
  if (event.key === 'Escape' && selectedId !== null && !showSetup &&
      !(surface === 'page' && matchMedia('(min-width: 760px)').matches)) { backToLibrary(); return; }
  const target = event.target;
  if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey ||
      (target instanceof HTMLElement && (target.matches('input,textarea,select') || target.isContentEditable))) return;
  event.preventDefault();
  if (showSetup) setSetup(false);
  if (selectedId !== null && !(surface === 'page' && matchMedia('(min-width: 760px)').matches)) backToLibrary();
  app?.library.focusSearch();
});

window.addEventListener('pagehide', () => {
  clearInterval(poll);
  closeDialog();
  inspector?.dispose();
  setupView?.dispose();
  app?.dispose();
  host.dispose();
});
