// Storage health probe — open it in a browser to see whether the backlog
// will actually persist. GET /api/health → { ok, redis, blob, persistent }.
// No auth: it reports only booleans about the deployment, never any data.
import { storageStatus, storageEnvKeys } from './_lib/store.js';
import { applyCors } from './_lib/auth.js';

export default function handler(req, res) {
  applyCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  const s = storageStatus();
  return res.status(200).json({
    ok: true,
    ...s,
    note: s.persistent
      ? 'Redis connected — the backlog persists.'
      : 'No Redis credentials found — backlog is in-memory and will NOT persist. Connect Upstash/KV in Vercel.',
    // ?debug=1 → names (never values) of storage env vars the function sees,
    // so a name/prefix mismatch is obvious.
    ...(req.query?.debug ? { envKeys: storageEnvKeys() } : {}),
  });
}
