// Ephemeral live-highlight slot: one selection, overwritten on each new one.
// Never enters the backlog (the panel offers a "keep" action for that).
// POST   /api/live { text, url? } → { ok } (dropped when the ⚡ toggle is off)
// GET    /api/live → { live: { text, url, ts } | null }
// PATCH  /api/live { on } → { ok, captureOn } — the panel's ⚡ toggle; gates
//        all live senders (clipboard watcher, extension live mode) server-side
// DELETE /api/live → { ok }
import { getDoc, setDoc } from './_lib/store.js';
import { gate, keyFor } from './_lib/auth.js';

const KEY = 'rr:live';

export default async function handler(req, res) {
  const uid = gate(req, res);
  if (!uid) return;
  const KEY_U = keyFor(KEY, uid);
  const FLAG_U = keyFor('rr:capture', uid);

  if (req.method === 'GET') {
    return res.status(200).json({ live: await getDoc(KEY_U, null) });
  }
  if (req.method === 'POST') {
    const text = (req.body?.text || '').trim().slice(0, 50000);
    if (!text) return res.status(400).json({ error: 'text required' });
    const flag = await getDoc(FLAG_U, null);
    if (flag?.on === false) return res.status(200).json({ ok: true, ignored: true });
    await setDoc(KEY_U, { text, url: req.body?.url || '', ts: Date.now() });
    return res.status(200).json({ ok: true });
  }
  if (req.method === 'PATCH') {
    const on = !!req.body?.on;
    await setDoc(FLAG_U, { on });
    if (!on) await setDoc(KEY_U, null); // clear any pending capture
    return res.status(200).json({ ok: true, captureOn: on });
  }
  if (req.method === 'DELETE') {
    await setDoc(KEY_U, null);
    return res.status(200).json({ ok: true });
  }
  return res.status(405).json({ error: 'method not allowed' });
}
