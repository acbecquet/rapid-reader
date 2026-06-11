// Pure RSVP logic: no DOM, no fetch. Tested by test/rsvp.test.mjs.

// Split text into word tokens, marking clause/sentence/paragraph boundaries
// so the player can pause longer where a reader naturally would.
export function tokenize(text) {
  const tokens = [];
  const paragraphs = text.split(/\n\s*\n+/);
  for (const para of paragraphs) {
    const words = para.split(/\s+/).filter(Boolean);
    for (let i = 0; i < words.length; i++) {
      const w = words[i];
      tokens.push({
        w,
        sentenceEnd: /[.?!…]["')\]]*$/.test(w),
        clauseEnd: /[,;:—]["')\]]*$/.test(w),
      });
    }
    if (tokens.length) tokens[tokens.length - 1].paraEnd = true;
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

// Build-up mode: start at 80 WPM, +20 every 15s of play time, capped at target.
export const BUILD = { startWpm: 80, stepWpm: 20, stepMs: 15000 };

export function buildWpm(playedMs, targetWpm) {
  const wpm = BUILD.startWpm + BUILD.stepWpm * Math.floor(playedMs / BUILD.stepMs);
  return Math.min(targetWpm, wpm);
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
