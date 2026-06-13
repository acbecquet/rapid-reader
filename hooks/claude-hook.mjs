// Claude Code Stop hook: every time Claude finishes responding, push the
// session transcript to Rapid Reader. One backlog item per session, updated
// in place (api/items.js upserts on sessionId). Install with hooks/install.mjs.
// Must never block or fail the session: always exits 0, short timeout.
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import { buildPayload as build } from './transcript.mjs';

// Claude Code does NOT pass our env vars to Stop hooks, so the installer
// writes ~/.claude/rapid-reader.json with { url, token }. Fall back to env
// then the production URL so a hand-run still works.
function config() {
  let cfg = {};
  try { cfg = JSON.parse(readFileSync(join(homedir(), '.claude', 'rapid-reader.json'), 'utf8')); } catch {}
  return {
    url: cfg.url || process.env.RAPID_READER_URL || 'https://rapid-reader-pi.vercel.app',
    token: cfg.token || process.env.RAPID_READER_TOKEN || '',
  };
}

export function buildPayload(input, jsonl) {
  return build({
    jsonl,
    sessionId: 'claude:' + input.session_id,
    group: basename(input.cwd || '') || 'sessions',
    sourceType: 'claude_code',
  });
}

async function main() {
  let raw = '';
  for await (const c of process.stdin) raw += c;
  const input = JSON.parse(raw);
  const payload = buildPayload(input, readFileSync(input.transcript_path, 'utf8'));
  if (!payload) return;
  const { url, token } = config();
  await fetch(url + '/api/items', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: 'Bearer ' + token } : {}),
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(6000),
  });
}

if (process.argv[1] && import.meta.url.endsWith(basename(process.argv[1]))) {
  main().catch(() => {}).finally(() => process.exit(0));
}
