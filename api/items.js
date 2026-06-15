// Backlog endpoint. The index holds lean stubs; each item's full text lives
// in Blob (api/_lib/store putBody/getBody). No AI on the hot path — titles
// are instant (first words), structure is parsed client-side, raw text is
// shown in the transcript. This keeps capture responsive and handles very
// long inputs (the body never rides the 4s poll).
//
// Stub: { id, title, sourceType, createdAt, readAt, progress, archivedAt,
//         words, url, source, bodyUrl, sessionId? }
// GET    /api/items            → { items, live, prefs }
// GET    /api/items?id=…       → { item, text }   (loads one body to read)
// POST   /api/items            { text, sourceType?, url?, title?, words?, sessionId? } → { item } | { ignored }
// PATCH  /api/items            { id, title?|readAt?|progress?|archivedAt? } → { item }
// DELETE /api/items?id=… | { id } | { ids:[…] }   → { ok }
import { getDoc, getDocs, setDoc, getBody, delBody } from './_lib/store.js';
import { gate, keyFor } from './_lib/auth.js';
import { mergePrefs, publicPrefs } from './_lib/prefs.js';
import { fetchReadable } from './_lib/readable.js';
import { addItem, SOURCE_TYPES } from './_lib/ingest.js';
import { makeTitle } from './_lib/title.js';

const KEY = 'rr:items';

export { SOURCE_TYPES };

// Which API keys this user's AI calls may spend. A signed-in user spends their
// own Gemini key; the owner falls back to the shared env keys; a guest with no
// key of their own gets none (explicit '' disables env fallback in llm()) — so
// growing the tester pool never drains the owner's free quota.
function keysFor(uid, prefs) {
  const owner = uid === 'owner';
  return {
    geminiKey: prefs.geminiKey || (owner ? undefined : ''),
    minimaxKey: owner ? undefined : '',
  };
}

function defaultSourceType(url) {
  if (!url) return 'manual';
  try {
    if (/(^|\.)claude\.(ai|com)$/.test(new URL(url).hostname)) return 'claude_code';
  } catch {}
  return 'web';
}

export default async function handler(req, res) {
  const uid = gate(req, res);
  if (!uid) return;
  const KEY_U = keyFor(KEY, uid);
  const body = req.body || {};

  if (req.method === 'GET') {
    // single-item body load for the reader
    if (req.query?.id) {
      const items = await getDoc(KEY_U, []);
      const item = items.find((it) => it.id === req.query.id);
      if (!item || item.deletedAt) return res.status(404).json({ error: 'not found' }); // deleted = restore first
      const text = await getBody(uid, item.id, item.bodyUrl);
      return res.status(200).json({ item, text });
    }
    // poll: lean stubs + live slot + prefs, in one MGET
    const [items, live, prefs] = await getDocs(
      [KEY_U, keyFor('rr:live', uid), keyFor('rr:prefs', uid)], [[], null, null]
    );
    // Recently-deleted view: only soft-deleted items, newest-deleted first
    if (req.query?.trash) {
      const trash = items.filter((it) => it.deletedAt).sort((a, b) => b.deletedAt - a.deletedAt);
      return res.status(200).json({ items: trash, live: null, prefs: publicPrefs(mergePrefs(prefs), uid) });
    }
    // lazy purge: erase soft-deleted items past the 30-day recovery window
    const cutoff = Date.now() - 30 * 86400000;
    const expired = items.filter((it) => it.deletedAt && it.deletedAt < cutoff);
    if (expired.length) {
      for (const it of expired) await delBody(uid, it.id, it.bodyUrl);
      await setDoc(KEY_U, items.filter((it) => !expired.includes(it)));
    }
    const visible = items.filter((it) => !it.deletedAt);
    return res.status(200).json({ items: visible, live, prefs: publicPrefs(mergePrefs(prefs), uid) });
  }

  const items = await getDoc(KEY_U, []);

  if (req.method === 'POST') {
    let text = (body.text || '').trim();
    if (!text) return res.status(400).json({ error: 'text required' });

    let url = body.url || '';
    let title = (body.title || '').trim();
    let digested = false;
    // A bare URL means "read this page": fetch + strip to text (no AI).
    if (/^https?:\/\/\S+$/i.test(text)) {
      try {
        url = url || text;
        const page = await fetchReadable(text);
        text = page.markdown;
        title = title || page.title;
        digested = true;
      } catch {
        return res.status(422).json({ error: 'could not read that page — try copying its text instead' });
      }
    }

    const sourceType = SOURCE_TYPES.includes(body.sourceType)
      ? body.sourceType : (digested ? 'article' : defaultSourceType(url));

    const out = await addItem(uid, { text, sourceType, title, url, words: body.words, sessionId: body.sessionId, group: body.group, bookId: body.bookId, chapterIndex: body.chapterIndex, ts: body.ts, preview: body.preview });
    if (out.ignored) return res.status(200).json({ ignored: true });
    return res.status(out.updated ? 200 : 201).json({ item: out.item });
  }

  if (req.method === 'PATCH') {
    const item = items.find((it) => it.id === body.id);
    if (!item) return res.status(404).json({ error: 'not found' });
    // AI title self-heal: re-derive a title from the body (LLM, else first
    // words). The frontend asks for this only when a title looks wrong.
    if (body.retitle) {
      const text = await getBody(uid, item.id, item.bodyUrl);
      const prefs = mergePrefs(await getDoc(keyFor('rr:prefs', uid), null));
      const t = await makeTitle(text, body.model === 'minimax' ? 'minimax' : undefined, keysFor(uid, prefs));
      if (t) item.title = t.slice(0, 120);
    }
    if ('title' in body) item.title = String(body.title).slice(0, 120);
    if ('readAt' in body) item.readAt = body.readAt;
    if ('progress' in body) item.progress = Math.max(0, Number(body.progress) || 0);
    if ('archivedAt' in body) item.archivedAt = body.archivedAt;
    if ('bookmarkAt' in body) item.bookmarkAt = body.bookmarkAt; // current book chapter
    if ('deletedAt' in body) item.deletedAt = body.deletedAt; // soft-delete / restore (null)
    if ('titlePinned' in body) item.titlePinned = body.titlePinned; // manual rename sticks
    if ('order' in body) { if (body.order == null) delete item.order; else item.order = Number(body.order) || 0; } // manual drag position
    if ('preview' in body) item.preview = String(body.preview || '').slice(0, 200); // latest-turn line
    await setDoc(KEY_U, items);
    return res.status(200).json({ item });
  }

  if (req.method === 'DELETE') {
    const ids = body.ids || [body.id || req.query?.id].filter(Boolean);
    if (!ids.length) return res.status(400).json({ error: 'id required' });
    // soft by default (recoverable from Trash); hard erase only on explicit ask
    if (!(req.query?.hard || body.hard)) {
      const now = Date.now();
      for (const it of items) if (ids.includes(it.id)) it.deletedAt = now;
      await setDoc(KEY_U, items);
      return res.status(200).json({ ok: true, deletedAt: now });
    }
    const gone = items.filter((it) => ids.includes(it.id));
    await setDoc(KEY_U, items.filter((it) => !ids.includes(it.id)));
    for (const it of gone) await delBody(uid, it.id, it.bodyUrl);
    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ error: 'method not allowed' });
}
