import test from 'node:test';
import assert from 'node:assert/strict';
import { hasRedis, hasBlob, storageEnvKeys } from '../api/_lib/store.js';

// Vercel integrations inject storage credentials under several names, sometimes
// with a store-name/marketplace prefix. Detection must be prefix-proof.
function withEnv(env, fn) {
  const saved = {};
  for (const k of Object.keys(process.env)) {
    if (/(redis|kv|blob|upstash|storage)/i.test(k)) { saved[k] = process.env[k]; delete process.env[k]; }
  }
  Object.assign(process.env, env);
  try { return fn(); } finally {
    for (const k of Object.keys(env)) delete process.env[k];
    Object.assign(process.env, saved);
  }
}

test('redis detected across integration env-var shapes', () => {
  assert.equal(withEnv({ UPSTASH_REDIS_REST_URL: 'u', UPSTASH_REDIS_REST_TOKEN: 't' }, hasRedis), true);
  assert.equal(withEnv({ KV_REST_API_URL: 'u', KV_REST_API_TOKEN: 't' }, hasRedis), true);
  assert.equal(withEnv({ STORAGE_KV_REST_API_URL: 'u', STORAGE_KV_REST_API_TOKEN: 't' }, hasRedis), true);
  assert.equal(withEnv({ CERULEAN_KV_REST_API_URL: 'u', CERULEAN_KV_REST_API_TOKEN: 't' }, hasRedis), true);
  // read-only token alone is not enough
  assert.equal(withEnv({ KV_REST_API_URL: 'u', KV_REST_API_READ_ONLY_TOKEN: 'ro' }, hasRedis), false);
  // a TCP-only connection string can't drive the REST client
  assert.equal(withEnv({ REDIS_URL: 'rediss://x' }, hasRedis), false);
});

test('blob token detected with or without a store prefix', () => {
  assert.equal(withEnv({ BLOB_READ_WRITE_TOKEN: 'x' }, hasBlob), true);
  assert.equal(withEnv({ RAPID_READER_BLOB_READ_WRITE_TOKEN: 'x' }, hasBlob), true);
  assert.equal(withEnv({}, hasBlob), false);
});

test('storageEnvKeys reports names only', () => {
  withEnv({ KV_REST_API_TOKEN: 'secret-value' }, () => {
    const keys = storageEnvKeys();
    assert.ok(keys.includes('KV_REST_API_TOKEN'));
    assert.ok(!keys.some((k) => k.includes('secret-value')));
  });
});
