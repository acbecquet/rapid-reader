// Ephemeral live-highlight slot: one selection, overwritten on each new one.
// Never enters the backlog (the panel offers a "keep" action for that).
// Gated by the ⚡ capture toggle in prefs (rr:prefs.capture).
// POST   /api/live { text, url? } → { ok }  (dropped when capture is off)
// GET    /api/live → { live: { text, url, ts } | null }
// DELETE /api/live → { ok }
import { getDoc, setDoc } from './_lib/store.js';
import { gate, keyFor } from './_lib/auth.js';
import { mergePrefs } from './_lib/prefs.js';

const KEY = 'rr:live';

export default async function handler(req, res) {
  const uid = gate(req, res);
  if (!uid) return;
  const KEY_U = keyFor(KEY, uid);

  if (req.method === 'GET') {
    return res.status(200).json({ live: await getDoc(KEY_U, null) });
  }
  if (req.method === 'POST') {
    const text = (req.body?.text || '').trim().slice(0, 200000);
    if (!text) return res.status(400).json({ error: 'text required' });
    const prefs = mergePrefs(await getDoc(keyFor('rr:prefs', uid), null));
    if (!prefs.capture) return res.status(200).json({ ok: true, ignored: true });
    await setDoc(KEY_U, { text, url: req.body?.url || '', ts: Date.now() });
    return res.status(200).json({ ok: true });
  }
  if (req.method === 'DELETE') {
    await setDoc(KEY_U, null);
    return res.status(200).json({ ok: true });
  }
  return res.status(405).json({ error: 'method not allowed' });
}
