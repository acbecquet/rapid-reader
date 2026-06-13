// Storage. Two tiers so the 4-second backlog poll stays tiny even when a
// person has gigabytes of text:
//   - Redis (Upstash REST) holds the lean per-user index + small prefs/stats.
//   - Vercel Blob holds each item's full text body, keyed by an unguessable
//     URL stored on the index stub. Bodies are fetched only when an item is
//     opened. 2GB/person lives in Blob, not Redis.
// Local dev (no creds): everything in an in-memory Map (single process only).

const memory = new Map();      // doc + body store fallback (dev only)
let client;

// Find an env var by regex (Vercel Marketplace integrations sometimes add a
// store-name prefix, so we can't hard-code exact names). Returns the value.
function pickEnv(re, exclude) {
  for (const k of Object.keys(process.env)) {
    if (re.test(k) && (!exclude || !exclude.test(k)) && process.env[k]) return process.env[k];
  }
  return undefined;
}

// Upstash/Vercel KV REST credentials under any prefix (UPSTASH_REDIS_REST_URL,
// KV_REST_API_URL, <PREFIX>_KV_REST_API_URL, …). REST only — @upstash/redis.
function redisEnv() {
  const url = pickEnv(/(^|_)(UPSTASH_REDIS|KV|REDIS)_REST(_API)?_URL$/i);
  const token = pickEnv(/(^|_)(UPSTASH_REDIS|KV|REDIS)_REST(_API)?_TOKEN$/i, /READ_ONLY/i);
  return url && token ? { url, token } : null;
}

// Vercel Blob read-write token under any prefix (BLOB_READ_WRITE_TOKEN,
// <STORE>_READ_WRITE_TOKEN).
function blobToken() {
  return pickEnv(/(^|_)BLOB_READ_WRITE_TOKEN$/i) || pickEnv(/_READ_WRITE_TOKEN$/i);
}

export function hasRedis() {
  return !!redisEnv();
}

export function hasBlob() {
  return !!blobToken();
}

// What the /api/health probe reports.
export function storageStatus() {
  return {
    redis: hasRedis(),
    blob: hasBlob(),
    persistent: hasRedis(), // the index must be durable for the backlog to survive
  };
}

// Diagnostic: names (never values) of storage-related env vars present.
export function storageEnvKeys() {
  return Object.keys(process.env)
    .filter((k) => /(redis|kv_|_kv|blob|upstash|storage)/i.test(k))
    .sort();
}

async function redis() {
  if (!client) {
    const { Redis } = await import('@upstash/redis');
    client = new Redis(redisEnv());
  }
  return client;
}

// ---------- lean documents (index, prefs, live, stats) ----------
export async function getDoc(key, fallback) {
  if (!hasRedis()) return memory.has(key) ? memory.get(key) : fallback;
  return (await (await redis()).get(key)) ?? fallback;
}

export async function getDocs(keys, fallbacks) {
  if (!hasRedis()) return keys.map((k, i) => (memory.has(k) ? memory.get(k) : fallbacks[i]));
  const vals = await (await redis()).mget(...keys);
  return vals.map((v, i) => v ?? fallbacks[i]);
}

export async function setDoc(key, value) {
  if (!hasRedis()) { memory.set(key, value); return; }
  await (await redis()).set(key, value);
}

export async function delDoc(key) {
  if (!hasRedis()) { memory.delete(key); return; }
  await (await redis()).del(key);
}

// ---------- text bodies ----------
// Bodies are stored apart from the lean index so the 4s poll never carries
// them. Preference: Vercel Blob (scales to GBs) → Redis (durable, ~256MB
// free) → in-memory (dev only). Returns the blob URL to persist on the stub,
// or null when the body lives in Redis/memory (getBody resolves by uid+id).
// Redis/memory bodies are wrapped { t } so a JSON-like body never misparses.
const bodyKey = (uid, id) => `rr:body:${uid}:${id}`;

export async function putBody(uid, id, text) {
  if (hasBlob()) {
    const { put } = await import('@vercel/blob');
    const { url } = await put(`bodies/${uid}/${id}.txt`, text, {
      access: 'public',
      addRandomSuffix: true,
      contentType: 'text/plain; charset=utf-8',
      token: blobToken(),
    });
    return url;
  }
  await setDoc(bodyKey(uid, id), { t: text });
  return null;
}

export async function getBody(uid, id, bodyUrl) {
  if (bodyUrl) {
    const res = await fetch(bodyUrl);
    return res.ok ? await res.text() : '';
  }
  return (await getDoc(bodyKey(uid, id), { t: '' })).t || '';
}

export async function delBody(uid, id, bodyUrl) {
  if (bodyUrl && hasBlob()) {
    try {
      const { del } = await import('@vercel/blob');
      await del(bodyUrl, { token: blobToken() });
    } catch {}
    return;
  }
  await delDoc(bodyKey(uid, id));
}
