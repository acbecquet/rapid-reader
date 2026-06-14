// Shared transcript parsing for CLI coding agents (Claude Code, Codex).
// Pure and unit-tested. Goal: a faithful, read-only rendering of the actual
// chat — exactly the live sessions, with background noise filtered out:
//   - sub-agent (Task) sessions   → isSidechain
//   - observer/memory agents      → automated first prompt / observer cwd
//   - injected context            → <environment_context>, AGENTS.md, etc.
// Titles prefer the session's own summary (matches the native sidebar).

const TEXT_CAP = 60000;

// Non-conversational user content that's in the transcript but not part of the
// chat as shown natively (Codex env block, AGENTS.md, system reminders, …).
const INJECTED = /^\s*(<environment_context>|<INSTRUCTIONS>|#\s*AGENTS\.md|<system-reminder>|<command-|<local-command|caveat: the messages below)/i;

// Automated background agents the user doesn't want surfaced.
const OBSERVER = /\bmemory agent\b|continuing to observe\b/i;

// One JSONL entry → { role, text } | null. Tolerant of the shapes Claude and
// Codex use (message/payload wrappers, string vs block content, event style).
export function oneMessage(entry) {
  if (!entry || typeof entry !== 'object') return null;
  const node = entry.message || entry.payload || entry;
  const type = node.type || entry.type;
  if (!node.role && !entry.role) {
    if (/agent|assistant/i.test(type) && (node.message || node.text)) return mk('assistant', node.message || node.text);
    if (/user/i.test(type) && (node.message || node.text)) return mk('user', node.message || node.text);
    return null;
  }
  const role = node.role || entry.role;
  if (role !== 'user' && role !== 'assistant') return null;
  const c = node.content;
  let text = '';
  if (typeof c === 'string') text = c;
  else if (Array.isArray(c)) text = c.map((b) => (typeof b === 'string' ? b : (b?.text || b?.content || ''))).filter(Boolean).join('\n\n');
  else if (typeof node.text === 'string') text = node.text;
  return mk(role, text);
}

function mk(role, text) {
  text = String(text || '').trim();
  return text ? { role, text } : null;
}

// Claude writes {type:'summary', summary:'…'} entries — the sidebar title.
export function sessionSummary(jsonl) {
  let s = '';
  for (const line of jsonl.split('\n')) {
    if (!line.includes('"summary"')) continue;
    let e; try { e = JSON.parse(line); } catch { continue; }
    if (e.type === 'summary' && e.summary) s = String(e.summary);
  }
  return s.trim();
}

// cwd from a JSON "cwd" field (Claude) or an <cwd>…</cwd> tag (Codex env block).
export function cwdOf(jsonl) {
  const j = jsonl.match(/"cwd"\s*:\s*"([^"]+)"/);
  if (j) return j[1];
  const x = jsonl.match(/<cwd>([^<]+)<\/cwd>/);
  return x ? x[1].trim() : '';
}

// Is this a background/non-interactive session we should NOT surface?
export function isBackground(jsonl) {
  let sidechain = false, realUsers = 0, firstPrompt = '';
  for (const line of jsonl.split('\n')) {
    if (!line) continue;
    let e; try { e = JSON.parse(line); } catch { continue; }
    if (e.isSidechain === true) sidechain = true;
    const m = oneMessage(e);
    if (m?.role === 'user' && !INJECTED.test(m.text)) {
      realUsers++;
      if (!firstPrompt) firstPrompt = m.text;
    }
  }
  if (sidechain) return true;                 // sub-agent (Task) session
  if (realUsers === 0) return true;           // no genuine human turn
  if (OBSERVER.test(firstPrompt)) return true; // memory/observer agent
  const proj = (cwdOf(jsonl).split(/[\\/]/).filter(Boolean).pop() || '');
  if (/^(observer|memory|background)/i.test(proj)) return true;
  return false;
}

// JSONL → { md, firstPrompt }. user prompts → "# heading", assistant → prose,
// injected context dropped.
export function compileTranscript(jsonl) {
  const out = [];
  let firstPrompt = '';
  for (const line of jsonl.split('\n')) {
    let entry; try { entry = JSON.parse(line); } catch { continue; }
    const m = oneMessage(entry);
    if (!m) continue;
    if (m.role === 'user') {
      if (INJECTED.test(m.text)) continue;
      const flat = m.text.replace(/\s+/g, ' ').trim();
      if (!firstPrompt) firstPrompt = flat;
      out.push('> ' + flat); // the prompt you wrote → a "You wrote:" turn in the reader
    } else {
      out.push(m.text);
    }
  }
  let md = out.join('\n\n');
  if (md.length > TEXT_CAP) md = '(earlier conversation trimmed)\n\n' + md.slice(-TEXT_CAP);
  return { md, firstPrompt };
}

// Build the /api/items payload, or null for thin/background sessions. `title`
// is an optional override (sync injects a native-model title); without it the
// quick title is the session summary || first prompt (instant, no LLM).
export function buildPayload({ jsonl, sessionId, group, sourceType, title }) {
  if (isBackground(jsonl)) return null;
  const { md, firstPrompt } = compileTranscript(jsonl);
  if (md.split(/\s+/).length < 8) return null;
  let quick = title;
  if (!quick) {
    const base = (sessionSummary(jsonl) || firstPrompt || 'session').replace(/\s+/g, ' ').trim();
    const words = base.split(' ');
    quick = words.slice(0, 12).join(' ').slice(0, 90) + (words.length > 12 ? '…' : '');
  }
  return { sessionId, text: md, title: quick, group: group || 'sessions', sourceType: sourceType || 'claude_code' };
}
