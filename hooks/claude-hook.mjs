// Claude Code Stop hook: every time Claude finishes responding, push the
// session transcript to Rapid Reader. One backlog item per session, updated
// in place (api/items.js upserts on sessionId). Install with hooks/install.mjs.
// Must never block or fail the session: always exits 0, short timeout.
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';

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
const TEXT_CAP = 40000;

// Transcript JSONL → markdown: user prompts become headings (sections in the
// reader), assistant prose follows. Pure, unit tested.
// → { md, firstPrompt } : prompts become headings, assistant prose follows.
export function compileTranscript(jsonl) {
  const out = [];
  let firstPrompt = '';
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
      if (!firstPrompt) firstPrompt = text.replace(/\s+/g, ' ').trim();
      const words = text.replace(/\s+/g, ' ').split(' ');
      out.push('# ' + words.slice(0, 10).join(' ') + (words.length > 10 ? '…' : ''));
    } else if (entry.type === 'assistant') {
      out.push(text);
    }
  }
  let md = out.join('\n\n');
  if (md.length > TEXT_CAP) md = '(earlier conversation trimmed)\n\n' + md.slice(-TEXT_CAP);
  return { md, firstPrompt };
}

export function buildPayload(input, jsonl) {
  const { md, firstPrompt } = compileTranscript(jsonl);
  if (md.split(/\s+/).length < 10) return null; // nothing worth reading yet
  // mirror the Claude sidebar: title = the session's first prompt, grouped by
  // its project folder (so the Agents column reads just like Claude Code).
  const words = (firstPrompt || 'Claude session').split(' ');
  const title = words.slice(0, 9).join(' ').slice(0, 80) + (words.length > 9 ? '…' : '');
  return {
    sessionId: input.session_id,
    text: md,
    title,
    group: basename(input.cwd || '') || 'sessions',
    sourceType: 'claude_code',
  };
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
