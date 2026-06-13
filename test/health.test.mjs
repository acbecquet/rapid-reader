import test from 'node:test';
import assert from 'node:assert/strict';
import healthHandler from '../api/health.js';

function call(method) {
  return new Promise((resolve) => {
    const req = { method, headers: {}, query: {} };
    const res = {
      setHeader() {},
      status(c) { this.code = c; return this; },
      json(o) { resolve({ code: this.code, body: o }); },
      end() { resolve({ code: this.code }); },
    };
    healthHandler(req, res);
  });
}

test('health reports storage booleans (in-memory in tests → not persistent)', async () => {
  const r = await call('GET');
  assert.equal(r.code, 200);
  assert.equal(r.body.ok, true);
  assert.equal(typeof r.body.redis, 'boolean');
  assert.equal(typeof r.body.blob, 'boolean');
  assert.equal(r.body.persistent, r.body.redis);
  assert.match(r.body.note, /persist/i);
});
