// Storage: JSON documents keyed in Redis (rr:items, rr:stats).
// Upstash Redis when configured (Vercel marketplace integration injects the
// env vars); in-memory otherwise (local dev only — serverless instances
// don't share memory).
const memory = new Map();
let client;

function redisEnv() {
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  return url && token ? { url, token } : null;
}

export function hasRedis() {
  return !!redisEnv();
}

async function redis() {
  if (!client) {
    const { Redis } = await import('@upstash/redis');
    client = new Redis(redisEnv());
  }
  return client;
}

export async function getDoc(key, fallback) {
  if (!hasRedis()) return memory.has(key) ? memory.get(key) : fallback;
  return (await (await redis()).get(key)) ?? fallback;
}

export async function setDoc(key, value) {
  if (!hasRedis()) {
    memory.set(key, value);
    return;
  }
  await (await redis()).set(key, value);
}
