import test from 'node:test';
import assert from 'node:assert/strict';
import { oneMessage, compileTranscript, buildPayload } from '../hooks/transcript.mjs';
import { decodeProject } from '../hooks/sync.mjs';

const jl = (entries) => entries.map((e) => JSON.stringify(e)).join('\n');

test('oneMessage handles Claude block content', () => {
  assert.deepEqual(
    oneMessage({ type: 'user', message: { role: 'user', content: 'hello there' } }),
    { role: 'user', text: 'hello there' });
  assert.deepEqual(
    oneMessage({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'hi' }, { type: 'tool_use' }] } }),
    { role: 'assistant', text: 'hi' });
  assert.equal(oneMessage({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', name: 'Bash' }] } }), null);
});

test('oneMessage handles Codex shapes (payload wrapper, output_text, event style)', () => {
  // response_item with payload.message
  assert.deepEqual(
    oneMessage({ type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'done' }] } }),
    { role: 'assistant', text: 'done' });
  // input_text user message
  assert.deepEqual(
    oneMessage({ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'do the thing' }] }),
    { role: 'user', text: 'do the thing' });
  // event-style agent_message with a plain string
  assert.deepEqual(
    oneMessage({ type: 'event_msg', payload: { type: 'agent_message', message: 'all set' } }),
    { role: 'assistant', text: 'all set' });
});

test('compileTranscript renders a faithful, readable conversation', () => {
  const codex = jl([
    { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'add a join option for squad players' }] },
    { type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Added the join flow and a test.' }] } },
  ]);
  const { md, firstPrompt } = compileTranscript(codex);
  assert.ok(md.startsWith('# add a join option for squad players'));
  assert.ok(md.includes('Added the join flow'));
  assert.equal(firstPrompt, 'add a join option for squad players');
});

test('buildPayload skips thin transcripts, sets group + source', () => {
  const p = buildPayload({
    jsonl: jl([
      { role: 'user', content: 'please refactor the auth module and add coverage' },
      { role: 'assistant', content: 'Refactored auth and added eight tests covering the edge cases.' },
    ]),
    sessionId: 'codex:abc', group: 'er2-mod', sourceType: 'codex',
  });
  assert.equal(p.sessionId, 'codex:abc');
  assert.equal(p.group, 'er2-mod');
  assert.equal(p.sourceType, 'codex');
  assert.ok(p.title.startsWith('please refactor'));
  assert.equal(buildPayload({ jsonl: jl([{ role: 'assistant', content: 'ok' }]), sessionId: 'x' }), null);
});

test('decodeProject turns a Claude cwd-encoded folder into a project name', () => {
  assert.equal(decodeProject('-Users-me-projects-rapid-reader'), 'reader');
  assert.equal(decodeProject('-home-user-er2mod'), 'er2mod');
  assert.equal(decodeProject(''), 'sessions');
});
