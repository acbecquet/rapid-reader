import test from 'node:test';
import assert from 'node:assert/strict';
import { quickTitle } from '../api/_lib/ingest.js';

test('quickTitle: plain text → first words', () => {
  assert.equal(quickTitle('Some highlighted passage about reading speed.'),
    'Some highlighted passage about reading speed.');
  assert.equal(quickTitle('one two three four five six seven eight nine ten'),
    'one two three four five six seven eight…');
});

test('quickTitle: agent transcript → the user prompt, never a raw sentinel', () => {
  const body = `[[rr:you]]
Give me the overnight overview.
[[rr:claude]]
## Overnight overview — everything done
You asked me to commit the pending repo work first.`;
  const t = quickTitle(body);
  assert.equal(t, 'Give me the overnight overview.');
  assert.equal(/\[\[rr:/.test(t), false); // the marker never leaks into a title
});

test('quickTitle: strips stray sentinels even with no you-turn', () => {
  assert.equal(/\[\[rr:/.test(quickTitle('[[rr:claude]] just the assistant talking here')), false);
});
