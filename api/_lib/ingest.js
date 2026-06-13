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
  const words = text.replace(/[#*`>|_~\-]+/g, ' ').replace(/\s+/g, ' ').trim().split(' ');
  return words.slice(0, 8).join(' ').slice(0, 90) + (words.length > 8 ? '…' : '');
}

// Add (or session-upsert) one item. Returns { item } or { ignored:true } when
// the source's header toggle is off. `gated:false` skips the toggle (the
// owner pasting by hand should never be dropped by a source switch).
export async function addItem(uid, { text, sourceType, title = '', url = '', words, sessionId } = {}, { gated = true } = {}) {
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
  let source = '';
  try { source = new URL(url).hostname; } catch {}

  const sid = sessionId ? String(sessionId).slice(0, 80) : null;
  if (sid) {
    const prev = items.find((it) => it.sessionId === sid);
    if (prev) {
      prev.bodyUrl = await putBody(uid, prev.id, text);
      prev.title = t;
      prev.words = w;
      prev.readAt = null;
      await setDoc(KEY_U, [prev, ...items.filter((it) => it !== prev)].slice(0, CAP));
      return { item: prev, updated: true };
    }
  }

  const id = crypto.randomUUID();
  const bodyUrl = await putBody(uid, id, text);
  const item = {
    id, title: t, sourceType, url, source,
    createdAt: Date.now(), readAt: null, progress: 0, archivedAt: null,
    words: w, bodyUrl, ...(sid ? { sessionId: sid } : {}),
  };
  await setDoc(KEY_U, [item, ...items].slice(0, CAP));
  return { item };
}
