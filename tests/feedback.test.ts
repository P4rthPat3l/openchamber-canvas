import { afterEach, describe, expect, test } from 'bun:test';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import { ArtifactStore } from '../src/store/index';
import type { ArtifactStoreOptions } from '../src/store/index';
import type { CreateResult } from '../src/store/types';
import { expectStoreError } from './helpers';

const temporaryRoots: string[] = [];

afterEach(async () => {
  for (const root of temporaryRoots.splice(0)) {
    await fs.rm(root, { recursive: true, force: true });
  }
});

async function makeRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'canvas-feedback-'));
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
  };
}

function page(): string {
  return '<!doctype html><html><body><h1>Feedback</h1></body></html>';
}

async function createHtml(store: ArtifactStore): Promise<CreateResult> {
  return store.create({
    title: 'Feedback probe',
    kind: 'html',
    directory: '/home/parth/Project',
    files: [{ path: 'index.html', content: page() }],
  });
}

describe('feedback and runtime state', () => {
  test('AC-051 AC-052: equal-timestamp feedback pages are complete and pending totals exclude composed records', async () => {
    const root = await makeRoot();
    const { store } = makeStore(root);
    const created = await createHtml(store);
    for (let index = 0; index < 55; index++) await store.addFeedback(created.id, { version: created.version, data: { index } });
    const first = await store.feedbackPage(created.id, { limit: 50 });
    const second = await store.feedbackPage(created.id, { offset: 50, limit: 50 });
    expect(first.total).toBe(55);
    expect(first.pending).toBe(55);
    expect(new Set([...first.responses, ...second.responses].map(record => record.id)).size).toBe(55);
    await store.markFeedbackDelivered(created.id, first.responses.slice(0, 2).map(record => record.id));
    expect((await store.list({ limit: 1 })).pendingFeedbackCount).toBe(53);
    expect((await store.feedbackPage(created.id)).pending).toBe(53);
  });
  test('writes, lists, and marks feedback delivered', async () => {
    const root = await makeRoot();
    const { store } = makeStore(root);
    const created = await createHtml(store);

    const record = await store.addFeedback(created.id, {
      version: created.version,
      kind: 'form',
      data: { region: 'EMEA' },
    });
    expect(record.id).toMatch(/^fb_/);
    expect(record.deliveredAt).toBeNull();
    expect(await store.countFeedback(created.id)).toBe(1);

    const listed = await store.listFeedback(created.id);
    expect(listed).toHaveLength(1);
    expect(listed[0]?.data).toEqual({ region: 'EMEA' });
    expect(listed[0]?.version).toBe(created.version);

    expect(await store.markFeedbackDelivered(created.id, [record.id])).toBe(1);
    const delivered = await store.listFeedback(created.id);
    expect(delivered[0]?.deliveredAt).not.toBeNull();
  });

  test('rejects feedback for an unknown version and oversized data', async () => {
    const root = await makeRoot();
    const { store } = makeStore(root);
    const created = await createHtml(store);

    await expectStoreError(
      store.addFeedback(created.id, {
        version: '20260101T000000000Z',
        data: { region: 'EMEA' },
      }),
      'NOT_FOUND',
    );

    await expectStoreError(
      store.addFeedback(created.id, {
        version: created.version,
        data: 'x'.repeat(70 * 1024),
      }),
      'TOO_LARGE',
    );
  });

  test('reads, writes, deletes, and clears runtime state', async () => {
    const root = await makeRoot();
    const { store } = makeStore(root);
    const created = await createHtml(store);

    const written = await store.writeStateKey(created.id, 'filter', { region: 'EMEA' });
    expect(written.filter).toEqual({ region: 'EMEA' });

    const read = await store.readState(created.id);
    expect(read.filter).toEqual({ region: 'EMEA' });

    await store.writeStateKey(created.id, 'filter', undefined);
    expect((await store.readState(created.id)).filter).toBeUndefined();

    await store.writeStateKey(created.id, 'seen', true);
    await store.clearState(created.id);
    expect(await store.readState(created.id)).toEqual({});
  });

  test('caps a state key and the full state', async () => {
    const root = await makeRoot();
    const { store } = makeStore(root);
    const created = await createHtml(store);

    await expectStoreError(
      store.writeStateKey(created.id, 'x'.repeat(130), true),
      'INVALID_ARTIFACT',
    );

    await expectStoreError(
      store.writeStateKey(created.id, 'big', 'x'.repeat(1024 * 1024 + 1)),
      'TOO_LARGE',
    );
  });
});
