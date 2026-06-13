// Shared transcript parsing for CLI coding agents (Claude Code, Codex).
// Pure and unit-tested. The goal is a faithful, read-only rendering of the
// conversation exactly as it appeared natively: user prompts become headings,
// assistant prose follows, tool-calls/non-text are dropped (not readable).

const TEXT_CAP = 60000;

// One JSONL entry → { role, text } | null. Tolerant of the different shapes
// Claude and Codex use (message/payload wrappers, string vs block content,
// event-style messages).
export function oneMessage(entry) {
  if (!entry || typeof entry !== 'object') return null;
  const node = entry.message || entry.payload || entry;
  const type = node.type || entry.type;

  // event-style (Codex): { type:'agent_message'|'user_message', message }
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
  else if (Array.isArray(c)) {
    text = c.map((b) => (typeof b === 'string' ? b : (b?.text || b?.content || ''))).filter(Boolean).join('\n\n');
  } else if (typeof node.text === 'string') text = node.text;
  return mk(role, text);
}

function mk(role, text) {
  text = String(text || '').trim();
  return text ? { role, text } : null;
}

// JSONL → { md, firstPrompt }. user prompts → "# heading", assistant → prose.
export function compileTranscript(jsonl) {
  const out = [];
  let firstPrompt = '';
  for (const line of jsonl.split('\n')) {
    let entry;
    try { entry = JSON.parse(line); } catch { continue; }
    const m = oneMessage(entry);
    if (!m) continue;
    if (m.role === 'user') {
      const flat = m.text.replace(/\s+/g, ' ').trim();
      if (!firstPrompt) firstPrompt = flat;
      const words = flat.split(' ');
      out.push('# ' + words.slice(0, 12).join(' ') + (words.length > 12 ? '…' : ''));
    } else {
      out.push(m.text);
    }
  }
  let md = out.join('\n\n');
  if (md.length > TEXT_CAP) md = '(earlier conversation trimmed)\n\n' + md.slice(-TEXT_CAP);
  return { md, firstPrompt };
}

// Build the /api/items payload for a session, or null if too thin to read.
export function buildPayload({ jsonl, sessionId, group, sourceType }) {
  const { md, firstPrompt } = compileTranscript(jsonl);
  if (md.split(/\s+/).length < 8) return null;
  const words = (firstPrompt || 'session').split(' ');
  const title = words.slice(0, 9).join(' ').slice(0, 80) + (words.length > 9 ? '…' : '');
  return { sessionId, text: md, title, group: group || 'sessions', sourceType: sourceType || 'claude_code' };
}
