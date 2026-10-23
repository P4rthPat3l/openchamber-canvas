import { connectHost } from '@openchamber/sdk';
import { applyHostReady } from '@openchamber/sdk/ui';

type ArtifactKind = 'html' | 'bundle' | 'markdown' | 'image' | 'pdf' | 'data';
type Scope = 'project' | 'all' | 'archived' | 'trash';
type ViewMode = 'list' | 'grid';
type SortMode = 'updated' | 'title';

interface ArtifactSummary {
  id: string;
  title: string;
  kind: ArtifactKind;
  directory: string;
  projectName: string;
  updatedAt: string;
  versions: number;
  currentVersion: string;
  tags: string[];
  favorite: boolean;
  archived: boolean;
  feedbackCount: number;
}

interface VersionSummary {
  id: string;
  createdAt: string;
  bytes: number;
  files: number;
  title: string;
  restoredFrom: string | null;
}

interface ArtifactMeta {
  schema: 2;
  id: string;
  title: string;
  kind: ArtifactKind;
  directory: string;
  projectName: string;
  sessionId: string | null;
  tags: string[];
  favorite: boolean;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
  currentVersion: string;
  pinnedVersion: string | null;
  librarySet: string;
  libraries: string[];
  versions: VersionSummary[];
  live: unknown[];
  openCount: number;
  lastOpenedAt: string | null;
  dedupeKey: string | null;
}

interface ListResponse {
  artifacts: ArtifactSummary[];
  errors: number;
}

interface ViewUrlResponse {
  url: string;
  expiresAt: number;
}

interface ExportResponse {
  path: string;
  format: 'html' | 'zip';
  bytes: number;
}

interface ServiceHealth {
  ok: boolean;
  pid: number;
  uptime: number;
  store: string;
  version: string;
  mcpPath?: string;
}

interface SetupState {
  service: string | null;
  health: ServiceHealth | null;
  mcp: Record<string, unknown> | null;
  error: string | null;
  loading: boolean;
}

interface Shell {
  body: HTMLElement;
  titleMeta: HTMLElement;
  plus: HTMLButtonElement;
  searchWrap: HTMLElement;
  search: HTMLInputElement;
  searchClear: HTMLButtonElement;
  filters: HTMLElement;
  scope: HTMLSelectElement;
  projectOption: HTMLOptionElement;
  tag: HTMLSelectElement;
  tagWrap: HTMLElement;
  viewToggle: HTMLButtonElement;
  menu: HTMLDetailsElement;
  menuMain: HTMLElement;
  setupLabel: HTMLElement;
  sortUpdated: HTMLButtonElement;
  sortTitle: HTMLButtonElement;
}

type IconName =
  | 'search'
  | 'plus'
  | 'more'
  | 'grid'
  | 'list'
  | 'star'
  | 'star-filled'
  | 'external'
  | 'copy'
  | 'download'
  | 'message'
  | 'chevron-left'
  | 'chevron-right'
  | 'chevron-down'
  | 'settings'
  | 'refresh'
  | 'check'
  | 'alert'
  | 'trash'
  | 'archive'
  | 'paperclip'
  | 'send'
  | 'terminal'
  | 'box'
  | 'file'
  | 'image'
  | 'table'
  | 'chart'
  | 'frame'
  | 'x';

const KIND_LABELS: Record<ArtifactKind, string> = {
  html: 'HTML',
  bundle: 'Bundle',
  markdown: 'Markdown',
  image: 'Image',
  pdf: 'PDF',
  data: 'Data',
};

const KIND_ICONS: Record<ArtifactKind, IconName> = {
  html: 'frame',
  bundle: 'box',
  markdown: 'file',
  image: 'image',
  pdf: 'file',
  data: 'table',
};

const ICONS: Record<IconName, string> = {
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.2-3.2"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  more: '<circle cx="5" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1.4" fill="currentColor" stroke="none"/>',
  grid: '<rect x="4" y="4" width="6" height="6" rx="1.2"/><rect x="14" y="4" width="6" height="6" rx="1.2"/><rect x="4" y="14" width="6" height="6" rx="1.2"/><rect x="14" y="14" width="6" height="6" rx="1.2"/>',
  list: '<path d="M9 6h11M9 12h11M9 18h11"/><path d="M4 6h.01M4 12h.01M4 18h.01"/>',
  star: '<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3 6.4 20.2l1.1-6.2L3 9.6l6.2-.9Z"/>',
  'star-filled':
    '<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3 6.4 20.2l1.1-6.2L3 9.6l6.2-.9Z" fill="currentColor" stroke="none"/>',
  external:
    '<path d="M14 4h6v6"/><path d="M20 4 11 13"/><path d="M20 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h4"/>',
  copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  download: '<path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/>',
  message:
    '<path d="M20 11.5a7.5 7.5 0 0 1-7.5 7.5H5l-2 2V11.5A7.5 7.5 0 0 1 10.5 4h2A7.5 7.5 0 0 1 20 11.5Z"/>',
  'chevron-left': '<path d="m15 18-6-6 6-6"/>',
  'chevron-right': '<path d="m9 18 6-6-6-6"/>',
  'chevron-down': '<path d="m6 9 6 6 6-6"/>',
  settings:
    '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"/>',
  refresh:
    '<path d="M20 11a8 8 0 0 0-14.3-4.9L4 8"/><path d="M4 4v4h4"/><path d="M4 13a8 8 0 0 0 14.3 4.9L20 16"/><path d="M20 20v-4h-4"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  alert: '<circle cx="12" cy="12" r="9"/><path d="M12 8v5"/><path d="M12 16h.01"/>',
  trash:
    '<path d="M4 7h16"/><path d="M10 11v6M14 11v6"/><path d="M6 7l1 13h10l1-13"/><path d="M9 7V4h6v3"/>',
  archive:
    '<rect x="3" y="4" width="18" height="4" rx="1"/><path d="M5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8"/><path d="M10 12h4"/>',
  paperclip:
    '<path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 1 1 5.66 5.66l-9.2 9.19a2 2 0 1 1-2.83-2.83l8.49-8.48"/>',
  send: '<path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/>',
  terminal: '<path d="m4 17 6-6-6-6"/><path d="M12 19h8"/>',
  box: '<path d="m21 8-9-5-9 5 9 5 9-5Z"/><path d="M3 8v8l9 5 9-5V8"/><path d="M12 13v8"/>',
  file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6"/><path d="M8 13h8M8 17h6"/>',
  image:
    '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/>',
  table: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 3v18"/>',
  chart: '<path d="M4 19V5"/><path d="M4 19h16"/><path d="m7 15 4-4 3 3 5-6"/>',
  frame:
    '<rect x="3" y="3" width="18" height="18" rx="4"/><path d="M8 16v-4M12 16V8M16 16v-6"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
};

const EMPTY_PROMPT =
  'Create a Canvas artifact for this project: a chart, dashboard, report, or interface mockup that answers a question. Use the Canvas tools to publish it, then open the result.';
const SAMPLE_PROMPT =
  'Publish a small Canvas test artifact: a one-page chart with three sample values and a short title. Use canvas_publish with the chartjs library, then open it.';

const host = connectHost();
const root = document.querySelector<HTMLDivElement>('#root');
if (root === null) {
  throw new Error('Canvas root is missing');
}

