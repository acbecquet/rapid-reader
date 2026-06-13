import test from 'node:test';
import assert from 'node:assert/strict';
import { llm, makeTitle } from '../api/_lib/title.js';

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
