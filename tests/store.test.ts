import { afterEach, describe, expect, test } from 'bun:test';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import { ArtifactStore } from '../src/store/index';
import type { ArtifactStoreOptions } from '../src/store/index';
import type { CreateArtifactInput, CreateResult } from '../src/store/types';
import { decodeText, expectStoreError } from './helpers';

const temporaryRoots: string[] = [];

afterEach(async () => {
  for (const root of temporaryRoots.splice(0)) {
    await fs.rm(root, { recursive: true, force: true });
  }
});

async function makeRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'canvas-store-'));
  temporaryRoots.push(root);
  return root;
}

function makeStore(root: string, overrides: Partial<ArtifactStoreOptions> = {}) {
  let tick = 0;
  let now = new Date('2026-10-23T14:25:01.123Z');
  const store = new ArtifactStore({
    root,
    now: () => now,
    random: (size) => {
      tick += 1;
      const bytes = new Uint8Array(size);
      bytes.fill((tick % 255) + 1);
      return bytes;
    },
    lockRetryMs: 2,
    lockTimeoutMs: 200,
    lockStaleMs: 1000,
    ...overrides,
  });
  return {
    store,
    advance: (milliseconds = 1000) => {
      now = new Date(now.getTime() + milliseconds);
    },
    setNow: (date: Date) => {
      now = date;
    },
  };
}

function page(body = '<h1>Revenue</h1>', color = '#2563eb'): string {
  return [
    '<!doctype html>',
    '<html>',
    '<head><style>:root{--accent:',
    color,
    '}</style></head>',
    '<body>',
    body,
    "<script>const color = '",
    color,
    "';</script>",
    '</body>',
    '</html>',
  ].join('');
}

async function createHtml(
  store: ArtifactStore,
  overrides: Partial<CreateArtifactInput> = {},
): Promise<CreateResult> {
  return store.create({
    title: 'Revenue by region',
    kind: 'html',
    directory: '/home/parth/Project',
    files: [{ path: 'index.html', content: page() }],
    ...overrides,
  });
}

