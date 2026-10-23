import { connectHost } from '@openchamber/sdk';
import { applyHostReady } from '@openchamber/sdk/ui';

type ArtifactKind = 'html' | 'bundle' | 'markdown' | 'image' | 'pdf' | 'data';

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
  count: HTMLElement;
  scopeProject: HTMLButtonElement;
  scopeAll: HTMLButtonElement;
  scopeArchived: HTMLButtonElement;
  scopeTrash: HTMLButtonElement;
  viewToggle: HTMLButtonElement;
  setupToggle: HTMLButtonElement;
  search: HTMLInputElement;
  tag: HTMLSelectElement;
  sort: HTMLSelectElement;
}

type Scope = 'project' | 'all' | 'archived' | 'trash';
type ViewMode = 'list' | 'grid';
type SortMode = 'updated' | 'title';

const KIND_LABELS: Record<ArtifactKind, string> = {
  html: 'HTML',
  bundle: 'Bundle',
  markdown: 'Markdown',
  image: 'Image',
  pdf: 'PDF',
  data: 'Data',
};

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
let deleteArmed = false;
let refine = '';
let setup: SetupState = { service: null, health: null, mcp: null, error: null, loading: false };
let shell: Shell | null = null;
let mounted = false;

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

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className !== undefined) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
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

function kindLabel(kind: ArtifactKind): string {
  return KIND_LABELS[kind];
}

function relativeDate(iso: string): string {
  const time = Date.parse(iso);
  if (Number.isNaN(time)) return '';
  const difference = Date.now() - time;
  const minute = 60_000;
  if (difference < minute) return 'now';
  if (difference < 60 * minute) return `${Math.floor(difference / minute)}m`;
  if (difference < 24 * 60 * minute) return `${Math.floor(difference / (60 * minute))}h`;
  if (difference < 7 * 24 * 60 * minute) return `${Math.floor(difference / (24 * 60 * minute))}d`;
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

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
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
    if (
      tagFilter !== '' &&
      !artifact.tags.some((value) => value.toLowerCase() === tagFilter)
    ) {
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
    sort === 'title' ? left.title.localeCompare(right.title) : right.updatedAt.localeCompare(left.updatedAt),
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
  deleteArmed = false;
}

async function refresh(): Promise<void> {
  if (refreshing) return;
  refreshing = true;
  if (artifacts.length === 0) loading = true;
  const canRender = selectedId === null && !showSetup;
  if (canRender) {
    updateHeader();
    renderBody();
  }
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
    error = null;
    void updateBadge();
  } catch (caught) {
    error = errorMessage(caught);
  } finally {
    refreshing = false;
    loading = false;
    updateHeader();
    if (canRender) renderBody();
  }
}

async function openDetail(id: string): Promise<void> {
  selectedId = id;
  detail = null;
  deleteArmed = false;
  showSetup = false;
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
}

function setScope(next: Scope): void {
  if (next === 'project' && directory === null) next = 'all';
  scope = next;
  selectedId = null;
  detail = null;
  showSetup = false;
  updateHeader();
  renderBody();
  void refresh();
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
  shell.count.textContent = String(artifacts.length);
  shell.scopeProject.disabled = directory === null;
  shell.scopeProject.setAttribute('aria-pressed', String(scope === 'project'));
  shell.scopeAll.setAttribute('aria-pressed', String(scope === 'all'));
  shell.scopeArchived.setAttribute('aria-pressed', String(scope === 'archived'));
  shell.scopeTrash.setAttribute('aria-pressed', String(scope === 'trash'));
  shell.viewToggle.textContent = view === 'list' ? 'Grid' : 'List';
  shell.setupToggle.textContent = showSetup ? 'Gallery' : 'Setup';
  updateTagOptions(shell.tag);
}

