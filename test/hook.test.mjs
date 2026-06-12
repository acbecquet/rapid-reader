import test from 'node:test';
import assert from 'node:assert/strict';
import { compileTranscript, buildPayload } from '../hooks/claude-hook.mjs';
import itemsHandler from '../api/items.js';

const jl = (entries) => entries.map((e) => JSON.stringify(e)).join('\n');

const TRANSCRIPT = jl([
  { type: 'user', message: { role: 'user', content: 'Fix the login bug and then explain what was wrong with the session handling' } },
  { type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', name: 'Bash' }] } },
  { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'The bug was a stale cookie. I rewrote the session check and added a test.' }] } },
  { type: 'user', message: { role: 'user', content: 'great, now update the docs' } },
  { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'Docs updated: the README now explains the cookie lifetime and the new flag.' }] } },
]);

test('compileTranscript: prompts become headings, assistant prose follows, tool calls skipped', () => {
  const md = compileTranscript(TRANSCRIPT);
  assert.ok(md.startsWith('# Fix the login bug and then explain what was wrong…'));
  assert.ok(md.includes('stale cookie'));
  assert.ok(md.includes('# great, now update the docs'));
  assert.ok(md.indexOf('stale cookie') < md.indexOf('# great'));
  assert.ok(!md.includes('tool_use'));
});

test('compileTranscript trims very long transcripts from the front', () => {
  const long = jl([{ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'word '.repeat(20000) }] } }]);
  const md = compileTranscript(long);
  assert.ok(md.startsWith('(earlier conversation trimmed)'));
  assert.ok(md.length < 41000);
});

test('buildPayload: session metadata, skips near-empty transcripts', () => {
  const p = buildPayload({ session_id: 'abc-123', cwd: '/home/u/projects/rapid-reader' }, TRANSCRIPT);
  assert.equal(p.sessionId, 'abc-123');
  assert.equal(p.sourceType, 'claude_code');
  assert.equal(p.title, 'Claude · rapid-reader');
  assert.equal(buildPayload({ session_id: 'x', cwd: '/a' }, jl([
    { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'ok' }] } },
  ])), null);
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

test('items POST upserts by sessionId: same session updates in place, marks unread', async () => {
  let r = await call('POST', { sessionId: 's1', text: 'First response from Claude about the task.', title: 'Claude · proj', sourceType: 'claude_code' });
  assert.equal(r.code, 201);
  const id = r.body.item.id;

  await call('PATCH', { id, readAt: Date.now() }); // user reviews it

  r = await call('POST', { sessionId: 's1', text: 'First response from Claude about the task. And a second one.', title: 'Claude · proj' });
  assert.equal(r.code, 200); // updated, not created
  assert.equal(r.body.item.id, id);
  assert.equal(r.body.item.readAt, null); // new content → unread again
  assert.ok(r.body.item.text.includes('second one'));

  const list = await call('GET');
  assert.equal(list.body.items.filter((i) => i.sessionId === 's1').length, 1);
  assert.equal(list.body.items[0].id, id); // bumped to top

  // a different session is a separate item
  r = await call('POST', { sessionId: 's2', text: 'Another conversation entirely, with different words.', title: 'Claude · other' });
  assert.equal(r.code, 201);
  await call('DELETE', { ids: [id, r.body.item.id] });
});
