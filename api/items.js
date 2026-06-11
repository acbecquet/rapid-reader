// The whole API. Items: { id, text, title, url, source, createdAt, readAt }.
// GET    /api/items            → { items }
// POST   /api/items            { text, url?, title? } → { item }
// PATCH  /api/items            { id, title? readAt? } → { item }
// DELETE /api/items?id=… or { id } or { ids: […] } → { ok }
// Auth: Authorization: Bearer <RAPID_READER_TOKEN> (or ?token=…).
import crypto from 'node:crypto';
import { getItems, setItems, hasRedis } from './_lib/store.js';
import { makeTitle } from './_lib/title.js';

function authorized(req) {
  const required = process.env.RAPID_READER_TOKEN;
  if (!required) return !hasRedis(); // open only in local/dev memory mode
  const header = req.headers['authorization'] || '';
  const bearer = header.replace(/^Bearer\s+/i, '');
  return bearer === required || req.query?.token === required;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'content-type,authorization');
  if (req.method === 'OPTIONS') return res.status(204).end();

  if (process.env.RAPID_READER_TOKEN === undefined && hasRedis()) {
    return res.status(503).json({ error: 'Set the RAPID_READER_TOKEN env var' });
  }
  if (!authorized(req)) return res.status(401).json({ error: 'bad or missing token' });

  const body = req.body || {};

  if (req.method === 'GET') {
    return res.status(200).json({ items: await getItems() });
  }

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
      createdAt: Date.now(),
      readAt: null,
    };
    await setItems([item, ...await getItems()]);
    return res.status(201).json({ item });
  }

  if (req.method === 'PATCH') {
    const items = await getItems();
    const item = items.find((it) => it.id === body.id);
    if (!item) return res.status(404).json({ error: 'not found' });
    if ('title' in body) item.title = String(body.title).slice(0, 120);
    if ('readAt' in body) item.readAt = body.readAt;
    await setItems(items);
    return res.status(200).json({ item });
  }

  if (req.method === 'DELETE') {
    const ids = body.ids || [body.id || req.query?.id].filter(Boolean);
    if (!ids.length) return res.status(400).json({ error: 'id required' });
    await setItems((await getItems()).filter((it) => !ids.includes(it.id)));
    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ error: 'method not allowed' });
}
