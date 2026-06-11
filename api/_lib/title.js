// Short sidebar title for a captured highlight. Uses the free Gemini API
// tier when GEMINI_API_KEY is set; otherwise falls back to the first words.

export function fallbackTitle(text) {
  const words = text.trim().split(/\s+/);
  return words.slice(0, 7).join(' ') + (words.length > 7 ? '…' : '');
}

export async function makeTitle(text) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return fallbackTitle(text);
  const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash-lite';
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify({
          contents: [{
            parts: [{
              text: 'Write a terse 3-7 word title for the following text. ' +
                'Reply with the title only, no quotes.\n\n' + text.slice(0, 4000),
            }],
          }],
          generationConfig: { maxOutputTokens: 1000, temperature: 0.2 },
        }),
        signal: AbortSignal.timeout(6000),
      }
    );
    if (!res.ok) return fallbackTitle(text);
    const data = await res.json();
    const title = (data.candidates?.[0]?.content?.parts || [])
      .map((p) => p.text || '')
      .join('')
      .trim()
      .replace(/^["“']+|["”']+$/g, '');
    return title ? title.slice(0, 80) : fallbackTitle(text);
  } catch {
    return fallbackTitle(text);
  }
}