function mountShell(): void {
  root.replaceChildren();

  const header = el('header', 'cv-header');
  const titleRow = el('div', 'cv-title-row');
  const title = el('h1', 'cv-title', 'Canvas');
  const count = el('span', 'cv-count', '0');
  const spacer = el('span', 'cv-spacer');
  const setupToggle = actionButton('Setup', 'cv-icon-btn', () => {
    showSetup = !showSetup;
    if (showSetup) void loadSetup();
    updateHeader();
    renderBody();
  });
  const viewToggle = actionButton(view === 'list' ? 'Grid' : 'List', 'cv-icon-btn', () => {
    view = view === 'list' ? 'grid' : 'list';
    updateHeader();
    renderBody();
  });
  const refreshButton = actionButton('Refresh', 'cv-icon-btn', () => {
    void refresh();
  });
  titleRow.append(title, count, spacer, setupToggle, viewToggle, refreshButton);

  const filters = el('div', 'cv-filters');
  const segmented = el('div', 'cv-segmented');
  const scopeProject = actionButton('Project', '', () => setScope('project'));
  const scopeAll = actionButton('All', '', () => setScope('all'));
  const scopeArchived = actionButton('Archived', '', () => setScope('archived'));
  const scopeTrash = actionButton('Trash', '', () => setScope('trash'));
  scopeProject.setAttribute('aria-pressed', 'true');
  scopeAll.setAttribute('aria-pressed', 'false');
  scopeArchived.setAttribute('aria-pressed', 'false');
  scopeTrash.setAttribute('aria-pressed', 'false');
  segmented.append(scopeProject, scopeAll, scopeArchived, scopeTrash);

  const search = el('input', 'cv-search');
  search.type = 'search';
  search.placeholder = 'Search artifacts';
  search.setAttribute('aria-label', 'Search artifacts');
  search.value = query;
  search.addEventListener('input', () => {
    query = search.value;
    renderBody();
  });
  search.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      search.value = '';
      query = '';
      renderBody();
    }
  });

  const tagSelect = el('select', 'cv-select');
  tagSelect.setAttribute('aria-label', 'Filter by tag');
  tagSelect.addEventListener('change', () => {
    tag = tagSelect.value;
    renderBody();
  });

  const sortSelect = el('select', 'cv-select');
  sortSelect.setAttribute('aria-label', 'Sort artifacts');
  const updated = el('option', undefined, 'Updated');
  updated.value = 'updated';
  const titleSort = el('option', undefined, 'Title');
  titleSort.value = 'title';
  sortSelect.append(updated, titleSort);
  sortSelect.value = sort;
  sortSelect.addEventListener('change', () => {
    sort = sortSelect.value === 'title' ? 'title' : 'updated';
    renderBody();
  });

  filters.append(segmented, search, tagSelect, sortSelect);
  header.append(titleRow, filters);

  const body = el('div', 'cv-body');
  root.append(header, body);

  shell = {
    body,
    count,
    scopeProject,
    scopeAll,
    scopeArchived,
    scopeTrash,
    viewToggle,
    setupToggle,
    search,
    tag: tagSelect,
    sort: sortSelect,
  };
  updateHeader();
  renderBody();
}

function renderError(): HTMLElement {
  const banner = el('div', 'cv-banner');
  banner.setAttribute('role', 'alert');
  banner.append(el('span', undefined, error ?? 'The Canvas service is unavailable.'));
  banner.append(
    actionButton('Retry', 'cv-quiet', () => {
      error = null;
      void refresh();
    }),
  );
  return banner;
}

function renderEmpty(): HTMLElement {
  const state = el('div', 'cv-state');
  const heading =
    artifacts.length === 0
      ? scope === 'trash'
        ? 'Trash is empty'
        : scope === 'archived'
          ? 'No archived artifacts'
          : scope === 'all'
            ? 'No artifacts yet'
            : 'No artifacts in this project'
      : 'No matches';
  state.append(el('h2', undefined, heading));
  state.append(
    el(
      'p',
      undefined,
      artifacts.length === 0
        ? scope === 'trash'
          ? 'Deleted artifacts stay here for 30 days, then they are removed.'
          : scope === 'archived'
            ? 'Archive an artifact to hide it from the project list. It stays restorable.'
            : 'Ask the agent for a chart, dashboard, report, or interface mockup. It can publish one with Canvas.'
        : 'Try a different search or tag, or switch scope.',
    ),
  );
  if (artifacts.length === 0 && (scope === 'project' || scope === 'all')) {
    state.append(
      actionButton('Put a prompt in chat', 'cv-primary', () =>
        runAction(async () => {
          await host.compose({
            text: 'Create a Canvas artifact for this project: a chart, dashboard, report, or interface mockup that answers the question. Use the Canvas tools and open the result.',
            mode: 'append',
          });
          await host.toast({
            kind: 'info',
            message: 'Prompt added to the composer. Send it when ready.',
          });
        }),
      ),
    );
  }
  return state;
}

