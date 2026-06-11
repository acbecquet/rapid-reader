import test from 'node:test';
import assert from 'node:assert/strict';
import {
  tokenize, orpIndex, delayMultiplier, delayMs, buildWpm,
  remainingMs, prevSentenceStart, nextSentenceStart,
} from '../public/rsvp.js';

test('tokenize marks sentence, clause, and paragraph boundaries', () => {
  const t = tokenize('Hello world, this ends.\n\nNew paragraph here!');
  assert.equal(t.length, 7);
  assert.equal(t[1].clauseEnd, true);
  assert.equal(t[3].sentenceEnd, true);
  assert.equal(t[3].paraEnd, true);
  assert.equal(t[6].paraEnd, true);
  assert.ok(!t[0].sentenceEnd && !t[0].clauseEnd);
});

test('tokenize handles quotes and collapses whitespace', () => {
  const t = tokenize('He said  "stop."   Then\nleft.');
  assert.deepEqual(t.map((x) => x.w), ['He', 'said', '"stop."', 'Then', 'left.']);
  assert.equal(t[2].sentenceEnd, true);
});

test('tokenize splits hyphenated and slashed compounds', () => {
  const words = (s) => tokenize(s).map((x) => x.w);
  assert.deepEqual(words('a run-of-the-mill day'), ['a', 'run', 'of', 'the', 'mill', 'day']);
  assert.deepEqual(words('and/or em—dash en–dash'), ['and', 'or', 'em', 'dash', 'en', 'dash']);
  assert.deepEqual(words('a 3-day, state-of-the-art co-op'), ['a', '3', 'day,', 'state', 'of', 'the', 'art', 'co', 'op']);
  // digit-digit joins are ranges/dates and stay whole
  assert.deepEqual(words('pages 2-3 of 1998-2024'), ['pages', '2-3', 'of', '1998-2024']);
});

test('orpIndex follows Spritz-style length buckets', () => {
  assert.equal(orpIndex('a'), 0);
  assert.equal(orpIndex('the'), 1);
  assert.equal(orpIndex('readers'), 2);
  assert.equal(orpIndex('presentation'), 3);
  assert.equal(orpIndex('internationalization'), 4);
});

test('orpIndex skips leading punctuation', () => {
  assert.equal(orpIndex('"hello'), 2); // letters start at 1, pivot +1
  assert.equal(orpIndex('(a)'), 1);
});

test('delay multipliers: long words, numbers, punctuation pauses', () => {
  assert.equal(delayMultiplier({ w: 'cat' }), 1);
  assert.equal(delayMultiplier({ w: 'absolutely' }), 1.3);
  assert.equal(delayMultiplier({ w: 'incomprehensible' }), 1.6);
  assert.equal(delayMultiplier({ w: '1,234' }), 1.6);
  assert.equal(delayMultiplier({ w: 'end.', sentenceEnd: true }), 2.5);
  assert.equal(delayMultiplier({ w: 'pause,', clauseEnd: true }), 1.6);
  assert.equal(delayMultiplier({ w: 'para.', sentenceEnd: true, paraEnd: true }), 3);
});

test('delayMs scales with wpm', () => {
  assert.equal(delayMs({ w: 'cat' }, 300), 200);
  assert.equal(delayMs({ w: 'cat' }, 600), 100);
});

test('buildWpm ramps 80 → target in +20/15s steps', () => {
  assert.equal(buildWpm(0, 400), 80);
  assert.equal(buildWpm(14999, 400), 80);
  assert.equal(buildWpm(15000, 400), 100);
  assert.equal(buildWpm(45000, 400), 140);
  assert.equal(buildWpm(10 * 60000, 400), 400); // capped at target
  assert.equal(buildWpm(0, 60), 60); // target below start: just target
});

test('remainingMs sums per-token delays', () => {
  // 100ms base per word at 600 wpm; final token carries the paragraph pause (×3)
  const t = tokenize('one two three');
  assert.equal(remainingMs(t, 0, 600), 500);
  assert.equal(remainingMs(t, 2, 600), 300);
});

test('sentence navigation', () => {
  const t = tokenize('First one. Second sentence here. Third.');
  // tokens: First one. | Second sentence here. | Third.
  assert.equal(nextSentenceStart(t, 0), 2);
  assert.equal(nextSentenceStart(t, 3), 5);
  assert.equal(prevSentenceStart(t, 3), 2); // mid-sentence → its start
  assert.equal(prevSentenceStart(t, 2), 0); // at start → previous sentence
  assert.equal(prevSentenceStart(t, 0), 0);
});
