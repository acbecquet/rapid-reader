// .docx / .pptx → readable text. Both are zip-of-XML, so we reuse epub.js's zip
// reader; the XML→text parts are pure and unit-tested in Node (no DOM, no fetch).

import { unzip } from './epub.js';

const td = new TextDecoder();
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
function decode(s) {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
    .replace(/&([a-z]+);/gi, (m, n) => ENT[n.toLowerCase()] ?? m);
}

// concatenate the text of every <tag>…</tag> run in a chunk
function runText(xml, tag) {
  let out = '';
  const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, 'gi');
  let m;
  while ((m = re.exec(xml))) out += m[1];
  return decode(out);
}

// word/document.xml → text. Each <w:p> is a paragraph; a Heading style becomes a
// markdown heading so parse.js renders it as one.
export function docxXmlToText(xml) {
  const body = (xml.match(/<w:body[^>]*>([\s\S]*)<\/w:body>/i) || [null, xml])[1];
  const out = [];
  for (const p of body.split(/<\/w:p>/i)) {
    const text = runText(p, 'w:t').replace(/[ \t]+/g, ' ').trim();
    if (!text) continue;
    const h = p.match(/<w:pStyle\b[^>]*\bw:val\s*=\s*["']Heading([1-6])["']/i);
    out.push(h ? `${'#'.repeat(+h[1])} ${text}` : text);
  }
  return out.join('\n\n');
}

// one slide's xml → text, one line per <a:p> paragraph
export function pptxSlideXmlToText(xml) {
  const out = [];
  for (const p of xml.split(/<\/a:p>/i)) {
    const text = runText(p, 'a:t').replace(/[ \t]+/g, ' ').trim();
    if (text) out.push(text);
  }
  return out.join('\n');
}

export async function docxText(buf) {
  const files = await unzip(buf);
  const doc = files.get('word/document.xml');
  if (!doc) throw new Error('not a .docx (no word/document.xml)');
  const text = docxXmlToText(td.decode(doc));
  if (!text.trim()) throw new Error('no readable text in the document');
  return text;
}

export async function pptxText(buf) {
  const files = await unzip(buf);
  const slides = [...files.keys()]
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/i.test(n))
    .sort((a, b) => +a.match(/(\d+)/)[1] - +b.match(/(\d+)/)[1]);
  if (!slides.length) throw new Error('not a .pptx (no slides)');
  const out = [];
  slides.forEach((n, i) => {
    const t = pptxSlideXmlToText(td.decode(files.get(n)));
    if (t.trim()) out.push(`## Slide ${i + 1}\n\n${t}`);
  });
  const text = out.join('\n\n');
  if (!text.trim()) throw new Error('no readable text in the slides');
  return text;
}
