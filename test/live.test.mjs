import test from 'node:test';
import assert from 'node:assert/strict';
import liveHandler from '../api/live.js';
import itemsHandler from '../api/items.js';

function call(handler, method, body) {
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

test('live slot: set, read via items poll, overwrite, clear', async () => {
  let r = await call(liveHandler, 'GET');
  assert.equal(r.body.live, null);

  r = await call(liveHandler, 'POST', { text: 'A fresh selection.', url: 'https://example.com/p' });
  assert.equal(r.code, 200);

  // the panel reads it from the same GET it already polls
  r = await call(itemsHandler, 'GET');
  assert.equal(r.body.live.text, 'A fresh selection.');
  assert.ok(r.body.live.ts > 0);
  assert.deepEqual(r.body.items, []); // never enters the backlog

  r = await call(liveHandler, 'POST', { text: 'A newer selection.' });
  r = await call(liveHandler, 'GET');
  assert.equal(r.body.live.text, 'A newer selection.'); // overwrites

  r = await call(liveHandler, 'POST', { text: '   ' });
  assert.equal(r.code, 400);

  r = await call(liveHandler, 'DELETE');
  r = await call(liveHandler, 'GET');
  assert.equal(r.body.live, null);

  r = await call(liveHandler, 'PUT');
  assert.equal(r.code, 405);
});

test('⚡ toggle gates live captures server-side', async () => {
  // default: on
  let r = await call(itemsHandler, 'GET');
  assert.equal(r.body.captureOn, true);

  // off: POSTs are accepted but dropped, pending capture cleared
  await call(liveHandler, 'POST', { text: 'Pending capture before the switch.' });
  r = await call(liveHandler, 'PATCH', { on: false });
  assert.equal(r.body.captureOn, false);
  r = await call(liveHandler, 'POST', { text: 'Copied while capture is off.' });
  assert.equal(r.code, 200);
  assert.equal(r.body.ignored, true);
  r = await call(itemsHandler, 'GET');
  assert.equal(r.body.live, null);
  assert.equal(r.body.captureOn, false);

  // back on: captures flow again
  await call(liveHandler, 'PATCH', { on: true });
  await call(liveHandler, 'POST', { text: 'Copied after re-enabling.' });
  r = await call(itemsHandler, 'GET');
  assert.equal(r.body.live.text, 'Copied after re-enabling.');
  await call(liveHandler, 'DELETE');
});
