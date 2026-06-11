import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../api/stats.js';

function call(method, body) {
  return new Promise((resolve) => {
    const req = { method, headers: {}, body: body || {}, query: {} };
    const res = {
      setHeader() {},
      status(c) { this.code = c; return this; },
      json(o) { resolve({ code: this.code, body: o }); },
      end() { resolve({ code: this.code }); },
    };
    handler(req, res);
  });
}

test('sessions aggregate into daily totals and per-source buckets', async () => {
  let r = await call('GET');
  assert.deepEqual(r.body.days, {});

  r = await call('POST', {
    dateKey: '2026-06-11', sourceType: 'claude_code',
    playbackMs: 60000, words: 400, pauses: 2, rewinds: 1, skips: 0, completed: true,
  });
  assert.equal(r.code, 200);
  r = await call('POST', {
    dateKey: '2026-06-11', sourceType: 'web',
    playbackMs: 30000, words: 150, completed: false,
  });

  r = await call('GET');
  const day = r.body.days['2026-06-11'];
  assert.equal(day.ms, 90000);
  assert.equal(day.words, 550);
  assert.equal(day.sessions, 2);
  assert.equal(day.pauses, 2);
  assert.equal(day.rewinds, 1);
  assert.equal(day.completed, 1);
  assert.equal(day.bySource.claude_code.words, 400);
  assert.equal(day.bySource.claude_code.completed, 1);
  assert.equal(day.bySource.web.ms, 30000);
});

test('rejects malformed sessions', async () => {
  let r = await call('POST', { playbackMs: 1000, words: 10 });
  assert.equal(r.code, 400); // no dateKey
  r = await call('POST', { dateKey: '2026-06-11', playbackMs: 0, words: 0 });
  assert.equal(r.code, 400); // empty session
  r = await call('PUT');
  assert.equal(r.code, 405);
});