function renderList(): HTMLElement {
  const visible = filteredArtifacts();
  if (loading && artifacts.length === 0) {
    const state = el('div', 'cv-state');
    state.append(el('h2', undefined, 'Loading artifacts'));
    state.append(el('p', undefined, 'Reading the Canvas service.'));
    return state;
  }
  if (visible.length === 0) return renderEmpty();

  if (scope === 'trash') {
    const list = el('div', 'cv-list');
    for (const artifact of visible) {
      const row = el('div', 'cv-row');
      const kind = el('span', 'cv-kind', kindLabel(artifact.kind));
      kind.dataset.kind = artifact.kind;
      const main = el('span', 'cv-row-main');
      const title = el('span', 'cv-row-title', artifact.title);
      title.dir = 'auto';
      const meta = el('span', 'cv-row-meta');
      meta.append(el('span', undefined, artifact.projectName));
      meta.append(
        el('span', undefined, `${artifact.versions} ${artifact.versions === 1 ? 'version' : 'versions'}`),
      );
      for (const value of artifact.tags.slice(0, 2)) {
        meta.append(el('span', 'cv-tag', value));
      }
      main.append(title, meta);
      const side = el('span', 'cv-row-side');
      side.append(el('span', undefined, relativeDate(artifact.updatedAt)));
      side.append(
        actionButton('Restore', 'cv-quiet', () => runAction(() => untrashArtifact(artifact.id))),
      );
      row.append(kind, main, side);
      list.append(row);
    }
    return list;
  }

  if (view === 'grid') {
    const grid = el('div', 'cv-grid');
    for (const artifact of visible) {
      const card = el('button', 'cv-card');
      card.type = 'button';
      card.addEventListener('click', () => {
        void openDetail(artifact.id);
      });
      const kind = el('span', 'cv-kind', kindLabel(artifact.kind));
      kind.dataset.kind = artifact.kind;
      const title = el('span', 'cv-card-title', artifact.title);
      title.dir = 'auto';
      const meta = el('span', 'cv-card-meta');
      meta.append(el('span', undefined, artifact.projectName));
      meta.append(el('span', undefined, `${artifact.versions} versions`));
      card.append(kind, title, meta);
      if (artifact.tags.length > 0) {
        const tags = el('span', 'cv-row-meta');
        for (const value of artifact.tags.slice(0, 3)) {
          tags.append(el('span', 'cv-tag', value));
        }
        card.append(tags);
      }
      grid.append(card);
    }
    return grid;
  }

  const list = el('div', 'cv-list');
  list.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    const rows = [...list.querySelectorAll<HTMLButtonElement>('button.cv-row')];
    const active = document.activeElement;
    const index = active instanceof HTMLButtonElement ? rows.indexOf(active) : -1;
    if (index === -1) return;
    event.preventDefault();
    const nextIndex = Math.max(0, Math.min(rows.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)));
    rows[nextIndex]?.focus();
  });
  for (const artifact of visible) {
    const row = el('button', 'cv-row');
    row.type = 'button';
    row.setAttribute('aria-selected', String(artifact.id === selectedId));
    row.setAttribute(
      'aria-label',
      `${artifact.title}, ${kindLabel(artifact.kind)}, ${artifact.projectName}, ${artifact.versions} versions`,
    );
    const kind = el('span', 'cv-kind', kindLabel(artifact.kind));
    kind.dataset.kind = artifact.kind;

    const main = el('span', 'cv-row-main');
    const title = el('span', 'cv-row-title', artifact.title);
    title.dir = 'auto';
    const meta = el('span', 'cv-row-meta');
    meta.append(el('span', undefined, artifact.projectName));
    meta.append(
      el('span', undefined, `${artifact.versions} ${artifact.versions === 1 ? 'version' : 'versions'}`),
    );
    for (const value of artifact.tags.slice(0, 2)) {
      meta.append(el('span', 'cv-tag', value));
    }
    main.append(title, meta);

    const side = el('span', 'cv-row-side');
    side.append(el('span', undefined, relativeDate(artifact.updatedAt)));
    if (artifact.feedbackCount > 0) {
      side.append(
        el(
          'span',
          'cv-feedback',
          `${artifact.feedbackCount} ${artifact.feedbackCount === 1 ? 'response' : 'responses'}`,
        ),
      );
    }
    if (artifact.favorite) side.append(el('span', undefined, '★'));

    row.append(kind, main, side);
    row.addEventListener('click', () => {
      void openDetail(artifact.id);
    });
    list.append(row);
  }
  return list;
}

