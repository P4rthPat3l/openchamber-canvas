import { test, expect } from 'bun:test';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { ArtifactStore } from '../src/store/index';
import { sha256 } from '../src/store/fs';
import { captureRendering, loadRendering, installedRendering } from '../src/viewer/rendering';
import { createViewerServer } from '../src/viewer/server';
import { PreviewStore } from '../src/preview/index';

test('AC-083 AC-084: promotion imports the tested renderer despite package changes and rejects corrupt dependencies', async () => {
  const root = await fs.mkdtemp('/tmp/opencode/canvas-promote-rendering-');
  try {
    const assets = path.join(root, 'assets');
    await fs.mkdir(assets);
    const source = { runtimeFile: path.join(assets, 'runtime.js'), librariesDir: assets };
    await fs.writeFile(source.runtimeFile, 'window.testedRuntime = true;');
    await fs.writeFile(path.join(assets, 'manifest.json'), JSON.stringify({ libraries: {} }));
    const previews = new PreviewStore({ root, renderingSource: source });
    const owner = { directory: root, sessionId: 'ses_rendering_preview' };
    const candidate = await previews.create({ ...owner, title: 'Frozen', kind: 'html', files: [{ path: 'index.html', content: '<h1>Frozen</h1>' }] });
    await fs.writeFile(source.runtimeFile, 'window.untestedRuntime = true;');
    const destination = new ArtifactStore({ root, renderingSource: source });
    const promote = () => previews.promote(candidate.id, owner, snapshot => destination.create({ ...owner, title: 'Promoted', kind: 'html', files: snapshot.files.map(file => ({ path: file.path, content: file.content })), rendering: { root: previews.storeRoot, id: snapshot.manifest.rendering ?? '' } }));
    const published = await promote();
    const reference = (await destination.read(published.id)).manifest.rendering ?? '';
    expect((await loadRendering(root, reference)).runtime).toContain('testedRuntime');
    expect((await loadRendering(root, reference)).runtime).not.toContain('untestedRuntime');
    await fs.writeFile(path.join(previews.storeRoot, '.rendering', reference, 'runtime.js'), 'tampered');
    await expect(promote()).rejects.toMatchObject({ code: 'RENDERING_UNAVAILABLE' });
    expect((await destination.list()).total).toBe(1);
    await fs.unlink(path.join(previews.storeRoot, '.rendering', reference, 'runtime.js'));
    await expect(promote()).rejects.toMatchObject({ code: 'RENDERING_UNAVAILABLE' });
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('AC-083: a changed-content preview retry keeps the tested rendering after the package changes', async () => {
  const root = await fs.mkdtemp('/tmp/opencode/canvas-retry-rendering-');
  try {
    const assets = path.join(root, 'assets');
    await fs.mkdir(assets);
    const source = { runtimeFile: path.join(assets, 'runtime.js'), librariesDir: assets };
    await fs.writeFile(source.runtimeFile, 'window.testedRuntime = true;');
    await fs.writeFile(path.join(assets, 'manifest.json'), JSON.stringify({ libraries: {} }));
    const previews = new PreviewStore({ root, renderingSource: source });
    const owner = { directory: root, sessionId: 'ses_retry_rendering' };
    const candidate = await previews.create({ ...owner, title: 'Tested', kind: 'html', files: [{ path: 'index.html', content: '<h1>Tested</h1>' }] });
    const destination = new ArtifactStore({ root, renderingSource: source });
    const promote = (baseVersion?: string) => previews.promote(candidate.id, owner, snapshot => destination.create({ ...owner, title: 'Promoted', kind: 'html', dedupeKey: `preview:${candidate.id}`, baseVersion,
      files: snapshot.files.map(file => ({ path: file.path, content: file.content })), rendering: { root: previews.storeRoot, id: snapshot.manifest.rendering ?? '' } }));
    const published = await promote();
    const tested = (await destination.read(published.id)).manifest.rendering;
    const later = await destination.update(published.id, { mode: 'replace', baseVersion: published.version, files: [{ path: 'index.html', content: '<h1>Edited later</h1>' }] });
    expect((await destination.read(published.id)).manifest.rendering).toBe(tested);
    await fs.writeFile(source.runtimeFile, 'window.untestedRuntime = true;');
    const retried = await promote(later.version);
    expect(retried.contentChanged).toBe(true);
    expect((await destination.read(published.id, retried.version)).manifest.rendering).toBe(tested);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('AC-061 AC-062: rendering bytes survive dependency updates and restarts; restores retain references', async () => {
  const root = await fs.mkdtemp('/tmp/opencode/canvas-rendering-');
  const source = { runtimeFile: path.join(root, 'package/runtime.js'), librariesDir: path.join(root, 'package') };
  await fs.mkdir(source.librariesDir);
  const write = async (revision: number) => {
    const bytes = Buffer.from(`globalThis.Chart = { revision: ${revision} };`);
    await fs.writeFile(source.runtimeFile, `globalThis.revision = ${revision};`);
    await fs.writeFile(path.join(source.librariesDir, 'chartjs.js'), bytes);
    await fs.writeFile(path.join(source.librariesDir, 'manifest.json'), JSON.stringify({ libraries: { chartjs: { file: 'chartjs.js', bytes: bytes.length, sha256: sha256(bytes) } } }));
  };
  try {
    await write(1);
    const store = new ArtifactStore({ root: path.join(root, 'store'), renderingSource: source });
    const first = await store.create({ title: 'Pinned', kind: 'html', directory: root, libraries: ['chartjs'], files: [{ path: 'index.html', content: '<head></head><h1>One</h1>' }] });
    const reference = (await store.read(first.id)).manifest.rendering;
    expect(reference).toBeTruthy();
    if (!reference) throw new Error('Expected a pinned renderer');
    expect(await captureRendering(store.storeRoot, source, ['chartjs'])).toBe(reference);
    await write(2);
    for (let restart = 0; restart < 2; restart++) {
      const viewer = await createViewerServer({ store, secret: 'rendering-test-secret-at-least-32', ...source });
      try {
        const base = `http://127.0.0.1:${viewer.port}`;
        const minted = await fetch(`${base}/mint`, { method: 'POST', headers: { authorization: `Bearer ${viewer.secret}`, 'content-type': 'application/json' }, body: JSON.stringify({ id: first.id }) }).then(response => response.json());
        const html = await fetch(minted.url).then(response => response.text());
        expect(html).toContain('revision = 1');
        const library = await fetch(`${base}/rendering/${reference}/chartjs.js`).then(response => response.text());
        expect(library).toContain('revision: 1');
        const rendering = await loadRendering(store.storeRoot, reference ?? '');
        expect(rendering.runtime).toContain('revision = 1');
        expect(rendering.libraries.chartjs?.toString()).toContain('revision: 1');
      } finally { await viewer.close(); }
    }
    const second = await store.update(first.id, { mode: 'replace', baseVersion: first.version, files: [{ path: 'index.html', content: '<head></head><h1>Two</h1>' }] });
    expect((await store.read(first.id)).manifest.rendering).not.toBe(reference);
    await store.update(first.id, { mode: 'restore', baseVersion: second.version, restoreFrom: first.version });
    expect((await store.read(first.id)).manifest.rendering).toBe(reference);
    await fs.writeFile(path.join(store.storeRoot, '.rendering', reference ?? '', 'runtime.js'), 'tampered');
    await expect(loadRendering(store.storeRoot, reference ?? '')).rejects.toThrow('verification');
    const before = (await store.list()).total;
    await expect(store.create({ title: 'Missing', kind: 'html', directory: root, libraries: ['missing'], files: [{ path: 'index.html', content: 'x' }] })).rejects.toThrow();
    expect((await store.list()).total).toBe(before);
    const legacy = new ArtifactStore({ root: path.join(root, 'legacy') });
    const old = await legacy.create({ title: 'Legacy', kind: 'html', directory: root, files: [{ path: 'index.html', content: '<h1>Legacy</h1>' }] });
    expect((await legacy.read(old.id)).manifest.rendering).toBeUndefined();
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('AC-061: rendering snapshots reject escaping symlinks and unsupported API versions', async () => {
  const root = await fs.mkdtemp('/tmp/opencode/canvas-rendering-path-');
  const outside = await fs.mkdtemp('/tmp/opencode/canvas-rendering-outside-');
  try {
    await fs.symlink(outside, path.join(root, '.rendering'));
    await expect(captureRendering(root, installedRendering(), [])).rejects.toThrow('escape');
    expect(await fs.readdir(outside)).toEqual([]);
    await fs.unlink(path.join(root, '.rendering'));
    const reference = await captureRendering(root, installedRendering(), []);
    await fs.rename(path.join(root, '.rendering', reference), path.join(outside, reference));
    await fs.symlink(path.join(outside, reference), path.join(root, '.rendering', reference));
    await expect(loadRendering(root, reference)).rejects.toThrow('escape');
    await fs.unlink(path.join(root, '.rendering', reference));
    await fs.rename(path.join(outside, reference), path.join(root, '.rendering', reference));
    const filename = path.join(root, '.rendering', reference, 'manifest.json');
    const manifest = JSON.parse(await fs.readFile(filename, 'utf8'));
    manifest.api = 999;
    await fs.writeFile(filename, JSON.stringify(manifest));
    await expect(loadRendering(root, reference)).rejects.toThrow('Unsupported rendering API');
    await expect(loadRendering(root, '0'.repeat(64))).rejects.toThrow('missing');
  } finally { await fs.rm(root, { recursive: true, force: true }); await fs.rm(outside, { recursive: true, force: true }); }
});
