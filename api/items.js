// Backlog endpoint. Items:
// { id, text, title, url, source, sourceType, createdAt, readAt, progress,
//   archivedAt, summary }
// GET    /api/items            → { items }
// POST   /api/items            { text, url?, title?, sourceType? } → { item }
// PATCH  /api/items            { id, title?|readAt?|progress?|archivedAt? } → { item }
//        { id, summarize: true } → Gemini language summary stored on the item
//        { id, summary } → store an agent-written summary directly
// DELETE /api/items?id=… or { id } or { ids: […] } → { ok }
import crypto from 'node:crypto';
import { getDoc, getDocs, setDoc, delDoc } from './_lib/store.js';
import { gate, keyFor } from './_lib/auth.js';
import { makeTitle, makeSummary } from './_lib/title.js';
import { fetchReadable } from './_lib/readable.js';

const KEY = 'rr:items';
const CAP = 500;

export const SOURCE_TYPES = [
  'manual', 'web', 'claude_code', 'codex', 'copilot', 'docs', 'email', 'article', 'book', 'other',
];

function defaultSourceType(url) {
  if (!url) return 'manual';
  if (/(^|\.)claude\.(ai|com)$/.test(new URL(url).hostname)) return 'claude_code';
  return 'web';
}

export default async function handler(req, res) {
  const uid = gate(req, res);
  if (!uid) return;
  const KEY_U = keyFor(KEY, uid);
  const body = req.body || {};

  if (req.method === 'GET') {
    // one MGET: backlog + the ephemeral live-highlight slot (see api/live.js)
    const [items, live] = await getDocs([KEY_U, keyFor('rr:live', uid)], [[], null]);
    return res.status(200).json({ items, live });
  }
  const items = await getDoc(KEY_U, []);

  if (req.method === 'POST') {
    let text = (body.text || '').trim();
    if (!text) return res.status(400).json({ error: 'text required' });
    let url = body.url || '';
    let title = (body.title || '').trim();
    let digested = false;
    // A bare URL means "read this page": fetch it and reorganize for RSVP.
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
    let source = '';
    try { source = new URL(url).hostname; } catch {}
    // Claude-session pushes (hooks/) upsert: same sessionId → refresh the item
    const sessionId = body.sessionId ? String(body.sessionId).slice(0, 80) : null;
    if (sessionId) {
      const prev = items.find((it) => it.sessionId === sessionId);
      if (prev) {
        prev.text = text;
        if (title) prev.title = title.slice(0, 100);
        prev.readAt = null; // new content → unread again
        await setDoc(KEY_U, [prev, ...items.filter((it) => it !== prev)]);
        return res.status(200).json({ item: prev });
      }
    }
    const item = {
      id: crypto.randomUUID(),
      text,
      title: title.slice(0, 100) || await makeTitle(text),
      url,
      source,
      sourceType: SOURCE_TYPES.includes(body.sourceType)
        ? body.sourceType
        : (digested ? 'article' : defaultSourceType(url)),
      createdAt: Date.now(),
      readAt: null,
      progress: 0,
      archivedAt: null,
      summary: null,
      ...(sessionId ? { sessionId } : {}),
    };
    await setDoc(KEY_U, [item, ...items].slice(0, CAP));
    return res.status(201).json({ item });
  }

  if (req.method === 'PATCH') {
    const item = items.find((it) => it.id === body.id);
    if (!item) return res.status(404).json({ error: 'not found' });
    if (body.summarize) {
      const summary = await makeSummary(item.text);
      if (!summary) return res.status(502).json({ error: 'summary unavailable — set GEMINI_API_KEY' });
      item.summary = summary;
    } else if ('summary' in body) {
      // agent-provided summary (e.g. via MCP — the connected model writes it)
      item.summary = String(body.summary || '').slice(0, 20000) || null;
    }
    if ('title' in body) item.title = String(body.title).slice(0, 120);
    if ('readAt' in body) item.readAt = body.readAt;
    if ('progress' in body) item.progress = Math.max(0, Number(body.progress) || 0);
    if ('archivedAt' in body) item.archivedAt = body.archivedAt;
    await setDoc(KEY_U, items);
    return res.status(200).json({ item });
  }

  if (req.method === 'DELETE') {
    const ids = body.ids || [body.id || req.query?.id].filter(Boolean);
    if (!ids.length) return res.status(400).json({ error: 'id required' });
    const gone = items.filter((it) => ids.includes(it.id));
    await setDoc(KEY_U, items.filter((it) => !ids.includes(it.id)));
    // book content lives in its own doc (api/books.js) — delete it too
    for (const it of gone) {
      if (it.bookId) await delDoc(keyFor('rr:book:' + it.bookId, uid));
    }
    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ error: 'method not allowed' });
}
