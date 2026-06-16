import test from 'node:test';
import assert from 'node:assert/strict';
import { docxXmlToText, pptxSlideXmlToText } from '../public/office.js';

test('docxXmlToText: paragraphs become lines; Heading styles become markdown', () => {
  const xml = `<w:document><w:body>
    <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Title Here</w:t></w:r></w:p>
    <w:p><w:r><w:t>First </w:t></w:r><w:r><w:t>paragraph.</w:t></w:r></w:p>
    <w:p></w:p>
    <w:p><w:r><w:t xml:space="preserve">Second &amp; last.</w:t></w:r></w:p>
  </w:body></w:document>`;
  assert.equal(docxXmlToText(xml), '# Title Here\n\nFirst paragraph.\n\nSecond & last.');
});

test('docxXmlToText: a w:tab element is not mistaken for a w:t run', () => {
  const xml = '<w:body><w:p><w:r><w:tab/><w:t>after tab</w:t></w:r></w:p></w:body>';
  assert.equal(docxXmlToText(xml), 'after tab');
});

test('pptxSlideXmlToText: each a:p paragraph is a line; entities decode', () => {
  const xml = `<p:sld><p:cSld><p:spTree>
    <a:p><a:r><a:t>Slide heading</a:t></a:r></a:p>
    <a:p><a:r><a:t>Point one &lt;x&gt;</a:t></a:r></a:p>
  </p:spTree></p:cSld></p:sld>`;
  assert.equal(pptxSlideXmlToText(xml), 'Slide heading\nPoint one <x>');
});
