// Google sign-in. The panel sends the Google ID token (from the GIS button);
// we verify it against Google's published keys (pure node:crypto, no deps)
// and mint a long-lived stateless session token for this user.
//
// GET  /api/login → { clientId }      (null when Google auth isn't configured)
// POST /api/login { credential } → { token, name, email }
//
// Env: GOOGLE_CLIENT_ID  — OAuth web client ID (enables Google sign-in)
//      OWNER_EMAIL       — this Google account maps to the original data
//      ALLOWED_EMAILS    — optional comma-separated guest list
import crypto from 'node:crypto';
import { applyCors, sessionToken } from './_lib/auth.js';

let certs = null;
let certsAt = 0;

async function googleKeys() {
  if (!certs || Date.now() - certsAt > 6 * 3600 * 1000) {
    const res = await fetch('https://www.googleapis.com/oauth2/v3/certs');
    if (!res.ok) throw new Error('jwks fetch failed');
    certs = await res.json();
    certsAt = Date.now();
  }
  return certs;
}

async function verifyGoogleToken(credential, clientId) {
  const [h, p, s] = String(credential).split('.');
  const header = JSON.parse(Buffer.from(h, 'base64url'));
  const payload = JSON.parse(Buffer.from(p, 'base64url'));
  const jwk = (await googleKeys()).keys.find((k) => k.kid === header.kid);
  if (!jwk) throw new Error('unknown key');
  const key = crypto.createPublicKey({ key: jwk, format: 'jwk' });
  const ok = crypto.verify(
    'RSA-SHA256',
    Buffer.from(h + '.' + p),
    key,
    Buffer.from(s, 'base64url')
  );
  if (!ok) throw new Error('bad signature');
  if (payload.aud !== clientId) throw new Error('bad audience');
  if (!['accounts.google.com', 'https://accounts.google.com'].includes(payload.iss)) {
    throw new Error('bad issuer');
  }
  if (payload.exp * 1000 < Date.now()) throw new Error('expired');
  return payload;
}

export default async function handler(req, res) {
  applyCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  const clientId = process.env.GOOGLE_CLIENT_ID || null;

  if (req.method === 'GET') {
    return res.status(200).json({ clientId });
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' });
  if (!clientId) return res.status(503).json({ error: 'Google sign-in is not configured' });

  try {
    const payload = await verifyGoogleToken(req.body?.credential, clientId);
    const email = (payload.email || '').toLowerCase();
    const allowed = (process.env.ALLOWED_EMAILS || '')
      .toLowerCase().split(',').map((s) => s.trim()).filter(Boolean);
    if (allowed.length && !allowed.includes(email)) {
      return res.status(403).json({ error: `${email} isn't on the guest list yet — ask the owner to add you` });
    }
    const owner = (process.env.OWNER_EMAIL || '').toLowerCase();
    const uid = email && email === owner ? 'owner' : payload.sub;
    return res.status(200).json({
      token: sessionToken(uid),
      name: payload.name || '',
      email,
    });
  } catch {
    return res.status(401).json({ error: 'Google sign-in failed — try again' });
  }
}
