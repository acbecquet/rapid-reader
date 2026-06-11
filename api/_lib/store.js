// Storage: one JSON document of items, newest first, capped.
// Upstash Redis when configured (Vercel marketplace integration injects the
// env vars); in-memory otherwise (local dev only — serverless instances
// don't share memory).
const KEY = 'rr:items';
const CAP = 500;

let memory = [];
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

export async function getItems() {
  if (!hasRedis()) return memory;
  return (await (await redis()).get(KEY)) || [];
}

export async function setItems(items) {
  const capped = items.slice(0, CAP);
  if (!hasRedis()) {
    memory = capped;
    return;
  }
  await (await redis()).set(KEY, capped);
}