let directory: string | null = null;
let remote = false;
let artifacts: ArtifactSummary[] = [];
let selectedId: string | null = null;
let detail: ArtifactMeta | null = null;
let scope: Scope = 'project';
let view: ViewMode = 'list';
let query = '';
let tag = '';
let sort: SortMode = 'updated';
let showSetup = false;
let loading = true;
let refreshing = false;
let error: string | null = null;
let confirmTrash = false;
let refine = '';
let setup: SetupState = { service: null, health: null, mcp: null, error: null, loading: false };
let shell: Shell | null = null;
let mounted = false;
let knownIds = new Set<string>();
let newId: string | null = null;
let lastDetailId: string | null = null;
let detailSignature = '';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function errorMessage(value: unknown): string {
  return value instanceof Error ? value.message : String(value);
}

function isLoopbackHost(hostname: string): boolean {
  return (
    hostname === '127.0.0.1' ||
    hostname === 'localhost' ||
    hostname === '::1' ||
    hostname === '[::1]'
  );
}

function isWideLayout(): boolean {
  return (
    document.body.dataset.surface === 'page' &&
    window.matchMedia('(min-width: 760px)').matches
  );
}

function loadPreferences(): void {
  try {
    const savedView = localStorage.getItem('canvas.view');
    if (savedView === 'grid' || savedView === 'list') view = savedView;
    const savedSort = localStorage.getItem('canvas.sort');
    if (savedSort === 'title' || savedSort === 'updated') sort = savedSort;
  } catch {
    // Preferences are optional.
  }
}

function savePreferences(): void {
  try {
    localStorage.setItem('canvas.view', view);
    localStorage.setItem('canvas.sort', sort);
  } catch {
    // Preferences are optional.
  }
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className !== undefined && className.length > 0) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

function svgIcon(name: IconName, className = ''): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.8');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.setAttribute('class', className.length > 0 ? `cv-svg ${className}` : 'cv-svg');
  svg.innerHTML = ICONS[name];
  return svg;
}

function actionButton(
  label: string,
  className: string,
  onClick: () => void | Promise<void>,
): HTMLButtonElement {
  const node = el('button', className, label);
  node.type = 'button';
  node.addEventListener('click', () => {
    void onClick();
  });
  return node;
}

function iconButton(
  icon: IconName,
  label: string,
  onClick: () => void | Promise<void>,
  className = 'cv-icon-btn',
): HTMLButtonElement {
  const node = el('button', className);
  node.type = 'button';
  node.setAttribute('aria-label', label);
  node.title = label;
  node.append(svgIcon(icon));
  node.addEventListener('click', () => {
    void onClick();
  });
  return node;
}

function kindLabel(kind: ArtifactKind): string {
  return KIND_LABELS[kind];
}

function kindIcon(kind: ArtifactKind): IconName {
  return KIND_ICONS[kind];
}

function relativeDate(iso: string): string {
  const time = Date.parse(iso);
  if (Number.isNaN(time)) return '';
  const difference = Date.now() - time;
  const minute = 60_000;
  if (difference < minute) return 'now';
  if (difference < 60 * minute) return `${Math.floor(difference / minute)}m`;
  if (difference < 24 * 60 * minute) return `${Math.floor(difference / (60 * minute))}h`;
  if (difference < 7 * 24 * 60 * minute) {
    return `${Math.floor(difference / (24 * 60 * minute))}d`;
  }
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(
    new Date(time),
  );
}

function formatDate(iso: string): string {
  const time = Date.parse(iso);
  if (Number.isNaN(time)) return iso;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(time));
}

function formatShortDate(iso: string): string {
  const time = Date.parse(iso);
  if (Number.isNaN(time)) return iso;
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(time));
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

function projectName(): string | null {
  if (artifacts.length > 0) return artifacts[0]?.projectName ?? null;
  if (directory === null) return null;
  const parts = directory.split('/').filter((part) => part.length > 0);
  return parts.at(-1) ?? null;
}

function countLabel(): string {
  const count = artifacts.length;
  if (loading && count === 0) return 'Reading artifacts';
  if (error !== null && count === 0) return 'Canvas service unavailable';
  if (showSetup) return 'Set up the agent connection';
  const noun = count === 1 ? 'artifact' : 'artifacts';
  if (scope === 'trash') {
    return count === 0 ? 'Trash is empty' : `${count} deleted ${noun}`;
  }
  if (scope === 'archived') {
    return count === 0 ? 'No archived artifacts' : `${count} archived ${noun}`;
  }
  if (scope === 'all') {
    return count === 0 ? 'No artifacts across projects' : `${count} ${noun} across projects`;
  }
  const project = projectName();
  if (count === 0) return project === null ? 'No artifacts yet' : `No artifacts in ${project}`;
  return project === null ? `${count} ${noun}` : `${count} ${noun} in ${project}`;
}

function closeMenus(): void {
  for (const menu of document.querySelectorAll<HTMLDetailsElement>('details.cv-menu[open]')) {
    menu.open = false;
  }
}

async function request<T>(
  path: string,
  method: 'GET' | 'POST' = 'GET',
  body?: unknown,
): Promise<T> {
  const payload = body === undefined ? undefined : JSON.stringify(body);
  const response = await host.serviceRequest({
    method,
    path,
    ...(payload === undefined ? {} : { body: payload }),
  });
  let parsed: unknown = null;
  if (response.body.length > 0) {
    try {
      parsed = JSON.parse(response.body);
    } catch {
      parsed = null;
    }
  }
  if (response.status >= 400) {
    const message =
      isRecord(parsed) && isRecord(parsed.error) && typeof parsed.error.message === 'string'
        ? parsed.error.message
        : `Canvas service error (${response.status})`;
    throw new Error(message);
  }
  return parsed as T;
}

async function runAction(work: () => Promise<void>): Promise<void> {
  try {
    await work();
  } catch (caught) {
    await host.toast({ kind: 'error', message: errorMessage(caught) });
  }
}

function filteredArtifacts(): ArtifactSummary[] {
  const needle = query.trim().toLowerCase();
  const tagFilter = tag.toLowerCase();
  const visible = artifacts.filter((artifact) => {
    if (tagFilter !== '' && !artifact.tags.some((value) => value.toLowerCase() === tagFilter)) {
      return false;
    }
    if (needle === '') return true;
    return (
      artifact.title.toLowerCase().includes(needle) ||
      artifact.projectName.toLowerCase().includes(needle) ||
      artifact.tags.some((value) => value.toLowerCase().includes(needle))
    );
  });
  visible.sort((left, right) =>
    sort === 'title'
      ? left.title.localeCompare(right.title)
      : right.updatedAt.localeCompare(left.updatedAt),
  );
  return visible;
}

async function updateBadge(): Promise<void> {
  if (scope === 'trash') return;
  try {
    const total = artifacts.reduce((sum, artifact) => sum + artifact.feedbackCount, 0);
    await host.setBadge(total > 0 ? Math.min(total, 999) : null);
  } catch {
    // A badge failure must not block the gallery.
  }
}

async function loadDetail(id: string): Promise<void> {
  detail = await request<ArtifactMeta>(`/artifact/${encodeURIComponent(id)}`);
  detailSignature = selectedSummarySignature();
}

function selectedSummarySignature(): string {
  if (selectedId === null) return '';
  const summary = artifacts.find((artifact) => artifact.id === selectedId);
  return summary === undefined
    ? ''
    : `${summary.updatedAt}|${summary.currentVersion}|${summary.feedbackCount}`;
}

function metaLabel(meta: ArtifactMeta, versionId: string): string {
  const index = meta.versions.findIndex((version) => version.id === versionId);
  return index === -1 ? 'version' : `v${index + 1}`;
}

