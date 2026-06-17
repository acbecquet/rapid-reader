// EPUB → readable chapters. Pure (no DOM, no fetch): zip parsing with
// DataView + DecompressionStream (browsers and Node 18+), regex-based
// XHTML→text in the style of api/_lib/readable.js. Unit tested in Node.

const td = new TextDecoder();

async function inflateRaw(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

// Minimal zip reader: central directory → name/method/offset/size. No zip64
// (EPUBs are small), CRCs not verified. Exported so office.js can read .docx/
// .pptx (also zip-of-XML) without a second implementation.
export async function unzip(buf) {
  const b = new Uint8Array(buf);
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let eocd = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 65558); i--) {
    if (v.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('not a zip file');
  const count = v.getUint16(eocd + 10, true);
  let p = v.getUint32(eocd + 16, true);
  const files = new Map();
  for (let n = 0; n < count; n++) {
    if (v.getUint32(p, true) !== 0x02014b50) break;
    const method = v.getUint16(p + 10, true);
    const csize = v.getUint32(p + 20, true);
    const nlen = v.getUint16(p + 28, true);
    const xlen = v.getUint16(p + 30, true);
    const clen = v.getUint16(p + 32, true);
    const lho = v.getUint32(p + 42, true);
    const name = td.decode(b.subarray(p + 46, p + 46 + nlen));
    // local header repeats name/extra lengths; data follows them
    const dataAt = lho + 30 + v.getUint16(lho + 26, true) + v.getUint16(lho + 28, true);
    const raw = b.subarray(dataAt, dataAt + csize);
    files.set(name, method === 8 ? await inflateRaw(raw) : raw);
    p += 46 + nlen + xlen + clen;
  }
  return files;
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', mdash: '—', ndash: '–', hellip: '…', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“' };

function decodeEntities(s) {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
    .replace(/&([a-z]+);/gi, (m, name) => ENTITIES[name.toLowerCase()] ?? m);
}

// XHTML chapter body → plain text with markdown headings (parse.js sections).
export function chapterText(xhtml) {
  let s = xhtml.replace(/<!--[\s\S]*?-->/g, '');
  const body = s.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  s = body ? body[1] : s;
  s = s
    .replace(/<(script|style|svg)\b[\s\S]*?<\/\1>/gi, '')
    .replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_, l, t) => {
      const txt = t.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      return txt ? `\n\n${'#'.repeat(+l)} ${txt}\n\n` : '\n\n'; // skip empty headings
    })
    .replace(/<li[^>]*>/gi, '\n- ')
    .replace(/<\/(p|div|li|tr|blockquote|section)>/gi, '\n')
    .replace(/<(br|hr)[^>]*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');
  return decodeEntities(s)
    .split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// The chapter's heading text, or '' when it has none (a numbered chapter whose
// number is an image/glyph). parseEpub then assigns a running "Chapter N".
function chapterTitle(xhtml) {
  const h = xhtml.match(/<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/i)
    || xhtml.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const t = h && decodeEntities(h[1].replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
  return t && /[\p{L}\p{N}]/u.test(t) ? t : '';
}

function attr(tag, name) {
  const m = tag.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, 'i'));
  return m ? m[1] : '';
}

function resolve(dir, href) {
  const parts = (dir ? dir.split('/') : []).concat(decodeURIComponent(href).split('#')[0].split('/'));
  const out = [];
  for (const p of parts) {
    if (p === '..') out.pop();
    else if (p && p !== '.') out.push(p);
  }
  return out.join('/');
}