function factRow(list: HTMLDListElement, label: string, value: Node): void {
  list.append(el('dt', undefined, label));
  const dd = el('dd');
  dd.append(value);
  list.append(dd);
}

function renderDetail(): HTMLElement {
  if (detail === null) {
    const state = el('div', 'cv-state');
    state.append(
      actionButton('Back', 'cv-back', () => {
        selectedId = null;
        detail = null;
        renderBody();
      }),
    );
    state.append(el('h2', undefined, 'Loading artifact'));
    return state;
  }
  const meta = detail;
  const summary = artifacts.find((artifact) => artifact.id === meta.id);
  const wrapper = el('div', 'cv-detail');

  wrapper.append(
    actionButton('Back', 'cv-back', () => {
      selectedId = null;
      detail = null;
      renderBody();
    }),
  );

  const head = el('div', 'cv-detail-head');
  const title = el('h2', undefined, meta.title);
  title.dir = 'auto';
  const star = actionButton(meta.favorite ? '★' : '☆', 'cv-star', () =>
    runAction(async () => {
      await request(`/favorite/${encodeURIComponent(meta.id)}`, 'POST', {
        favorite: !meta.favorite,
      });
      await host.toast({ kind: 'success', message: meta.favorite ? 'Removed from favorites.' : 'Added to favorites.' });
      await loadDetail(meta.id);
      await refresh();
      renderBody();
    }),
  );
  star.setAttribute('aria-label', meta.favorite ? 'Remove from favorites' : 'Add to favorites');
  star.setAttribute('aria-pressed', String(meta.favorite));
  head.append(title, star);

  const facts = el('dl', 'cv-facts');
  factRow(facts, 'Project', document.createTextNode(meta.projectName));
  factRow(facts, 'Kind', document.createTextNode(kindLabel(meta.kind)));
  factRow(facts, 'Updated', document.createTextNode(formatDate(meta.updatedAt)));
  factRow(
    facts,
    'Versions',
    document.createTextNode(`${meta.versions.length}${meta.pinnedVersion !== null ? ', one pinned' : ''}`),
  );
  factRow(
    facts,
    'Feedback',
    document.createTextNode(
      `${summary?.feedbackCount ?? 0} ${summary?.feedbackCount === 1 ? 'response' : 'responses'}`,
    ),
  );
  factRow(
    facts,
    'Libraries',
    document.createTextNode(meta.libraries.length > 0 ? meta.libraries.join(', ') : 'None'),
  );
  if (meta.sessionId !== null) {
    const session = el('span');
    session.append(el('span', 'cv-mono', meta.sessionId));
    session.append(
      actionButton('Copy', 'cv-quiet', () =>
        runAction(async () => {
          await host.writeClipboard(meta.sessionId ?? '');
          await host.toast({ kind: 'success', message: 'Session id copied.' });
        }),
      ),
    );
    factRow(facts, 'Session', session);
  }

  const actions = el('div', 'cv-actions');
  actions.append(
    actionButton('Open', 'cv-primary', () => runAction(() => openArtifact(meta.id))),
    actionButton('Copy URL', 'cv-quiet', () => runAction(() => copyUrl(meta.id))),
    actionButton('Export', 'cv-quiet', () => runAction(() => exportArtifact(meta))),
    actionButton('Attach to chat', 'cv-quiet', () => runAction(() => attachArtifact(meta))),
    actionButton(meta.archivedAt === null ? 'Archive' : 'Unarchive', 'cv-quiet', () =>
      runAction(() => archiveArtifact(meta)),
    ),
  );

  const refineRow = el('div', 'cv-refine');
  const refineInput = el('input');
  refineInput.type = 'text';
  refineInput.placeholder = 'Ask the agent to change this artifact';
  refineInput.setAttribute('aria-label', 'Instruction for the agent');
  refineInput.value = refine;
  refineInput.addEventListener('input', () => {
    refine = refineInput.value;
  });
  refineInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      void runAction(() => refineArtifact(meta));
    }
  });
  refineRow.append(
    refineInput,
    actionButton('Put in chat', 'cv-quiet', () => runAction(() => refineArtifact(meta))),
  );

  const versionsLabel = el('div', 'cv-section-label', 'Versions');
  const versions = el('div', 'cv-versions');
  for (const version of meta.versions) {
    const current = version.id === meta.currentVersion;
    const row = el('div', 'cv-version');
    row.dataset.current = String(current);
    const main = el('div', 'cv-version-main');
    const versionTitle = el('span', 'cv-version-title', version.id);
    const versionMeta = el('span', 'cv-version-meta');
    versionMeta.append(el('span', undefined, formatDate(version.createdAt)));
    versionMeta.append(el('span', undefined, `${version.files} files`));
    versionMeta.append(el('span', undefined, formatBytes(version.bytes)));
    if (version.restoredFrom !== null) {
      versionMeta.append(el('span', undefined, `restored from ${version.restoredFrom}`));
    }
    main.append(versionTitle, versionMeta);
    row.append(main);
    if (current) {
      row.append(el('span', 'cv-current', 'Current'));
    } else {
      row.append(
        actionButton('Open', 'cv-quiet', () => runAction(() => openArtifact(meta.id, version.id))),
        actionButton('Restore', 'cv-quiet', () =>
          runAction(() => restoreVersion(meta, version.id)),
        ),
      );
    }
    versions.append(row);
  }

  const danger = el('div', 'cv-danger-row');
  if (deleteArmed) {
    danger.append(
      actionButton('Confirm delete', 'cv-danger', () => runAction(() => trashArtifact(meta))),
      actionButton('Cancel', 'cv-quiet', () => {
        deleteArmed = false;
        renderBody();
      }),
    );
  } else {
    danger.append(
      actionButton('Delete', 'cv-danger', () => {
        deleteArmed = true;
        renderBody();
      }),
    );
  }

  wrapper.append(head, facts, actions, refineRow, versionsLabel, versions, danger);
  return wrapper;
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
  await host.toast({ kind: 'success', message: `Restored ${version} as a new version.` });
  await loadDetail(meta.id);
  await refresh();
  renderBody();
}

