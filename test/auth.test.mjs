import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import loginHandler from '../api/login.js';
import itemsHandler from '../api/items.js';

// A local RSA keypair plays the role of Google's signing keys; global fetch
// is stubbed to serve its JWKS.
const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'test-key', alg: 'RS256', use: 'sig' };
const realFetch = global.fetch;
global.fetch = async (url) => {
  if (String(url).includes('googleapis.com/oauth2/v3/certs')) {
    return { ok: true, json: async () => ({ keys: [jwk] }) };
  }
  return realFetch(url);
};

function makeIdToken({ sub = '111222333', email = 'friend@example.com', aud = 'test-client', exp } = {}) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const head = b64({ alg: 'RS256', kid: 'test-key', typ: 'JWT' });
  const body = b64({
    sub, email, name: 'Test Friend', aud,
    iss: 'https://accounts.google.com',
    exp: exp ?? Math.floor(Date.now() / 1000) + 3600,
  });
  const sig = crypto.sign('RSA-SHA256', Buffer.from(`${head}.${body}`), privateKey).toString('base64url');
  return `${head}.${body}.${sig}`;
}

function call(handler, method, { body, headers, query } = {}) {
  return new Promise((resolve) => {
    const req = { method, headers: headers || {}, body: body || {}, query: query || {} };
    const res = {
      setHeader() {},
      status(c) { this.code = c; return this; },
      json(o) { resolve({ code: this.code, body: o }); },
      end() { resolve({ code: this.code }); },
    };
    handler(req, res);
  });
}

const login = (token) => call(loginHandler, 'POST', { body: { credential: token } });
const itemsAs = (bearer, method = 'GET', extra = {}) =>
  call(itemsHandler, method, { ...extra, headers: { authorization: 'Bearer ' + bearer } });

test('google sign-in: verify, mint session, namespace data per user', async () => {
  process.env.GOOGLE_CLIENT_ID = 'test-client';
  process.env.RAPID_READER_TOKEN = 'dev-secret';
  process.env.OWNER_EMAIL = 'owner@example.com';
  try {
    // GET exposes the public client id
    let r = await call(loginHandler, 'GET');
    assert.equal(r.body.clientId, 'test-client');

    // two different Google users get distinct working sessions
    r = await login(makeIdToken({ sub: 'alice-sub', email: 'alice@example.com' }));
    assert.equal(r.code, 200);
    const alice = r.body.token;
    assert.equal(r.body.email, 'alice@example.com');

    r = await login(makeIdToken({ sub: 'bob-sub', email: 'bob@example.com' }));
    const bob = r.body.token;

    r = await itemsAs(alice, 'POST', { body: { text: 'Alice private item' } });
    assert.equal(r.code, 201);
    r = await itemsAs(alice);
    assert.equal(r.body.items.length, 1);
    r = await itemsAs(bob);
    assert.deepEqual(r.body.items, []); // isolation

    // owner email maps to the original un-namespaced data (= dev token's view)
    r = await call(itemsHandler, 'POST', {
      headers: { authorization: 'Bearer dev-secret' },
      body: { text: 'Owner legacy item' },
    });
    r = await login(makeIdToken({ sub: 'owner-sub', email: 'Owner@Example.com' }));
    const ownerSession = r.body.token;
    r = await itemsAs(ownerSession);
    assert.equal(r.body.items[0].text, 'Owner legacy item');

    // cleanup
    for (const t of [alice, ownerSession]) {
      const { body } = await itemsAs(t);
      if (body.items.length) await itemsAs(t, 'DELETE', { body: { ids: body.items.map((i) => i.id) } });
    }
  } finally {
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.RAPID_READER_TOKEN;
    delete process.env.OWNER_EMAIL;
  }
});

test('login rejects bad tokens, wrong audience, expiry, and tampering', async () => {
  process.env.GOOGLE_CLIENT_ID = 'test-client';
  process.env.RAPID_READER_TOKEN = 'dev-secret';
  try {
    assert.equal((await login('garbage')).code, 401);
    assert.equal((await login(makeIdToken({ aud: 'someone-else' }))).code, 401);
    assert.equal((await login(makeIdToken({ exp: Math.floor(Date.now() / 1000) - 10 }))).code, 401);
    const tampered = makeIdToken().split('.');
    tampered[1] = Buffer.from(JSON.stringify({ sub: 'evil', aud: 'test-client', iss: 'https://accounts.google.com', exp: 9999999999 })).toString('base64url');
    assert.equal((await login(tampered.join('.'))).code, 401);
    // forged session tokens are rejected by the data api
    assert.equal((await itemsAs('evil-sub.' + 'ab'.repeat(32))).code, 401);
  } finally {
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.RAPID_READER_TOKEN;
  }
});

test('ALLOWED_EMAILS guest list gates sign-in', async () => {
  process.env.GOOGLE_CLIENT_ID = 'test-client';
  process.env.RAPID_READER_TOKEN = 'dev-secret';
  process.env.ALLOWED_EMAILS = 'vip@example.com, second@example.com';
  try {
    assert.equal((await login(makeIdToken({ email: 'stranger@example.com' }))).code, 403);
    assert.equal((await login(makeIdToken({ email: 'VIP@example.com' }))).code, 200);
  } finally {
    delete process.env.ALLOWED_EMAILS;
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.RAPID_READER_TOKEN;
  }
});

test('login reports unconfigured Google cleanly', async () => {
  const r = await call(loginHandler, 'GET');
  assert.equal(r.body.clientId, null);
  const r2 = await login(makeIdToken());
  assert.equal(r2.code, 503);
});

test('PUBLIC_DEMO: tokenless visitors share the dev-token queue', async () => {
  process.env.RAPID_READER_TOKEN = 'dev-secret';
  process.env.PUBLIC_DEMO = '1';
  try {
    // visitor (no token) can use the app
    let r = await call(itemsHandler, 'POST', { body: { text: 'Demo visitor item' } });
    assert.equal(r.code, 201);
    r = await call(itemsHandler, 'GET');
    assert.equal(r.body.items[0].text, 'Demo visitor item');

    // the dev token sees the same queue (family/demo phase)
    r = await itemsAs('dev-secret');
    assert.equal(r.body.items[0].text, 'Demo visitor item');

    // cleanup, then verify the off-switch
    const { body } = await call(itemsHandler, 'GET');
    await call(itemsHandler, 'DELETE', { body: { ids: body.items.map((i) => i.id) } });
    delete process.env.PUBLIC_DEMO;
    r = await call(itemsHandler, 'GET');
    assert.equal(r.code, 401);
  } finally {
    delete process.env.PUBLIC_DEMO;
    delete process.env.RAPID_READER_TOKEN;
  }
});
