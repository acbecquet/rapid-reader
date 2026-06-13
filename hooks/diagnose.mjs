// Read-only diagnostic: characterizes local agent sessions so we can tell
// real interactive chats from background/observer/sub-agent runs, and hunts
// for where the Claude *desktop* app stores its sessions. Prints names and
// short snippets only — never full transcripts. Run: node hooks/diagnose.mjs
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, basename, sep } from 'node:path';

const trunc = (s, n = 110) => (s || '').replace(/\s+/g, ' ').trim().slice(0, n);

function* walk(dir) {
  let entries = [];
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else yield p;
  }
}

// Characterize one Claude/Codex transcript without dumping it.
function characterize(file) {
  let lines = [];
  try { lines = readFileSync(file, 'utf8').split('\n'); } catch { return null; }
  let cwd = '', sidechain = false, meta = false, users = 0, asst = 0, firstPrompt = '';
  const userTypes = new Set();
  for (const line of lines) {
    if (!line) continue;
    let e; try { e = JSON.parse(line); } catch { continue; }
    if (e.cwd && !cwd) cwd = e.cwd;
    if (e.isSidechain === true) sidechain = true;
    if (e.isMeta === true) meta = true;
    if (e.userType) userTypes.add(e.userType);
    const node = e.message || e.payload || e;
    const role = node.role || e.role;
    const type = node.type || e.type;
    let text = '';
    const c = node.content;
    if (typeof c === 'string') text = c;
    else if (Array.isArray(c)) text = c.map((b) => (typeof b === 'string' ? b : (b?.text || ''))).filter(Boolean).join(' ');
    if (role === 'user' || type === 'user') {
      users++;
      if (!firstPrompt && text) firstPrompt = text;
    } else if (role === 'assistant' || type === 'assistant') asst++;
  }
  return { cwd, sidechain, meta, users, asst, userTypes: [...userTypes], firstPrompt };
}

const AUTO = /memory agent|continuing to observe|you are an?\b.*agent|background (task|process)|\bobserve\b|system reminder|<command-name>/i;

function reportDir(label, dir) {
  if (!existsSync(dir)) { console.log(`\n${label}: NOT FOUND (${dir})`); return; }
  const files = [...walk(dir)].filter((f) => f.endsWith('.jsonl'));
  console.log(`\n${label}: ${files.length} .jsonl files (${dir})`);
  const withTime = files.map((f) => ({ f, t: statSync(f).mtimeMs })).sort((a, b) => b.t - a.t);
  let automated = 0, single = 0, side = 0;
  for (const { f } of withTime) {
    const c = characterize(f);
    if (!c) continue;
    if (c.sidechain) side++;
    if (AUTO.test(c.firstPrompt)) automated++;
    if (c.users <= 1) single++;
  }
  console.log(`  totals: sidechain=${side}  first-prompt-looks-automated=${automated}  single-user-turn=${single}`);
  console.log('  --- 15 most recent ---');
  for (const { f, t } of withTime.slice(0, 15)) {
    const c = characterize(f);
    if (!c) continue;
    const proj = c.cwd ? basename(c.cwd) : (f.split(sep).slice(-2, -1)[0] || '?');
    const d = new Date(t).toISOString().slice(5, 16).replace('T', ' ');
    console.log(`  ${d} | ${proj.padEnd(18).slice(0, 18)} | side=${c.sidechain ? 'Y' : 'n'} meta=${c.meta ? 'Y' : 'n'} u=${c.users} a=${c.asst} type=${c.userTypes.join(',') || '-'} | "${trunc(c.firstPrompt)}"`);
  }
}

console.log('Rapid Reader — agent session diagnostic (read-only)');
reportDir('~/.claude/projects', join(homedir(), '.claude', 'projects'));
reportDir('~/.codex/sessions', join(homedir(), '.codex', 'sessions'));

// Where might the DESKTOP app keep sessions? Probe common roots and report
// any folders that contain session-like data (jsonl / *.json / leveldb).
console.log('\n=== Desktop app data probe ===');
const roots = [
  process.env.APPDATA && join(process.env.APPDATA, 'Claude'),
  process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'Claude'),
  process.env.APPDATA && join(process.env.APPDATA, 'AnthropicClaude'),
  process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'AnthropicClaude'),
  join(homedir(), 'Library', 'Application Support', 'Claude'),
  join(homedir(), '.config', 'Claude'),
  join(homedir(), '.claude'),
].filter(Boolean);
for (const r of roots) {
  if (!existsSync(r)) { console.log(`  ${r} : not found`); continue; }
  let subs = [];
  try { subs = readdirSync(r, { withFileTypes: true }).map((e) => e.name + (e.isDirectory() ? '/' : '')); } catch {}
  const jsonl = [...walk(r)].filter((f) => f.endsWith('.jsonl')).length;
  const json = [...walk(r)].filter((f) => f.endsWith('.json')).length;
  console.log(`  ${r} : EXISTS — jsonl=${jsonl} json=${json} — entries: ${subs.slice(0, 20).join(' ')}`);
}
console.log('\nPaste this whole output back to Rapid Reader chat.');