describe('artifact store', () => {
  test('AC-055: every content replacement and changed dedupe publish requires a current base', async () => {
    const root = await makeRoot();
    const { store } = makeStore(root);
    const created = await createHtml(store, { dedupeKey: 'guarded' });
    const files = [{ path: 'index.html', content: page('<h1>New</h1>') }];
    await expectStoreError(store.update(created.id, { mode: 'replace', files }), 'INVALID_UPDATE');
    await expectStoreError(createHtml(store, { dedupeKey: 'guarded', files }), 'INVALID_UPDATE');
    const next = await store.update(created.id, { mode: 'replace', files, baseVersion: created.version });
    await expectStoreError(store.update(created.id, { mode: 'replace', files, baseVersion: created.version }), 'CONFLICT');
    const concurrent = await Promise.allSettled([
      store.update(created.id, { mode: 'replace', files, baseVersion: next.version }),
      store.update(created.id, { mode: 'replace', files, baseVersion: next.version }),
    ]);
    expect(concurrent.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect((await store.getMeta(created.id)).versions).toHaveLength(3);
  });

  test('AC-057: metadata-only changes and identical dedupe keep the content version', async () => {
    const root = await makeRoot();
    const { store } = makeStore(root);
    const created = await createHtml(store, { dedupeKey: 'metadata' });
    const updated = await store.update(created.id, { mode: 'metadata', baseVersion: created.version, tags: ['revised'] });
    expect(updated.version).toBe(created.version);
    expect(updated.changedFiles).toEqual([]);
    expect(updated.meta.versions).toHaveLength(1);
    const deduped = await store.create({ title: 'Renamed', kind: 'html', directory: created.meta.directory, dedupeKey: 'metadata', files: [{ path: 'index.html', content: page() }] });
    expect(deduped.meta.title).toBe('Renamed');
    expect(deduped.meta.tags).toEqual(['revised']);
    expect(deduped.version).toBe(created.version);
    expect(deduped.meta.versions).toHaveLength(1);
  });

  test('AC-055 AC-057: concurrent dedupe, entry changes, and omitted tags retain correct semantics', async () => {
    const root = await makeRoot();
    const { store } = makeStore(root);
    const source = { title: 'Shared', kind: 'bundle' as const, directory: '/project', dedupeKey: 'shared', entry: 'a.html', tags: ['keep'], files: [{ path: 'a.html', content: 'A' }, { path: 'b.html', content: 'B' }] };
    const [left, right] = await Promise.all([store.create(source), store.create(source)]);
    expect(left.id).toBe(right.id);
    await expectStoreError(store.create({ ...source, entry: 'b.html' }), 'INVALID_UPDATE');
    const changed = await store.create({ ...source, entry: 'b.html', tags: undefined, baseVersion: left.version });
    expect(changed.contentChanged).toBe(true);
    expect(changed.meta.tags).toEqual(['keep']);
    expect((await store.read(left.id)).manifest.entry).toBe('b.html');
    const results = await Promise.allSettled([
      store.update(left.id, { mode: 'replace', baseVersion: changed.version, files: [{ path: 'index.html', content: 'New content' }], entry: 'index.html' }),
      store.create({ ...source, entry: 'b.html' }),
    ]);
    const published = results[1];
    if (published?.status === 'fulfilled') expect((await store.readVersion(left.id, published.value.version)).files.find(file => file.path === 'a.html')?.content.toString()).toBe('A');
    expect((await store.getMeta(left.id)).tags).toEqual(['keep']);
  });

  test('AC-059: filtering and title sort precede pagination across more than 200 artifacts', async () => {
    const root = await makeRoot();
    const { store, advance } = makeStore(root);
    const old = await createHtml(store, { title: 'Old searchable', tags: ['historic'] });
    for (let index = 0; index < 201; index++) { advance(); await createHtml(store, { title: `New ${String(index).padStart(3, '0')}` }); }
    const found = await store.list({ query: 'Old searchable' });
    expect(found.total).toBe(1);
    expect(found.artifacts[0]?.id).toBe(old.id);
    const page = await store.list({ sort: 'title', offset: 200, limit: 50 });
    expect(page.total).toBe(202);
    expect(page.artifacts).toHaveLength(2);
    expect(page.tags).toContain('historic');
    await store.trash(old.id);
    expect((await store.list({ trash: true, query: 'Old searchable' })).artifacts[0]?.id).toBe(old.id);
  }, 30_000);
  test('creates an html artifact with a manifest and a meta file', async () => {
    const root = await makeRoot();
    const { store } = makeStore(root);
    const result = await createHtml(store);

    expect(result.deduped).toBe(false);
    expect(result.id.endsWith('-revenue-by-region')).toBe(true);
    expect(result.version).toBe('20261023T142501123Z');
    expect(result.meta.currentVersion).toBe(result.version);
    expect(result.meta.versions).toHaveLength(1);
    expect(result.meta.directory).toBe('/home/parth/Project');
    expect(result.meta.projectName).toBe('Project');
    expect(result.meta.librarySet).toBe('canvas-2026-10');

    expect(decodeText(await store.readFile(result.id, undefined, 'index.html'))).toBe(page());

    const metaRaw: unknown = JSON.parse(
      await fs.readFile(path.join(root, result.id, 'meta.json'), 'utf8'),
    );
    expect(metaRaw).toMatchObject({ schema: 2, id: result.id });

    const manifestRaw: unknown = JSON.parse(
      await fs.readFile(
        path.join(root, result.id, 'versions', result.version, 'manifest.json'),
        'utf8',
      ),
    );
    expect(manifestRaw).toMatchObject({
      schema: 1,
      kind: 'html',
      entry: 'index.html',
    });
    const manifest = manifestRaw as { files: Array<{ path: string; sha256: string }> };
    expect(manifest.files).toHaveLength(1);
    expect(manifest.files[0]?.path).toBe('index.html');
    expect(manifest.files[0]?.sha256).toHaveLength(64);
  });

  test('sets user-only modes on the store', async () => {
    if (process.platform === 'win32') return;
    const root = await makeRoot();
    const { store } = makeStore(root);
    const result = await createHtml(store);

    const artifact = await fs.stat(path.join(root, result.id));
    const meta = await fs.stat(path.join(root, result.id, 'meta.json'));
    expect(artifact.mode & 0o777).toBe(0o700);
    expect(meta.mode & 0o777).toBe(0o600);
  });

  test('replaces the whole html and keeps the old version', async () => {
    const root = await makeRoot();
    const { store, advance } = makeStore(root);
    const first = await createHtml(store);
    advance();

    const second = await store.update(first.id, {
      mode: 'replace',
      baseVersion: first.version,
      files: [{ path: 'index.html', content: page('<h1>Revised</h1>') }],
    });

    expect(second.version).not.toBe(first.version);
    expect(second.meta.versions).toHaveLength(2);
    expect(decodeText(await store.readFile(first.id, first.version, 'index.html'))).toBe(page());
    expect(decodeText(await store.readFile(first.id, second.version, 'index.html'))).toBe(
      page('<h1>Revised</h1>'),
    );
  });

  test('merges one bundle file, carries the others, and removes the named ones', async () => {
    const root = await makeRoot();
    const { store, advance } = makeStore(root);
    const created = await store.create({
      title: 'Bundle',
      kind: 'bundle',
      directory: '/home/parth/Project',
      entry: 'index.html',
      files: [
        { path: 'index.html', content: page() },
        { path: 'app.js', content: 'console.log(1)' },
        { path: 'old.js', content: 'old' },
      ],
    });
    advance();

    const updated = await store.update(created.id, {
      mode: 'merge',
      baseVersion: created.version,
      files: [{ path: 'app.js', content: 'console.log(2)' }],
      remove: ['old.js'],
    });

    expect(updated.changedFiles).toEqual(['app.js', 'old.js']);
    expect(decodeText(await store.readFile(created.id, updated.version, 'index.html'))).toBe(page());
    expect(decodeText(await store.readFile(created.id, updated.version, 'app.js'))).toBe(
      'console.log(2)',
    );
    await expectStoreError(store.readFile(created.id, updated.version, 'old.js'), 'PATH_NOT_FOUND');
  });

  test('applies exact edits and leaves the rest unchanged', async () => {
    const root = await makeRoot();
    const { store, advance } = makeStore(root);
    const created = await createHtml(store);
    advance();

    const updated = await store.update(created.id, {
      mode: 'edits',
      baseVersion: created.version,
      edits: [
        { find: "const color = '#2563eb';", replace: "const color = '#db2777';" },
      ],
    });

    expect(updated.changedFiles).toEqual(['index.html']);
    const current = decodeText(await store.readFile(created.id, updated.version, 'index.html'));
    expect(current).toContain("const color = '#db2777';");
    expect(current.replace("const color = '#db2777';", "const color = '#2563eb';")).toBe(page());
  });

  test('rejects an edit that matches more than once and writes nothing', async () => {
    const root = await makeRoot();
    const { store } = makeStore(root);
    const created = await createHtml(store, {
      files: [{ path: 'index.html', content: page('<div></div><div></div>') }],
    });

    await expectStoreError(
      store.update(created.id, {
        mode: 'edits',
        baseVersion: created.version,
        edits: [{ find: '<div></div>', replace: '<p></p>' }],
      }),
      'EDIT_CONFLICT',
    );
    expect((await store.getMeta(created.id)).versions).toHaveLength(1);
  });

  test('rejects an edit that matches nothing and writes nothing', async () => {
    const root = await makeRoot();
    const { store } = makeStore(root);
    const created = await createHtml(store);

    await expectStoreError(
      store.update(created.id, {
        mode: 'edits',
        baseVersion: created.version,
        edits: [{ find: 'missing-token', replace: 'x' }],
      }),
      'EDIT_CONFLICT',
    );
    expect((await store.getMeta(created.id)).versions).toHaveLength(1);
  });

  test('restores an older version as a new version', async () => {
    const root = await makeRoot();
    const { store, advance } = makeStore(root);
    const first = await createHtml(store);
    advance();
    const second = await store.update(first.id, {
      mode: 'replace',
      baseVersion: first.version,
      files: [{ path: 'index.html', content: page('<h1>Second</h1>') }],
    });
    advance();

    const third = await store.update(first.id, {
      mode: 'restore',
      restoreFrom: first.version,
      baseVersion: second.version,
    });

    expect(third.meta.versions).toHaveLength(3);
    expect(third.meta.versions.at(-1)?.restoredFrom).toBe(first.version);
    expect(decodeText(await store.readFile(first.id, third.version, 'index.html'))).toBe(page());
  });

  test('rejects a stale baseVersion without writing a version', async () => {
    const root = await makeRoot();
    const { store, advance } = makeStore(root);
    const first = await createHtml(store);
    advance();
    await store.update(first.id, {
      mode: 'replace',
      baseVersion: first.version,
      files: [{ path: 'index.html', content: page('<h1>Second</h1>') }],
    });
    advance();

    await expectStoreError(
      store.update(first.id, {
        mode: 'replace',
        baseVersion: first.version,
        files: [{ path: 'index.html', content: page('<h1>Third</h1>') }],
      }),
      'CONFLICT',
    );
    expect((await store.getMeta(first.id)).versions).toHaveLength(2);
  });

  test('dedupes a publish with the same key and directory', async () => {
    const root = await makeRoot();
    const { store, advance } = makeStore(root);
    const first = await createHtml(store, { dedupeKey: 'turn-1' });
    advance();
    const second = await createHtml(store, { dedupeKey: 'turn-1' });

    expect(second.id).toBe(first.id);
    expect(second.deduped).toBe(true);
    expect((await store.getMeta(first.id)).versions).toHaveLength(1);
  });

  test('appends a version when a dedupe publish changes the content', async () => {
    const root = await makeRoot();
    const { store, advance } = makeStore(root);
    const first = await createHtml(store, { dedupeKey: 'turn-1' });
    advance();
    const second = await createHtml(store, {
      dedupeKey: 'turn-1',
      baseVersion: first.version,
      files: [{ path: 'index.html', content: page('<h1>Turn 2</h1>') }],
    });

    expect(second.id).toBe(first.id);
    expect(second.deduped).toBe(true);
    expect(second.version).not.toBe(first.version);
    const meta = await store.getMeta(first.id);
    expect(meta.versions).toHaveLength(2);
    expect(meta.currentVersion).toBe(second.version);
    expect(meta.tags).toEqual(first.meta.tags);
    expect(decodeText(await store.readFile(first.id, second.version, 'index.html'))).toBe(
      page('<h1>Turn 2</h1>'),
    );
  });

  test('does not dedupe across kinds', async () => {
    const root = await makeRoot();
    const { store } = makeStore(root);
    const first = await createHtml(store, { dedupeKey: 'turn-1' });

    const second = await store.create({
      title: 'Revenue by region',
      kind: 'bundle',
      directory: '/home/parth/Project',
      dedupeKey: 'turn-1',
      files: [{ path: 'index.html', content: page() }],
      entry: 'index.html',
    });
    expect(second.id).not.toBe(first.id);
    expect(second.deduped).toBe(false);
  });

  test('a dedupe publish keeps the dedupe key on the updated artifact', async () => {
    const root = await makeRoot();
    const { store, advance } = makeStore(root);
    const first = await createHtml(store, { dedupeKey: 'turn-1' });
    advance();
    const second = await createHtml(store, {
      dedupeKey: 'turn-1',
      baseVersion: first.version,
      files: [{ path: 'index.html', content: page('<h1>Turn 2</h1>') }],
    });
    const third = await createHtml(store, {
      dedupeKey: 'turn-1',
      baseVersion: second.version,
      files: [{ path: 'index.html', content: page('<h1>Turn 3</h1>') }],
    });

    expect(third.id).toBe(first.id);
    expect(third.deduped).toBe(true);
    expect((await store.getMeta(first.id)).versions).toHaveLength(3);
    expect((await store.getMeta(first.id)).dedupeKey).toBe('turn-1');
  });

  test('lists by project, tag, query, and archive state', async () => {
    const root = await makeRoot();
    const { store } = makeStore(root);
    const revenue = await createHtml(store, {
      title: 'Revenue by region',
      tags: ['q3'],
    });
    const costs = await createHtml(store, {
      title: 'Costs',
      tags: ['q4'],
      directory: '/home/parth/Other',
    });
    await store.archive(costs.id, true);

    expect((await store.list()).artifacts.map((item) => item.id)).toEqual([revenue.id]);
    expect((await store.list({ includeArchived: true })).artifacts).toHaveLength(2);
    expect((await store.list({ tag: 'q3' })).artifacts.map((item) => item.id)).toEqual([revenue.id]);
    expect(
      (await store.list({ query: 'cost', includeArchived: true })).artifacts.map((item) => item.id),
    ).toEqual([costs.id]);
    expect((await store.list({ directory: '/home/parth/Project' })).artifacts).toHaveLength(1);
    expect(
      (await store.list({ directory: '/home/parth/Other', includeArchived: true })).artifacts,
    ).toHaveLength(1);
  });

  test('skips a corrupt meta file and reports an error count', async () => {
    const root = await makeRoot();
    const { store } = makeStore(root);
    await createHtml(store);
    await fs.mkdir(path.join(root, 'broken'), { mode: 0o700 });
    await fs.writeFile(path.join(root, 'broken', 'meta.json'), '{"schema":2}', 'utf8');
    await fs.mkdir(path.join(root, 'exports'), { recursive: true });
    await fs.writeFile(path.join(root, 'exports', 'x.txt'), 'not an artifact', 'utf8');

    const listed = await store.list();
    expect(listed.artifacts).toHaveLength(1);
    expect(listed.errors).toBe(1);
  });

  test('archives, favorites, and pins a version', async () => {
    const root = await makeRoot();
    const { store } = makeStore(root);
    const created = await createHtml(store);

    expect((await store.archive(created.id, true)).archivedAt).not.toBeNull();
    expect((await store.list()).artifacts).toHaveLength(0);
    expect((await store.archive(created.id, false)).archivedAt).toBeNull();
    expect((await store.list()).artifacts).toHaveLength(1);
    expect((await store.setFavorite(created.id, true)).favorite).toBe(true);
    expect((await store.setPinned(created.id, created.version)).pinnedVersion).toBe(
      created.version,
    );
    await expectStoreError(
      store.setPinned(created.id, '20260101T000000000Z'),
      'NOT_FOUND',
    );
    expect((await store.setPinned(created.id, null)).pinnedVersion).toBeNull();
  });

  test('trashes and restores an artifact', async () => {
    const root = await makeRoot();
    const { store } = makeStore(root);
    const created = await createHtml(store);

    await store.trash(created.id);
    await expectStoreError(store.getMeta(created.id), 'NOT_FOUND');
    expect((await store.list()).artifacts).toHaveLength(0);

    const restored = await store.untrash(created.id);
    expect(restored.id).toBe(created.id);
    expect((await store.list()).artifacts).toHaveLength(1);
  });

  test('prunes old versions but keeps the current and pinned ones', async () => {
    const root = await makeRoot();
    const { store, advance } = makeStore(root, { versionsKept: 3 });
    const first = await createHtml(store);
    await store.setPinned(first.id, first.version);

    let currentVersion = first.version;
    let prunedVersion = '';
    for (let index = 1; index <= 5; index += 1) {
      advance();
      const updated = await store.update(first.id, {
        mode: 'replace',
        baseVersion: currentVersion,
        files: [{ path: 'index.html', content: page(`<h1>Version ${index}</h1>`) }],
      });
      currentVersion = updated.version;
      if (index === 1) prunedVersion = updated.version;
    }

    const meta = await store.getMeta(first.id);
    expect(meta.versions.length).toBe(3);
    expect(meta.versions.some((version) => version.id === first.version)).toBe(true);
    expect(meta.currentVersion).toBe(currentVersion);
    expect(decodeText(await store.readFile(first.id, first.version, 'index.html'))).toBe(page());
    expect(prunedVersion).not.toBe('');
    await expectStoreError(store.readFile(first.id, prunedVersion, 'index.html'), 'NOT_FOUND');
  });

  test('rejects traversal and unsafe paths', async () => {
    const root = await makeRoot();
    const { store } = makeStore(root);

    for (const badPath of ['../evil.html', '/etc/passwd', 'a\\b.html', 'CON.html', 'a//b.html']) {
      await expectStoreError(
        store.create({
          title: 'Bad',
          kind: 'html',
          directory: '/home/parth/Project',
          files: [{ path: badPath, content: 'x' }],
        }),
        'INVALID_PATH',
      );
    }

    const valid = await createHtml(store);
    await expectStoreError(
      store.update(valid.id, {
        mode: 'merge',
        baseVersion: valid.version,
        files: [{ path: '../evil.js', content: 'x' }],
      }),
      'INVALID_PATH',
    );
    await expectStoreError(
      store.update(valid.id, {
        mode: 'merge',
        baseVersion: valid.version,
        files: [],
        remove: ['../evil.js'],
      }),
      'INVALID_PATH',
    );
  });

  test('enforces file, bundle, and count caps', async () => {
    const root = await makeRoot();

    await expectStoreError(
      createHtml(makeStore(root, { maxHtmlBytes: 10 }).store),
      'TOO_LARGE',
    );

    const fileCapped = makeStore(await makeRoot(), { maxFileBytes: 5 }).store;
    await expectStoreError(
      fileCapped.create({
        title: 'Too big',
        kind: 'html',
        directory: '/home/parth/Project',
        files: [{ path: 'index.html', content: '123456' }],
      }),
      'TOO_LARGE',
    );

    const countCapped = makeStore(await makeRoot(), { maxBundleFiles: 1 }).store;
    await expectStoreError(
      countCapped.create({
        title: 'Too many',
        kind: 'bundle',
        directory: '/home/parth/Project',
        entry: 'index.html',
        files: [
          { path: 'index.html', content: page() },
          { path: 'app.js', content: 'x' },
        ],
      }),
      'TOO_MANY_FILES',
    );
  });

  test('rejects kinds that are not implemented', async () => {
    const root = await makeRoot();
    const { store } = makeStore(root);
    await expectStoreError(
      store.create({
        title: 'Doc',
        kind: 'markdown',
        directory: '/home/parth/Project',
        files: [{ path: 'index.md', content: '# Doc' }],
      }),
      'UNSUPPORTED_KIND',
    );
  });

  test('rejects a second writer while the lock is fresh', async () => {
    const root = await makeRoot();
    const { store } = makeStore(root, { lockTimeoutMs: 30, lockRetryMs: 5 });
    const created = await createHtml(store);
    const lockDir = path.join(root, '.locks', `${created.id}.lock`);
    await fs.mkdir(lockDir, { mode: 0o700 });
    await fs.writeFile(path.join(lockDir, 'owner.json'), '{}', 'utf8');

    try {
      await expectStoreError(
        store.update(created.id, {
          mode: 'replace',
          baseVersion: created.version,
          files: [{ path: 'index.html', content: page('<h1>Second</h1>') }],
        }),
        'LOCK_TIMEOUT',
      );
    } finally {
      await fs.rm(lockDir, { recursive: true, force: true });
    }
  });

  test('recovers a stale lock', async () => {
    const root = await makeRoot();
    const { store } = makeStore(root, { lockTimeoutMs: 500, lockRetryMs: 5, lockStaleMs: 100 });
    const created = await createHtml(store);
    const lockDir = path.join(root, '.locks', `${created.id}.lock`);
    await fs.mkdir(lockDir, { mode: 0o700 });
    await fs.writeFile(path.join(lockDir, 'owner.json'), '{}', 'utf8');
    await fs.utimes(lockDir, new Date(0), new Date(0));

    const updated = await store.update(created.id, {
      mode: 'replace',
      baseVersion: created.version,
      files: [{ path: 'index.html', content: page('<h1>Second</h1>') }],
    });
    expect(updated.version).not.toBe(created.version);
  });

  test('keeps version ids monotonic when the clock does not move', async () => {
    const root = await makeRoot();
    const { store } = makeStore(root);
    const first = await createHtml(store);
    const second = await store.update(first.id, {
      mode: 'replace',
      baseVersion: first.version,
      files: [{ path: 'index.html', content: page('<h1>Second</h1>') }],
    });
    expect(second.version > first.version).toBe(true);
  });

  test('reads a bundle version with every file', async () => {
    const root = await makeRoot();
    const { store } = makeStore(root);
    const created = await store.create({
      title: 'Bundle',
      kind: 'bundle',
      directory: '/home/parth/Project',
      entry: 'index.html',
      files: [
        { path: 'index.html', content: page() },
        { path: 'assets/app.js', content: 'console.log(1)' },
      ],
    });

    const version = await store.readVersion(created.id);
    expect(version.files).toHaveLength(2);
    const app = version.files.find((file) => file.path === 'assets/app.js');
    expect(app).toBeDefined();
    expect(decodeText(app?.content ?? new Uint8Array())).toBe('console.log(1)');
  });
});
