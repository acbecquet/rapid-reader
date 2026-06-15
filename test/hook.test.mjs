import test from 'node:test';
import assert from 'node:assert/strict';
import { compileTranscript } from '../hooks/transcript.mjs';
import { buildPayload } from '../hooks/claude-hook.mjs';
import itemsHandler from '../api/items.js';

const jl = (entries) => entries.map((e) => JSON.stringify(e)).join('\n');

const TRANSCRIPT = jl([
  { type: 'user', message: { role: 'user', content: 'Fix the login bug and then explain what was wrong with the session handling' } },
  { type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', name: 'Bash' }] } },
  { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'The bug was a stale cookie. I rewrote the session check and added a test.' }] } },
  { type: 'user', message: { role: 'user', content: 'great, now update the docs' } },
  { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'Docs updated: the README now explains the cookie lifetime and the new flag.' }] } },
]);

test('compileTranscript: turns get [[rr:role]] sentinels, tool calls captured, first prompt kept', () => {
  const { md, firstPrompt } = compileTranscript(TRANSCRIPT);
  assert.ok(md.startsWith('[[rr:you]]\nFix the login bug and then explain what was wrong with the session handling'));
  assert.ok(md.includes('stale cookie'));
  assert.ok(md.includes('[[rr:you]]\ngreat, now update the docs'));
  assert.ok(md.indexOf('stale cookie') < md.indexOf('great, now update the docs'));
  assert.ok(md.includes('[[rr:tool Bash]]')); // tool calls captured as clean turns, not raw JSON
  assert.ok(!md.includes('tool_use'));
  assert.ok(firstPrompt.startsWith('Fix the login bug'));
});

test('compileTranscript keeps long transcripts whole, trimming only past the ~1MB ceiling', () => {
  // ~100k is well under the ceiling — kept intact (no mid-conversation cut)
  const long = jl([{ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'word '.repeat(20000) }] } }]);
  assert.ok(!compileTranscript(long).md.includes('trimmed'));

  // past ~1MB, whole oldest turns are dropped (never mid-turn)
  const entries = [];
  for (let i = 0; i < 30; i++) entries.push({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'TURN' + i + ' ' + 'word '.repeat(8000) }] } });
  const { md } = compileTranscript(jl(entries));
  assert.ok(md.startsWith('(earlier turns trimmed)'));
  assert.ok(md.length <= 1_000_060);
  assert.ok(!md.includes('TURN0 ')); // oldest dropped
  assert.ok(md.includes('TURN29'));  // newest kept
});

test('buildPayload: title is your most recent prompt, group from project folder', () => {
  const p = buildPayload({ session_id: 'abc-123', cwd: '/home/u/projects/rapid-reader' }, TRANSCRIPT);
  assert.equal(p.sessionId, 'claude:abc-123');
  assert.equal(p.sourceType, 'claude_code');
  assert.ok(p.title.startsWith('great, now update the docs')); // your latest prompt, not the first
  assert.equal(p.group, 'rapid-reader'); // grouped by project, like the sidebar
  assert.equal(buildPayload({ session_id: 'x', cwd: '/a' }, jl([
    { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'ok' }] } },
  ])), null);
});

function call(method, body, query) {
  return new Promise((resolve) => {
    const req = { method, headers: {}, body: body || {}, query: query || {} };
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

  // the updated body is fetchable by id
  const got = await call('GET', null, { id });
  assert.ok(got.body.text.includes('second one'));

  const list = await call('GET');
  assert.equal(list.body.items.filter((i) => i.sessionId === 's1').length, 1);
  assert.equal(list.body.items[0].id, id); // bumped to top

  // a different session is a separate item
  r = await call('POST', { sessionId: 's2', text: 'Another conversation entirely, with different words.', title: 'Claude · other' });
  assert.equal(r.code, 201);
  await call('DELETE', { ids: [id, r.body.item.id] });
});