// ---------- chapter classification ----------
// Front matter, structural dividers, and back matter never take a chapter
// number. The first real chapter is "Chapter 1"; numbering enumerates ascending
// and stops once back matter begins. Shared with the app's reconcile sweep.
const FRONT_RE = /^(title page|half[- ]title|cover|copyright|colophon|dedication|epigraph|epigram|foreword|preface|introduction|prologue|epilogue|afterword|synopsis|credits|praise for|also by|by the same author|contents|table of contents|map\b|maps\b|timeline|cast of|dramatis personae|note to the reader|author.?s note|translator.?s note|acknowledg|appendix|notes\b|glossary|bibliography|index\b|about the)\b/i;
const DIVIDER_RE = /^(part|book|section|volume|act)\b[\s.:#"'“”\-—]*([0-9]+|[ivxlcdm]+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|first|second|third|fourth|fifth|the\b)/i;
const BACK_RE = /^(the end\b|about the author|about the publisher|about the type)/i;

// strip a stored "Chapter N ·" / markdown prefix down to the human title
export function bareTitle(title) {
  return String(title || '')
    .replace(/^\s*#{1,6}\s*/, '')
    .replace(/^chapter\s+[0-9ivxlcdm]+\s*[·:.\-—]?\s*/i, '')
    .replace(/\s+/g, ' ').trim();
}

// 'front' | 'divider' | 'back' | 'chapter' for one entry, given the book title
// (so the title page — whose heading is the book's own name — is caught).
export function classifyEntry(title, bookTitle = '') {
  const t = bareTitle(title);
  if (!t) return 'chapter';                                    // blank/junk → a chapter (numbered + AI-titled)
  if (BACK_RE.test(t)) return 'back';
  if (FRONT_RE.test(t)) return 'front';
  if (bookTitle && t.toLowerCase() === String(bookTitle).toLowerCase().trim()) return 'front'; // title page
  if (DIVIDER_RE.test(t)) return 'divider';
  return 'chapter';
}

// Titles in reading order → [{ num, category }] aligned to input. `num` is the
// chapter number for 'chapter' entries (1-based, ascending), null otherwise.
export function enumerateChapters(titles, bookTitle = '') {
  let num = 0, ended = false;
  return titles.map((title) => {
    const cat = ended ? 'back' : classifyEntry(title, bookTitle);
    if (cat === 'chapter') return { num: ++num, category: 'chapter' };
    if (cat === 'back') ended = true;
    return { num: null, category: cat };
  });
}

const ROMAN = { i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8, ix: 9, x: 10, xi: 11, xii: 12, xiii: 13, xiv: 14, xv: 15, xvi: 16, xvii: 17, xviii: 18, xix: 19, xx: 20, xxi: 21, xxii: 22, xxiii: 23, xxiv: 24, xxv: 25 };
const WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20 };
function toNum(tok) {
  const t = String(tok).toLowerCase();
  if (/^[0-9]+$/.test(t)) return Number(t);
  return ROMAN[t] ?? WORDS[t] ?? null;
}

// "Chapter 5 — Title" / "5. Title" / "V Title" → { num, label }. num is null
// when the heading states no number (then the caller enumerates).
function splitHeading(raw) {
  let s = String(raw).trim();
  let num = null, m;
  if ((m = s.match(/^chapter\s+([0-9]+|[ivxlcdm]+|[a-z]+)\b[\s.:)\-—]*/i))) { num = toNum(m[1]); s = s.slice(m[0].length); }
  else if ((m = s.match(/^([0-9]{1,3})\s*[.:)\-—]\s*/))) { num = Number(m[1]); s = s.slice(m[0].length); }
  else if (/^[0-9]{1,3}$/.test(s)) { num = Number(s); s = ''; }
  return { num, label: s.replace(/\s+/g, ' ').trim() };
}

// A chapter whose title is an image (a cover glyph): read its alt text like a
// heading. The structured "easy way" to recover an EPUB chapter-cover title.
function imgInfo(xhtml) {
  const alt = attr((xhtml.match(/<img\b[^>]*>/i) || [])[0] || '', 'alt');
  return { alt: alt && /[\p{L}\p{N}]/u.test(alt) ? alt.replace(/\s+/g, ' ').trim() : '' };
}