async function refresh(): Promise<void> {
  if (refreshing) return;
  refreshing = true;
  const hadArtifacts = artifacts.length > 0;
  if (!hadArtifacts) loading = true;
  if (!showSetup) {
    updateHeader();
    if (selectedId === null) renderBody();
    else if (isWideLayout()) renderListOnly();
  }
  let detailChanged = false;
  try {
    if (scope === 'trash') {
      const data = await request<ListResponse>('/trash');
      artifacts = data.artifacts;
    } else {
      const params = new URLSearchParams({ limit: '200' });
      if (scope === 'project' && directory !== null) params.set('directory', directory);
      if (scope === 'archived') params.set('archived', 'true');
      const data = await request<ListResponse>(`/list?${params.toString()}`);
      artifacts = data.artifacts;
    }
    const incoming = new Set(artifacts.map((artifact) => artifact.id));
    if (knownIds.size > 0 && (scope === 'project' || scope === 'all')) {
      const fresh = artifacts.find((artifact) => !knownIds.has(artifact.id));
      if (fresh !== undefined) newId = fresh.id;
    }
    knownIds = incoming;
    error = null;
    if (selectedId !== null && detail !== null && selectedSummarySignature() !== detailSignature) {
      await loadDetail(selectedId);
      detailChanged = true;
    }
    void updateBadge();
  } catch (caught) {
    error = errorMessage(caught);
  } finally {
    refreshing = false;
    loading = false;
    updateHeader();
    if (!showSetup) {
      if (error !== null && artifacts.length === 0) renderBody();
      else if (detailChanged) renderBody();
      else if (selectedId === null) renderListOnly();
      else if (isWideLayout()) renderListOnly();
    }
  }
}

async function openDetail(id: string): Promise<void> {
  selectedId = id;
  detail = null;
  refine = '';
  confirmTrash = false;
  showSetup = false;
  if (newId === id) newId = null;
  updateHeader();
  renderBody();
  try {
    await loadDetail(id);
    error = null;
  } catch (caught) {
    error = errorMessage(caught);
    selectedId = null;
    detail = null;
  }
  renderBody();
  if (detail !== null) {
    window.requestAnimationFrame(() => {
      document.querySelector<HTMLElement>('.cv-detail-title')?.focus();
    });
  }
}

function focusRow(id: string): void {
  const row = document.querySelector<HTMLElement>(`[data-id="${CSS.escape(id)}"]`);
  if (row === null) return;
  for (const item of document.querySelectorAll<HTMLElement>('button.cv-row, button.cv-card')) {
    item.tabIndex = item === row ? 0 : -1;
  }
  row.focus();
}

function closeDetail(): void {
  const previous = selectedId;
  selectedId = null;
  detail = null;
  refine = '';
  confirmTrash = false;
  detailSignature = '';
  updateHeader();
  renderBody();
  if (previous !== null) {
    window.requestAnimationFrame(() => focusRow(previous));
  }
}

function setScope(next: Scope): void {
  if (next === 'project' && directory === null) next = 'all';
  scope = next;
  selectedId = null;
  detail = null;
  detailSignature = '';
  query = '';
  tag = '';
  showSetup = false;
  knownIds = new Set();
  newId = null;
  if (shell !== null) {
    shell.search.value = '';
    shell.searchClear.hidden = true;
  }
  updateHeader();
  renderBody();
  void refresh();
}

function setSort(next: SortMode): void {
  sort = next;
  savePreferences();
  closeMenus();
  updateHeader();
  if (showSetup) return;
  if (selectedId === null || isWideLayout()) renderListOnly();
}

function ensureListVisible(): void {
  if (!isWideLayout() && selectedId !== null) {
    selectedId = null;
    detail = null;
    detailSignature = '';
    confirmTrash = false;
    updateHeader();
    renderBody();
    return;
  }
  renderListOnly();
}

function renderListOnly(): void {
  if (shell === null || showSetup) return;
  const pane = shell.body.querySelector<HTMLElement>('.cv-list-pane');
  if (pane === null) {
    renderBody();
    return;
  }
  const top = pane.scrollTop;
  const focused =
    document.activeElement instanceof HTMLElement
      ? document.activeElement.closest<HTMLElement>('[data-id]')?.dataset.id
      : undefined;
  pane.replaceChildren(renderList());
  pane.scrollTop = top;
  if (focused !== undefined) focusRow(focused);
}

function updateTagOptions(select: HTMLSelectElement): void {
  const tags = [...new Set(artifacts.flatMap((artifact) => artifact.tags))].sort((left, right) =>
    left.localeCompare(right),
  );
  if (tag !== '' && !tags.some((value) => value.toLowerCase() === tag.toLowerCase())) {
    tag = '';
  }
  select.replaceChildren();
  const all = el('option', undefined, 'All tags');
  all.value = '';
  select.append(all);
  for (const value of tags) {
    const option = el('option', undefined, value);
    option.value = value;
    select.append(option);
  }
  select.value = tag;
  select.disabled = tags.length === 0;
}

function updateHeader(): void {
  if (shell === null) return;
  shell.titleMeta.textContent = countLabel();
  shell.scope.value = scope;
  shell.projectOption.disabled = directory === null;
  const narrowDetail = selectedId !== null && !isWideLayout();
  const empty =
    artifacts.length === 0 && !loading && error === null && !showSetup;
  const unavailable =
    artifacts.length === 0 && !loading && error !== null && !showSetup;
  const hideChrome = showSetup || narrowDetail || empty || unavailable;
  shell.searchWrap.hidden = hideChrome;
  shell.filters.hidden = showSetup || narrowDetail;
  shell.tagWrap.hidden = empty || unavailable;
  shell.viewToggle.hidden = empty || unavailable;
  shell.plus.hidden = hideChrome;
  shell.menu.hidden = narrowDetail;
  shell.menuMain.hidden = showSetup;
  shell.setupLabel.textContent = showSetup ? 'Back to gallery' : 'Setup';
  shell.sortUpdated.dataset.checked = String(sort === 'updated');
  shell.sortTitle.dataset.checked = String(sort === 'title');
  const viewIcon = svgIcon(view === 'list' ? 'grid' : 'list');
  shell.viewToggle.replaceChildren(viewIcon);
  shell.viewToggle.setAttribute(
    'aria-label',
    view === 'list' ? 'Show as grid' : 'Show as list',
  );
  shell.viewToggle.title = view === 'list' ? 'Show as grid' : 'Show as list';
  updateTagOptions(shell.tag);
}

function menuButton(
  label: string,
  icon: IconName | null,
  onClick: () => void,
): HTMLButtonElement {
  const item = el('button', 'cv-menu-item');
  item.type = 'button';
  if (icon !== null) item.append(svgIcon(icon));
  item.append(el('span', undefined, label));
  item.addEventListener('click', onClick);
  return item;
}

