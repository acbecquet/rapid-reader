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

test('items CRUD flow in memory mode', async () => {
  let r = await call('GET');
  assert.equal(r.code, 200);
  assert.deepEqual(r.body.items, []);

  r = await call('POST', { body: { text: '  Some highlighted passage about reading speed.  ', url: 'https://example.com/article' } });
  assert.equal(r.code, 201);
  const item = r.body.item;
  assert.equal(item.text, 'Some highlighted passage about reading speed.');
  assert.equal(item.source, 'example.com');
  assert.equal(item.sourceType, 'web');
  assert.equal(item.readAt, null);
  assert.equal(item.progress, 0);
  assert.equal(item.archivedAt, null);
  assert.ok(item.title.length > 0); // fallback title without GEMINI_API_KEY
  assert.ok(item.id);

  r = await call('POST', { body: { text: 'Second item' } });
  r = await call('GET');
  assert.equal(r.body.items.length, 2);
  assert.equal(r.body.items[0].text, 'Second item'); // newest first

  r = await call('PATCH', { body: { id: item.id, readAt: 123 } });
  assert.equal(r.code, 200);
  assert.equal(r.body.item.readAt, 123);

  r = await call('DELETE', { query: { id: item.id } });
  assert.equal(r.code, 200);
  r = await call('GET');
  assert.equal(r.body.items.length, 1);

  r = await call('DELETE', { body: { ids: r.body.items.map((i) => i.id) } });
  r = await call('GET');
  assert.deepEqual(r.body.items, []);
});

test('source types: explicit, claude.ai detection, manual default, progress/archive patch', async () => {
  let r = await call('POST', { body: { text: 'Codex says hi', sourceType: 'codex' } });
  assert.equal(r.body.item.sourceType, 'codex');
  const codexId = r.body.item.id;

  r = await call('POST', { body: { text: 'From a Claude session', url: 'https://claude.ai/chat/abc' } });
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

test('summarize without GEMINI_API_KEY reports 502', async () => {
  let r = await call('POST', { body: { text: 'diff --git a/x b/x\n+new line' } });
  r = await call('PATCH', { body: { id: r.body.item.id, summarize: true } });
  assert.equal(r.code, 502);
  const { body } = await call('GET');
  await call('DELETE', { body: { ids: body.items.map((i) => i.id) } });
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
