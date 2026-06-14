// Pure structure parser: no DOM, no fetch. Tested by test/parse.test.mjs.
// Splits captured text (typically markdown-ish AI output) into sections so
// the player can navigate by heading, read tables as sentences, and never
// RSVP raw code word-by-word.
import { tokenize } from './rsvp.js';

const BULLET = /^\s*(?:[-*•]|\d+[.)])\s+/;
const HEADING = /^#{1,6}\s+/;
const FENCE = /^\s*(?:```|~~~)/;
const TABLE_ROW = /^\s*\|.*\|\s*$/;
const TABLE_SEP = /^\s*\|?[\s:|-]+\|?\s*$/;
const DIFF_LINE = /^(?:[+-](?![+-]).*|@@.*@@|diff --git|index [0-9a-f]+\.\.|[+-]{3} )/;

// → [{ type: 'heading'|'paragraph'|'bullets'|'table'|'code', title?, text, raw }]
export function parseStructure(text) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const sections = [];
  let para = [];

  const flushPara = () => {
    const t = para.join(' ').trim();
    if (t) sections.push({ type: 'paragraph', text: t, raw: para.join('\n') });
    para = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (FENCE.test(line)) {
      flushPara();
      const start = i++;
      while (i < lines.length && !FENCE.test(lines[i])) i++;
      const raw = lines.slice(start, i + 1).join('\n');
      const body = lines.slice(start + 1, i);
      sections.push({ type: 'code', text: codePlaceholder(body), raw });
      continue;
    }

    if (HEADING.test(line)) {
      flushPara();
      const title = line.replace(HEADING, '').replace(/\s*#+\s*$/, '').trim();
      sections.push({ type: 'heading', title, text: title, raw: line });
      continue;
    }

    if (TABLE_ROW.test(line)) {
      flushPara();
      const start = i;
      while (i < lines.length && TABLE_ROW.test(lines[i])) i++;
      const rows = lines.slice(start, i--);
      sections.push({ type: 'table', text: tableToSentences(rows), raw: rows.join('\n') });
      continue;
    }

    if (BULLET.test(line)) {
      flushPara();
      const items = [];
      while (i < lines.length && (BULLET.test(lines[i]) || (/^\s{2,}\S/.test(lines[i]) && items.length))) {
        if (BULLET.test(lines[i])) items.push(lines[i].replace(BULLET, '').trim());
        else items[items.length - 1] += ' ' + lines[i].trim();
        i++;
      }
      i--;
      const text = items.map((it) => (/[.?!:;]$/.test(it) ? it : it + '.')).join(' ');
      sections.push({ type: 'bullets', text, raw: items.map((x) => '• ' + x).join('\n') });
      continue;
    }

    // Blockquote → its own section. In an agent transcript these carry the
    // user's own prompts (compileTranscript emits them as '> …'), which the
    // reader renders as a right-aligned "You wrote:" turn.
    if (/^\s*>\s?/.test(line)) {
      flushPara();
      const buf = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) buf.push(lines[i++].replace(/^\s*>\s?/, '').trim());
      i--;
      const text = buf.join(' ').trim();
      if (text) sections.push({ type: 'quote', text, raw: buf.map((x) => '> ' + x).join('\n') });
      continue;
    }

    if (!line.trim()) flushPara();
    else para.push(line.replace(/^>\s?/, '').trim());
  }
  flushPara();
  return sections;
}

function codePlaceholder(bodyLines) {
  const n = bodyLines.filter((l) => l.trim()).length;
  return `⟨code · ${n} line${n === 1 ? '' : 's'}⟩`;
}

// "| Tier | Price |" rows → one readable sentence per data row.
function tableToSentences(rows) {
  const parse = (r) => r.split('|').map((c) => c.trim()).filter(Boolean);
  let header = null;
  const out = [];
  for (const r of rows) {
    if (TABLE_SEP.test(r)) continue;
    const cells = parse(r);
    if (!cells.length) continue;
    if (!header) { header = cells; continue; }
    const pairs = cells.map((c, idx) => (header[idx] ? `${header[idx]}: ${c}` : c));
    out.push(pairs.join(', ') + '.');
  }
  // single-row tables (no data rows) read the header itself
  if (!out.length && header) out.push(header.join(', ') + '.');
  return out.join(' ');
}

// Flatten sections into one RSVP token stream. Each token gains `sec` (its
// section index); code sections become a single placeholder token so raw
// code is never flashed word-by-word.
export function readingTokens(sections) {
  const tokens = [];
  sections.forEach((s, sec) => {
    if (s.type === 'code') {
      tokens.push({ w: s.text, sec, code: true, paraEnd: true, sentenceEnd: true });
      return;
    }
    for (const t of tokenize(s.text)) tokens.push({ ...t, sec });
    if (tokens.length) tokens[tokens.length - 1].paraEnd = true;
  });
  return tokens;
}

// True when the text is mostly code or a git diff — the case where the item
// should be summarized into language instead of RSVP'd.
export function isCodeHeavy(text) {
  const lines = text.split('\n').filter((l) => l.trim());
  if (lines.length < 4) return false;
  if (/^diff --git/m.test(text)) return true;
  const diffish = lines.filter((l) => DIFF_LINE.test(l)).length;
  if (diffish / lines.length > 0.5) return true;
  const sections = parseStructure(text);
  const codeWords = sections.filter((s) => s.type === 'code')
    .reduce((n, s) => n + s.raw.split(/\s+/).length, 0);
  const totalWords = text.split(/\s+/).length;
  return codeWords / totalWords > 0.6;
}