function mountShell(): void {
  root.replaceChildren();

  const header = el('header', 'cv-header');

  const titleRow = el('div', 'cv-title-row');
  const mark = el('span', 'cv-mark');
  mark.append(svgIcon('frame'));
  const heading = el('div', 'cv-heading');
  const title = el('h1', 'cv-title', 'Canvas');
  const titleMeta = el('div', 'cv-title-meta', 'Reading artifacts');
  heading.append(title, titleMeta);

  const plus = iconButton('plus', 'Ask the agent for an artifact', askAgent);
  const menu = el('details', 'cv-menu');
  const menuSummary = el('summary', 'cv-icon-btn');
  menuSummary.setAttribute('aria-label', 'Canvas menu');
  menuSummary.title = 'Canvas menu';
  menuSummary.append(svgIcon('more'));
  const menuPop = el('div', 'cv-menu-pop');
  const menuMain = el('div');
  const refreshItem = menuButton('Refresh', 'refresh', () => {
    closeMenus();
    void refresh();
  });
  const sortUpdated = menuButton('Sort by updated', null, () => setSort('updated'));
  sortUpdated.append(svgIcon('check', 'cv-menu-check'));
  const sortTitle = menuButton('Sort by title', null, () => setSort('title'));
  sortTitle.append(svgIcon('check', 'cv-menu-check'));
  menuMain.append(
    refreshItem,
    el('div', 'cv-menu-sep'),
    sortUpdated,
    sortTitle,
    el('div', 'cv-menu-sep'),
  );
  const setupItem = el('button', 'cv-menu-item');
  setupItem.type = 'button';
  setupItem.append(svgIcon('settings'));
  const setupLabel = el('span', undefined, 'Setup');
  setupItem.append(setupLabel);
  setupItem.addEventListener('click', () => {
    closeMenus();
    showSetup = !showSetup;
    if (showSetup) void loadSetup();
    updateHeader();
    renderBody();
  });
  menuPop.append(menuMain, setupItem);
  menu.append(menuSummary, menuPop);
  menu.addEventListener('toggle', () => {
    menuSummary.setAttribute('aria-expanded', String(menu.open));
  });

  const actions = el('div', 'cv-header-actions');
  actions.append(plus, menu);
  titleRow.append(mark, heading, actions);

  const searchWrap = el('div', 'cv-search');
  const search = el('input');
  search.type = 'search';
  search.placeholder = 'Search artifacts';
  search.setAttribute('aria-label', 'Search artifacts');
  search.value = query;
  const searchClear = iconButton('x', 'Clear search', () => {
    query = '';
    search.value = '';
    searchClear.hidden = true;
    ensureListVisible();
  }, 'cv-search-clear');
  searchClear.hidden = query.length === 0;
  search.addEventListener('input', () => {
    query = search.value;
    searchClear.hidden = query.length === 0;
    ensureListVisible();
  });
  search.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || search.value.length === 0) return;
    event.stopPropagation();
    query = '';
    search.value = '';
    searchClear.hidden = true;
    ensureListVisible();
  });
  searchWrap.append(svgIcon('search'), search, searchClear);

  const filters = el('div', 'cv-filters');
  const scopeWrap = el('label', 'cv-select-wrap');
  const scopeSelect = el('select', 'cv-select');
  scopeSelect.setAttribute('aria-label', 'Artifact scope');
  const projectOption = el('option', undefined, 'This project');
  projectOption.value = 'project';
  const allOption = el('option', undefined, 'All projects');
  allOption.value = 'all';
  const archivedOption = el('option', undefined, 'Archived');
  archivedOption.value = 'archived';
  const trashOption = el('option', undefined, 'Trash');
  trashOption.value = 'trash';
  scopeSelect.append(projectOption, allOption, archivedOption, trashOption);
  scopeSelect.value = scope;
  scopeSelect.addEventListener('change', () => {
    setScope(scopeSelect.value as Scope);
  });
  scopeWrap.append(scopeSelect, svgIcon('chevron-down'));

  const tagWrap = el('label', 'cv-select-wrap');
  const tagSelect = el('select', 'cv-select');
  tagSelect.setAttribute('aria-label', 'Filter by tag');
  tagSelect.addEventListener('change', () => {
    tag = tagSelect.value;
    ensureListVisible();
  });
  tagWrap.append(tagSelect, svgIcon('chevron-down'));

  const spacer = el('span', 'cv-filter-spacer');
  const viewToggle = iconButton('grid', 'Show as grid', () => {
    view = view === 'list' ? 'grid' : 'list';
    savePreferences();
    updateHeader();
    renderListOnly();
  });
  filters.append(scopeWrap, tagWrap, spacer, viewToggle);

  header.append(titleRow, searchWrap, filters);

  const body = el('div', 'cv-body');
  root.append(header, body);

  shell = {
    body,
    titleMeta,
    plus,
    searchWrap,
    search,
    searchClear,
    filters,
    scope: scopeSelect,
    projectOption,
    tag: tagSelect,
    tagWrap,
    viewToggle,
    menu,
    menuMain,
    setupLabel,
    sortUpdated,
    sortTitle,
  };
  updateHeader();
  renderBody();
}

function artifactTile(kind: ArtifactKind): HTMLElement {
  const tile = el('span', 'cv-tile');
  tile.dataset.kind = kind;
  tile.setAttribute('aria-hidden', 'true');
  tile.append(svgIcon(kindIcon(kind)));
  return tile;
}

function rowFavorite(): HTMLElement {
  return svgIcon('star-filled', 'cv-row-favorite');
}

function rowFeedback(count: number): HTMLElement {
  const span = el('span', 'cv-row-feedback');
  span.title = `${count} ${count === 1 ? 'response' : 'responses'}`;
  span.append(svgIcon('message'), document.createTextNode(String(count)));
  return span;
}

function artifactByline(artifact: ArtifactSummary): HTMLElement {
  const meta = el('span', 'cv-row-meta');
  meta.append(el('span', undefined, kindLabel(artifact.kind)));
  if (scope !== 'project') meta.append(el('span', undefined, artifact.projectName));
  meta.append(
    el('span', undefined, `${artifact.versions} ${artifact.versions === 1 ? 'version' : 'versions'}`),
  );
  return meta;
}

function artifactRow(artifact: ArtifactSummary, trash = false): HTMLElement {
  const row = trash ? el('div', 'cv-row cv-row--static') : el('button', 'cv-row');
  row.dataset.id = artifact.id;
  if (row instanceof HTMLButtonElement) {
    row.type = 'button';
    row.tabIndex = artifact.id === selectedId ? 0 : -1;
    row.setAttribute('aria-current', String(artifact.id === selectedId));
    row.setAttribute(
      'aria-label',
      `${artifact.title}, ${kindLabel(artifact.kind)}, ${artifact.projectName}, ${artifact.versions} versions${artifact.feedbackCount > 0 ? `, ${artifact.feedbackCount} responses` : ''}${artifact.favorite ? ', favorite' : ''}`,
    );
    row.addEventListener('click', () => {
      void openDetail(artifact.id);
    });
  }

  const main = el('span', 'cv-row-main');
  const titleLine = el('span', 'cv-row-title-line');
  const title = el('span', 'cv-row-title', artifact.title);
  title.dir = 'auto';
  titleLine.append(title);
  if (artifact.id === newId) titleLine.append(el('span', 'cv-new', 'New'));
  main.append(titleLine, artifactByline(artifact));

  const side = el('span', 'cv-row-side');
  const date = el('span', undefined, relativeDate(artifact.updatedAt));
  date.title = formatDate(artifact.updatedAt);
  side.append(date);
  if (artifact.feedbackCount > 0) side.append(rowFeedback(artifact.feedbackCount));
  if (artifact.favorite) side.append(rowFavorite());
  if (trash) {
    side.append(
      actionButton('Restore', 'cv-btn cv-btn--ghost', () =>
        runAction(() => untrashArtifact(artifact.id)),
      ),
    );
  }

  row.append(artifactTile(artifact.kind), main, side);
  return row;
}

function artifactCard(artifact: ArtifactSummary): HTMLElement {
  const card = el('button', 'cv-card');
  card.type = 'button';
  card.dataset.id = artifact.id;
  card.tabIndex = artifact.id === selectedId ? 0 : -1;
  card.setAttribute('aria-current', String(artifact.id === selectedId));
  card.setAttribute(
    'aria-label',
    `${artifact.title}, ${kindLabel(artifact.kind)}, ${artifact.projectName}, ${artifact.versions} versions`,
  );
  card.addEventListener('click', () => {
    void openDetail(artifact.id);
  });
  const title = el('span', 'cv-card-title', artifact.title);
  title.dir = 'auto';
  const project = el('span', 'cv-card-project', artifact.projectName);
  project.dir = 'auto';
  const meta = el('span', 'cv-card-meta');
  meta.append(el('span', undefined, kindLabel(artifact.kind)));
  meta.append(
    el('span', undefined, `${artifact.versions} ${artifact.versions === 1 ? 'version' : 'versions'}`),
  );
  meta.append(el('span', undefined, relativeDate(artifact.updatedAt)));
  if (artifact.id === newId) meta.append(el('span', 'cv-new', 'New'));
  if (artifact.favorite) meta.append(rowFavorite());
  card.append(artifactTile(artifact.kind), title);
  if (scope !== 'project') card.append(project);
  card.append(meta);
  return card;
}

