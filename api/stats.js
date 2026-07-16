// Reading metrics endpoint. Privacy: aggregates only, never raw text.
// GET  /api/stats → { days: { 'YYYY-MM-DD': DayAgg }, sessions: [Record] }
// POST /api/stats { dateKey, sourceType?, playbackMs, words, pauses?,
//                   rewinds?, skips?, completed? } → { ok }
// POST /api/stats { record: { ts, words, wpm, cluster, sourceType?,
//                   quiz?: { score, total } } } → { ok }
// DayAgg: { ms, words, sessions, pauses, rewinds, skips, completed,
//           bySource: { type: { ms, words, completed } } }
// Record: one completed read for the trainer — actual wpm, cluster size, and
// the quiz score when one was taken. Numbers only, capped list.
import { getDoc, setDoc } from './_lib/store.js';
import { gate, keyFor } from './_lib/auth.js';

const KEY = 'rr:stats';
const DAY_CAP = 400;
const SESSION_CAP = 400;

export default async function handler(req, res) {
  const uid = gate(req, res);
  if (!uid) return;
  const KEY_U = keyFor(KEY, uid);
  const stats = await getDoc(KEY_U, { days: {}, sessions: [] });
  stats.sessions ||= []; // docs stored before the trainer existed

  if (req.method === 'GET') {
    return res.status(200).json(stats);
  }

  if (req.method === 'POST') {
    const b = req.body || {};
    if (b.record) {
      const r = b.record;
      const words = Math.round(Number(r.words)) || 0;
      const wpm = Math.round(Number(r.wpm)) || 0;
      if (words <= 0 || wpm <= 0 || wpm > 3000) {
        return res.status(400).json({ error: 'record needs words and a sane wpm' });
      }
      const rec = {
        ts: Number(r.ts) || Date.now(),
        words,
        wpm,
        cluster: Math.max(1, Math.min(4, Math.round(Number(r.cluster)) || 1)),
        sourceType: typeof r.sourceType === 'string' ? r.sourceType.slice(0, 20) : 'other',
      };
      const q = r.quiz;
      if (q && Number.isInteger(q.score) && Number.isInteger(q.total)
        && q.total > 0 && q.total <= 20 && q.score >= 0 && q.score <= q.total) {
        rec.quiz = { score: q.score, total: q.total };
      }
      stats.sessions.push(rec);
      while (stats.sessions.length > SESSION_CAP) stats.sessions.shift();
      await setDoc(KEY_U, stats);
      return res.status(200).json({ ok: true });
    }
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
    await setDoc(KEY_U, stats);
    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ error: 'method not allowed' });
}
