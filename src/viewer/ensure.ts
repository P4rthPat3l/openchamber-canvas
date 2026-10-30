import { spawn } from 'node:child_process';
import * as fs from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { packageRoot } from './rendering';

import { ensureDir, readJson, sleep } from '../store/fs';
import { withArtifactLock } from '../store/lock';

export interface ViewerState {
  schema: 1;
  port: number;
  pid: number;
  secret: string;
  startedAt: string;
}

export const VIEWER_PROTOCOL = 2;
export function viewerBuild(): string {
  try {
    const value: unknown = JSON.parse(readFileSync(path.join(packageRoot(), 'viewer/build.json'), 'utf8'));
    if (isRecord(value) && typeof value.id === 'string') return value.id;
  } catch { /* Source-only tests do not require a distribution build. */ }
  return 'unbuilt';
}

interface ViewerHealth { protocol?: number; build?: string }

export interface EnsureViewerOptions {
  storeRoot: string;
  portFile: string;
  viewerEntry: string;
  idleMs?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
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

async function viewerHealth(state: ViewerState, signal?: AbortSignal): Promise<ViewerHealth | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 1500);
  try {
    const response = await fetch(`http://127.0.0.1:${state.port}/health`, {
      headers: { authorization: `Bearer ${state.secret}` },
      signal: signal ? AbortSignal.any([signal, controller.signal]) : controller.signal,
    });
    if (!response.ok) return null;
    const value: unknown = await response.json();
    if (!isRecord(value) || value.pid !== state.pid) return null;
    return { protocol: typeof value.protocol === 'number' ? value.protocol : undefined, build: typeof value.build === 'string' ? value.build : undefined };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function checkViewer(state: ViewerState): Promise<boolean> {
  const health = await viewerHealth(state);
  return health?.protocol === VIEWER_PROTOCOL && health.build === viewerBuild();
}

export async function viewerStatus(portFile: string): Promise<{ status: string; restartable: boolean }> {
  const state = await readViewerState(portFile);
  if (!state) return { status: 'Not running', restartable: false };
  const health = await viewerHealth(state);
  if (!health) return { status: 'Not running', restartable: false };
  if (health.protocol !== VIEWER_PROTOCOL) return { status: 'Legacy viewer. Close Canvas views and stop the old Canvas viewer before reopening.', restartable: false };
  return { status: health.build === viewerBuild() ? 'Compatible' : 'Update requires restart. Reopen Canvas views afterward.', restartable: true };
}

async function stopViewer(state: ViewerState, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  const health = await viewerHealth(state, signal);
  signal?.throwIfAborted();
  if (health?.protocol !== VIEWER_PROTOCOL) throw new ViewerUnavailableError('Legacy viewer cannot be restarted automatically. Close Canvas views and stop the old Canvas viewer, then reopen from the gallery.');
  const timeout = AbortSignal.timeout(1500);
  const response = await fetch(`http://127.0.0.1:${state.port}/shutdown`, { method: 'POST', headers: { authorization: `Bearer ${state.secret}` }, signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
  if (!response.ok) throw new ViewerUnavailableError('Viewer restart was rejected. Close Canvas views and retry.');
  const deadline = Date.now() + 3000;
  while (await viewerHealth(state, signal)) {
    signal?.throwIfAborted();
    if (Date.now() >= deadline) throw new ViewerUnavailableError('Viewer did not stop. Close Canvas views and retry.');
    await sleep(50);
  }
}

export async function restartViewer(options: EnsureViewerOptions): Promise<ViewerState> {
  const expected = await readViewerState(options.portFile);
  return ensureViewerLocked(options, expected?.startedAt);
}

export async function ensureViewer(options: EnsureViewerOptions): Promise<ViewerState> {
  return ensureViewerLocked(options);
}

async function ensureViewerLocked(options: EnsureViewerOptions, restartStartedAt?: string): Promise<ViewerState> {
  options.signal?.throwIfAborted();
  const timeoutMs = options.timeoutMs ?? 15_000;
  const lockDir = `${options.portFile}.lock`;

  try {
    const ready = await withArtifactLock(
      lockDir,
      async () => {
        options.signal?.throwIfAborted();
        const existing = await readViewerState(options.portFile);
        if (existing !== null) {
          const health = await viewerHealth(existing, options.signal);
          options.signal?.throwIfAborted();
          const restarting = restartStartedAt !== undefined && existing.startedAt === restartStartedAt;
          if (!restarting && health?.protocol === VIEWER_PROTOCOL && health.build === viewerBuild()) return existing;
          if (health) await stopViewer(existing, options.signal);
        }

        await ensureDir(options.storeRoot);
        options.signal?.throwIfAborted();
        await fs.rm(options.portFile, { force: true });
        const child = spawn(process.execPath, [options.viewerEntry], {
          detached: true,
          stdio: 'ignore',
          env: {
            ...process.env,
            ...(process.versions.bun ? { BUN_BE_BUN: '1' } : {}),
            ELECTRON_RUN_AS_NODE: '1',
            CANVAS_STORE: options.storeRoot,
            CANVAS_VIEWER_PORT_FILE: options.portFile,
            CANVAS_VIEWER_IDLE_MS: String(options.idleMs ?? 30 * 60 * 1000),
          },
        });
        child.unref();

        const deadline = Date.now() + timeoutMs;
        // A detached child owns this startup once spawned. Keep the lock until
        // it is ready, even if its original caller no longer needs the view.
        for (;;) {
          const state = await readViewerState(options.portFile);
          const health = state === null ? null : await viewerHealth(state);
          if (state !== null && health?.protocol === VIEWER_PROTOCOL && health.build === viewerBuild()) return state;
          if (Date.now() >= deadline) {
            throw new ViewerUnavailableError('The viewer did not start within the timeout.');
          }
          await sleep(100);
        }
      },
      { retryMs: 50, timeoutMs, staleMs: 30_000, signal: options.signal },
    );
    options.signal?.throwIfAborted();
    return ready;
  } catch (error) {
    options.signal?.throwIfAborted();
    if (error instanceof ViewerUnavailableError) throw error;
    throw new ViewerUnavailableError(
      error instanceof Error ? error.message : 'The viewer could not be started.',
    );
  }
}

export async function mintViewUrl(
  state: ViewerState,
  input: { id: string; version?: string; theme?: 'light' | 'dark'; follow?: boolean },
  signal?: AbortSignal,
): Promise<{ url: string; expiresAt: number }> {
  const response = await fetch(`http://127.0.0.1:${state.port}/mint`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${state.secret}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(input),
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(3000)]) : AbortSignal.timeout(3000),
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
  signal?: AbortSignal,
): Promise<number> {
  const response = await fetch(`http://127.0.0.1:${state.port}/notify`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${state.secret}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(input),
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(3000)]) : AbortSignal.timeout(3000),
  });
  if (!response.ok) {
    throw new ViewerUnavailableError(`The viewer rejected the notify request (${response.status}).`);
  }
  const body: unknown = await response.json();
  if (!isRecord(body) || typeof body.notified !== 'number') return 0;
  return body.notified;
}
