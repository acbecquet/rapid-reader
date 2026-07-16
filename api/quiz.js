// Comprehension quiz endpoint. POST { id } → { quiz: [{ q, choices, answer }] }.
// Generated on demand AFTER a completed read — never on the capture/open hot
// path — on the user's own Gemini key (keysFor), so quizzes cost each user
// only their own free quota. Grading happens client-side: this is
// self-training, not an exam, so the answer key riding along is fine.
import { getDoc, getBody } from './_lib/store.js';
import { gate, keyFor } from './_lib/auth.js';
import { mergePrefs, keysFor, aiCovered } from './_lib/prefs.js';
import { makeQuiz } from './_lib/title.js';

const MIN_WORDS = 30; // below this there is nothing meaningful to ask

export default async function handler(req, res) {
  const uid = gate(req, res);
  if (!uid) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' });

  const id = (req.body || {}).id;
  if (!id) return res.status(400).json({ error: 'id required' });
  const items = await getDoc(keyFor('rr:items', uid), []);
  const item = items.find((it) => it.id === id);
  if (!item) return res.status(404).json({ error: 'not found' });

  const text = await getBody(uid, item.id, item.bodyUrl);
  if (!text || text.trim().split(/\s+/).length < MIN_WORDS) {
    return res.status(422).json({ error: 'not enough text to quiz on' });
  }

  const prefs = mergePrefs(await getDoc(keyFor('rr:prefs', uid), null));
  const quiz = await makeQuiz(text, 5, undefined, keysFor(uid, prefs));
  if (!quiz) {
    return res.status(422).json({
      error: aiCovered(uid, prefs)
        ? 'could not build a quiz for this text — try again'
        : 'add your free Gemini key in ⚙ Settings to enable quizzes',
      needsGeminiKey: !aiCovered(uid, prefs),
    });
  }
  return res.status(200).json({ quiz });
}
