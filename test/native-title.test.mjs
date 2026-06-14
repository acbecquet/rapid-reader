import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTitlePrompt, cleanTitle } from '../hooks/native-title.mjs';

test('buildTitlePrompt includes the recent-direction instruction', () => {
  const p = buildTitlePrompt('add a join option for squad players');
  assert.ok(/3 to 7 words/.test(p));
  assert.ok(/MOST RECENT direction/.test(p));
  assert.ok(/No quotes/.test(p));
  assert.ok(/punctuation at the end/i.test(p));
  assert.ok(p.includes('add a join option for squad players'));
});

test('buildTitlePrompt biases to the tail of a long transcript', () => {
  const transcript = 'EARLY_MARKER ' + 'x '.repeat(8000) + 'RECENT_MARKER';
  const p = buildTitlePrompt(transcript);
  assert.ok(p.includes('RECENT_MARKER')); // the recent end survives
  assert.ok(!p.includes('EARLY_MARKER')); // the far-back start is dropped
});

test('cleanTitle strips wrapping quotes', () => {
  assert.equal(cleanTitle('"Fix login session bug"'), 'Fix login session bug');
  assert.equal(cleanTitle('“Add dogfight scoring mode”'), 'Add dogfight scoring mode');
  assert.equal(cleanTitle("'Refactor auth module'"), 'Refactor auth module');
});

test('cleanTitle strips markdown and a trailing period', () => {
  assert.equal(cleanTitle('**Fix the crash.**'), 'Fix the crash');
  assert.equal(cleanTitle('## Update the docs'), 'Update the docs');
  assert.equal(cleanTitle('Add rate limiting!'), 'Add rate limiting');
});

test('cleanTitle strips code fences and backticks, takes the first real line', () => {
  assert.equal(cleanTitle('Here is the title:\nWire native titling into sync'), 'Here is the title');
  assert.equal(cleanTitle('`grep` helper for transcripts'), 'grep helper for transcripts');
  assert.equal(cleanTitle('```\nFix parser\n```'), 'Fix parser');
});

test('cleanTitle caps to 9 words / 80 chars', () => {
  const out = cleanTitle('one two three four five six seven eight nine ten eleven');
  assert.equal(out.split(' ').length, 9);
  assert.equal(out, 'one two three four five six seven eight nine');
  assert.ok(cleanTitle('x'.repeat(200)).length <= 80);
});

test('cleanTitle returns empty string for empty/garbage', () => {
  assert.equal(cleanTitle(''), '');
  assert.equal(cleanTitle(null), '');
  assert.equal(cleanTitle('   '), '');
  assert.equal(cleanTitle('```\n```'), '');
  assert.equal(cleanTitle('"""'), '');
});
