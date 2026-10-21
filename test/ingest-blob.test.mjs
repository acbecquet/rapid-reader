import test from 'node:test';
import assert from 'node:assert/strict';
import { addItem, CAP } from '../api/_lib/ingest.js';
import { _setBlobSdk, getBody, getDoc, setDoc } from '../api/_lib/store.js';
import { keyFor } from '../api/_lib/auth.js';

// Blob layer stub: records puts/deletes; every put is a fresh URL, like the
// real SDK with addRandomSuffix. No Redis creds → index + Redis-tier bodies
// live in the in-memory store.
for (const k of Object.keys(process.env)) {
  if (/(redis|kv_|_kv|blob|upstash|read_write_token)/i.test(k)) delete process.env[k];
}
let n = 0;
const blobs = { put: [], del: [] };
_setBlobSdk({
  put: async (path) => { const url = `https://blob.test/${path}-${++n}`; blobs.put.push(url); return { url }; },
  del: async (url) => { blobs.del.push(url); },
});
const withBlob = async (fn) => {
  process.env.BLOB_READ_WRITE_TOKEN = 'test';
  try { return await fn(); } finally { delete process.env.BLOB_READ_WRITE_TOKEN; }
};

test('session upsert deletes the blob it replaces', () => withBlob(async () => {
  const uid = 'u-upsert';
  const a = await addItem(uid, { text: 'turn one', sourceType: 'claude_code', sessionId: 's1' }, { gated: false });
  const firstUrl = a.item.bodyUrl; // the in-memory store mutates the same object
  const b = await addItem(uid, { text: 'turn one turn two', sourceType: 'claude_code', sessionId: 's1' }, { gated: false });
  assert.equal(b.updated, true);
  assert.notEqual(b.item.bodyUrl, firstUrl);
  assert.deepEqual(blobs.del, [firstUrl]);
  const items = await getDoc(keyFor('rr:items', uid), []);
  assert.equal(items.length, 1);
  assert.equal(items[0].bodyUrl, b.item.bodyUrl);
}));

test('Redis-backed body (bodyUrl null) survives a session upsert', async () => {
  const uid = 'u-redis';
  blobs.del.length = 0;
  await addItem(uid, { text: 'first', sourceType: 'claude_code', sessionId: 's2' }, { gated: false });
  const b = await addItem(uid, { text: 'first and second', sourceType: 'claude_code', sessionId: 's2' }, { gated: false });
  assert.equal(b.item.bodyUrl, null);
  assert.equal(await getBody(uid, b.item.id, null), 'first and second');
  assert.deepEqual(blobs.del, []);
});

test('items trimmed past CAP have their bodies deleted', () => withBlob(async () => {
  const uid = 'u-cap';
  blobs.del.length = 0;
  const KEY_U = keyFor('rr:items', uid);
  const old = Array.from({ length: CAP }, (_, i) => ({ id: 'old' + i, bodyUrl: 'https://blob.test/old' + i }));
  old[CAP - 1].bodyUrl = null; // a Redis-tier body at the tail
  await setDoc('rr:body:' + uid + ':old' + (CAP - 1), { t: 'tail text' });
  await setDoc(KEY_U, old);

  // the last item (Redis body) falls off: its rr:body key goes
  await addItem(uid, { text: 'new one', sourceType: 'manual' }, { gated: false });
  assert.equal(await getBody(uid, 'old' + (CAP - 1), null), '');
  assert.deepEqual(blobs.del, []);

  // the next falls off too: its blob is deleted
  await addItem(uid, { text: 'new two', sourceType: 'manual' }, { gated: false });
  assert.deepEqual(blobs.del, ['https://blob.test/old' + (CAP - 2)]);
  assert.equal((await getDoc(KEY_U, [])).length, CAP);
}));
