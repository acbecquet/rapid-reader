import test from 'node:test';
import assert from 'node:assert/strict';
import prefsHandler from '../api/prefs.js';
import { defaultPrefs, mergePrefs, publicPrefs, DEFAULT_COLUMNS, SOURCES } from '../api/_lib/prefs.js';

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

test('publicPrefs never leaks the raw key; flags whether one is set/needed', () => {
  const withKey = publicPrefs(mergePrefs({ geminiKey: 'AIza-secret' }), 'guest-123');
  assert.equal('geminiKey' in withKey, false);
  assert.equal(withKey.hasGeminiKey, true);
  assert.equal(withKey.needsGeminiKey, false);

  const noKey = publicPrefs(mergePrefs(null), 'guest-123');
  assert.equal(noKey.hasGeminiKey, false);
  assert.equal(noKey.needsGeminiKey, true); // a guest with no key still needs one
});

test('PATCH geminiKey validates, stores, and never echoes the raw key', async () => {
  const real = global.fetch;
  global.fetch = async () => ({ ok: true }); // validateGeminiKey → valid
  try {
    let r = await call('PATCH', { geminiKey: 'AIza-test-key' });
    assert.equal(r.body.prefs.hasGeminiKey, true);
    assert.equal('geminiKey' in r.body.prefs, false); // redacted on the way out

    r = await call('GET');
    assert.equal(r.body.prefs.hasGeminiKey, true);
    assert.equal('geminiKey' in r.body.prefs, false);

    global.fetch = async () => ({ ok: false, status: 400 }); // a bad key is rejected
    r = await call('PATCH', { geminiKey: 'nope' });
    assert.equal(r.code, 400);
    r = await call('GET');
    assert.equal(r.body.prefs.hasGeminiKey, true); // unchanged — old key kept
  } finally { global.fetch = real; }

  const r = await call('PATCH', { geminiKey: '' }); // '' clears it (no network)
  assert.equal(r.body.prefs.hasGeminiKey, false);
});

test('PATCH rejects unknown methods', async () => {
  const r = await call('PUT');
  assert.equal(r.code, 405);
});
