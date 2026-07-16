import test from 'node:test';
import assert from 'node:assert/strict';
import {
  tokenize, orpIndex, delayMultiplier, delayMs, buildWpm,
  remainingMs, prevSentenceStart, nextSentenceStart,
  clusterize, clusterDelayMs,
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

test('URLs stay atomic and are flagged as links', () => {
  const t = tokenize('read this https://ex.com/a-long/path?q=1 and also (https://x.io/p), thanks');
  const links = t.filter((x) => x.link);
  assert.equal(links.length, 2);
  assert.equal(links[0].w, 'https://ex.com/a-long/path?q=1'); // no compound splitting
  assert.equal(links[1].w, '(https://x.io/p),');
  assert.equal(links[1].clauseEnd, true);
  assert.deepEqual(t.slice(0, 2).map((x) => x.w), ['read', 'this']);
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

test('buildWpm ramps 200 → target in configurable steps', () => {
  assert.equal(buildWpm(0, 400), 200);
  assert.equal(buildWpm(14999, 400), 200);
  assert.equal(buildWpm(15000, 400), 220);
  assert.equal(buildWpm(45000, 400), 260);
  assert.equal(buildWpm(10 * 60000, 400), 400); // capped at target
  assert.equal(buildWpm(0, 150), 150); // target below start: just target
  // configurable step + interval: +50 wpm every 10s → 200 + 50*2 at 20s
  assert.equal(buildWpm(20000, 600, { stepWpm: 50, stepSec: 10 }), 300);
});

test('remainingMs sums per-token delays', () => {
  // 100ms base per word at 600 wpm; final token carries the paragraph pause (×3)
  const t = tokenize('one two three');
  assert.equal(remainingMs(t, 0, 600), 500);
  assert.equal(remainingMs(t, 2, 600), 300);
});

test('clusterize size 1 is one cluster per token', () => {
  const t = tokenize('one two three.');
  const c = clusterize(t, 1);
  assert.deepEqual(c.map((x) => x.w), ['one', 'two', 'three.']);
  assert.deepEqual(c.map((x) => [x.start, x.end]), [[0, 0], [1, 1], [2, 2]]);
});

test('clusterize groups phrases, closing at clause and sentence ends', () => {
  const t = tokenize('The quick brown fox jumps, then rests. Done now');
  const c = clusterize(t, 3);
  assert.deepEqual(c.map((x) => x.w), ['The quick brown', 'fox jumps,', 'then rests.', 'Done now']);
});

test('clusterize never spans a paragraph boundary', () => {
  const t = tokenize('one two\n\nthree four');
  const c = clusterize(t, 4);
  assert.deepEqual(c.map((x) => x.w), ['one two', 'three four']);
});

test('clusterize never spans a section change', () => {
  const t = tokenize('alpha beta gamma delta').map((x, i) => ({ ...x, sec: i < 2 ? 0 : 1 }));
  const c = clusterize(t, 4);
  assert.deepEqual(c.map((x) => x.w), ['alpha beta', 'gamma delta']);
  assert.deepEqual(c.map((x) => x.sec), [0, 1]);
});

test('clusterize keeps links and code tokens solo', () => {
  const t = tokenize('see https://x.io/p now please');
  const c = clusterize(t, 3);
  assert.deepEqual(c.map((x) => x.w), ['see', 'https://x.io/p', 'now please']);
  assert.equal(c[1].link, true);
  const code = [{ w: 'plain' }, { w: 'x=1', code: true }, { w: 'after' }, { w: 'that' }];
  assert.deepEqual(clusterize(code, 3).map((x) => x.w), ['plain', 'x=1', 'after that']);
});

test('clusterize clamps size to 1-4', () => {
  const t = tokenize('a b c d e f g h');
  assert.equal(clusterize(t, 99)[0].w, 'a b c d');
  assert.equal(clusterize(t, 0)[0].w, 'a');
  assert.equal(clusterize(t, NaN)[0].w, 'a');
});

test('clusterDelayMs sums member delays so wpm stays honest', () => {
  const t = tokenize('one two three four');
  const c = clusterize(t, 4);
  assert.equal(c.length, 1);
  assert.equal(clusterDelayMs(t, c[0], 600), remainingMs(t, 0, 600));
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
