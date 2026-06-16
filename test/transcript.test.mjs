import test from 'node:test';
import assert from 'node:assert/strict';
import { oneMessage, compileTranscript, buildPayload, isBackground, sessionSummary, cwdOf } from '../hooks/transcript.mjs';
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
  assert.ok(md.startsWith('[[rr:you]]\nadd a join option for squad players'));
  assert.ok(md.includes('[[rr:claude]]\nAdded the join flow'));
  assert.equal(firstPrompt, 'add a join option for squad players');
});

test('compileTranscript captures tool calls and thinking as their own turns', () => {
  const jsonl = jl([
    { type: 'user', message: { role: 'user', content: 'fix it' } },
    { type: 'assistant', message: { role: 'assistant', content: [
      { type: 'thinking', thinking: 'weighing options' },
      { type: 'text', text: 'On it.' },
      { type: 'tool_use', name: 'Bash', input: { command: 'git commit -am fix' } },
    ] } },
    { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', content: '1 file changed' }] } },
  ]);
  const { md } = compileTranscript(jsonl);
  assert.ok(md.includes('[[rr:think]]\nweighing options'));
  assert.ok(md.includes('[[rr:claude]]\nOn it.'));
  assert.ok(md.includes('[[rr:tool Bash]]\ngit commit -am fix'));
  assert.ok(md.includes('1 file changed')); // tool_result folded into the tool turn
});

test('compileTranscript keeps full text — no 60k mid-conversation cut', () => {
  const big = 'word '.repeat(20000).trim(); // ~100k chars of assistant prose
  const { md } = compileTranscript(jl([
    { role: 'user', content: 'start' },
    { role: 'assistant', content: big },
  ]));
  assert.ok(md.includes(big));        // not truncated
  assert.ok(!md.includes('trimmed')); // ceiling not hit
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

test('isBackground filters sub-agents, observers, and observer cwds — keeps real chats', () => {
  const real = jl([
    { type: 'user', cwd: '/n/Easy Red 2/mod', userType: 'external', message: { role: 'user', content: 'fix the crash in the vehicle crew controller' } },
    { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'Fixed; here is the change and a test.' }] } },
  ]);
  assert.equal(isBackground(real), false);

  const sidechain = jl([
    { type: 'user', isSidechain: true, cwd: '/n/Easy Red 2/mod', message: { role: 'user', content: 'Adversarially review the new code' } },
    { type: 'assistant', isSidechain: true, message: { role: 'assistant', content: [{ type: 'text', text: 'Review done.' }] } },
  ]);
  assert.equal(isBackground(sidechain), true);

  const observer = jl([
    { type: 'user', cwd: '/home/user/work', message: { role: 'user', content: 'Hello memory agent, you are continuing to observe the workspace.' } },
    { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'Observing.' }] } },
  ]);
  assert.equal(isBackground(observer), true);

  const observerCwd = jl([
    { type: 'user', cwd: '/home/user/observer-sessions', message: { role: 'user', content: 'record the latest notes please' } },
    { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'Noted.' }] } },
  ]);
  assert.equal(isBackground(observerCwd), true);
});

test('buildPayload drops background sessions; title prefers the Claude summary, else your prompt', () => {
  const sidechain = jl([
    { type: 'user', isSidechain: true, message: { role: 'user', content: 'review this' } },
    { type: 'assistant', isSidechain: true, message: { role: 'assistant', content: [{ type: 'text', text: 'done with the review of everything' }] } },
  ]);
  assert.equal(buildPayload({ jsonl: sidechain, sessionId: 'claude:x' }), null);

  const session = jl([
    { type: 'summary', summary: 'ER2 vehicle crew control fix' },
    { type: 'user', userType: 'external', message: { role: 'user', content: 'the crew controller crashes on spawn, please investigate and fix it' } },
    { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'Found a null deref; patched and tested.' }] } },
  ]);
  const p = buildPayload({ jsonl: session, sessionId: 'claude:y', group: 'Easy Red 2', sourceType: 'claude_code' });
  assert.equal(p.title, 'ER2 vehicle crew control fix'); // Claude's native summary wins (the comprehensible sidebar title)

  // no summary entry → fall back to your most recent prompt
  const noSummary = jl([
    { type: 'user', userType: 'external', message: { role: 'user', content: 'the crew controller crashes on spawn, please investigate' } },
    { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'Found a null deref; patched and tested.' }] } },
  ]);
  assert.equal(buildPayload({ jsonl: noSummary, sessionId: 'claude:z' }).title, 'the crew controller crashes on spawn, please investigate');
});

test('buildPayload previews Claude\'s latest turn (title = your prompt, preview = where we are)', () => {
  const p = buildPayload({ jsonl: jl([
    { role: 'user', content: 'start the scoreboard work' },
    { role: 'assistant', content: 'Set up the overlay.' },
    { role: 'user', content: 'now persist the scores' },
    { role: 'assistant', content: 'Persisted to disk and added a test.' },
  ]), sessionId: 'pv-1' });
  assert.ok(p.title.startsWith('now persist the scores'));
  assert.equal(p.preview, 'Persisted to disk and added a test.');
});

test('Codex env-context block is skipped for the title; cwd parsed from it', () => {
  const codex = jl([
    { type: 'message', role: 'user', content: [{ type: 'input_text', text: '<environment_context> <cwd>/n/Easy Red 2/ER2DogfightMode</cwd> <shell>powershell</shell> </environment_context>' }] },
    { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'add a dogfight scoring mode to the mod' }] },
    { type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Added scoring with tests.' }] } },
  ]);
  assert.equal(cwdOf(codex), '/n/Easy Red 2/ER2DogfightMode');
  const p = buildPayload({ jsonl: codex, sessionId: 'codex:z', sourceType: 'codex' });
  assert.ok(p.title.startsWith('add a dogfight scoring mode')); // not the env block
  assert.ok(!p.text.includes('environment_context'));
});
