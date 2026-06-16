// Shared backlog ingestion. Used by the items POST handler and by every
// source endpoint (telegram, email, …) so they all gate, store the body in
// Blob, and write the lean index identically.
import crypto from 'node:crypto';
import { getDoc, setDoc, putBody } from './store.js';
import { keyFor } from './auth.js';
import { mergePrefs } from './prefs.js';

const CAP = 5000;

export const SOURCE_TYPES = [
  'manual', 'web', 'claude_code', 'codex', 'copilot', 'docs', 'email',
  'article', 'book', 'telegram', 'other',
];

export function quickTitle(text) {
  text = String(text || '');
  // Agent transcripts carry [[rr:you|claude|…]] turn markers. Title from the first
  // user turn (your prompt), and never leak a raw sentinel into the title.
  const you = text.match(/\[\[rr:you\b[^\]]*\]\]\s*([\s\S]*?)(?:\n\s*\[\[rr:|$)/i);
  if (you && you[1].trim()) text = you[1];
  const words = text.replace(/\[\[rr:[^\]]*\]\]/g, ' ').replace(/[#*`>|_~\-]+/g, ' ').replace(/\s+/g, ' ').trim().split(' ');
  return words.slice(0, 8).join(' ').slice(0, 90) + (words.length > 8 ? '…' : '');
}

// Add (or session-upsert) one item. Returns { item } or { ignored:true } when
// the source's header toggle is off. `gated:false` skips the toggle (the
// owner pasting by hand should never be dropped by a source switch).
export async function addItem(uid, { text, sourceType, title = '', url = '', words, sessionId, group = '', bookId, chapterIndex, ts, preview } = {}, { gated = true } = {}) {
  text = String(text || '').trim();
  if (!text) throw new Error('text required');
  sourceType = SOURCE_TYPES.includes(sourceType) ? sourceType : 'other';

  if (gated) {
    const prefs = mergePrefs(await getDoc(keyFor('rr:prefs', uid), null));
    if (prefs.sources[sourceType] === false) return { ignored: true };
  }

  const KEY_U = keyFor('rr:items', uid);
  const items = await getDoc(KEY_U, []);
  const w = Number(words) || text.split(/\s+/).length;
  const t = (title || '').trim().slice(0, 100) || quickTitle(text);
  const g = String(group || '').slice(0, 60);
  const when = Number(ts) || Date.now(); // real session time when provided
  // book chapter fields, kept only when present
  const bookFields = bookId
    ? { bookId: String(bookId).slice(0, 80), chapterIndex: Number(chapterIndex) || 0 }
    : {};
  let source = '';
  try { source = new URL(url).hostname; } catch {}

  const sid = sessionId ? String(sessionId).slice(0, 80) : null;
  if (sid) {
    const prev = items.find((it) => it.sessionId === sid);
    if (prev) {
      prev.bodyUrl = await putBody(uid, prev.id, text);
      if (!prev.titlePinned) prev.title = t; // a manual rename sticks across re-syncs
      prev.words = w;
      if (preview) prev.preview = String(preview).slice(0, 200); // latest-turn line
      if (g) prev.group = g;
      Object.assign(prev, bookFields);
      prev.createdAt = when; // bump recency so live updates sort to the top
      prev.readAt = bookId ? prev.readAt : null; // re-importing a book keeps your read state
      await setDoc(KEY_U, [prev, ...items.filter((it) => it !== prev)].slice(0, CAP));
      return { item: prev, updated: true };
    }
  }

  const id = crypto.randomUUID();
  const bodyUrl = await putBody(uid, id, text);
  const item = {
    id, title: t, sourceType, url, source,
    createdAt: when, readAt: null, progress: 0, archivedAt: null,
    words: w, bodyUrl, ...(g ? { group: g } : {}), ...bookFields, ...(sid ? { sessionId: sid } : {}),
    ...(preview ? { preview: String(preview).slice(0, 200) } : {}),
  };
  await setDoc(KEY_U, [item, ...items].slice(0, CAP));
  return { item };
}
