import { afterEach, expect, test } from 'bun:test';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { PreviewStore, PREVIEW_TTL_MS } from '../src/preview/index';
import { ArtifactStore } from '../src/store/index';
import { installedRendering } from '../src/viewer/rendering';
import { withArtifactLock } from '../src/store/lock';

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true }); });
const owner = { directory: '/projects/example', sessionId: 'ses_preview_test' };
async function fixture() {
  const root = await fs.mkdtemp('/tmp/opencode/canvas-preview-');
  roots.push(root);
  let time = Date.now();
  const previews = new PreviewStore({ root, renderingSource: installedRendering(), now: () => new Date(time) });
  const published = new ArtifactStore({ root, renderingSource: installedRendering() });
  const create = () => previews.create({ ...owner, title: 'Candidate', kind: 'html', files: [{ path: 'index.html', content: '<h1>Candidate</h1>' }] });
  return { root, previews, published, create, advance: () => { time += PREVIEW_TTL_MS + 1; } };
}

test('AC-082 AC-083: preview state stays unpublished and promotion freezes files and rendering', async () => {
  const { previews, published, create } = await fixture();
  const candidate = await create();
  await previews.use(candidate.id, async store => {
    await store.writeStateKey(candidate.id, 'draft', true);
    await store.addFeedback(candidate.id, { version: candidate.version, data: { draft: true } });
  });
  expect((await published.list()).total).toBe(0);
  const promoted = await previews.promote(candidate.id, owner, async snapshot => published.create({
    ...owner, title: 'Published', kind: snapshot.meta.kind, entry: snapshot.manifest.entry,
    libraries: snapshot.meta.libraries, files: snapshot.files.map(file => ({ path: file.path, content: file.content })),
    rendering: { root: previews.storeRoot, id: snapshot.manifest.rendering ?? '' },
  }));
  const source = await previews.use(candidate.id, store => store.read(candidate.id));
  const result = await published.read(promoted.id);
  expect(result.manifest.files).toEqual(source.manifest.files);
  expect(result.manifest.rendering).toBe(source.manifest.rendering);
  expect(result.meta.versions).toHaveLength(1);
  expect(await published.readState(promoted.id)).toEqual({});
  expect((await published.feedbackPage(promoted.id)).total).toBe(0);
});

test('AC-084: foreign ownership, corrupt source, and symlink escapes fail', async () => {
  const { root, previews, create } = await fixture();
  const candidate = await create();
  for (const foreign of [{ ...owner, sessionId: 'ses_foreign' }, { ...owner, directory: '/other' }]) {
    await expect(previews.promote(candidate.id, foreign, async () => true)).rejects.toMatchObject({ code: 'PREVIEW_OWNERSHIP' });
  }
  await fs.writeFile(path.join(previews.storeRoot, candidate.id, 'versions', candidate.version, 'index.html'), '<h1>Tampered</h1>');
  await expect(previews.promote(candidate.id, owner, async () => true)).rejects.toMatchObject({ code: 'INVALID_ARTIFACT' });
  const outside = path.join(root, 'outside');
  await fs.mkdir(outside);
  await fs.symlink(outside, path.join(previews.storeRoot, '06GPKC3DMMKBG26E4CC9HE33HZ-linked'));
  await expect(previews.use('06GPKC3DMMKBG26E4CC9HE33HZ-linked', async () => true)).rejects.toMatchObject({ code: 'INVALID_PATH' });
  await previews.cleanup();
  expect(await fs.readdir(outside)).toEqual([]);
});

