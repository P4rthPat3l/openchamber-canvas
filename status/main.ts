import { connectHost } from '@openchamber/sdk';
import { applyHostReady } from '@openchamber/sdk/ui';

interface ArtifactSummary {
  id: string;
  title: string;
}

interface ListResponse {
  artifacts: ArtifactSummary[];
  errors: number;
}

const host = connectHost();
const countEl = document.querySelector<HTMLSpanElement>('#count');
const titleEl = document.querySelector<HTMLSpanElement>('#title');
const mcpEl = document.querySelector<HTMLSpanElement>('#mcp');
const mcpDot = document.querySelector<HTMLSpanElement>('#mcp-dot');

let directory: string | null = null;
let started = false;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function request<T>(path: string): Promise<T> {
  const response = await host.serviceRequest({ method: 'GET', path });
  if (response.status >= 400) throw new Error(`Canvas service error (${response.status})`);
  const parsed: unknown = JSON.parse(response.body);
  return parsed as T;
}

function render(count: number | null, title: string, live: boolean): void {
  if (countEl !== null) {
    countEl.textContent =
      count === null ? 'offline' : `${count} ${count === 1 ? 'artifact' : 'artifacts'}`;
  }
  if (titleEl !== null) titleEl.textContent = title;
  if (mcpEl !== null) {
    const label = live ? 'MCP connected' : 'MCP setup needed';
    mcpEl.setAttribute('aria-label', label);
    mcpEl.title = label;
  }
  if (mcpDot !== null) mcpDot.dataset.live = String(live);
}

async function refresh(): Promise<void> {
  try {
    const params = new URLSearchParams({ limit: '200' });
    if (directory !== null) params.set('directory', directory);
    const data = await request<ListResponse>(`/list?${params.toString()}`);
    let live = false;
    try {
      const heartbeat = await request<Record<string, unknown> | null>('/mcp-status');
      if (heartbeat !== null && isRecord(heartbeat) && typeof heartbeat.seenAt === 'string') {
        const seen = Date.parse(heartbeat.seenAt);
        live = !Number.isNaN(seen) && Date.now() - seen < 3 * 60_000;
      }
    } catch {
      live = false;
    }
    const latest = data.artifacts[0];
    render(data.artifacts.length, latest === undefined ? 'No artifacts in this project' : latest.title, live);
  } catch {
    render(null, 'Canvas service unavailable', false);
  }
  await host.setHeight(76).catch(() => undefined);
}

host.onReady((context) => {
  applyHostReady(context, document.documentElement);
  directory = context.directory;
  if (!started) {
    started = true;
    void refresh();
  }
});

host.onDirectory((next) => {
  directory = next;
  void refresh();
});

window.setInterval(() => {
  if (document.visibilityState === 'visible') void refresh();
}, 5000);