function renderGroup(label: string, items: ArtifactSummary[], grid: boolean): HTMLElement {
  const group = el('section', 'cv-group');
  const head = el('div', 'cv-group-label');
  head.append(el('span', undefined, label), el('span', 'cv-group-count', String(items.length)));
  group.append(head);
  if (grid) {
    const gridEl = el('div', 'cv-grid');
    for (const artifact of items) gridEl.append(artifactCard(artifact));
    group.append(gridEl);
  } else {
    const rows = el('div', 'cv-rows');
    for (const artifact of items) rows.append(artifactRow(artifact));
    group.append(rows);
  }
  return group;
}

function applyRoving(container: HTMLElement): void {
  const items = [...container.querySelectorAll<HTMLElement>('button.cv-row, button.cv-card')];
  if (items.length === 0) return;
  const selected = items.find((item) => item.getAttribute('aria-current') === 'true');
  const active = selected ?? items[0];
  for (const item of items) item.tabIndex = item === active ? 0 : -1;
}

function renderTrashGroup(items: ArtifactSummary[]): HTMLElement {
  const group = el('section', 'cv-group');
  const head = el('div', 'cv-group-label');
  head.append(el('span', undefined, 'Trash'), el('span', 'cv-group-count', String(items.length)));
  const rows = el('div', 'cv-rows');
  for (const artifact of items) rows.append(artifactRow(artifact, true));
  group.append(head, rows);
  return group;
}

function renderSkeleton(): HTMLElement {
  const wrap = el('div', 'cv-skeleton');
  for (let index = 0; index < 4; index += 1) {
    const row = el('div', 'cv-skeleton-row');
    const lines = el('div', 'cv-skeleton-lines');
    lines.append(el('div', 'cv-skeleton-line'), el('div', 'cv-skeleton-line'));
    row.append(el('div', 'cv-skeleton-tile'), lines);
    wrap.append(row);
  }
  return wrap;
}

function renderEmpty(): HTMLElement {
  const state = el('div', 'cv-empty');
  const hasFilters = query.trim().length > 0 || tag.length > 0;
  let copy: string;
  if (hasFilters && artifacts.length > 0) {
    copy = 'No matches. Try another search, or clear the filters to see every artifact.';
  } else if (scope === 'trash') {
    copy = 'Deleted artifacts stay here for 30 days, then they are removed.';
  } else if (scope === 'archived') {
    copy = 'Archive an artifact to hide it from the project list; it stays restorable.';
  } else {
    copy = 'Ask the agent for a chart, dashboard, or interface mockup. It can publish one here.';
  }
  state.append(el('p', undefined, copy));
  if (hasFilters && artifacts.length > 0) {
    state.append(
      actionButton('Clear filters', 'cv-btn', () => {
        clearFilters();
      }),
    );
  } else if (scope === 'project' || scope === 'all') {
    const ask = actionButton('Ask the agent', 'cv-btn', () => {
      void askAgent();
    });
    ask.prepend(svgIcon('plus'));
    state.append(ask);
  }
  return state;
}

function renderList(): HTMLElement {
  const visible = filteredArtifacts();
  if (loading && artifacts.length === 0) return renderSkeleton();
  if (visible.length === 0) return renderEmpty();
  if (scope === 'trash') return renderTrashGroup(visible);

  const favorites = visible.filter((artifact) => artifact.favorite);
  const rest = visible.filter((artifact) => !artifact.favorite);
  const showFavoriteGroup = (scope === 'project' || scope === 'all') && favorites.length > 0;
  const label =
    scope === 'all' ? 'All projects' : scope === 'archived' ? 'Archived' : 'Artifacts';
  const container = el('div');
  if (showFavoriteGroup) container.append(renderGroup('Favorites', favorites, view === 'grid'));
  if (rest.length > 0 || !showFavoriteGroup) {
    container.append(renderGroup(label, rest, view === 'grid'));
  }
  applyRoving(container);
  container.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    const rows = [...container.querySelectorAll<HTMLButtonElement>('button.cv-row')];
    const active = document.activeElement;
    const index = active instanceof HTMLButtonElement ? rows.indexOf(active) : -1;
    if (index === -1) return;
    event.preventDefault();
    const next = rows[Math.max(0, Math.min(rows.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)))];
    if (next === undefined) return;
    for (const row of rows) row.tabIndex = row === next ? 0 : -1;
    next.focus();
  });
  return container;
}

function renderRowFallback(): HTMLElement {
  const state = el('div', 'cv-detail-loading');
  const line1 = el('div', 'cv-skeleton-line');
  line1.style.width = '56%';
  const line2 = el('div', 'cv-skeleton-line');
  line2.style.width = '36%';
  state.append(el('div', 'cv-skeleton-tile'), line1, line2);
  return state;
}

function renderDetailLoading(): HTMLElement {
  const wrap = el('div', 'cv-detail');
  const scroll = el('div', 'cv-detail-scroll');
  scroll.append(renderRowFallback());
  wrap.append(scroll);
  return wrap;
}

function renderDetailEmpty(): HTMLElement {
  const state = el('div', 'cv-detail-empty');
  const tile = el('span', 'cv-tile');
  tile.append(svgIcon('frame'));
  state.append(tile, el('h2', undefined, 'Select an artifact'));
  state.append(el('p', undefined, 'Choose an artifact to inspect its versions, feedback, and actions.'));
  return state;
}

function copyButton(value: string, message: string): HTMLButtonElement {
  const button = el('button', 'cv-copy');
  button.type = 'button';
  button.setAttribute('aria-label', message);
  button.title = message;
  button.append(svgIcon('copy'));
  button.addEventListener('click', () => {
    void runAction(async () => {
      await host.writeClipboard(value);
      await host.toast({ kind: 'success', message });
    });
  });
  return button;
}

function detailRow(label: string, value: Node, copy?: { value: string; message: string }): HTMLElement {
  const row = el('div', 'cv-detail-row');
  row.append(el('span', undefined, label));
  const valueNode = el('span', 'cv-detail-value');
  valueNode.append(value);
  row.append(valueNode);
  if (copy !== undefined) row.append(copyButton(copy.value, copy.message));
  return row;
}

