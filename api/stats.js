// Reading metrics endpoint. Privacy: aggregates only, never raw text.
// GET  /api/stats → { days: { 'YYYY-MM-DD': DayAgg } }
// POST /api/stats { dateKey, sourceType?, playbackMs, words, pauses?,
//                   rewinds?, skips?, completed? } → { ok }
// DayAgg: { ms, words, sessions, pauses, rewinds, skips, completed,
//           bySource: { type: { ms, words, completed } } }
import { getDoc, setDoc } from './_lib/store.js';
import { gate } from './_lib/auth.js';

const KEY = 'rr:stats';
const DAY_CAP = 400;

export default async function handler(req, res) {
  if (!gate(req, res)) return;
  const stats = await getDoc(KEY, { days: {} });

  if (req.method === 'GET') {
    return res.status(200).json(stats);
  }

  if (req.method === 'POST') {
    const b = req.body || {};
    if (!/^\d{4}-\d{2}-\d{2}$/.test(b.dateKey || '')) {
      return res.status(400).json({ error: 'dateKey required (YYYY-MM-DD)' });
    }
    const ms = Math.max(0, Number(b.playbackMs) || 0);
    const words = Math.max(0, Number(b.words) || 0);
    if (!ms && !words) return res.status(400).json({ error: 'empty session' });

    const day = stats.days[b.dateKey] ||= {
      ms: 0, words: 0, sessions: 0, pauses: 0, rewinds: 0, skips: 0,
      completed: 0, bySource: {},
    };
    day.ms += ms;
    day.words += words;
    day.sessions += 1;
    day.pauses += Math.max(0, Number(b.pauses) || 0);
    day.rewinds += Math.max(0, Number(b.rewinds) || 0);
    day.skips += Math.max(0, Number(b.skips) || 0);
    day.completed += b.completed ? 1 : 0;
    const st = typeof b.sourceType === 'string' ? b.sourceType.slice(0, 20) : 'other';
    const src = day.bySource[st] ||= { ms: 0, words: 0, completed: 0 };
    src.ms += ms;
    src.words += words;
    src.completed += b.completed ? 1 : 0;

    const keys = Object.keys(stats.days).sort();
    while (keys.length > DAY_CAP) delete stats.days[keys.shift()];
    await setDoc(KEY, stats);
    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ error: 'method not allowed' });
}
