import test from 'node:test';
import assert from 'node:assert/strict';
import prefsHandler from '../api/prefs.js';
import { defaultPrefs, mergePrefs, DEFAULT_COLUMNS, SOURCES } from '../api/_lib/prefs.js';

function call(method, body) {
  return new Promise((resolve) => {
    const req = { method, headers: {}, body: body || {}, query: {} };
    const res = {
      setHeader() {},
      status(c) { this.code = c; return this; },
      json(o) { resolve({ code: this.code, body: o }); },
      end() { resolve({ code: this.code }); },
    };
    prefsHandler(req, res);
  });
}

test('defaults: capture on, all sources on, five columns', () => {
  const d = defaultPrefs();
  assert.equal(d.capture, true);
  assert.deepEqual(Object.keys(d.sources).sort(), [...SOURCES].sort());
  assert.equal(d.columns.length, 5);
  assert.deepEqual(d.columns.map((c) => c.id), ['agents', 'books', 'email', 'news', 'general']);
});

test('mergePrefs fills missing fields over stored partials', () => {
  const m = mergePrefs({ sources: { codex: false } });
  assert.equal(m.capture, true);
  assert.equal(m.sources.codex, false);
  assert.equal(m.sources.claude_code, true); // default preserved
  assert.equal(m.columns.length, DEFAULT_COLUMNS.length);
});

test('GET returns merged prefs; PATCH toggles capture, sources, columns', async () => {
  let r = await call('GET');
  assert.equal(r.body.prefs.capture, true);

  r = await call('PATCH', { capture: false });
  assert.equal(r.body.prefs.capture, false);

  r = await call('PATCH', { source: 'telegram', on: false });
  assert.equal(r.body.prefs.sources.telegram, false);
  assert.equal(r.body.prefs.capture, false); // unchanged

  // unknown source is ignored, not stored
  r = await call('PATCH', { source: 'bogus', on: false });
  assert.equal('bogus' in r.body.prefs.sources, false);

  r = await call('PATCH', { columns: [{ id: 'all', name: 'All', icon: 'general', sources: ['manual', 'book'] }] });
  assert.equal(r.body.prefs.columns.length, 1);
  assert.equal(r.body.prefs.columns[0].name, 'All');

  // reset for other suites
  await call('PATCH', { capture: true });
  await call('PATCH', { source: 'telegram', on: true });
});

test('PATCH rejects unknown methods', async () => {
  const r = await call('PUT');
  assert.equal(r.code, 405);
});
