import { spawn } from 'node:child_process';
import * as fs from 'node:fs/promises';

import { ensureDir, readJson, sleep } from '../store/fs';
import { withArtifactLock } from '../store/lock';

export interface ViewerState {
  schema: 1;
  port: number;
  pid: number;
  secret: string;
  startedAt: string;
}

export interface EnsureViewerOptions {
  storeRoot: string;
  portFile: string;
  viewerEntry: string;
  idleMs?: number;
  timeoutMs?: number;
}

export class ViewerUnavailableError extends Error {
  readonly code = 'VIEWER_UNAVAILABLE';

  constructor(message: string) {
    super(message);
    this.name = 'ViewerUnavailableError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export async function readViewerState(portFile: string): Promise<ViewerState | null> {
  try {
    const raw = await readJson(portFile);
    if (!isRecord(raw)) return null;
    if (raw.schema !== 1) return null;
    if (typeof raw.port !== 'number' || !Number.isInteger(raw.port) || raw.port <= 0) return null;
    if (typeof raw.pid !== 'number' || !Number.isInteger(raw.pid)) return null;
    if (typeof raw.secret !== 'string' || raw.secret.length < 16) return null;
    if (typeof raw.startedAt !== 'string') return null;
    return {
      schema: 1,
      port: raw.port,
      pid: raw.pid,
      secret: raw.secret,
      startedAt: raw.startedAt,
    };
  } catch {
    return null;
  }
}

async function isHealthy(state: ViewerState): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 1500);
  try {
    const response = await fetch(`http://127.0.0.1:${state.port}/health`, {
      headers: { authorization: `Bearer ${state.secret}` },
      signal: controller.signal,
    });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export async function checkViewer(state: ViewerState): Promise<boolean> {
  return isHealthy(state);
}

export async function ensureViewer(options: EnsureViewerOptions): Promise<ViewerState> {
  const timeoutMs = options.timeoutMs ?? 15_000;
  const lockDir = `${options.portFile}.lock`;

  try {
    return await withArtifactLock(
      lockDir,
      async () => {
        const existing = await readViewerState(options.portFile);
        if (existing !== null && (await isHealthy(existing))) return existing;

        await ensureDir(options.storeRoot);
        await fs.rm(options.portFile, { force: true });
        const child = spawn(process.execPath, [options.viewerEntry], {
          detached: true,
          stdio: 'ignore',
          env: {
            ...process.env,
            ELECTRON_RUN_AS_NODE: '1',
            CANVAS_STORE: options.storeRoot,
            CANVAS_VIEWER_PORT_FILE: options.portFile,
            CANVAS_VIEWER_IDLE_MS: String(options.idleMs ?? 30 * 60 * 1000),
          },
        });
        child.unref();

        const deadline = Date.now() + timeoutMs;
        for (;;) {
          const state = await readViewerState(options.portFile);
          if (state !== null && (await isHealthy(state))) return state;
          if (Date.now() >= deadline) {
            throw new ViewerUnavailableError('The viewer did not start within the timeout.');
          }
          await sleep(100);
        }
      },
      { retryMs: 50, timeoutMs, staleMs: 30_000 },
    );
  } catch (error) {
    if (error instanceof ViewerUnavailableError) throw error;
    throw new ViewerUnavailableError(
      error instanceof Error ? error.message : 'The viewer could not be started.',
    );
  }
}

export async function mintViewUrl(
  state: ViewerState,
  input: { id: string; version?: string; theme?: 'light' | 'dark' },
): Promise<{ url: string; expiresAt: number }> {
  const response = await fetch(`http://127.0.0.1:${state.port}/mint`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${state.secret}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    throw new ViewerUnavailableError(`The viewer rejected the view request (${response.status}).`);
  }
  const body: unknown = await response.json();
  if (!isRecord(body) || typeof body.url !== 'string') {
    throw new ViewerUnavailableError('The viewer returned no view URL.');
  }
  return {
    url: body.url,
    expiresAt: typeof body.expiresAt === 'number' ? body.expiresAt : 0,
  };
}

export async function notifyViewer(
  state: ViewerState,
  input: { id: string; event: 'changed' | 'deleted'; version?: string },
): Promise<number> {
  const response = await fetch(`http://127.0.0.1:${state.port}/notify`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${state.secret}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    throw new ViewerUnavailableError(`The viewer rejected the notify request (${response.status}).`);
  }
  const body: unknown = await response.json();
  if (!isRecord(body) || typeof body.notified !== 'number') return 0;
  return body.notified;
}
