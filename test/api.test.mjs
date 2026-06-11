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
  assert.equal(item.readAt, null);
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

test('PUBLIC_DEMO: tokenless visitors get a shared sandbox, owner data stays private', async () => {
  process.env.RAPID_READER_TOKEN = 'secret';
  process.env.PUBLIC_DEMO = '1';
  const asOwner = (method, extra = {}) => new Promise((resolve) => {
    const req = { method, headers: { authorization: 'Bearer secret' }, body: extra.body || {}, query: extra.query || {} };
    const res = {
      setHeader() {},
      status(c) { this.code = c; return this; },
      json(o) { resolve({ code: this.code, body: o }); },
    };
    handler(req, res);
  });
  try {
    // owner adds a private item
    let r = await asOwner('POST', { body: { text: 'Owner private item' } });
    assert.equal(r.code, 201);

    // tokenless visitor: allowed, sees an empty sandbox (not owner data)
    r = await call('GET');
    assert.equal(r.code, 200);
    assert.deepEqual(r.body.items, []);

    // visitor adds to the sandbox; owner does not see it
    r = await call('POST', { body: { text: 'Demo visitor item' } });
    assert.equal(r.code, 201);
    r = await call('GET');
    assert.equal(r.body.items[0].text, 'Demo visitor item');
    r = await asOwner('GET');
    assert.equal(r.body.items.length, 1);
    assert.equal(r.body.items[0].text, 'Owner private item');

    // cleanup both stores
    r = await call('GET');
    await call('DELETE', { body: { ids: r.body.items.map((i) => i.id) } });
    r = await asOwner('GET');
    await asOwner('DELETE', { body: { ids: r.body.items.map((i) => i.id) } });

    // with PUBLIC_DEMO off again, tokenless is rejected
    delete process.env.PUBLIC_DEMO;
    r = await call('GET');
    assert.equal(r.code, 401);
  } finally {
    delete process.env.PUBLIC_DEMO;
    delete process.env.RAPID_READER_TOKEN;
  }
});
