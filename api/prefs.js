// Per-user preferences: ⚡ capture gate, source on/off toggles, column layout.
// GET   /api/prefs                      → { prefs }
// PATCH /api/prefs { capture? }          toggle live highlight capture
//       /api/prefs { source, on }        toggle one ingestion source
//       /api/prefs { columns:[…] }       replace the backlog column layout
import { getDoc, setDoc } from './_lib/store.js';
import { gate, keyFor } from './_lib/auth.js';
import { mergePrefs, SOURCES } from './_lib/prefs.js';

export default async function handler(req, res) {
  const uid = gate(req, res);
  if (!uid) return;
  const KEY = keyFor('rr:prefs', uid);

  if (req.method === 'GET') {
    return res.status(200).json({ prefs: mergePrefs(await getDoc(KEY, null)) });
  }

  if (req.method === 'PATCH') {
    const prefs = mergePrefs(await getDoc(KEY, null));
    const body = req.body || {};
    if ('capture' in body) prefs.capture = !!body.capture;
    if (body.source && SOURCES.includes(body.source)) prefs.sources[body.source] = !!body.on;
    if (Array.isArray(body.columns)) {
      prefs.columns = body.columns.slice(0, 12).map((c) => ({
        id: String(c.id || '').slice(0, 40),
        name: String(c.name || '').slice(0, 24),
        icon: String(c.icon || 'general').slice(0, 24),
        sources: Array.isArray(c.sources) ? c.sources.map((s) => String(s).slice(0, 24)).slice(0, 20) : [],
      }));
    }
    await setDoc(KEY, prefs);
    return res.status(200).json({ prefs });
  }

  return res.status(405).json({ error: 'method not allowed' });
}
