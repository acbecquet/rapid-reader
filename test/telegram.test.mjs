import test from 'node:test';
import assert from 'node:assert/strict';
import telegramHandler from '../api/telegram.js';
import itemsHandler from '../api/items.js';

function call(handler, method, body, headers) {
  return new Promise((resolve) => {
    const req = { method, headers: headers || {}, body: body || {}, query: {} };
    const res = {
      setHeader() {},
      status(c) { this.code = c; return this; },
      json(o) { resolve({ code: this.code, body: o }); },
      end() { resolve({ code: this.code }); },
    };
    handler(req, res);
  });
}

const HDR = { 'x-telegram-bot-api-secret-token': 's3cret' };
const update = (text) => ({ message: { text, chat: { id: 1, title: 'Chat' }, from: { username: 'bob' } } });

test('503 when the secret env var is unset', async () => {
  delete process.env.TELEGRAM_WEBHOOK_SECRET;
  const r = await call(telegramHandler, 'POST', update('hi'), HDR);
  assert.equal(r.code, 503);
});

test('401 when the secret header is wrong', async () => {
  process.env.TELEGRAM_WEBHOOK_SECRET = 's3cret';
  const r = await call(telegramHandler, 'POST', update('hi'), { 'x-telegram-bot-api-secret-token': 'nope' });
  assert.equal(r.code, 401);
});

test('405 for GET', async () => {
  process.env.TELEGRAM_WEBHOOK_SECRET = 's3cret';
  const r = await call(telegramHandler, 'GET', {}, HDR);
  assert.equal(r.code, 405);
});

test('200 skipped when the update has no text', async () => {
  process.env.TELEGRAM_WEBHOOK_SECRET = 's3cret';
  const r = await call(telegramHandler, 'POST', { message: { chat: { id: 1 } } }, HDR);
  assert.equal(r.code, 200);
  assert.equal(r.body.skipped, true);
});

test('200 + item created when secret matches and a message arrives', async () => {
  process.env.TELEGRAM_WEBHOOK_SECRET = 's3cret';
  const r = await call(telegramHandler, 'POST', update('First line here\nsecond line'), HDR);
  assert.equal(r.code, 200);
  assert.ok(r.body.id);

  const list = await call(itemsHandler, 'GET');
  const item = list.body.items.find((it) => it.id === r.body.id);
  assert.ok(item, 'telegram item should be in the backlog');
  assert.equal(item.sourceType, 'telegram');
  assert.equal(item.title, 'First line here');

  // clean up
  const del = await call(itemsHandler, 'DELETE', { id: r.body.id });
  assert.equal(del.code, 200);
});
