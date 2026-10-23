interface CanvasUpdate {
  event: 'changed' | 'deleted';
  id: string;
  version?: string;
  url?: string;
}

interface CanvasStorage {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
}

interface CanvasApi {
  id: string;
  version: string;
  theme: 'light' | 'dark';
  storage: CanvasStorage;
  feedback(data: unknown, kind?: string): Promise<{ id: string }>;
  data(sourceId: string): Promise<unknown>;
  refresh(): Promise<void>;
  onUpdate(handler: (update: CanvasUpdate) => void): () => void;
}

declare global {
  interface Window {
    canvas?: CanvasApi;
  }
}

const segments = window.location.pathname.split('/').filter(Boolean);
const token = segments[1] ?? '';
const id = segments[2] ?? '';
const version = segments[3] ?? '';

const query = new URLSearchParams(window.location.search);
const requestedTheme = query.get('theme');
const theme: 'light' | 'dark' =
  requestedTheme === 'dark' || requestedTheme === 'light'
    ? requestedTheme
    : window.matchMedia('(prefers-color-scheme: dark)').matches
      ? 'dark'
      : 'light';
document.documentElement.dataset.theme = theme;

async function requestJson(url: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(url, init);
  if (!response.ok) {
    throw new Error(`Canvas request failed (${response.status})`);
  }
  return response.json();
}

async function readState(): Promise<Record<string, unknown>> {
  const body = await requestJson(`/api/${token}/state`);
  if (
    typeof body === 'object' &&
    body !== null &&
    'state' in body &&
    typeof body.state === 'object' &&
    body.state !== null &&
    !Array.isArray(body.state)
  ) {
    return body.state as Record<string, unknown>;
  }
  return {};
}

const storage: CanvasStorage = {
  async get(key: string): Promise<unknown> {
    return (await readState())[key];
  },
  async set(key: string, value: unknown): Promise<void> {
    await requestJson(`/api/${token}/state`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ key, value }),
    });
  },
  async delete(key: string): Promise<void> {
    await requestJson(`/api/${token}/state`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ key, delete: true }),
    });
  },
};

async function feedback(data: unknown, kind = 'form'): Promise<{ id: string }> {
  const body = await requestJson(`/api/${token}/feedback`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ kind, data }),
  });
  return body as { id: string };
}

async function data(sourceId: string): Promise<unknown> {
  return requestJson(`/data/${token}/${id}/${encodeURIComponent(sourceId)}`);
}

async function refresh(): Promise<void> {
  await requestJson(`/api/${token}/refresh`, { method: 'POST' });
}

const updateHandlers = new Set<(update: CanvasUpdate) => void>();

function onUpdate(handler: (update: CanvasUpdate) => void): () => void {
  updateHandlers.add(handler);
  return () => {
    updateHandlers.delete(handler);
  };
}

if (token.length > 0 && id.length > 0 && typeof EventSource !== 'undefined') {
  const source = new EventSource(`/events/${token}/${id}`);
  source.onmessage = (event) => {
    let payload: CanvasUpdate;
    try {
      payload = JSON.parse(event.data) as CanvasUpdate;
    } catch {
      return;
    }
    if (payload.event !== 'changed' && payload.event !== 'deleted') return;
    if (updateHandlers.size > 0) {
      for (const handler of updateHandlers) handler(payload);
      return;
    }
    if (payload.event === 'changed' && payload.url) {
      const next = new URL(payload.url);
      const themeParam = new URLSearchParams(window.location.search).get('theme');
      if (themeParam) next.searchParams.set('theme', themeParam);
      window.location.href = next.toString();
      return;
    }
    window.location.reload();
  };
}

window.canvas = {
  id,
  version,
  theme,
  storage,
  feedback,
  data,
  refresh,
  onUpdate,
};

export {};
