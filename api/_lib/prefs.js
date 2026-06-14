// Per-user preferences: the ⚡ capture gate, the source on/off toggles, and
// the backlog column layout. Stored lean at rr:prefs:<uid>. Shared here so
// items.js (which returns prefs in its poll) and prefs.js (which edits them)
// agree on the defaults and the source→column routing.

export const SOURCES = ['claude_code', 'codex', 'copilot', 'docs', 'email', 'telegram'];

// The five default columns and which source types fall into each. Order is the
// backlog's top-to-bottom order on phones (and left-to-right on desktop):
// reading first (books, articles), then agents, general, with email last.
export const DEFAULT_COLUMNS = [
  { id: 'books', name: 'Books', icon: 'book', sources: ['book'] },
  { id: 'news', name: 'News', icon: 'news', sources: ['article', 'web'] },
  { id: 'agents', name: 'Agents', icon: 'agents', sources: ['claude_code', 'codex', 'copilot', 'telegram'] },
  { id: 'general', name: 'General', icon: 'general', sources: ['manual', 'docs', 'other'] },
  { id: 'email', name: 'Email', icon: 'email', sources: ['email'] },
];

export function defaultPrefs() {
  return {
    capture: true,
    sources: Object.fromEntries(SOURCES.map((s) => [s, true])),
    columns: DEFAULT_COLUMNS,
    geminiKey: '', // this user's own free Gemini key (bring-your-own quota)
  };
}

// Merge stored prefs over the defaults so new fields always exist. Carries the
// raw geminiKey — this is the server-internal view; never send it to a client
// (use publicPrefs for that).
export function mergePrefs(stored) {
  const d = defaultPrefs();
  if (!stored) return d;
  return {
    capture: stored.capture !== false,
    sources: { ...d.sources, ...(stored.sources || {}) },
    columns: Array.isArray(stored.columns) && stored.columns.length ? stored.columns : d.columns,
    geminiKey: typeof stored.geminiKey === 'string' ? stored.geminiKey : '',
  };
}

// Will AI titles work for this user *without* them adding a key? Their own key
// always counts; the owner is also covered by the server's shared env key.
// Guests are not — bringing their own free key is the whole point, so each
// tester spends their own quota instead of the owner's.
export function aiCovered(uid, merged) {
  if (merged.geminiKey) return true;
  return uid === 'owner' && !!(process.env.GEMINI_API_KEY || process.env.MINIMAX_API_KEY);
}

// Client-safe view of prefs: the raw key never leaves the server. The browser
// gets only whether a key is set, and whether this user still needs one.
export function publicPrefs(merged, uid) {
  const { geminiKey, ...rest } = merged;
  return { ...rest, hasGeminiKey: !!geminiKey, needsGeminiKey: !aiCovered(uid, merged) };
}
