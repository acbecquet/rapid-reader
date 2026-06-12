// LLM helpers: short sidebar titles and language summaries of code/diff-heavy
// captures. Uses MiniMax (MINIMAX_API_KEY) when configured, falling back to
// Gemini (GEMINI_API_KEY). Both degrade gracefully to null.

async function minimax(prompt, maxOutputTokens) {
  const key = process.env.MINIMAX_API_KEY;
  if (!key) return null;
  const base = process.env.MINIMAX_BASE_URL || 'https://api.minimax.io/v1';
  const model = process.env.MINIMAX_MODEL || 'MiniMax-M2';
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

async function gemini(prompt, maxOutputTokens) {
  const key = process.env.GEMINI_API_KEY;
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

export async function llm(prompt, maxOutputTokens) {
  return (await minimax(prompt, maxOutputTokens)) ?? gemini(prompt, maxOutputTokens);
}

export function fallbackTitle(text) {
  const words = text.replace(/[#*`>|_~-]+/g, ' ').trim().split(/\s+/);
  return words.slice(0, 7).join(' ') + (words.length > 7 ? '…' : '');
}

export async function makeTitle(text) {
  const title = await llm(
    'Write a terse 3-7 word title for the following text. ' +
      'Reply with the title only, no quotes.\n\n' + text.slice(0, 4000),
    1000
  );
  return title ? title.replace(/^["“']+|["”']+$/g, '').slice(0, 80) : fallbackTitle(text);
}

// Code/diff → readable review notes (the RSVP-able language around the work).
// Returns null when no LLM is available so the caller can report it.
export async function makeSummary(text) {
  return llm(
    'Summarize this code or diff into short review notes a developer can ' +
      'read quickly: what changed, any behavior changes, and what to ' +
      'double-check. Use markdown headings and bullet points with short ' +
      'plain sentences. Do not include code blocks.\n\n' + text.slice(0, 16000),
    3000
  );
}
