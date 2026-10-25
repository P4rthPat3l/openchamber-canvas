import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { spawn } from 'node:child_process';
import { ArtifactStore } from '../../src/store/index';
import { installedRendering } from '../../src/viewer/rendering';
import { readViewerState, mintViewUrl, notifyViewer } from '../../src/viewer/ensure';

export async function builtViewer() {
  const root = await fs.mkdtemp('/tmp/opencode/canvas-browser-');
  const portFile = path.join(root, '.viewer.json');
  const child = spawn('node', [path.resolve('viewer/server.js')], {
    env: { ...process.env, CANVAS_STORE: root, CANVAS_VIEWER_PORT_FILE: portFile }, stdio: 'ignore',
  });
  let state = await readViewerState(portFile);
  const deadline = Date.now() + 10_000;
  while (!state) {
    if (child.exitCode !== null || Date.now() > deadline) {
      child.kill('SIGTERM');
      await fs.rm(root, { recursive: true, force: true });
      throw new Error('Built Node viewer did not start');
    }
    await new Promise(resolve => setTimeout(resolve, 30));
    state = await readViewerState(portFile);
  }
  const viewer = state;
  const store = new ArtifactStore({ root, renderingSource: installedRendering() });
  return {
    store, root, state: viewer,
    mint: (id: string, version?: string, theme?: 'light' | 'dark') => mintViewUrl(viewer, { id, version, theme }),
    notify: (id: string, version: string) => notifyViewer(viewer, { id, version, event: 'changed' }),
    close: async () => {
      const exited = new Promise<void>(resolve => child.once('exit', () => resolve()));
      child.kill('SIGTERM');
      if (child.exitCode === null) await exited;
      await fs.rm(root, { recursive: true, force: true });
    },
  };
}
