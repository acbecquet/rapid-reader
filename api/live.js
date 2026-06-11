// Ephemeral live-highlight slot: one selection, overwritten on each new one.
// Never enters the backlog (the panel offers a "keep" action for that).
// POST   /api/live { text, url? } → { ok }
// GET    /api/live → { live: { text, url, ts } | null }
// DELETE /api/live → { ok }
import { getDoc, setDoc } from './_lib/store.js';
import { gate } from './_lib/auth.js';

const KEY = 'rr:live';

export default async function handler(req, res) {
  if (!gate(req, res)) return;

  if (req.method === 'GET') {
    return res.status(200).json({ live: await getDoc(KEY, null) });
  }
  if (req.method === 'POST') {
    const text = (req.body?.text || '').trim().slice(0, 50000);
    if (!text) return res.status(400).json({ error: 'text required' });
    await setDoc(KEY, { text, url: req.body?.url || '', ts: Date.now() });
    return res.status(200).json({ ok: true });
  }
  if (req.method === 'DELETE') {
    await setDoc(KEY, null);
    return res.status(200).json({ ok: true });
  }
  return res.status(405).json({ error: 'method not allowed' });
}