function renderDetail(): HTMLElement {
  if (selectedId === null) return renderDetailEmpty();
  if (detail === null) return renderDetailLoading();
  const meta = detail;
  const summary = artifacts.find((artifact) => artifact.id === meta.id);

  const wrap = el('div', 'cv-detail');
  const scroll = el('div', 'cv-detail-scroll');

  const top = el('div', 'cv-detail-top');
  const back = actionButton('Back', 'cv-back', () => {
    closeDetail();
  });
  back.prepend(svgIcon('chevron-left'));
  const label = el('span', 'cv-detail-label', 'Artifact');
  const menu = el('details', 'cv-menu');
  const menuSummary = el('summary', 'cv-icon-btn');
  menuSummary.setAttribute('aria-label', 'Artifact actions');
  menuSummary.title = 'Artifact actions';
  menuSummary.append(svgIcon('more'));
  const menuPop = el('div', 'cv-menu-pop');
  const attach = menuButton('Attach to chat', 'paperclip', () => {
    closeMenus();
    void runAction(() => attachArtifact(meta));
  });
  const archive = menuButton(meta.archivedAt === null ? 'Archive' : 'Unarchive', 'archive', () => {
    closeMenus();
    void runAction(() => archiveArtifact(meta));
  });
  const remove = menuButton('Move to trash', 'trash', () => {
    closeMenus();
    confirmTrash = true;
    renderBody();
  });
  remove.classList.add('cv-menu-item--danger');
  menuPop.append(attach, el('div', 'cv-menu-sep'), archive, el('div', 'cv-menu-sep'), remove);
  menu.append(menuSummary, menuPop);
  menu.addEventListener('toggle', () => {
    menuSummary.setAttribute('aria-expanded', String(menu.open));
  });
  top.append(back, label, menu);

  const hero = el('div', 'cv-detail-hero');
  const heroMain = el('div', 'cv-detail-hero-main');
  const title = el('h2', 'cv-detail-title', meta.title);
  title.dir = 'auto';
  title.tabIndex = -1;
  const sub = el('div', 'cv-detail-sub');
  sub.append(
    el('span', undefined, meta.projectName),
    el('span', undefined, formatDate(meta.updatedAt)),
  );
  heroMain.append(title, sub);
  const star = actionButton('', 'cv-star-btn', () =>
    runAction(async () => {
      await request(`/favorite/${encodeURIComponent(meta.id)}`, 'POST', {
        favorite: !meta.favorite,
      });
      await host.toast({
        kind: 'success',
        message: meta.favorite ? 'Removed from favorites.' : 'Added to favorites.',
      });
      await loadDetail(meta.id);
      await refresh();
      renderBody();
    }),
  );
  star.setAttribute(
    'aria-label',
    meta.favorite ? 'Remove from favorites' : 'Add to favorites',
  );
  star.setAttribute('aria-pressed', String(meta.favorite));
  star.append(svgIcon(meta.favorite ? 'star-filled' : 'star'));
  top.insertBefore(star, menu);
  hero.append(artifactTile(meta.kind), heroMain);

  const actions = el('div', 'cv-actions');
  const copyUrlButton = iconButton('copy', 'Copy view URL', () =>
    runAction(() => copyUrl(meta.id)),
  );
  copyUrlButton.className = 'cv-btn cv-btn--icon';
  const exportButton = iconButton('download', 'Export artifact', () =>
    runAction(() => exportArtifact(meta)),
  );
  exportButton.className = 'cv-btn cv-btn--icon';
  if (remote) {
    const copyPrimary = actionButton('Copy URL', 'cv-btn cv-btn--primary', () =>
      runAction(() => copyUrl(meta.id)),
    );
    copyPrimary.prepend(svgIcon('copy'));
    actions.append(copyPrimary, exportButton);
  } else {
    const open = actionButton('Open', 'cv-btn cv-btn--primary', () =>
      runAction(() => openArtifact(meta.id)),
    );
    open.append(svgIcon('external'));
    actions.append(open, copyUrlButton, exportButton);
  }

  const metaLine = el('div', 'cv-detail-meta');
  const kindMeta = el('span', 'cv-detail-meta-item');
  kindMeta.append(svgIcon(kindIcon(meta.kind)), document.createTextNode(kindLabel(meta.kind)));
  const feedbackMeta = el('span', 'cv-detail-meta-item');
  feedbackMeta.append(
    svgIcon('message'),
    document.createTextNode(
      `${summary?.feedbackCount ?? 0} ${summary?.feedbackCount === 1 ? 'response' : 'responses'}`,
    ),
  );
  metaLine.append(kindMeta, feedbackMeta);

  const versionsSection = el('section', 'cv-section');
  const versionsHead = el('div', 'cv-section-head');
  versionsHead.append(
    el('h3', undefined, 'Versions'),
    el('span', 'cv-count', String(meta.versions.length)),
  );
  const versions = el('div', 'cv-versions');
  const ordered = [...meta.versions].reverse();
  for (const version of ordered) {
    const current = version.id === meta.currentVersion;
    const row = el('div', 'cv-version');
    row.dataset.current = String(current);
    const main = el('div', 'cv-version-main');
    const line = el('div', 'cv-version-line');
    line.append(el('span', 'cv-version-label', metaLabel(meta, version.id)));
    if (current) line.append(el('span', 'cv-current', 'Current'));
    line.append(el('span', 'cv-version-time', formatShortDate(version.createdAt)));
    const versionMeta = el('div', 'cv-version-meta');
    versionMeta.append(
      el(
        'span',
        undefined,
        `${version.files} ${version.files === 1 ? 'file' : 'files'}, ${formatBytes(version.bytes)}`,
      ),
    );
    if (version.restoredFrom !== null) {
      versionMeta.append(
        el(
          'span',
          'cv-version-restored',
          `Restored from ${metaLabel(meta, version.restoredFrom)}`,
        ),
      );
    }
    main.append(line, versionMeta);
    row.append(main);
    if (!current) {
      const rowActions = el('div', 'cv-version-actions');
      rowActions.append(
        actionButton('Open', 'cv-btn cv-version-open', () =>
          runAction(() => openArtifact(meta.id, version.id)),
        ),
        actionButton('Restore', 'cv-btn cv-version-restore', () =>
          runAction(() => restoreVersion(meta, version.id)),
        ),
      );
      row.append(rowActions);
    }
    versions.append(row);
  }
  versionsSection.append(versionsHead, versions);

  const details = el('details', 'cv-details');
  const detailsSummary = el('summary');
  detailsSummary.append(
    svgIcon('chevron-right'),
    document.createTextNode('Details'),
  );
  const detailsBody = el('div', 'cv-details-body');
  detailsBody.append(
    detailRow('Artifact ID', document.createTextNode(meta.id), {
      value: meta.id,
      message: 'Artifact ID copied.',
    }),
  );
  if (meta.sessionId !== null) {
    detailsBody.append(
      detailRow('Session', document.createTextNode(meta.sessionId), {
        value: meta.sessionId,
        message: 'Session ID copied.',
      }),
    );
  }
  detailsBody.append(
    detailRow(
      'Libraries',
      document.createTextNode(meta.libraries.length > 0 ? meta.libraries.join(', ') : 'None'),
    ),
    detailRow('Created', document.createTextNode(formatDate(meta.createdAt))),
  );
  if (meta.pinnedVersion !== null) {
    detailsBody.append(
      detailRow('Pinned', document.createTextNode(metaLabel(meta, meta.pinnedVersion))),
    );
  }
  details.append(detailsSummary, detailsBody);

  scroll.append(top, hero, actions, metaLine, versionsSection, details);

  const composer = el('div', 'cv-composer');
  const composerInner = el('div', 'cv-composer-inner');
  const input = el('input');
  input.type = 'text';
  input.placeholder = 'Ask the agent to change this artifact';
  input.setAttribute('aria-label', 'Instruction for the agent');
  input.value = refine;
  input.addEventListener('input', () => {
    refine = input.value;
  });
  input.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    void runAction(() => refineArtifact(meta));
  });
  const addToChat = actionButton('Add to chat', 'cv-btn cv-composer-btn', () =>
    runAction(() => refineArtifact(meta)),
  );
  addToChat.prepend(svgIcon('message'));
  composerInner.append(input, addToChat);
  composer.append(composerInner);

  wrap.append(scroll, composer);
  return wrap;
}

