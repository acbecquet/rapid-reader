import test from 'node:test';
import assert from 'node:assert/strict';
import itemsHandler from '../api/items.js';
import quizHandler from '../api/quiz.js';
import { makeQuiz } from '../api/_lib/title.js';

// Minimal req/res shims matching what Vercel and dev-server.mjs provide.
function call(handler, method, { body, query } = {}) {
  return new Promise((resolve) => {
    const req = { method, headers: {}, body: body || {}, query: query || {} };
    const res = {
      setHeader() {},
      status(c) { this.code = c; return this; },
      json(o) { resolve({ code: this.code, body: o }); },
      end() { resolve({ code: this.code }); },
    };
    handler(req, res);
  });
}

function stubFetch(impl) {
  const real = global.fetch;
  global.fetch = impl;
  return () => { global.fetch = real; };
}

function geminiKey() {
  process.env.GEMINI_API_KEY = 'gk';
  return () => { delete process.env.GEMINI_API_KEY; };
}

const PASSAGE = Array.from({ length: 40 }, (_, i) => 'word' + i).join(' ')
  + '. The trainer builds reading span with clusters and checks comprehension with quizzes.';

const VALID_QUIZ = JSON.stringify(Array.from({ length: 5 }, (_, i) => ({
  q: `Question ${i}?`,
  choices: ['first', 'second', 'third', 'fourth'],
  answer: i % 4,
})));

const geminiSays = (text) => ({
  ok: true,
  json: async () => ({ candidates: [{ content: { parts: [{ text }] } }] }),
});

async function seedItem(text = PASSAGE) {
  const r = await call(itemsHandler, 'POST', { body: { text, sourceType: 'manual' } });
  return r.body.item.id;
}

test('quiz happy path: fenced JSON from Gemini becomes a validated quiz', async () => {
  const clean = geminiKey();
  const restore = stubFetch(async () => geminiSays('```json\n' + VALID_QUIZ + '\n```'));
  try {
    const id = await seedItem();
    const r = await call(quizHandler, 'POST', { body: { id } });
    assert.equal(r.code, 200);
    assert.equal(r.body.quiz.length, 5);
    for (const q of r.body.quiz) {
      assert.ok(q.q.length > 0);
      assert.equal(q.choices.length, 4);
      assert.ok(q.answer >= 0 && q.answer < 4);
    }
  } finally { restore(); clean(); }
});

test('quiz retries once on malformed JSON, then succeeds', async () => {
  const clean = geminiKey();
  let calls = 0;
  const restore = stubFetch(async () => geminiSays(++calls === 1 ? 'sorry, no JSON here' : VALID_QUIZ));
  try {
    const id = await seedItem();
    const r = await call(quizHandler, 'POST', { body: { id } });
    assert.equal(r.code, 200);
    assert.equal(calls, 2);
  } finally { restore(); clean(); }
});

test('quiz gives up after persistent junk', async () => {
  const clean = geminiKey();
  const restore = stubFetch(async () => geminiSays('still not JSON'));
  try {
    const id = await seedItem();
    const r = await call(quizHandler, 'POST', { body: { id } });
    assert.equal(r.code, 422);
    assert.equal(r.body.needsGeminiKey, false); // a key exists; the model just failed
  } finally { restore(); clean(); }
});

test('quiz without any key points at the key nudge, never calls out', async () => {
  let called = false;
  const restore = stubFetch(async () => { called = true; return geminiSays(VALID_QUIZ); });
  try {
    const id = await seedItem();
    const r = await call(quizHandler, 'POST', { body: { id } });
    assert.equal(r.code, 422);
    assert.equal(r.body.needsGeminiKey, true);
    assert.equal(called, false);
  } finally { restore(); }
});

test('quiz rejects short texts, unknown items, missing id, and GET', async () => {
  const clean = geminiKey();
  const restore = stubFetch(async () => geminiSays(VALID_QUIZ));
  try {
    const shortId = await seedItem('too short to quiz on');
    let r = await call(quizHandler, 'POST', { body: { id: shortId } });
    assert.equal(r.code, 422);
    r = await call(quizHandler, 'POST', { body: { id: 'nope' } });
    assert.equal(r.code, 404);
    r = await call(quizHandler, 'POST', { body: {} });
    assert.equal(r.code, 400);
    r = await call(quizHandler, 'GET');
    assert.equal(r.code, 405);
  } finally { restore(); clean(); }
});

test('makeQuiz validates shape: drops bad questions, needs at least 3 good ones', async () => {
  const clean = geminiKey();
  const mixed = JSON.stringify([
    { q: 'ok one?', choices: ['a', 'b', 'c', 'd'], answer: 1 },
    { q: 'three choices', choices: ['a', 'b', 'c'], answer: 0 },
    { q: 'answer out of range', choices: ['a', 'b', 'c', 'd'], answer: 4 },
    { q: '', choices: ['a', 'b', 'c', 'd'], answer: 0 },
    { q: 'ok two?', choices: ['a', 'b', 'c', 'd'], answer: 2 },
    { q: 'ok three?', choices: ['a', 'b', 'c', 'd'], answer: 3 },
  ]);
  const restore = stubFetch(async () => geminiSays(mixed));
  try {
    const quiz = await makeQuiz('text '.repeat(50), 5);
    assert.equal(quiz.length, 3); // only the valid ones survive
    assert.deepEqual(quiz.map((q) => q.q), ['ok one?', 'ok two?', 'ok three?']);
  } finally { restore(); clean(); }
});
