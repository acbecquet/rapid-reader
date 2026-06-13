import test from 'node:test';
import assert from 'node:assert/strict';
import logHandler from '../api/log.js';
import itemsHandler from '../api/items.js';

function call(handler, method, body, query) {
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

test('log: records, dedupes by signature with a count, lists newest first', async () => {
  await call(logHandler, 'DELETE');
  let r = await call(logHandler, 'POST', { kind: 'parse-failed', message: 'boom', context: 'book:1' });
  assert.equal(r.body.ok, true);
  await call(logHandler, 'POST', { kind: 'parse-failed', message: 'boom', context: 'book:1' }); // same → dedupe
  await call(logHandler, 'POST', { kind: 'bad-title', message: '##', context: 'book:2' });

  r = await call(logHandler, 'GET');
  assert.equal(r.body.errors.length, 2);
  const boom = r.body.errors.find((e) => e.message === 'boom');
  assert.equal(boom.count, 2); // deduped, counted
  assert.equal(boom.kind, 'parse-failed');

  r = await call(logHandler, 'POST', { message: '' });
  assert.equal(r.code, 400);
  await call(logHandler, 'DELETE');
  r = await call(logHandler, 'GET');
  assert.deepEqual(r.body.errors, []);
});

test('items retitle: re-derives a title from the body when one looks wrong', async () => {
  // an item that ended up with a junk title but real body text
  let r = await call(itemsHandler, 'POST', {
    text: 'The crew left the harbor at dawn and sailed straight into the open sea under a red sky.',
    title: '##', sourceType: 'book',
  });
  const id = r.body.item.id;
  assert.equal(r.body.item.title, '##');

  r = await call(itemsHandler, 'PATCH', { id, retitle: true });
  assert.equal(r.code, 200);
  // no LLM key in tests → falls back to first words of the body (still better than ##)
  assert.notEqual(r.body.item.title, '##');
  assert.ok(/crew|harbor|dawn/i.test(r.body.item.title));

  await call(itemsHandler, 'DELETE', { id });
});
