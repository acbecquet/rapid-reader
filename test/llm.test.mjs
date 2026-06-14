import test from 'node:test';
import assert from 'node:assert/strict';
import { llm, makeTitle, validateGeminiKey } from '../api/_lib/title.js';

function stubFetch(impl) {
  const real = global.fetch;
  global.fetch = impl;
  return () => { global.fetch = real; };
}

const geminiOk = { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: 'From Gemini' }] } }] }) };
const minimaxOk = { ok: true, json: async () => ({ choices: [{ message: { content: 'From MiniMax' } }] }) };

function bothKeys() {
  process.env.MINIMAX_API_KEY = 'mk';
  process.env.GEMINI_API_KEY = 'gk';
  return () => {
    delete process.env.MINIMAX_API_KEY;
    delete process.env.GEMINI_API_KEY;
  };
}

test('llm defaults to Gemini first (free tier)', async () => {
  const clean = bothKeys();
  const calls = [];
  const restore = stubFetch(async (url) => {
    calls.push(String(url));
    return String(url).includes('googleapis') ? geminiOk : minimaxOk;
  });
  try {
    assert.equal(await llm('hi', 100), 'From Gemini');
    assert.equal(calls.length, 1);
    assert.ok(calls[0].includes('googleapis'));
  } finally { restore(); clean(); }
});

test('llm falls over to MiniMax when Gemini is out of quota', async () => {
  const clean = bothKeys();
  const restore = stubFetch(async (url, opts) => {
    if (String(url).includes('googleapis')) return { ok: false, status: 429 };
    assert.equal(JSON.parse(opts.body).model, 'MiniMax-M3');
    assert.equal(opts.headers.authorization, 'Bearer mk');
    return minimaxOk;
  });
  try {
    assert.equal(await llm('hi', 100), 'From MiniMax');
  } finally { restore(); clean(); }
});

test("prefer:'minimax' goes straight to MiniMax", async () => {
  const clean = bothKeys();
  const calls = [];
  const restore = stubFetch(async (url) => {
    calls.push(String(url));
    return minimaxOk;
  });
  try {
    assert.equal(await llm('hi', 100, 'minimax'), 'From MiniMax');
    assert.equal(calls.length, 1);
    assert.ok(calls[0].includes('api.minimax.io'));
  } finally { restore(); clean(); }
});

test("prefer:'minimax' still falls back to Gemini if MiniMax errors", async () => {
  const clean = bothKeys();
  const restore = stubFetch(async (url) =>
    String(url).includes('minimax') ? { ok: false, status: 401 } : geminiOk);
  try {
    assert.equal(await llm('hi', 100, 'minimax'), 'From Gemini');
  } finally { restore(); clean(); }
});

test('makeTitle degrades to first words with no keys at all', async () => {
  const restore = stubFetch(async () => { throw new Error('no network'); });
  try {
    assert.equal(await makeTitle('Quick check of the fallback title path here'), 'Quick check of the fallback title path…');
  } finally { restore(); }
});

test('an explicit per-user key is used over the shared env key', async () => {
  const clean = bothKeys(); // env gk/mk present
  const seen = [];
  const restore = stubFetch(async (url, opts) => {
    seen.push(opts.headers['x-goog-api-key']);
    return geminiOk;
  });
  try {
    await llm('hi', 100, undefined, { geminiKey: 'user-key' });
    assert.equal(seen[0], 'user-key'); // not the env 'gk'
  } finally { restore(); clean(); }
});

test('an explicit empty key disables env fallback (guests bring their own)', async () => {
  const clean = bothKeys(); // env keys present, but…
  let called = false;
  const restore = stubFetch(async () => { called = true; return geminiOk; });
  try {
    // both providers explicitly disabled → no key, no call, no quota spent
    assert.equal(await llm('hi', 100, undefined, { geminiKey: '', minimaxKey: '' }), null);
    assert.equal(called, false);
  } finally { restore(); clean(); }
});

test('validateGeminiKey checks the key via a no-cost models list', async () => {
  const restore = stubFetch(async (url, opts) => {
    assert.ok(String(url).includes('/v1beta/models'));
    return opts.headers['x-goog-api-key'] === 'good' ? { ok: true } : { ok: false, status: 400 };
  });
  try {
    assert.equal(await validateGeminiKey('good'), true);
    assert.equal(await validateGeminiKey('bad'), false);
    assert.equal(await validateGeminiKey(''), false); // no key → no network call
  } finally { restore(); }
});
