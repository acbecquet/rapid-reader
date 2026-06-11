// Gemini helpers (free API tier, GEMINI_API_KEY): short sidebar titles and
// language summaries of code/diff-heavy captures. Both degrade gracefully.

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

export function fallbackTitle(text) {
  const words = text.replace(/[#*`>|_~-]+/g, ' ').trim().split(/\s+/);
  return words.slice(0, 7).join(' ') + (words.length > 7 ? '…' : '');
}

export async function makeTitle(text) {
  const title = await gemini(
    'Write a terse 3-7 word title for the following text. ' +
      'Reply with the title only, no quotes.\n\n' + text.slice(0, 4000),
    1000
  );
  return title ? title.replace(/^["“']+|["”']+$/g, '').slice(0, 80) : fallbackTitle(text);
}

// Code/diff → readable review notes (the RSVP-able language around the work).
// Returns null when Gemini is unavailable so the caller can report it.
export async function makeSummary(text) {
  return gemini(
    'Summarize this code or diff into short review notes a developer can ' +
      'read quickly: what changed, any behavior changes, and what to ' +
      'double-check. Use markdown headings and bullet points with short ' +
      'plain sentences. Do not include code blocks.\n\n' + text.slice(0, 16000),
    3000
  );
}
