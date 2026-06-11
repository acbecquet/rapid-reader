import test from 'node:test';
import assert from 'node:assert/strict';
import { htmlToText, pageTitle, fetchReadable } from '../api/_lib/readable.js';
import itemsHandler from '../api/items.js';

const PAGE = `<!doctype html><html><head><title>Big News Story</title>
<style>.x{color:red}</style><script>alert(1)</script></head>
<body><nav><a href="/">Home</a><a href="/about">About</a></nav>
<article><h1>Big News</h1><p>The first paragraph explains what happened today in detail.</p>
<h2>Background</h2><ul><li>point one</li><li>point two</li></ul>
<p>Closing thoughts &amp; a quoted &quot;phrase&quot; to finish the report properly.</p></article>
<footer>© corp · privacy · terms</footer></body></html>`;

test('htmlToText strips chrome and keeps structure', () => {
  const t = htmlToText(PAGE);
  assert.ok(t.includes('# Big News'));
  assert.ok(t.includes('## Background'));
  assert.ok(t.includes('- point one'));
  assert.ok(t.includes('& a quoted "phrase"'));
  assert.ok(!t.includes('alert(1)'));
  assert.ok(!t.includes('Home'));     // nav removed
  assert.ok(!t.includes('privacy'));  // footer removed
  assert.equal(pageTitle(PAGE), 'Big News Story');
});

function stubFetch(impl) {
  const real = global.fetch;
  global.fetch = impl;
  return () => { global.fetch = real; };
}

test('fetchReadable returns title + text (no Gemini key → stripped text)', async () => {
  const restore = stubFetch(async () => ({ ok: true, text: async () => PAGE }));
  try {
    const page = await fetchReadable('https://news.example.com/story');
    assert.equal(page.title, 'Big News Story');
    assert.ok(page.markdown.includes('first paragraph'));
  } finally { restore(); }
});

test('fetchReadable rejects private hosts and failed fetches', async () => {
  await assert.rejects(() => fetchReadable('http://localhost:3000/'));
  await assert.rejects(() => fetchReadable('http://192.168.1.1/admin'));
  const restore = stubFetch(async () => ({ ok: false, status: 404 }));
  try {
    await assert.rejects(() => fetchReadable('https://gone.example.com/x'));
  } finally { restore(); }
});

function call(method, body) {
  return new Promise((resolve) => {
    const req = { method, headers: {}, body: body || {}, query: {} };
    const res = {
      setHeader() {},
      status(c) { this.code = c; return this; },
      json(o) { resolve({ code: this.code, body: o }); },
    };
    itemsHandler(req, res);
  });
}

test('POSTing a bare URL becomes a digested article item', async () => {
  const restore = stubFetch(async () => ({ ok: true, text: async () => PAGE }));
  try {
    const r = await call('POST', { text: 'https://news.example.com/story' });
    assert.equal(r.code, 201);
    assert.equal(r.body.item.url, 'https://news.example.com/story');
    assert.equal(r.body.item.sourceType, 'article');
    assert.equal(r.body.item.title, 'Big News Story');
    assert.ok(r.body.item.text.includes('first paragraph'));
    await call('DELETE', { id: r.body.item.id });
  } finally { restore(); }
});

test('unreachable URL paste returns a clear 422', async () => {
  const restore = stubFetch(async () => ({ ok: false, status: 403 }));
  try {
    const r = await call('POST', { text: 'https://blocked.example.com/x' });
    assert.equal(r.code, 422);
    assert.match(r.body.error, /could not read/i);
  } finally { restore(); }
});
