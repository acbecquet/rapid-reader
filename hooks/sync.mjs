// Unified CLI-agent sync: reads transcript JSONL that Claude Code and Codex
// write to disk and pushes each session to Rapid Reader (one item per session,
// upserted by a stable id). Faithful + read-only — the reader is a portal, it
// never changes the agent's files.
//   node hooks/sync.mjs            one-shot backfill of recent sessions
//   node hooks/sync.mjs --watch    keep syncing as sessions change (live)
//   node hooks/sync.mjs --days 7   how far back to import (default 30)
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, basename, sep } from 'node:path';
import { buildPayload } from './transcript.mjs';

function config() {
  let cfg = {};
  try { cfg = JSON.parse(readFileSync(join(homedir(), '.claude', 'rapid-reader.json'), 'utf8')); } catch {}
  return {
    url: cfg.url || process.env.RAPID_READER_URL || 'https://rapid-reader-pi.vercel.app',
    token: cfg.token || process.env.RAPID_READER_TOKEN || '',
  };
}

const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i !== -1 ? process.argv[i + 1] : d; };
const DAYS = Number(arg('days', 30));
const WATCH = process.argv.includes('--watch');

// The two known CLI-agent transcript roots. Each entry says how to derive the
// group (project) for a given file path.
const SOURCES = [
  {
    type: 'claude_code',
    dir: join(homedir(), '.claude', 'projects'),
    // Claude encodes the project cwd as the parent folder (slashes → dashes).
    group: (file) => decodeProject(file.split(sep).slice(-2, -1)[0] || ''),
  },
  {
    type: 'codex',
    dir: join(homedir(), '.codex', 'sessions'),
    group: () => 'codex',
  },
];

function decodeProject(dirName) {
  // "-Users-me-projects-foo" → "foo"; fall back to the raw name.
  const parts = dirName.replace(/^-+/, '').split('-').filter(Boolean);
  return parts[parts.length - 1] || 'sessions';
}

// recursively collect *.jsonl under a dir
function walk(dir, out = []) {
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith('.jsonl')) out.push(p);
  }
  return out;
}

// The agent records its working directory inside the transcript; that's the
// accurate project name (the folder encoding can't separate "/" from "-").
function cwdFromJsonl(jsonl) {
  for (const line of jsonl.split('\n', 50)) {
    const m = line.match(/"cwd"\s*:\s*"([^"]+)"/);
    if (m) return basename(m[1].replace(/[\\/]+$/, ''));
  }
  return '';
}

async function syncFile(src, file, { url, token }) {
  let jsonl = '';
  try { jsonl = readFileSync(file, 'utf8'); } catch { return false; }
  const payload = buildPayload({
    jsonl,
    sessionId: src.type + ':' + basename(file).replace(/\.jsonl$/, ''),
    group: cwdFromJsonl(jsonl) || src.group(file),
    sourceType: src.type,
  });
  if (!payload) return false;
  try {
    await fetch(url + '/api/items', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(8000),
    });
    return true;
  } catch { return false; }
}

async function scan(cfg, seen) {
  const cutoff = Date.now() - DAYS * 86400000;
  let pushed = 0;
  for (const src of SOURCES) {
    if (!existsSync(src.dir)) continue;
    for (const file of walk(src.dir)) {
      let mtime;
      try { mtime = statSync(file).mtimeMs; } catch { continue; }
      if (mtime < cutoff) continue;
      if (seen.get(file) === mtime) continue; // unchanged since last scan
      seen.set(file, mtime);
      if (await syncFile(src, file, cfg)) pushed++;
    }
  }
  return pushed;
}

async function main() {
  const cfg = config();
  const seen = new Map();
  const n = await scan(cfg, seen);
  console.log(`Synced ${n} session${n === 1 ? '' : 's'} from the last ${DAYS} days → ${cfg.url}`);
  if (!WATCH) return;
  console.log('Watching for new agent activity (Ctrl+C to stop)…');
  for (;;) {
    await new Promise((r) => setTimeout(r, 5000));
    const m = await scan(cfg, seen);
    if (m) console.log(`updated ${m} session${m === 1 ? '' : 's'}`);
  }
}

if (process.argv[1] && import.meta.url.endsWith(basename(process.argv[1]))) {
  main().catch((e) => { console.error(e.message); process.exit(1); });
}

export { decodeProject, SOURCES };