// Navigation document (EPUB3 nav.xhtml or EPUB2 toc.ncx) → spine path → label.
// The most reliable chapter titles, especially when the body shows an image.
function parseNav(opf, opfDir, read) {
  const map = new Map();
  const dirOf = (p) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
  const add = (base, href, label) => {
    label = decodeEntities(String(label || '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
    if (!href || !label) return;
    const path = resolve(base, href.split('#')[0]);
    if (path && !map.has(path)) map.set(path, label);
  };
  const nav3 = opf.match(/<item\b[^>]*\bproperties\s*=\s*["'][^"']*\bnav\b[^"']*["'][^>]*>/i);
  if (nav3) {
    const p = resolve(opfDir, attr(nav3[0], 'href')), dir = dirOf(p), doc = read(p);
    for (const a of doc.match(/<a\b[^>]*>[\s\S]*?<\/a>/gi) || []) add(dir, attr(a, 'href'), a.replace(/^<a\b[^>]*>/i, ''));
  }
  const ncx = opf.match(/<item\b[^>]*media-type\s*=\s*["']application\/x-dtbncx\+xml["'][^>]*>/i);
  if (ncx) {
    const p = resolve(opfDir, attr(ncx[0], 'href')), dir = dirOf(p), doc = read(p);
    for (const np of doc.match(/<navPoint\b[\s\S]*?<\/navPoint>/gi) || []) {
      const label = (np.match(/<text[^>]*>([\s\S]*?)<\/text>/i) || [])[1];
      const src = attr((np.match(/<content\b[^>]*>/i) || [])[0] || '', 'src');
      add(dir, src, label);
    }
  }
  return map;
}

// ArrayBuffer of an .epub → { title, author, chapters: [{ title, text }] }
export async function parseEpub(buf) {
  const files = await unzip(buf);
  const read = (name) => { const f = files.get(name); return f ? td.decode(f) : ''; };

  const container = read('META-INF/container.xml');
  const opfPath = attr(container.match(/<rootfile\b[^>]*>/i)?.[0] || '', 'full-path');
  const opf = read(opfPath);
  if (!opf) throw new Error('no OPF package document');
  const opfDir = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/')) : '';

  const meta = (tag) => {
    const m = opf.match(new RegExp(`<dc:${tag}[^>]*>([\\s\\S]*?)</dc:${tag}>`, 'i'));
    return m ? decodeEntities(m[1]).replace(/\s+/g, ' ').trim() : '';
  };

  const manifest = new Map();
  for (const tag of opf.match(/<item\b[^>]*>/gi) || []) {
    manifest.set(attr(tag, 'id'), attr(tag, 'href'));
  }
  const nav = parseNav(opf, opfDir, read);
  const bookTitle = meta('title');
  // pass 1: collect readable spine entries with their best raw heading
  const entries = [];
  for (const tag of opf.match(/<itemref\b[^>]*>/gi) || []) {
    if (attr(tag, 'linear') === 'no') continue;
    const href = manifest.get(attr(tag, 'idref'));
    if (!href) continue;
    const path = resolve(opfDir, href);
    const xhtml = read(path);
    const text = chapterText(xhtml);
    if (text.split(/\s+/).length < 5) continue; // covers, blank pages
    entries.push({ raw: chapterTitle(xhtml) || nav.get(path) || imgInfo(xhtml).alt || '', text });
  }
  // pass 2: classify + enumerate — front matter/dividers/back keep their name,
  // the first real chapter is Chapter 1, the rest count up.
  const marks = enumerateChapters(entries.map((e) => e.raw), bookTitle);
  const chapters = entries.map((e, i) => (
    marks[i].category !== 'chapter'
      ? { title: e.raw || 'Untitled', text: e.text }   // front matter / dividers keep their name
      : { title: `Chapter ${marks[i].num}`, text: e.text } // chapters: number only — no spoilers
  ));
  if (!chapters.length) throw new Error('no readable chapters');
  return { title: meta('title') || 'Untitled book', author: meta('creator'), chapters };
}

// One chapter → a markdown section headed by its (numbered) title. A heading
// already at the top of the body is replaced so the chapter number always shows.
export function chapterMarkdown(ch) {
  const body = ch.text.replace(/^\s*#{1,6}\s+.*(?:\n|$)/, '').replace(/^\n+/, '');
  return `# ${ch.title}\n\n${body}`.trim();
}

// One markdown stream: chapter titles become sections in parse.js.
export function compileBook(book) {
  return book.chapters.map(chapterMarkdown).join('\n\n');
}
