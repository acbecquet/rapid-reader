// LLM helpers: short sidebar titles and language summaries of code/diff-heavy
// captures. Gemini (free tier) first; MiniMax picks up when Gemini is out of
// quota or fails. prefer:'minimax' (the ⚙ review-model setting) flips the
// order. Both degrade gracefully to null.
//
// Keys are passed in (not read from env here) so each signed-in user spends
// their own free Gemini quota — see keysFor() in api/items.js. The keys arg
// defaults to the shared env keys, which still serves the owner and local dev.

async function minimax(prompt, maxOutputTokens, key) {
  if (!key) return null;
  const base = process.env.MINIMAX_BASE_URL || 'https://api.minimax.io/v1';
  const model = process.env.MINIMAX_MODEL || 'MiniMax-M3';
  try {
    const res = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + key },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: maxOutputTokens,
        temperature: 0.2,
      }),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return (data.choices?.[0]?.message?.content || '').trim() || null;
  } catch {
    return null;
  }
}

async function gemini(prompt, maxOutputTokens, key) {
  if (!key) return null;
  const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash-lite';
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { maxOutputTokens, temperature: 0.2 },
        }),
        signal: AbortSignal.timeout(15000),
      }
    );
    if (!res.ok) return null;
    const data = await res.json();
    const out = (data.candidates?.[0]?.content?.parts || [])
      .map((p) => p.text || '')
      .join('')
      .trim();
    return out || null;
  } catch {
    return null;
  }
}

// keys: { geminiKey?, minimaxKey? } — each defaults to the shared env key, so
// the owner and local dev keep working. Pass an explicit '' to *disable* a
// provider for this call (guests with no key of their own get no AI, rather
// than quietly spending the owner's quota).
export async function llm(prompt, maxOutputTokens, prefer, keys = {}) {
  const gk = keys.geminiKey ?? process.env.GEMINI_API_KEY;
  const mk = keys.minimaxKey ?? process.env.MINIMAX_API_KEY;
  if (prefer === 'minimax') {
    return (await minimax(prompt, maxOutputTokens, mk)) ?? gemini(prompt, maxOutputTokens, gk);
  }
  return (await gemini(prompt, maxOutputTokens, gk)) ?? minimax(prompt, maxOutputTokens, mk);
}

export function fallbackTitle(text) {
  const words = text.replace(/[#*`>|_~-]+/g, ' ').trim().split(/\s+/);
  return words.slice(0, 7).join(' ') + (words.length > 7 ? '…' : '');
}

export async function makeTitle(text, prefer, keys) {
  const title = await llm(
    'Write a terse 3-7 word title for the following text. ' +
      'Reply with the title only, no quotes.\n\n' + text.slice(0, 4000),
    1000,
    prefer,
    keys
  );
  return title ? title.replace(/^["“']+|["”']+$/g, '').slice(0, 80) : fallbackTitle(text);
}

// Code/diff → readable review notes (the RSVP-able language around the work).
// Returns null when no LLM is available so the caller can report it.
export async function makeSummary(text, prefer, keys) {
  return llm(
    'Summarize this code or diff into short review notes a developer can ' +
      'read quickly: what changed, any behavior changes, and what to ' +
      'double-check. Use markdown headings and bullet points with short ' +
      'plain sentences. Do not include code blocks.\n\n' + text.slice(0, 16000),
    3000,
    prefer,
    keys
  );
}

// Comprehension quiz: simple multiple-choice questions about a passage the
// user just read. Returns [{ q, choices: [4], answer: 0-3 }] or null when no
// LLM is available or the model can't produce valid JSON (one retry).
export async function makeQuiz(text, n = 5, prefer, keys) {
  const prompt =
    `Write ${n} simple multiple-choice comprehension questions about the ` +
    'following text. Test understanding of the main points and important ' +
    'details, not trivia. Reply with ONLY a JSON array, no markdown fences, ' +
    'in exactly this shape: ' +
    '[{"q":"…","choices":["…","…","…","…"],"answer":0}] ' +
    'with 4 choices per question, answer being the index (0-3) of the ' +
    'correct choice, and correct answers spread evenly across positions.' +
    '\n\n' + text.slice(0, 15000);
  for (let attempt = 0; attempt < 2; attempt++) {
    const out = await llm(prompt, 4000, prefer, keys);
    if (!out) return null; // no key/provider — a retry won't help
    const quiz = parseQuiz(out, n);
    if (quiz) return quiz;
  }
  return null;
}

function parseQuiz(out, n) {
  const s = out.replace(/```(?:json)?/g, '').trim();
  const start = s.indexOf('[');
  const end = s.lastIndexOf(']');
  if (start === -1 || end <= start) return null;
  let arr;
  try { arr = JSON.parse(s.slice(start, end + 1)); } catch { return null; }
  if (!Array.isArray(arr)) return null;
  const qs = arr
    .filter((x) => x && typeof x.q === 'string' && x.q.trim()
      && Array.isArray(x.choices) && x.choices.length === 4
      && x.choices.every((c) => typeof c === 'string' && String(c).trim())
      && Number.isInteger(x.answer) && x.answer >= 0 && x.answer < 4)
    .map((x) => ({ q: x.q.trim(), choices: x.choices.map((c) => String(c).trim()), answer: x.answer }));
  return qs.length >= 3 ? qs.slice(0, n) : null; // a thin quiz is worse than a retry
}

// Confirm a user-supplied Gemini key really works before we store it — so the
// sign-in flow can honestly say "you're set". Listing models needs only a
// valid key and costs no generation quota, so checking never eats their free
// budget. true only on a clean 200; a bad/typo'd key (400/403) returns false.
export async function validateGeminiKey(key) {
  key = String(key || '').trim();
  if (!key) return false;
  try {
    const res = await fetch('https://generativelanguage.googleapis.com/v1beta/models', {
      headers: { 'x-goog-api-key': key },
      signal: AbortSignal.timeout(10000),
    });
    return res.ok;
  } catch {
    return false;
  }
}