test('AC-085: expiry blocks access and cleanup skips active promotion until it finishes', async () => {
  const { previews, create, advance, published } = await fixture();
  const candidate = await create();
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const promotion = previews.promote(candidate.id, owner, async () => { entered.resolve(); await release.promise; return true; });
  await entered.promise;
  advance();
  await previews.cleanup();
  expect(await fs.stat(path.join(previews.storeRoot, candidate.id))).toBeDefined();
  release.resolve();
  expect(await promotion).toBe(true);
  await previews.cleanup();
  await expect(previews.use(candidate.id, async () => true)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  const next = await create();
  advance();
  await expect(previews.use(next.id, async () => true)).rejects.toMatchObject({ code: 'PREVIEW_EXPIRED' });
  await expect(previews.promote(next.id, owner, async () => true)).rejects.toMatchObject({ code: 'PREVIEW_EXPIRED' });
  expect((await published.list()).total).toBe(0);
});

test('AC-085: a cancelled snapshot waiter cannot run after its lock is released', async () => {
  const { previews, create } = await fixture();
  const candidate = await create();
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const holding = previews.use(candidate.id, async () => { entered.resolve(); await release.promise; });
  await entered.promise;
  const controller = new AbortController();
  let ran = false;
  const waiting = previews.promote(candidate.id, owner, async () => { ran = true; }, controller.signal);
  controller.abort();
  await expect(waiting).rejects.toThrow();
  release.resolve();
  await holding;
  expect(ran).toBe(false);
});

test('AC-085: preview locking never steals an aged live owner or removes a successor lock', async () => {
  const { root } = await fixture();
  const lock = path.join(root, 'protected.lock');
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const options = { retryMs: 1, timeoutMs: 30, staleMs: 1, protectLiveOwner: true };
  const first = withArtifactLock(lock, async () => { entered.resolve(); await release.promise; }, options);
  await entered.promise;
  const old = new Date(Date.now() - 60_000);
  await fs.utimes(lock, old, old);
  try {
    await expect(withArtifactLock(lock, async () => 'stolen', options)).rejects.toMatchObject({ code: 'LOCK_TIMEOUT' });
    expect(await fs.stat(lock)).toBeDefined();
  } finally { release.resolve(); await first; }

  const formerEntered = Promise.withResolvers<void>();
  const formerRelease = Promise.withResolvers<void>();
  const former = withArtifactLock(lock, async () => { formerEntered.resolve(); await formerRelease.promise; }, options);
  await formerEntered.promise;
  await fs.rename(lock, `${lock}.former`);
  const successorEntered = Promise.withResolvers<void>();
  const successorRelease = Promise.withResolvers<void>();
  const successor = withArtifactLock(lock, async () => { successorEntered.resolve(); await successorRelease.promise; }, options);
  await successorEntered.promise;
  formerRelease.resolve();
  await former;
  try { expect(await fs.stat(lock)).toBeDefined(); }
  finally { successorRelease.resolve(); await successor; }
});

test('AC-085: abandoned protected locks recover and unrelated live previews do not block creation', async () => {
  const { root, previews, create } = await fixture();
  const child = Bun.spawn([process.execPath, '-e', 'process.exit(0)'], { stdout: 'ignore', stderr: 'ignore' });
  await child.exited;
  const lock = path.join(root, 'abandoned.lock');
  await fs.mkdir(lock);
  await fs.writeFile(path.join(lock, 'owner.json'), JSON.stringify({ pid: child.pid, at: new Date(0).toISOString(), token: 'abandoned' }));
  await fs.utimes(lock, new Date(0), new Date(0));
  const options = { retryMs: 1, timeoutMs: 200, staleMs: 1, protectLiveOwner: true };
  let active = 0;
  let peak = 0;
  await Promise.all(Array.from({ length: 8 }, () => withArtifactLock(lock, async () => {
    active += 1; peak = Math.max(peak, active); await Bun.sleep(2); active -= 1;
  }, options)));
  expect(peak).toBe(1);
  const candidate = await create();
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const holding = previews.use(candidate.id, async () => { entered.resolve(); await release.promise; });
  await entered.promise;
  try { expect((await create()).id).not.toBe(candidate.id); }
  finally { release.resolve(); await holding; }
});
