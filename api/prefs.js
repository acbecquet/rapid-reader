// Per-user preferences: ⚡ capture gate, source on/off toggles, column layout,
// and this user's own free Gemini key (bring-your-own quota). The raw key is
// stored but never returned — responses carry only hasGeminiKey/needsGeminiKey.
// GET   /api/prefs                      → { prefs }
// PATCH /api/prefs { capture? }          toggle live highlight capture
//       /api/prefs { source, on }        toggle one ingestion source
//       /api/prefs { columns:[…] }       replace the backlog column layout
//       /api/prefs { geminiKey }         set ('' clears) the user's Gemini key
import { getDoc, setDoc } from './_lib/store.js';
import { gate, keyFor } from './_lib/auth.js';
import { mergePrefs, publicPrefs, SOURCES } from './_lib/prefs.js';
import { validateGeminiKey } from './_lib/title.js';

export default async function handler(req, res) {
  const uid = gate(req, res);
  if (!uid) return;
  const KEY = keyFor('rr:prefs', uid);

  if (req.method === 'GET') {
    return res.status(200).json({ prefs: publicPrefs(mergePrefs(await getDoc(KEY, null)), uid) });
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
    if (body.transcript && body.transcript.roles) {
      const roles = {};
      for (const r of ['you', 'claude', 'tool', 'think']) {
        const v = body.transcript.roles[r] || {};
        roles[r] = {
          label: String(v.label || r).slice(0, 24),
          align: ['left', 'right', 'center'].includes(v.align) ? v.align : 'left',
          color: String(v.color || '').slice(0, 24),
          box: !!v.box,
          show: v.show !== false,
          collapsed: v.collapsed !== false,
        };
      }
      prefs.transcript = { roles };
    }
    if (body.groupAliases && typeof body.groupAliases === 'object') {
      const aliases = {};
      for (const [k, v] of Object.entries(body.groupAliases).slice(0, 200)) {
        const name = String(v || '').trim().slice(0, 60);
        if (name) aliases[String(k).slice(0, 80)] = name;
      }
      prefs.groupAliases = aliases;
    }
    if ('geminiKey' in body) {
      const key = String(body.geminiKey || '').trim().slice(0, 200);
      if (key && !(await validateGeminiKey(key))) {
        return res.status(400).json({ error: "That key didn't work — copy the whole key from Google AI Studio and try again." });
      }
      prefs.geminiKey = key; // '' clears it
    }
    await setDoc(KEY, prefs);
    return res.status(200).json({ prefs: publicPrefs(prefs, uid) });
  }

  return res.status(405).json({ error: 'method not allowed' });
}