function renderDialog(meta: ArtifactMeta): HTMLDialogElement {
  const dialog = el('dialog', 'cv-dialog');
  const body = el('div', 'cv-dialog-body');
  const title = el('h2', undefined, 'Move to trash?');
  title.id = 'cv-trash-title';
  dialog.setAttribute('aria-labelledby', title.id);
  body.append(
    title,
    el(
      'p',
      undefined,
      `"${meta.title}" moves to Trash. You can restore it for 30 days.`,
    ),
  );
  const actions = el('div', 'cv-dialog-actions');
  const cancel = actionButton('Cancel', 'cv-btn', () => {
    dialog.close();
  });
  const confirm = actionButton('Move to trash', 'cv-btn cv-btn--danger', () => {
    confirmTrash = false;
    void runAction(() => trashArtifact(meta));
  });
  actions.append(cancel, confirm);
  dialog.append(body, actions);
  dialog.addEventListener('close', () => {
    if (!confirmTrash) return;
    confirmTrash = false;
    renderBody();
  });
  return dialog;
}

function renderError(): HTMLElement {
  const banner = el('div', 'cv-error');
  banner.setAttribute('role', 'alert');
  banner.append(svgIcon('alert'), el('span', undefined, error ?? 'The Canvas service is unavailable.'));
  banner.append(
    actionButton('Retry', 'cv-btn', () => {
      error = null;
      void refresh();
    }),
  );
  return banner;
}

function renderRemoteNotice(): HTMLElement {
  const notice = el('div', 'cv-notice');
  notice.setAttribute('role', 'status');
  notice.append(
    svgIcon('alert'),
    el(
      'span',
      undefined,
      'This client is connected to another machine. Artifacts cannot open in the local browser panel. Use Copy URL or Export.',
    ),
  );
  return notice;
}

function renderBody(): void {
  if (shell === null) return;
  updateHeader();
  const body = shell.body;
  const focusedRowId =
    selectedId === null && document.activeElement instanceof HTMLElement
      ? document.activeElement.closest<HTMLElement>('[data-id]')?.dataset.id
      : undefined;
  const oldList = body.querySelector<HTMLElement>('.cv-list-pane');
  const oldDetail = body.querySelector<HTMLElement>('.cv-detail-scroll');
  const listTop = oldList?.scrollTop ?? 0;
  const sameDetail = lastDetailId === selectedId;
  const detailTop = sameDetail ? (oldDetail?.scrollTop ?? 0) : 0;

  body.replaceChildren();
  if (showSetup) {
    body.append(renderSetup());
    lastDetailId = selectedId;
    return;
  }
  if (error !== null && artifacts.length === 0 && !loading) {
    body.append(renderError());
    lastDetailId = selectedId;
    return;
  }
  if (error !== null) body.append(renderError());
  if (remote) body.append(renderRemoteNotice());

  const workspace = el('div', 'cv-workspace');
  workspace.dataset.detail = String(selectedId !== null);
  workspace.dataset.empty = String(artifacts.length === 0);
  const listPane = el('div', 'cv-list-pane');
  listPane.append(renderList());
  const detailPane = el('div', 'cv-detail-pane');
  detailPane.append(renderDetail());
  workspace.append(listPane, detailPane);
  body.append(workspace);
  listPane.scrollTop = listTop;
  const newDetail = detailPane.querySelector<HTMLElement>('.cv-detail-scroll');
  if (newDetail !== null) newDetail.scrollTop = detailTop;
  lastDetailId = selectedId;
  if (focusedRowId !== undefined) focusRow(focusedRowId);

  if (confirmTrash && detail !== null) {
    const dialog = renderDialog(detail);
    body.append(dialog);
    requestAnimationFrame(() => {
      if (dialog.isConnected && !dialog.open) dialog.showModal();
    });
  }
}

async function askAgent(): Promise<void> {
  await runAction(async () => {
    await host.compose({ text: EMPTY_PROMPT, mode: 'append' });
    await host.toast({
      kind: 'info',
      message: 'Prompt added to the composer. Send it when ready.',
    });
  });
}

function clearFilters(): void {
  query = '';
  tag = '';
  if (shell !== null) {
    shell.search.value = '';
    shell.searchClear.hidden = true;
  }
  updateHeader();
  ensureListVisible();
}

async function openArtifact(id: string, version?: string): Promise<void> {
  if (remote) {
    await host.toast({
      kind: 'error',
      message: 'This client is remote. Copy the URL or export the artifact instead.',
    });
    return;
  }
  const result = await request<ViewUrlResponse>('/view-url', 'POST', {
    id,
    ...(version === undefined ? {} : { version }),
  });
  await host.openUrl(result.url);
}

async function copyUrl(id: string, version?: string): Promise<void> {
  const result = await request<ViewUrlResponse>('/view-url', 'POST', {
    id,
    ...(version === undefined ? {} : { version }),
  });
  await host.writeClipboard(result.url);
  await host.toast({
    kind: 'success',
    message: 'View URL copied. It is local and expires.',
  });
}

async function exportArtifact(meta: ArtifactMeta): Promise<void> {
  const format = meta.kind === 'html' ? 'html' : 'zip';
  const result = await request<ExportResponse>(`/export/${encodeURIComponent(meta.id)}`, 'POST', {
    format,
  });
  await host.toast({
    kind: 'success',
    message: `Exported to ${result.path}`,
    copy: { text: result.path },
    persistent: true,
  });
}

async function attachArtifact(meta: ArtifactMeta): Promise<void> {
  const result = await request<ViewUrlResponse>('/view-url', 'POST', { id: meta.id });
  await host.attach({
    providerId: 'canvas',
    id: meta.id,
    title: meta.title,
    url: result.url,
    data: { artifactId: meta.id },
  });
  await host.toast({ kind: 'success', message: 'Artifact attached to the chat.' });
}

async function refineArtifact(meta: ArtifactMeta): Promise<void> {
  const instruction = refine.trim();
  if (instruction.length === 0) {
    await host.toast({ kind: 'error', message: 'Write an instruction first.' });
    return;
  }
  const text = `Canvas artifact ${meta.id} ("${meta.title}"). ${instruction}\n\nRead it with canvas_read first, then update it with canvas_update and the current baseVersion.`;
  await host.compose({ text, mode: 'append' });
  refine = '';
  await host.toast({
    kind: 'info',
    message: 'Instruction added to the composer. Send it when ready.',
  });
  renderBody();
}

async function restoreVersion(meta: ArtifactMeta, version: string): Promise<void> {
  await request(`/restore/${encodeURIComponent(meta.id)}`, 'POST', {
    version,
    baseVersion: meta.currentVersion,
  });
  await host.toast({
    kind: 'success',
    message: `Restored ${metaLabel(meta, version)} as a new version.`,
  });
  await loadDetail(meta.id);
  await refresh();
  renderBody();
}

async function archiveArtifact(meta: ArtifactMeta): Promise<void> {
  const archived = meta.archivedAt === null;
  await request(`/archive/${encodeURIComponent(meta.id)}`, 'POST', { archived });
  selectedId = null;
  detail = null;
  detailSignature = '';
  confirmTrash = false;
  await host.toast({
    kind: 'success',
    message: archived ? 'Artifact archived.' : 'Artifact unarchived.',
  });
  await refresh();
}

async function trashArtifact(meta: ArtifactMeta): Promise<void> {
  await request(`/trash/${encodeURIComponent(meta.id)}`, 'POST', {});
  selectedId = null;
  detail = null;
  detailSignature = '';
  confirmTrash = false;
  await host.toast({ kind: 'success', message: 'Artifact moved to trash.' });
  await refresh();
}

async function untrashArtifact(id: string): Promise<void> {
  await request(`/untrash/${encodeURIComponent(id)}`, 'POST', {});
  await host.toast({ kind: 'success', message: 'Artifact restored from trash.' });
  await refresh();
}

