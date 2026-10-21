// Find and delete Vercel Blob bodies that no backlog item points at.
//
//   node --env-file=.env.local scripts/prune-blobs.mjs            dry run: report orphans
//   node --env-file=.env.local scripts/prune-blobs.mjs --delete   delete orphans
//   node --env-file=.env.local scripts/prune-blobs.mjs --all      delete EVERY body blob and
//                                                                 null bodyUrl on every item
//
// Get .env.local with `vercel env pull .env.local`. An orphan is a blob under
// bodies/ that no rr:items* index references and that is over an hour old
// (so a body uploaded moments before its index write is never mistaken for
// one). --all keeps the backlog list; items just lose their text.
import { Redis } from '@upstash/redis';
import { list, del } from '@vercel/blob';
import { redisEnv, blobToken } from '../api/_lib/store.js';

const DELETE = process.argv.includes('--delete');
const ALL = process.argv.includes('--all');
const HOUR = 60 * 60 * 1000;

const env = redisEnv();
const token = blobToken();
if (!env || !token) {
  console.error('Need both Upstash Redis REST vars and BLOB_READ_WRITE_TOKEN (run `vercel env pull .env.local`).');
  process.exit(1);
}
const redis = new Redis(env);

const mb = (bytes) => (bytes / 1024 / 1024).toFixed(1) + ' MB';

async function indexKeys() {
  const keys = [];
  let cursor = '0';
  do {
    const [next, batch] = await redis.scan(cursor, { match: 'rr:items*', count: 500 });
    cursor = String(next);
    keys.push(...batch);
  } while (cursor !== '0');
  return keys;
}

async function listBodies() {
  const blobs = [];
  let cursor;
  do {
    const page = await list({ prefix: 'bodies/', cursor, limit: 1000, token });
    blobs.push(...page.blobs);
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  return blobs;
}

async function delAll(urls) {
  for (let i = 0; i < urls.length; i += 100) {
    await del(urls.slice(i, i + 100), { token });
    console.log(`  deleted ${Math.min(i + 100, urls.length)}/${urls.length}`);
  }
}

const keys = await indexKeys();
const referenced = new Set();
for (const k of keys) {
  const items = await redis.get(k);
  if (Array.isArray(items)) for (const it of items) if (it?.bodyUrl) referenced.add(it.bodyUrl);
}
const blobs = await listBodies();
const total = blobs.reduce((s, b) => s + b.size, 0);
const cutoff = Date.now() - HOUR;
const orphans = blobs.filter((b) => !referenced.has(b.url) && new Date(b.uploadedAt).getTime() < cutoff);
const orphanBytes = orphans.reduce((s, b) => s + b.size, 0);

console.log(`indexes: ${keys.length} (${keys.join(', ') || 'none'}), referenced bodies: ${referenced.size}`);
console.log(`bodies/: ${blobs.length} blobs, ${mb(total)}`);
console.log(`orphans: ${orphans.length} blobs, ${mb(orphanBytes)}`);

if (ALL) {
  console.log(`--all: deleting all ${blobs.length} blobs under bodies/ …`);
  await delAll(blobs.map((b) => b.url));
  for (const k of keys) {
    const items = await redis.get(k);
    if (!Array.isArray(items)) continue;
    await redis.set(k, items.map((it) => ({ ...it, bodyUrl: null })));
    console.log(`  ${k}: bodyUrl cleared on ${items.length} items`);
  }
} else if (DELETE) {
  if (!referenced.size) {
    console.error('Refusing to delete: Redis references zero bodies (wrong env file?).');
    process.exit(1);
  }
  console.log(`--delete: deleting ${orphans.length} orphans …`);
  await delAll(orphans.map((b) => b.url));
} else {
  console.log('Dry run. Pass --delete to remove the orphans, or --all to empty bodies/.');
  process.exit(0);
}

const after = await listBodies();
console.log(`after: ${after.length} blobs, ${mb(after.reduce((s, b) => s + b.size, 0))}`);
