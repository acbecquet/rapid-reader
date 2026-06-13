import test from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { parseEpub, compileBook, chapterText } from '../public/epub.js';
import itemsHandler from '../api/items.js';

// ---------- minimal zip writer (CRCs unset — the parser ignores them) ----------
function zip(entries) {
  const parts = [];
  const central = [];
  let offset = 0;
  for (const { name, data, deflate } of entries) {
    const raw = Buffer.from(data);
    const body = deflate ? zlib.deflateRawSync(raw) : raw;
    const n = Buffer.from(name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(deflate ? 8 : 0, 8);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(n.length, 26);
    parts.push(local, n, body);

    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(deflate ? 8 : 0, 10);
    cd.writeUInt32LE(body.length, 20);
    cd.writeUInt32LE(raw.length, 24);
    cd.writeUInt16LE(n.length, 28);
    cd.writeUInt32LE(offset, 42);
    central.push(Buffer.concat([cd, n]));
    offset += local.length + n.length + body.length;
  }
  const cdBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cdBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  const buf = Buffer.concat([...parts, cdBuf, eocd]);
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

const xhtml = (title, body) =>
  `<?xml version="1.0"?><html><head><title>${title}</title></head><body>${body}</body></html>`;

function makeEpub() {
  return zip([
    { name: 'mimetype', data: 'application/epub+zip' }, // stored, per spec
    {
      name: 'META-INF/container.xml',
      data: '<container><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
      deflate: true,
    },
    {
      name: 'OEBPS/content.opf',
      data: `<package xmlns:dc="http://purl.org/dc/elements/1.1/">
        <metadata><dc:title>Test Voyage</dc:title><dc:creator>A. Writer</dc:creator></metadata>
        <manifest>
          <item id="cover" href="cover.xhtml" media-type="application/xhtml+xml"/>
          <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml"/>
          <item id="c1" href="ch%201.xhtml" media-type="application/xhtml+xml"/>
          <item id="c2" href="ch2.xhtml" media-type="application/xhtml+xml"/>
        </manifest>
        <spine><itemref idref="cover"/><itemref idref="nav" linear="no"/><itemref idref="c1"/><itemref idref="c2"/></spine>
      </package>`,
      deflate: true,
    },
    { name: 'OEBPS/cover.xhtml', data: xhtml('Cover', '<img src="cover.jpg"/>'), deflate: true },
    { name: 'OEBPS/nav.xhtml', data: xhtml('Contents', '<ol><li>Setting Sail</li><li>The Storm</li></ol>'), deflate: true },
    {
      name: 'OEBPS/ch 1.xhtml', // space in the name → href is URL-encoded
      data: xhtml('x', '<h1>Setting Sail</h1><p>The crew left the harbor at dawn &amp; sailed straight into the open sea.</p>'),
      deflate: true,
    },
    {
      name: 'OEBPS/ch2.xhtml',
      data: xhtml('The Storm', '<p>Clouds gathered quickly. The little ship held on through the night.</p>'),
      deflate: true,
    },
  ]);
}

test('parseEpub: metadata, spine order, skips cover and non-linear nav', async () => {
  const book = await parseEpub(makeEpub());
  assert.equal(book.title, 'Test Voyage');
  assert.equal(book.author, 'A. Writer');
  assert.equal(book.chapters.length, 2);
  assert.equal(book.chapters[0].title, 'Chapter 1 · Setting Sail'); // numbered + heading
  assert.ok(book.chapters[0].text.includes('harbor at dawn & sailed'));
  assert.equal(book.chapters[1].title, 'Chapter 2 · The Storm'); // title from <title>
});

test('compileBook produces markdown sections per chapter', async () => {
  const md = compileBook(await parseEpub(makeEpub()));
  assert.ok(md.includes('# Chapter 1 · Setting Sail'));
  assert.ok(md.includes('# Chapter 2 · The Storm'));
  assert.ok(md.indexOf('Setting Sail') < md.indexOf('The Storm'));
});

test('chapterText strips tags, keeps headings and lists', () => {
  const t = chapterText('<body><h2>Part</h2><ul><li>one</li><li>two</li></ul><p>done &mdash; ok</p></body>');
  assert.ok(t.includes('## Part'));
  assert.ok(t.includes('- one'));
  assert.ok(t.includes('done — ok'));
});

test('parseEpub rejects non-zip and empty books', async () => {
  await assert.rejects(() => parseEpub(new ArrayBuffer(40)), /not a zip/);
});

// Chapter numbering: an EPUB with front matter, an image-only chapter cover,
// a word-numbered heading, and a chapter whose title only lives in the nav.
function makeNumberedEpub() {
  return zip([
    { name: 'mimetype', data: 'application/epub+zip' },
    {
      name: 'META-INF/container.xml',
      data: '<container><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
      deflate: true,
    },
    {
      name: 'OEBPS/content.opf',
      data: `<package xmlns:dc="http://purl.org/dc/elements/1.1/">
        <metadata><dc:title>Numbered</dc:title></metadata>
        <manifest>
          <item id="nav" href="nav.xhtml" properties="nav" media-type="application/xhtml+xml"/>
          <item id="f1" href="front1.xhtml" media-type="application/xhtml+xml"/>
          <item id="p1" href="part1.xhtml" media-type="application/xhtml+xml"/>
          <item id="ig" href="imgch.xhtml" media-type="application/xhtml+xml"/>
          <item id="c3" href="ch3.xhtml" media-type="application/xhtml+xml"/>
          <item id="c4" href="ch4.xhtml" media-type="application/xhtml+xml"/>
        </manifest>
        <spine>
          <itemref idref="nav" linear="no"/>
          <itemref idref="f1"/><itemref idref="p1"/><itemref idref="ig"/>
          <itemref idref="c3"/><itemref idref="c4"/>
        </spine>
      </package>`,
      deflate: true,
    },
    { name: 'OEBPS/nav.xhtml', data: xhtml('Contents', '<nav epub:type="toc"><ol><li><a href="ch4.xhtml">The Aftermath</a></li></ol></nav>'), deflate: true },
    { name: 'OEBPS/front1.xhtml', data: xhtml('x', '<h1>Introduction</h1><p>This is the opening of the whole book for everyone.</p>'), deflate: true },
    { name: 'OEBPS/part1.xhtml', data: xhtml('x', '<h1>Part One</h1><p>The first part begins here with several plain words.</p>'), deflate: true },
    { name: 'OEBPS/imgch.xhtml', data: xhtml('', '<img src="images/ch01.png" alt="Chapter 1"/><p>The hero set out across the wide open plains alone.</p>'), deflate: true },
    { name: 'OEBPS/ch3.xhtml', data: xhtml('x', '<h1>Chapter Three — The Reckoning</h1><p>Everything came to a head on that cold grey morning.</p>'), deflate: true },
    { name: 'OEBPS/ch4.xhtml', data: xhtml('', '<p>In the quiet that followed the survivors counted their losses slowly.</p>'), deflate: true },
  ]);
}

test('chapter numbering: skips front matter, reads image alt, honours stated numbers, enumerates', async () => {
  const book = await parseEpub(makeNumberedEpub());
  assert.deepEqual(book.chapters.map((c) => c.title), [
    'Introduction',              // named front matter — no number
    'Part One',                  // structural division — no number
    'Chapter 1',                 // number read from the chapter-cover image alt
    'Chapter 3 · The Reckoning', // stated word-number jumps the running count
    'Chapter 4 · The Aftermath', // enumerated; title pulled from the nav document
  ]);
});

// ---------- books API ----------
function call(handler, method, { body, query } = {}) {
  return new Promise((resolve) => {
    const req = { method, headers: {}, body: body || {}, query: query || {} };
    const res = {
      setHeader() {},
      status(c) { this.code = c; return this; },
      json(o) { resolve({ code: this.code, body: o }); },
    };
    handler(req, res);
  });
}

test('a book is a normal item (sourceType book) with its text in the body store', async () => {
  const text = compileBook(await parseEpub(makeEpub()));
  let r = await call(itemsHandler, 'POST', {
    body: { title: 'Test Voyage — A. Writer', sourceType: 'book', text, words: text.split(/\s+/).length },
  });
  assert.equal(r.code, 201);
  const item = r.body.item;
  assert.equal(item.sourceType, 'book');
  assert.equal(item.title, 'Test Voyage — A. Writer');
  assert.equal('text' in item, false); // lean stub
  assert.ok(item.words > 5);

  // the full text loads by id and round-trips the chapters
  r = await call(itemsHandler, 'GET', { query: { id: item.id } });
  assert.ok(r.body.text.includes('# Chapter 1 · Setting Sail'));
  assert.ok(r.body.text.includes('# Chapter 2 · The Storm'));

  r = await call(itemsHandler, 'DELETE', { body: { id: item.id } });
  assert.equal(r.code, 200);
  r = await call(itemsHandler, 'GET', { query: { id: item.id } });
  assert.equal(r.code, 404);
});
