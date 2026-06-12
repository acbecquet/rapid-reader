// Claude Code Stop hook: every time Claude finishes responding, push the
// session transcript to Rapid Reader. One backlog item per session, updated
// in place (api/items.js upserts on sessionId). Install with hooks/install.mjs.
// Must never block or fail the session: always exits 0, short timeout.
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';

const URL_BASE = process.env.RAPID_READER_URL || 'https://rapid-reader-pi.vercel.app';
const TOKEN = process.env.RAPID_READER_TOKEN || '';
const TEXT_CAP = 40000;

// Transcript JSONL → markdown: user prompts become headings (sections in the
// reader), assistant prose follows. Pure, unit tested.
export function compileTranscript(jsonl) {
  const out = [];
  for (const line of jsonl.split('\n')) {
    let entry;
    try { entry = JSON.parse(line); } catch { continue; }
    const msg = entry?.message;
    if (!msg?.content) continue;
    const text = (Array.isArray(msg.content) ? msg.content : [{ type: 'text', text: msg.content }])
      .filter((b) => b.type === 'text' && b.text)
      .map((b) => b.text)
      .join('\n\n')
      .trim();
    if (!text) continue;
    if (entry.type === 'user') {
      const words = text.replace(/\s+/g, ' ').split(' ');
      out.push('# ' + words.slice(0, 10).join(' ') + (words.length > 10 ? '…' : ''));
    } else if (entry.type === 'assistant') {
      out.push(text);
    }
  }
  let md = out.join('\n\n');
  if (md.length > TEXT_CAP) md = '(earlier conversation trimmed)\n\n' + md.slice(-TEXT_CAP);
  return md;
}

export function buildPayload(input, jsonl) {
  const text = compileTranscript(jsonl);
  if (text.split(/\s+/).length < 10) return null; // nothing worth reading yet
  return {
    sessionId: input.session_id,
    text,
    title: 'Claude · ' + basename(input.cwd || '') || 'Claude session',
    sourceType: 'claude_code',
  };
}

async function main() {
  let raw = '';
  for await (const c of process.stdin) raw += c;
  const input = JSON.parse(raw);
  const payload = buildPayload(input, readFileSync(input.transcript_path, 'utf8'));
  if (!payload) return;
  await fetch(URL_BASE + '/api/items', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(TOKEN ? { authorization: 'Bearer ' + TOKEN } : {}),
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(6000),
  });
}

if (process.argv[1] && import.meta.url.endsWith(basename(process.argv[1]))) {
  main().catch(() => {}).finally(() => process.exit(0));
}