async function archiveArtifact(meta: ArtifactMeta): Promise<void> {
  const archived = meta.archivedAt === null;
  await request(`/archive/${encodeURIComponent(meta.id)}`, 'POST', { archived });
  selectedId = null;
  detail = null;
  await host.toast({
    kind: 'success',
    message: archived ? 'Artifact archived.' : 'Artifact unarchived.',
  });
  await refresh();
}

async function untrashArtifact(id: string): Promise<void> {
  await request(`/untrash/${encodeURIComponent(id)}`, 'POST', {});
  await host.toast({ kind: 'success', message: 'Artifact restored from trash.' });
  await refresh();
}

async function trashArtifact(meta: ArtifactMeta): Promise<void> {
  await request(`/trash/${encodeURIComponent(meta.id)}`, 'POST', {});
  selectedId = null;
  detail = null;
  await host.toast({ kind: 'success', message: 'Artifact moved to trash.' });
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

function renderSetup(): HTMLElement {
  const wrapper = el('div', 'cv-setup');
  wrapper.append(el('h2', undefined, 'Setup'));
  if (setup.loading) {
    wrapper.append(el('p', 'cv-setup-note', 'Checking the service and the MCP heartbeat.'));
  }
  if (setup.error !== null) {
    const banner = el('div', 'cv-banner');
    banner.setAttribute('role', 'alert');
    banner.append(el('span', undefined, setup.error));
    wrapper.append(banner);
  }
  const rows = el('div');
  const service = el('div', 'cv-setup-row');
  service.append(el('span', undefined, 'Service'), el('span', undefined, setup.service ?? 'Unknown'));
  rows.append(service);
  const store = el('div', 'cv-setup-row');
  store.append(el('span', undefined, 'Store'), el('span', 'cv-mono', setup.health?.store ?? 'Unknown'));
  rows.append(store);
  const heartbeat = el('div', 'cv-setup-row');
  const heartbeatValue =
    setup.mcp !== null && typeof setup.mcp.seenAt === 'string'
      ? `Seen ${formatDate(setup.mcp.seenAt)}${typeof setup.mcp.version === 'string' ? `, v${setup.mcp.version}` : ''}`
      : 'No heartbeat yet';
  heartbeat.append(el('span', undefined, 'MCP'), el('span', undefined, heartbeatValue));
  rows.append(heartbeat);
  wrapper.append(rows);

  wrapper.append(
    el(
      'p',
      'cv-setup-note',
      'Add a local MCP server in Settings → MCP. It gives the agent the publish, update, read, archive, and result tools. The gallery and service work without it for browsing.',
    ),
  );
  const pre = el('pre', 'cv-pre');
  pre.textContent = [
    'Settings → MCP → Add server',
    'Type: local',
    'Name: canvas',
    'Command: node',
    'Arguments: /absolute/path/to/openchamber-canvas/mcp/server.js',
  ].join('\n');
  wrapper.append(pre);
  wrapper.append(
    actionButton('Check again', 'cv-quiet', () => {
      void loadSetup();
    }),
  );
  wrapper.append(
    actionButton('Back to gallery', 'cv-icon-btn', () => {
      showSetup = false;
      updateHeader();
      renderBody();
    }),
  );
  return wrapper;
}

function renderRemoteBanner(): HTMLElement {
  const banner = el('div', 'cv-remote-banner');
  banner.setAttribute('role', 'status');
  banner.textContent =
    'This client is connected to another machine. Artifacts cannot open in the local browser panel. Use Copy URL or Export.';
  return banner;
}

function renderBody(): void {
  if (shell === null) return;
  shell.body.replaceChildren();
  if (remote) shell.body.append(renderRemoteBanner());
  if (error !== null) shell.body.append(renderError());
  if (showSetup) {
    shell.body.append(renderSetup());
    return;
  }
  if (selectedId !== null) {
    shell.body.append(renderDetail());
    return;
  }
  shell.body.append(renderList());
}

host.onReady((context) => {
  applyHostReady(context, document.documentElement);
  document.body.dataset.surface = context.surface;
  remote = !isLoopbackHost(window.location.hostname);
  const previousDirectory = directory;
  directory = context.directory;
  if (directory === null) scope = 'all';
  if (!mounted) {
    mounted = true;
    mountShell();
    void refresh();
    return;
  }
  if (previousDirectory !== directory) {
    selectedId = null;
    detail = null;
    void refresh();
  }
  updateHeader();
  renderBody();
});

host.onDirectory((next) => {
  if (next === directory) return;
  directory = next;
  if (directory === null) scope = 'all';
  selectedId = null;
  detail = null;
  updateHeader();
  renderBody();
  void refresh();
});

window.setInterval(() => {
  if (document.visibilityState === 'visible') void refresh();
}, 3000);

document.addEventListener('keydown', (event) => {
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
  shell?.search.focus();
});
