// Book content endpoint. The frontend parses an EPUB locally (public/epub.js)
// and POSTs the compiled text here; it is stored as its own doc so the
// items poll stays light. The backlog gets a stub item carrying bookId.
// POST   /api/books   { title, author?, text } → { item }
// GET    /api/books?id=…                       → { book }
// DELETE /api/books?id=…                       → { ok }  (items.js cascades here too)
import crypto from 'node:crypto';
import { getDoc, setDoc, delDoc } from './_lib/store.js';
import { gate, keyFor } from './_lib/auth.js';

const TEXT_CAP = 900_000; // stay under Upstash's 1MB request limit

export default async function handler(req, res) {
  const uid = gate(req, res);
  if (!uid) return;
  const body = req.body || {};

  if (req.method === 'GET') {
    const id = req.query?.id;
    if (!id) return res.status(400).json({ error: 'id required' });
    const book = await getDoc(keyFor('rr:book:' + id, uid), null);
    if (!book) return res.status(404).json({ error: 'not found' });
    return res.status(200).json({ book });
  }

  if (req.method === 'POST') {
    const text = String(body.text || '').slice(0, TEXT_CAP).trim();
    const title = String(body.title || '').trim().slice(0, 100);
    const author = String(body.author || '').trim().slice(0, 100);
    if (!text || !title) return res.status(400).json({ error: 'title and text required' });
    const id = crypto.randomUUID();
    await setDoc(keyFor('rr:book:' + id, uid), { id, title, author, text, createdAt: Date.now() });
    const item = {
      id: crypto.randomUUID(),
      text: `📖 ${author || 'book'} · open to read`,
      title,
      url: '',
      source: 'epub',
      sourceType: 'book',
      createdAt: Date.now(),
      readAt: null,
      progress: 0,
      archivedAt: null,
      summary: null,
      bookId: id,
      words: text.split(/\s+/).length,
    };
    const KEY_U = keyFor('rr:items', uid);
    await setDoc(KEY_U, [item, ...await getDoc(KEY_U, [])].slice(0, 500));
    return res.status(201).json({ item });
  }

  if (req.method === 'DELETE') {
    const id = body.id || req.query?.id;
    if (!id) return res.status(400).json({ error: 'id required' });
    await delDoc(keyFor('rr:book:' + id, uid));
    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ error: 'method not allowed' });
}
