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
import { getDoc, getDocs, setDoc } from './_lib/store.js';
import { gate } from './_lib/auth.js';
import { makeTitle, makeSummary } from './_lib/title.js';

const KEY = 'rr:items';
const CAP = 500;

export const SOURCE_TYPES = [
  'manual', 'web', 'claude_code', 'codex', 'copilot', 'docs', 'email', 'article', 'other',
];

function defaultSourceType(url) {
  if (!url) return 'manual';
  if (/(^|\.)claude\.(ai|com)$/.test(new URL(url).hostname)) return 'claude_code';
  return 'web';
}

export default async function handler(req, res) {
  if (!gate(req, res)) return;
  const body = req.body || {};

  if (req.method === 'GET') {
    // one MGET: backlog + the ephemeral live-highlight slot (see api/live.js)
    const [items, live] = await getDocs([KEY, 'rr:live'], [[], null]);
    return res.status(200).json({ items, live });
  }
  const items = await getDoc(KEY, []);

  if (req.method === 'POST') {
    const text = (body.text || '').trim();
    if (!text) return res.status(400).json({ error: 'text required' });
    let source = '';
    try { source = new URL(body.url).hostname; } catch {}
    const item = {
      id: crypto.randomUUID(),
      text,
      title: (body.title || '').trim() || await makeTitle(text),
      url: body.url || '',
      source,
      sourceType: SOURCE_TYPES.includes(body.sourceType)
        ? body.sourceType
        : defaultSourceType(body.url),
      createdAt: Date.now(),
      readAt: null,
      progress: 0,
      archivedAt: null,
      summary: null,
    };
    await setDoc(KEY, [item, ...items].slice(0, CAP));
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
    await setDoc(KEY, items);
    return res.status(200).json({ item });
  }

  if (req.method === 'DELETE') {
    const ids = body.ids || [body.id || req.query?.id].filter(Boolean);
    if (!ids.length) return res.status(400).json({ error: 'id required' });
    await setDoc(KEY, items.filter((it) => !ids.includes(it.id)));
    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ error: 'method not allowed' });
}
