// Per-user preferences: the ⚡ capture gate, the source on/off toggles, and
// the backlog column layout. Stored lean at rr:prefs:<uid>. Shared here so
// items.js (which returns prefs in its poll) and prefs.js (which edits them)
// agree on the defaults and the source→column routing.

export const SOURCES = ['claude_code', 'codex', 'copilot', 'docs', 'email', 'telegram'];

// The five default columns and which source types fall into each.
export const DEFAULT_COLUMNS = [
  { id: 'agents', name: 'Agents', icon: 'agents', sources: ['claude_code', 'codex', 'copilot'] },
  { id: 'books', name: 'Books', icon: 'book', sources: ['book'] },
  { id: 'email', name: 'Email', icon: 'email', sources: ['email'] },
  { id: 'news', name: 'News', icon: 'news', sources: ['article', 'web'] },
  { id: 'general', name: 'General', icon: 'general', sources: ['manual', 'docs', 'telegram', 'other'] },
];

export function defaultPrefs() {
  return {
    capture: true,
    sources: Object.fromEntries(SOURCES.map((s) => [s, true])),
    columns: DEFAULT_COLUMNS,
  };
}

// Merge stored prefs over the defaults so new fields always exist.
export function mergePrefs(stored) {
  const d = defaultPrefs();
  if (!stored) return d;
  return {
    capture: stored.capture !== false,
    sources: { ...d.sources, ...(stored.sources || {}) },
    columns: Array.isArray(stored.columns) && stored.columns.length ? stored.columns : d.columns,
  };
}
