// Pure RSVP logic: no DOM, no fetch. Tested by test/rsvp.test.mjs.

// Split text into word tokens, marking clause/sentence/paragraph boundaries
// so the player can pause longer where a reader naturally would.
// Hyphens/dashes/slashes joining words read as separate words
// ("run-of-the-mill" → 4 tokens); digit-digit joins like "2-3" stay whole.
// URLs stay atomic and are flagged `link` for transcript click-through.
const COMPOUND = /([\p{L}\p{N}])[-–—/]+(?=\p{L})|(\p{L})[-–—/]+(?=[\p{L}\p{N}])/gu;
const URLISH = /^[("'\[«]*https?:\/\//i;

export function tokenize(text) {
  const tokens = [];
  for (const para of text.split(/\n\s*\n+/)) {
    const before = tokens.length;
    for (const raw of para.split(/\s+/)) {
      if (!raw) continue;
      const pieces = URLISH.test(raw) ? [raw] : raw.replace(COMPOUND, '$1$2 ').split(' ');
      for (const w of pieces) {
        if (!w) continue;
        tokens.push({
          w,
          ...(URLISH.test(w) ? { link: true } : {}),
          sentenceEnd: /[.?!…]["')\]]*$/.test(w),
          clauseEnd: /[,;:—]["')\]]*$/.test(w),
        });
      }
    }
    if (tokens.length > before) tokens[tokens.length - 1].paraEnd = true;
  }
  return tokens;
}

// Index of the Optimal Recognition Point (the pivot letter the eye locks
// onto), computed over the word's letters and skipping leading punctuation.
export function orpIndex(word) {
  const start = word.search(/[\p{L}\p{N}]/u);
  if (start === -1) return Math.floor((word.length - 1) / 2);
  let end = word.length;
  while (end > start && !/[\p{L}\p{N}]/u.test(word[end - 1])) end--;
  const len = end - start;
  let pivot;
  if (len <= 1) pivot = 0;
  else if (len <= 5) pivot = 1;
  else if (len <= 9) pivot = 2;
  else if (len <= 13) pivot = 3;
  else pivot = 4;
  return start + pivot;
}

// Display-time multiplier for one token (smart pacing): long words, numbers,
// and clause/sentence/paragraph ends get extra time.
export function delayMultiplier(token) {
  const core = token.w.replace(/[^\p{L}\p{N}]/gu, '');
  let m = 1;
  if (core.length >= 12) m = 1.6;
  else if (core.length >= 8) m = 1.3;
  if (/\d/.test(core)) m = Math.max(m, 1.6);
  if (token.paraEnd) m += 2.0;
  else if (token.sentenceEnd) m += 1.5;
  else if (token.clauseEnd) m += 0.6;
  return m;
}

export function delayMs(token, wpm) {
  return (60000 / wpm) * delayMultiplier(token);
}

// Build-up mode: start at 200 WPM, ramp by `stepWpm` every `stepSec` of play
// time, capped at the target. Step + interval are user-configurable.
export const BUILD = { startWpm: 200, stepWpm: 20, stepSec: 15 };

export function buildWpm(playedMs, targetWpm, { stepWpm = BUILD.stepWpm, stepSec = BUILD.stepSec } = {}) {
  const wpm = BUILD.startWpm + stepWpm * Math.floor(playedMs / (stepSec * 1000));
  return Math.min(targetWpm, wpm);
}

// Cluster training: group up to `size` (1-4) consecutive tokens into one
// flash so the reader practices taking in a whole phrase per fixation.
// A cluster is always one natural unit: it closes at clause/sentence/paragraph
// ends and at section changes, and URL/code tokens stay solo. With size 1 this
// is one cluster per token, so the player runs on clusters unconditionally.
export function clusterize(tokens, size = 1) {
  size = Math.max(1, Math.min(4, Math.floor(size) || 1));
  const out = [];
  let i = 0;
  while (i < tokens.length) {
    const start = i;
    const first = tokens[i];
    let end = i;
    if (!first.link && !first.code) {
      while (
        end - start + 1 < size &&
        end + 1 < tokens.length &&
        !tokens[end].sentenceEnd && !tokens[end].clauseEnd && !tokens[end].paraEnd &&
        tokens[end + 1].sec === first.sec &&
        !tokens[end + 1].link && !tokens[end + 1].code
      ) end++;
    }
    const members = tokens.slice(start, end + 1);
    out.push({
      start,
      end,
      w: members.map((t) => t.w).join(' '),
      sec: first.sec,
      code: members.some((t) => !!t.code),
      link: members.some((t) => !!t.link),
    });
    i = end + 1;
  }
  return out;
}

// A cluster's display time is the sum of its members' delays, so a WPM target
// means the same words-per-minute at any cluster size.
export function clusterDelayMs(tokens, cluster, wpm) {
  let ms = 0;
  for (let i = cluster.start; i <= cluster.end; i++) ms += delayMs(tokens[i], wpm);
  return ms;
}

// Estimated time to read tokens[from..] at a fixed wpm.
export function remainingMs(tokens, from, wpm) {
  let ms = 0;
  for (let i = from; i < tokens.length; i++) ms += delayMs(tokens[i], wpm);
  return ms;
}

// Index of the start of the previous/next sentence relative to i.
export function prevSentenceStart(tokens, i) {
  const startOf = (k) => {
    let j = Math.max(0, k);
    while (j > 0 && !tokens[j - 1].sentenceEnd) j--;
    return j;
  };
  const cur = startOf(i);
  return cur < i ? cur : startOf(cur - 1);
}

export function nextSentenceStart(tokens, i) {
  for (let j = i; j < tokens.length - 1; j++) {
    if (tokens[j].sentenceEnd) return j + 1;
  }
  return tokens.length - 1;
}
