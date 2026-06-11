// Shared CORS + auth for the API endpoints.
//
// Identity: a bearer token that is either
//   - the dev/owner token (RAPID_READER_TOKEN)            → uid 'owner'
//   - a session token `uid.hmac` minted by api/login.js   → uid = Google sub
//     ('owner' when the Google email matches OWNER_EMAIL)
// Each uid gets its own Redis namespace via keyFor(); 'owner' keeps the
// original un-namespaced keys so pre-auth data survives.
import crypto from 'node:crypto';
import { hasRedis } from './store.js';

const secret = () => process.env.SESSION_SECRET || process.env.RAPID_READER_TOKEN || '';

export function applyCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'content-type,authorization');
}

export function sessionToken(uid) {
  return uid + '.' + crypto.createHmac('sha256', secret()).update(uid).digest('hex');
}

function uidFromBearer(bearer) {
  if (!bearer) return null;
  const dev = process.env.RAPID_READER_TOKEN;
  if (dev && bearer === dev) return 'owner';
  if (!secret()) return null;
  const i = bearer.lastIndexOf('.');
  if (i < 1) return null;
  const uid = bearer.slice(0, i);
  const expect = crypto.createHmac('sha256', secret()).update(uid).digest();
  let got;
  try { got = Buffer.from(bearer.slice(i + 1), 'hex'); } catch { return null; }
  if (got.length === expect.length && crypto.timingSafeEqual(got, expect)) return uid;
  return null;
}

// Returns the uid when the request may proceed; otherwise the response has
// already been written and this returns falsy.
export function gate(req, res) {
  applyCors(res);
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return null;
  }
  if (!secret()) {
    if (hasRedis()) {
      if (process.env.PUBLIC_DEMO === '1') return 'demo';
      res.status(503).json({ error: 'Set the RAPID_READER_TOKEN env var' });
      return null;
    }
    return 'owner'; // local dev, in-memory store
  }
  const bearer = (req.headers['authorization'] || '').replace(/^Bearer\s+/i, '')
    || req.query?.token || '';
  const uid = uidFromBearer(bearer);
  if (!uid) {
    // PUBLIC_DEMO=1: tokenless visitors share an isolated 'demo' namespace
    if (process.env.PUBLIC_DEMO === '1') return 'demo';
    res.status(401).json({ error: 'bad or missing token' });
    return null;
  }
  return uid;
}

export function keyFor(base, uid) {
  return uid === 'owner' ? base : `${base}:${uid}`;
}
