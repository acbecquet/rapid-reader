// EPUB → readable chapters. Pure (no DOM, no fetch): zip parsing with
// DataView + DecompressionStream (browsers and Node 18+), regex-based
// XHTML→text in the style of api/_lib/readable.js. Unit tested in Node.

const td = new TextDecoder();

async function inflateRaw(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

// Minimal zip reader: central directory → name/method/offset/size. No zip64
// (EPUBs are small), CRCs not verified.
async function unzip(buf) {
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
  const chapters = [];
  let num = 0; // running count of unnamed/numbered chapters → "Chapter N"
  for (const tag of opf.match(/<itemref\b[^>]*>/gi) || []) {
    if (attr(tag, 'linear') === 'no') continue;
    const href = manifest.get(attr(tag, 'idref'));
    if (!href) continue;
    const xhtml = read(resolve(opfDir, href));
    const text = chapterText(xhtml);
    if (text.split(/\s+/).length < 5) continue; // covers, blank pages
    let title = chapterTitle(xhtml);
    if (/^\d+$/.test(title)) { num = Number(title); title = `Chapter ${title}`; }
    else if (!title) title = `Chapter ${++num}`;
    chapters.push({ title, text });
  }
  if (!chapters.length) throw new Error('no readable chapters');
  return { title: meta('title') || 'Untitled book', author: meta('creator'), chapters };
}

// One markdown stream: chapter titles become sections in parse.js.
export function compileBook(book) {
  return book.chapters
    .map((c) => (c.text.startsWith('#') ? c.text : `# ${c.title}\n\n${c.text}`))
    .join('\n\n');
}