async function loadSetup(): Promise<void> {
  setup = { ...setup, loading: true, error: null };
  renderBody();
  try {
    const status = await host.serviceStatus();
    const health = await request<ServiceHealth>('/health');
    const mcp = await request<Record<string, unknown> | null>('/mcp-status');
    setup = {
      service: status.status,
      health,
      mcp,
      error: null,
      loading: false,
    };
  } catch (caught) {
    setup = { ...setup, error: errorMessage(caught), loading: false };
  }
  renderBody();
}

function setupConnected(): boolean {
  if (setup.mcp === null || typeof setup.mcp.seenAt !== 'string') return false;
  const seen = Date.parse(setup.mcp.seenAt);
  return !Number.isNaN(seen) && Date.now() - seen < 3 * 60_000;
}

function renderSetupStep(
  state: 'ready' | 'attention',
  icon: IconName,
  title: string,
  body: string,
  actions?: HTMLElement,
  extra?: HTMLElement,
): HTMLElement {
  const step = el('div', 'cv-step');
  step.dataset.state = state;
  const iconEl = el('span', 'cv-step-icon');
  iconEl.append(svgIcon(icon));
  const main = el('div', 'cv-step-main');
  main.append(el('div', 'cv-step-title', title), el('div', 'cv-step-body', body));
  if (extra !== undefined) main.append(extra);
  if (actions !== undefined) main.append(actions);
  step.append(iconEl, main);
  return step;
}

function renderSetup(): HTMLElement {
  const pane = el('div', 'cv-setup-pane');
  const inner = el('div', 'cv-setup-inner');
  const top = el('div', 'cv-setup-top');
  const back = actionButton('Back', 'cv-back', () => {
    showSetup = false;
    updateHeader();
    renderBody();
  });
  back.prepend(svgIcon('chevron-left'));
  const recheck = actionButton('Check again', 'cv-btn cv-btn--ghost', () => {
    void loadSetup();
  });
  recheck.prepend(svgIcon('refresh'));
  top.append(back, el('span', 'cv-detail-label'), recheck);
  inner.append(top);
  inner.append(el('h2', undefined, 'Set up Canvas'));
  inner.append(
    el(
      'p',
      'cv-setup-sub',
      'The gallery and viewer are ready. The agent needs the separate MCP server to publish and update artifacts.',
    ),
  );
  if (setup.error !== null) {
    const banner = el('div', 'cv-error');
    banner.setAttribute('role', 'alert');
    banner.append(svgIcon('alert'), el('span', undefined, setup.error));
    inner.append(banner);
  }

  const serviceReady = setup.service === 'ready' && setup.health !== null;
  const serviceBody = setup.loading
    ? 'Checking the extension service.'
    : setup.health === null
      ? 'The service is not answering. Open the gallery again or retry.'
      : `Running. Store: ${setup.health.store}.`;
  inner.append(renderSetupStep(serviceReady ? 'ready' : 'attention', 'frame', 'Canvas extension', serviceBody));

  const connected = setupConnected();
  const mcpPath = setup.health?.mcpPath ?? '/absolute/path/to/openchamber-canvas/mcp/server.js';
  const mcpConfig = JSON.stringify(
    {
      mcp: {
        servers: {
          canvas: {
            type: 'local',
            command: ['node', mcpPath],
          },
        },
      },
    },
    null,
    2,
  );
  const mcpActions = el('div', 'cv-step-actions');
  const copyConfig = actionButton(
    connected ? 'Copy config' : 'Copy MCP config',
    connected ? 'cv-btn cv-btn--ghost' : 'cv-btn cv-btn--primary',
    () =>
      runAction(async () => {
        await host.writeClipboard(mcpConfig);
        await host.toast({ kind: 'success', message: 'MCP config copied.' });
      }),
  );
  copyConfig.prepend(svgIcon('copy'));
  mcpActions.append(copyConfig);
  const configDetails = el('details', 'cv-config');
  const configSummary = el('summary');
  configSummary.append(svgIcon('chevron-right'), document.createTextNode('Show JSON'));
  const pre = el('pre', 'cv-pre');
  pre.textContent = mcpConfig;
  configDetails.append(configSummary, pre);
  mcpActions.append(configDetails);
  const path = el('div', 'cv-path');
  path.append(el('span', undefined, mcpPath), copyButton(mcpPath, 'MCP path copied.'));
  const mcpStep = renderSetupStep(
    connected ? 'ready' : 'attention',
    'terminal',
    'MCP server',
    setup.loading
      ? 'Checking the MCP heartbeat.'
      : connected
        ? `Connected. The agent can publish, read, update, and collect feedback. Last seen ${formatDate(String(setup.mcp?.seenAt))}.`
        : 'Not connected. Add the local server in Settings → MCP. The extension bundles the server file but cannot register it.',
    mcpActions,
    path,
  );
  inner.append(mcpStep);

  const agentActions = el('div', 'cv-step-actions');
  const sample = actionButton('Put a sample prompt in chat', 'cv-btn', () =>
    runAction(async () => {
      await host.compose({ text: SAMPLE_PROMPT, mode: 'append' });
      await host.toast({
        kind: 'info',
        message: 'Sample prompt added to the composer.',
      });
    }),
  );
  sample.disabled = !connected;
  sample.title = connected ? 'Add a sample Canvas prompt to the chat' : 'Connect the MCP server first';
  agentActions.append(sample);
  inner.append(
    renderSetupStep(
      connected ? 'ready' : 'attention',
      'message',
      'Agent',
      connected
        ? 'Ask the agent for a chart, dashboard, report, or interface mockup. Canvas will list it here.'
        : 'Connect the MCP server to let the agent publish and update artifacts.',
      agentActions,
    ),
  );

  pane.append(inner);
  return pane;
}

host.onReady((context) => {
  applyHostReady(context, document.documentElement);
  document.body.dataset.surface = context.surface;
  remote = !isLoopbackHost(window.location.hostname);
  const previousDirectory = directory;
  directory = context.directory;
  if (directory === null && scope === 'project') scope = 'all';
  if (!mounted) {
    mounted = true;
    loadPreferences();
    mountShell();
    void refresh();
    return;
  }
  if (previousDirectory !== directory) {
    selectedId = null;
    detail = null;
    confirmTrash = false;
    void refresh();
  }
  updateHeader();
  renderBody();
});

host.onDirectory((next) => {
  if (next === directory) return;
  directory = next;
  if (directory === null && scope === 'project') scope = 'all';
  selectedId = null;
  detail = null;
  confirmTrash = false;
  updateHeader();
  renderBody();
  void refresh();
});

window.setInterval(() => {
  if (document.visibilityState === 'visible') void refresh();
}, 3000);

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    if (document.querySelector('dialog[open]') !== null) return;
    const openMenu = document.querySelector<HTMLDetailsElement>('details.cv-menu[open]');
    if (openMenu !== null) {
      openMenu.open = false;
      return;
    }
    if (selectedId !== null && !isWideLayout()) {
      closeDetail();
      return;
    }
  }
  if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey) return;
  const target = event.target;
  if (
    target instanceof HTMLElement &&
    (target.tagName === 'INPUT' ||
      target.tagName === 'TEXTAREA' ||
      target.tagName === 'SELECT' ||
      target.isContentEditable)
  ) {
    return;
  }
  event.preventDefault();
  if (!isWideLayout() && selectedId !== null) closeDetail();
  window.requestAnimationFrame(() => {
    shell?.search.focus();
  });
});

document.addEventListener('click', (event) => {
  if (!(event.target instanceof Element)) return;
  if (event.target.closest('details.cv-menu') !== null) return;
  closeMenus();
});
