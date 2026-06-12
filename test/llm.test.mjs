import test from 'node:test';
import assert from 'node:assert/strict';
import { llm, makeTitle } from '../api/_lib/title.js';

function stubFetch(impl) {
  const real = global.fetch;
  global.fetch = impl;
  return () => { global.fetch = real; };
}

test('llm prefers MiniMax when its key is set', async () => {
  process.env.MINIMAX_API_KEY = 'mk';
  process.env.GEMINI_API_KEY = 'gk';
  const calls = [];
  const restore = stubFetch(async (url, opts) => {
    calls.push(url);
    assert.equal(JSON.parse(opts.body).model, 'MiniMax-M2');
    assert.equal(opts.headers.authorization, 'Bearer mk');
    return { ok: true, json: async () => ({ choices: [{ message: { content: 'From MiniMax' } }] }) };
  });
  try {
    assert.equal(await llm('hi', 100), 'From MiniMax');
    assert.equal(calls.length, 1);
    assert.ok(calls[0].includes('api.minimax.io'));
  } finally {
    restore();
    delete process.env.MINIMAX_API_KEY;
    delete process.env.GEMINI_API_KEY;
  }
});

test('llm falls back to Gemini when MiniMax fails', async () => {
  process.env.MINIMAX_API_KEY = 'mk';
  process.env.GEMINI_API_KEY = 'gk';
  const restore = stubFetch(async (url) =>
    url.includes('minimax')
      ? { ok: false, status: 401 }
      : { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: 'From Gemini' }] } }] }) });
  try {
    assert.equal(await llm('hi', 100), 'From Gemini');
  } finally {
    restore();
    delete process.env.MINIMAX_API_KEY;
    delete process.env.GEMINI_API_KEY;
  }
});

test('makeTitle degrades to first words with no keys at all', async () => {
  const restore = stubFetch(async () => { throw new Error('no network'); });
  try {
    assert.equal(await makeTitle('Quick check of the fallback title path here'), 'Quick check of the fallback title path…');
  } finally { restore(); }
});
