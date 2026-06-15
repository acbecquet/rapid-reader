// Shared transcript parsing for CLI coding agents (Claude Code, Codex).
// Pure and unit-tested. Goal: a faithful, read-only rendering of the actual
// chat — exactly the live sessions, with background noise filtered out:
//   - sub-agent (Task) sessions   → isSidechain
//   - observer/memory agents      → automated first prompt / observer cwd
//   - injected context            → <environment_context>, AGENTS.md, etc.
// Titles prefer the session's own summary (matches the native sidebar).
// Each turn is emitted behind a [[rr:role]] sentinel line so the reader can
// attribute it (you / claude / tool / think) faithfully.

const TEXT_CAP = 1_000_000; // ~1MB safety ceiling; normal sessions never reach it

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

// Compact, readable summary of a tool_use input (command/desc/path/etc.).
function toolInput(input) {
  if (input == null) return '';
  if (typeof input === 'string') return input;
  const o = input;
  const pick = o.command || o.description || o.file_path || o.path || o.pattern || o.query || o.url;
  if (pick) return String(pick);
  try { return JSON.stringify(o); } catch { return ''; }
}

function toolResultText(content) {
  if (typeof content === 'string') return content.trim();
  if (Array.isArray(content)) return content.map((b) => (typeof b === 'string' ? b : (b?.text || ''))).filter(Boolean).join('\n').trim();
  return String(content?.text || '').trim();
}

// One JSONL entry → { role, blocks:[{kind:'text'|'think'|'tool'|'toolresult', text, name?}] } | null.
// Richer than oneMessage (which stays for isBackground); preserves tool/thinking turns.
export function blocksOf(entry) {
  if (!entry || typeof entry !== 'object') return null;
  const node = entry.message || entry.payload || entry;
  const type = node.type || entry.type;
  const role = node.role || entry.role;
  if (!role) {
    if (/agent|assistant/i.test(type) && (node.message || node.text)) return { role: 'assistant', blocks: [{ kind: 'text', text: String(node.message || node.text).trim() }] };
    if (/user/i.test(type) && (node.message || node.text)) return { role: 'user', blocks: [{ kind: 'text', text: String(node.message || node.text).trim() }] };
    return null;
  }
  if (role !== 'user' && role !== 'assistant') return null;
  const c = node.content;
  const blocks = [];
  const pushText = (t) => { t = String(t || '').trim(); if (t) blocks.push({ kind: 'text', text: t }); };
  if (typeof c === 'string') pushText(c);
  else if (Array.isArray(c)) {
    for (const b of c) {
      if (typeof b === 'string') { pushText(b); continue; }
      if (!b || typeof b !== 'object') continue;
      const bt = b.type || '';
      if (bt === 'thinking' || b.thinking) blocks.push({ kind: 'think', text: String(b.thinking || b.text || '').trim() });
      else if (bt === 'tool_use') blocks.push({ kind: 'tool', name: String(b.name || 'tool'), text: toolInput(b.input) });
      else if (bt === 'tool_result') blocks.push({ kind: 'toolresult', text: toolResultText(b.content) });
      else pushText(b.text || b.content);
    }
  } else if (typeof node.text === 'string') pushText(node.text);
  return blocks.length ? { role, blocks } : null;
}

// A user line that isn't a real prompt (slash-command / markup / handoff / trim
// junk) — so it never becomes the title. Mirrors the reader's deriveTitle filter.
function isJunkPrompt(s) {
  return !s || s.length < 2
    || /^[<{[(]/.test(s)
    || /^(#{1,6}\s|\*{1,2}\S|>\s|[-*]\s)/.test(s)
    || /^[@"']*[A-Za-z]:[\\/]/.test(s)
    || /^[#*\-–—.·•\s>]+$/.test(s)
    || /environment_context|command-(name|message|args)|AGENTS\.md|system-reminder|resume_handoff|handoff document|earlier (conversation|turns) trimmed/i.test(s);
}

// JSONL → { md, firstPrompt, lastPrompt }. Each turn opens with a [[rr:role]]
// sentinel; content follows verbatim. Injected context dropped. No mid-turn cut.
export function compileTranscript(jsonl) {
  const out = [];
  let firstPrompt = '', lastPrompt = '', lastClaude = '';
  for (const line of jsonl.split('\n')) {
    let entry; try { entry = JSON.parse(line); } catch { continue; }
    const t = blocksOf(entry);
    if (!t) continue;
    for (const b of t.blocks) {
      if (b.kind === 'text') {
        if (t.role === 'user') {
          if (INJECTED.test(b.text)) continue;
          const flat = b.text.replace(/\s+/g, ' ').trim();
          if (!isJunkPrompt(flat)) { if (!firstPrompt) firstPrompt = flat; lastPrompt = flat; }
          out.push('[[rr:you]]\n' + b.text);
        } else {
          out.push('[[rr:claude]]\n' + b.text);
          lastClaude = b.text; // for the backlog preview line ("where we are now")
        }
      } else if (b.kind === 'think') {
        if (b.text) out.push('[[rr:think]]\n' + b.text);
      } else if (b.kind === 'tool') {
        out.push(`[[rr:tool ${b.name}]]\n` + b.text);
      } else if (b.kind === 'toolresult') {
        if (out.length && out[out.length - 1].startsWith('[[rr:tool')) out[out.length - 1] += '\n' + b.text;
        else if (b.text) out.push('[[rr:tool]]\n' + b.text);
      }
    }
  }
  let md = out.join('\n\n');
  if (md.length > TEXT_CAP) {
    const turns = md.split(/\n\n(?=\[\[rr:)/);
    while (turns.length > 1 && turns.join('\n\n').length > TEXT_CAP) turns.shift();
    md = '(earlier turns trimmed)\n\n' + turns.join('\n\n');
  }
  return { md, firstPrompt, lastPrompt, lastClaude };
}

// Build the /api/items payload, or null for thin/background sessions. `title`
// is an optional override (sync injects a native-model title); without it the
// quick title is the session summary || first prompt (instant, no LLM).
export function buildPayload({ jsonl, sessionId, group, sourceType, title }) {
  if (isBackground(jsonl)) return null;
  const { md, firstPrompt, lastPrompt, lastClaude } = compileTranscript(jsonl);
  if (md.replace(/\[\[rr:[^\]]*\]\]/g, '').split(/\s+/).filter(Boolean).length < 8) return null;
  // Title = your most recent prompt (strictly your words — no summary, no LLM).
  const base = (title || lastPrompt || firstPrompt || 'session').replace(/\s+/g, ' ').trim();
  const words = base.split(' ');
  const quick = words.slice(0, 12).join(' ').slice(0, 90) + (words.length > 12 ? '…' : '');
  const preview = (lastClaude || '').replace(/\s+/g, ' ').trim().slice(0, 140); // Claude's latest → preview line
  return { sessionId, text: md, title: quick, group: group || 'sessions', sourceType: sourceType || 'claude_code', ...(preview ? { preview } : {}) };
}
