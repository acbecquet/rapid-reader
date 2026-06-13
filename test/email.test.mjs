import test from 'node:test';
import assert from 'node:assert/strict';

process.env.EMAIL_WEBHOOK_SECRET = 'mailsecret';

const emailHandler = (await import('../api/email.js')).default;
const itemsHandler = (await import('../api/items.js')).default;

function call(handler, method, { body, query, headers } = {}) {
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

const ok = { query: { secret: 'mailsecret' } };

test('email: 503 when secret env unset', async () => {
  const saved = process.env.EMAIL_WEBHOOK_SECRET;
  delete process.env.EMAIL_WEBHOOK_SECRET;
  const r = await call(emailHandler, 'POST', { body: { subject: 's', text: 't' } });
  assert.equal(r.code, 503);
  process.env.EMAIL_WEBHOOK_SECRET = saved;
});

test('email: 401 when secret wrong', async () => {
  const r = await call(emailHandler, 'POST', {
    body: { subject: 's', text: 't' }, query: { secret: 'nope' },
  });
  assert.equal(r.code, 401);
});

test('email: 405 for GET', async () => {
  const r = await call(emailHandler, 'GET', ok);
  assert.equal(r.code, 405);
});

test('email: 200 skipped when neither subject nor text', async () => {
  const r = await call(emailHandler, 'POST', { body: { from: 'a@b.c' }, query: { secret: 'mailsecret' } });
  assert.equal(r.code, 200);
  assert.equal(r.body.skipped, true);
});

test('email: creates an item with subject H1 + From line', async () => {
  const subject = 'A Forwarded Article';
  const r = await call(emailHandler, 'POST', {
    body: { subject, from: 'alice@example.com', text: 'The body of the email goes here.' },
    query: { secret: 'mailsecret' },
  });
  assert.equal(r.code, 200);
  assert.ok(r.body.id);

  // it appears in the backlog with the right source + title
  const list = await call(itemsHandler, 'GET');
  const item = list.body.items.find((it) => it.id === r.body.id);
  assert.ok(item, 'item present in backlog');
  assert.equal(item.sourceType, 'email');
  assert.equal(item.title, subject);

  // its body carries the H1 and the From line
  const one = await call(itemsHandler, 'GET', { query: { id: r.body.id } });
  assert.match(one.body.text, /^# A Forwarded Article/);
  assert.match(one.body.text, /From: alice@example\.com/);

  // cleanup
  const del = await call(itemsHandler, 'DELETE', { query: { id: r.body.id } });
  assert.equal(del.code, 200);
});

test('email: HTML-only body is stripped to plain text', async () => {
  const r = await call(emailHandler, 'POST', {
    body: { subject: 'HTML Mail', html: '<p>Hello <b>world</b></p><div>second line</div>' },
    query: { secret: 'mailsecret' },
  });
  assert.equal(r.code, 200);
  assert.ok(r.body.id);

  const one = await call(itemsHandler, 'GET', { query: { id: r.body.id } });
  assert.ok(!one.body.text.includes('<'), 'no html tags in stored body');
  assert.match(one.body.text, /Hello world/);

  await call(itemsHandler, 'DELETE', { query: { id: r.body.id } });
});
