// Frontend error + anomaly log. The reader is simple, so when something throws
// or a derived value looks wrong, we record it here (capped, deduped) so the
// bug surfaces and gets fixed — never silently hidden. The AI title self-heal
// (items.js retitle) works *around* a bad title for the user, but the anomaly
// is still logged here.
// POST   /api/log  { kind, message, context? } → { ok }
// GET    /api/log                              → { errors }   (your own)
// DELETE /api/log                              → { ok }       (clear)
import { getDoc, setDoc } from './_lib/store.js';
import { gate, keyFor } from './_lib/auth.js';

const KEY = 'rr:errors';
const CAP = 200;

export default async function handler(req, res) {
  const uid = gate(req, res);
  if (!uid) return;
  const K = keyFor(KEY, uid);

  if (req.method === 'GET') {
    return res.status(200).json({ errors: await getDoc(K, []) });
  }
  if (req.method === 'POST') {
    const b = req.body || {};
    const message = String(b.message || '').slice(0, 500);
    if (!message) return res.status(400).json({ error: 'message required' });
    const entry = {
      ts: Date.now(),
      kind: String(b.kind || 'error').slice(0, 40),
      message,
      context: String(b.context || '').slice(0, 200),
    };
    const list = await getDoc(K, []);
    const sig = (e) => e.kind + '|' + e.message + '|' + e.context;
    const prev = list.find((e) => sig(e) === sig(entry));
    if (prev) { prev.count = (prev.count || 1) + 1; prev.ts = entry.ts; await setDoc(K, list); }
    else { await setDoc(K, [{ ...entry, count: 1 }, ...list].slice(0, CAP)); }
    return res.status(200).json({ ok: true });
  }
  if (req.method === 'DELETE') {
    await setDoc(K, []);
    return res.status(200).json({ ok: true });
  }
  return res.status(405).json({ error: 'method not allowed' });
}
