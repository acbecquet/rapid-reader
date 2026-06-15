import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../api/items.js';

// Minimal req/res shims matching what Vercel and dev-server.mjs provide.
function call(method, { body, query } = {}) {
  return new Promise((resolve) => {
    const req = { method, headers: {}, body: body || {}, query: query || {} };
    const res = {
      headers: {},
      setHeader(k, v) { this.headers[k] = v; },
      status(c) { this.code = c; return this; },
      json(o) { resolve({ code: this.code, body: o }); },
      end() { resolve({ code: this.code }); },
    };
    handler(req, res);
  });
}

test('items CRUD: lean stubs in the index, body loaded on demand', async () => {
  let r = await call('GET');
  assert.equal(r.code, 200);
  assert.deepEqual(r.body.items, []);
  assert.ok(r.body.prefs); // poll carries prefs
  assert.equal('geminiKey' in r.body.prefs, false); // but never the raw key
  assert.equal(r.body.prefs.hasGeminiKey, false);

  r = await call('POST', { body: { text: '  Some highlighted passage about reading speed.  ', sourceType: 'manual' } });
  assert.equal(r.code, 201);
  const item = r.body.item;
  assert.equal(item.title.length > 0, true);
  assert.equal(item.readAt, null);
  assert.equal(item.progress, 0);
  assert.equal(item.words, 6);
  assert.equal('text' in item, false); // stub carries no body
  assert.ok(item.id);

  // the body is fetched by id for the reader
  r = await call('GET', { query: { id: item.id } });
  assert.equal(r.body.text, 'Some highlighted passage about reading speed.');
  assert.equal(r.body.item.id, item.id);

  r = await call('POST', { body: { text: 'Second item here', sourceType: 'manual' } });
  r = await call('GET');
  assert.equal(r.body.items.length, 2);
  assert.equal(r.body.items[0].title.length > 0, true); // newest first

  r = await call('PATCH', { body: { id: item.id, readAt: 123 } });
  assert.equal(r.body.item.readAt, 123);

  r = await call('DELETE', { query: { id: item.id } });
  r = await call('GET');
  assert.equal(r.body.items.length, 1);

  r = await call('DELETE', { body: { ids: r.body.items.map((i) => i.id) } });
  r = await call('GET');
  assert.deepEqual(r.body.items, []);
});

test('soft-delete: recoverable via trash + restore; hard erases', async () => {
  let r = await call('POST', { body: { text: 'a passage to delete and recover later', sourceType: 'manual' } });
  const id = r.body.item.id;

  await call('DELETE', { query: { id } });                          // soft
  r = await call('GET');
  assert.equal(r.body.items.find((i) => i.id === id), undefined);   // hidden from the poll
  r = await call('GET', { query: { trash: '1' } });
  const t = r.body.items.find((i) => i.id === id);
  assert.ok(t && t.deletedAt);                                       // present in Trash

  await call('PATCH', { body: { id, deletedAt: null } });           // restore
  r = await call('GET');
  assert.ok(r.body.items.find((i) => i.id === id));

  await call('DELETE', { query: { id }, body: { hard: true } });    // erase
  r = await call('GET', { query: { trash: '1' } });
  assert.equal(r.body.items.find((i) => i.id === id), undefined);
});

test('source types: explicit, claude.ai detection, manual default, progress/archive patch', async () => {
  let r = await call('POST', { body: { text: 'Codex says hi', sourceType: 'codex' } });
  assert.equal(r.body.item.sourceType, 'codex');
  const codexId = r.body.item.id;

  r = await call('POST', { body: { text: 'From a Claude session', url: 'https://claude.ai/chat/abc', sourceType: 'claude_code' } });
  assert.equal(r.body.item.sourceType, 'claude_code');

  r = await call('POST', { body: { text: 'Pasted by hand' } });
  assert.equal(r.body.item.sourceType, 'manual');

  r = await call('POST', { body: { text: 'Bogus type falls back', sourceType: 'nonsense' } });
  assert.equal(r.body.item.sourceType, 'manual');

  r = await call('PATCH', { body: { id: codexId, progress: 42 } });
  assert.equal(r.body.item.progress, 42);
  r = await call('PATCH', { body: { id: codexId, archivedAt: 777 } });
  assert.equal(r.body.item.archivedAt, 777);

  const { body } = await call('GET');
  await call('DELETE', { body: { ids: body.items.map((i) => i.id) } });
});

test('a disabled source toggle drops its inflow', async () => {
  // turn codex off via prefs, then a codex POST is ignored
  const prefsHandler = (await import('../api/prefs.js')).default;
  await new Promise((resolve) => {
    const req = { method: 'PATCH', headers: {}, body: { source: 'codex', on: false }, query: {} };
    const res = { setHeader() {}, status(c) { this.code = c; return this; }, json() { resolve(); } };
    prefsHandler(req, res);
  });
  let r = await call('POST', { body: { text: 'codex output', sourceType: 'codex' } });
  assert.equal(r.body.ignored, true);
  r = await call('GET');
  assert.equal(r.body.items.length, 0);
  // re-enable for other tests
  await new Promise((resolve) => {
    const req = { method: 'PATCH', headers: {}, body: { source: 'codex', on: true }, query: {} };
    const res = { setHeader() {}, status(c) { this.code = c; return this; }, json() { resolve(); } };
    prefsHandler(req, res);
  });
});

test('rejects empty text and unknown methods', async () => {
  let r = await call('POST', { body: { text: '   ' } });
  assert.equal(r.code, 400);
  r = await call('PUT');
  assert.equal(r.code, 405);
  r = await call('PATCH', { body: { id: 'nope' } });
  assert.equal(r.code, 404);
});

test('requires token when RAPID_READER_TOKEN is set', async () => {
  process.env.RAPID_READER_TOKEN = 'secret';
  try {
    let r = await call('GET');
    assert.equal(r.code, 401);
    r = await new Promise((resolve) => {
      const req = { method: 'GET', headers: { authorization: 'Bearer secret' }, query: {} };
      const res = {
        setHeader() {},
        status(c) { this.code = c; return this; },
        json(o) { resolve({ code: this.code, body: o }); },
      };
      handler(req, res);
    });
    assert.equal(r.code, 200);
    r = await call('GET', { query: { token: 'secret' } });
    assert.equal(r.code, 200);
  } finally {
    delete process.env.RAPID_READER_TOKEN;
  }
});
