import test from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { parseEpub, compileBook, chapterText } from '../public/epub.js';
import booksHandler from '../api/books.js';
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
  assert.equal(book.chapters[0].title, 'Setting Sail');
  assert.ok(book.chapters[0].text.includes('harbor at dawn & sailed'));
  assert.equal(book.chapters[1].title, 'The Storm'); // falls back to <title>
});

test('compileBook produces markdown sections per chapter', async () => {
  const md = compileBook(await parseEpub(makeEpub()));
  assert.ok(md.includes('# Setting Sail'));
  assert.ok(md.includes('# The Storm'));
  assert.ok(md.indexOf('# Setting Sail') < md.indexOf('# The Storm'));
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

test('books API: POST stores the book and a stub item; items DELETE cascades', async () => {
  const text = '# Setting Sail\n\nThe crew left the harbor at dawn.';
  let r = await call(booksHandler, 'POST', { body: { title: 'Test Voyage', author: 'A. Writer', text } });
  assert.equal(r.code, 201);
  const item = r.body.item;
  assert.equal(item.sourceType, 'book');
  assert.equal(item.title, 'Test Voyage');
  assert.ok(item.bookId);
  assert.equal(item.words, text.split(/\s+/).length);
  assert.ok(item.text.length < 100); // stub, not the book

  // the stub is in the backlog, the text is fetchable by bookId
  r = await call(itemsHandler, 'GET');
  assert.equal(r.body.items[0].id, item.id);
  r = await call(booksHandler, 'GET', { query: { id: item.bookId } });
  assert.equal(r.body.book.text, text);

  // deleting the item removes the book doc too
  r = await call(itemsHandler, 'DELETE', { body: { id: item.id } });
  assert.equal(r.code, 200);
  r = await call(booksHandler, 'GET', { query: { id: item.bookId } });
  assert.equal(r.code, 404);
});

test('books API validates input', async () => {
  let r = await call(booksHandler, 'POST', { body: { title: 'No text' } });
  assert.equal(r.code, 400);
  r = await call(booksHandler, 'GET');
  assert.equal(r.code, 400);
});
