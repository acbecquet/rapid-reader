// Turn a webpage into RSVP-friendly markdown: fetch → strip to text →
// Gemini reorganizes (headings, short paragraphs, bullets; tables become
// statements; figures get a one-line description; boilerplate dropped).
// Without GEMINI_API_KEY the stripped text is used as-is.
import { llm } from './title.js';

const PRIVATE_HOST = /^(localhost|127\.|0\.|10\.|192\.168\.|169\.254\.|\[::1\])|\.(local|internal)$/i;

// Pure and unit-tested: rough HTML → readable text with light structure.
export function htmlToText(html) {
  return html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|svg|iframe|head|nav|footer|aside|form|template)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<li\b[^>]*>/gi, '\n- ')
    .replace(/<h([1-6])\b[^>]*>/gi, (m, n) => '\n\n' + '#'.repeat(+n) + ' ')
    .replace(/<(br|hr)\b[^>]*>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6]|tr|section|article|blockquote|ul|ol|table)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;|&apos;|&#x27;/g, "'")
    .replace(/&quot;|&#34;/g, '"')
    .replace(/&mdash;/g, '—')
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function pageTitle(html) {
  const m = html.match(/<title[^>]*>([^<]*)/i);
  return m ? m[1].trim().slice(0, 100) : '';
}

// → { title, markdown }; throws when the page can't be fetched/read.
export async function fetchReadable(url, prefer) {
  const u = new URL(url);
  if (!/^https?:$/.test(u.protocol) || PRIVATE_HOST.test(u.hostname)) {
    throw new Error('unsupported url');
  }
  const res = await fetch(u, {
    redirect: 'follow',
    headers: { 'user-agent': 'Mozilla/5.0 (compatible; RapidReader/1.0)', accept: 'text/html,*/*' },
    signal: AbortSignal.timeout(12000),
  });
  if (!res.ok) throw new Error('page returned ' + res.status);
  const html = (await res.text()).slice(0, 1500000);
  const text = htmlToText(html);
  if (text.split(/\s+/).length < 20) throw new Error('no readable content found');

  const organized = await llm(
    'Rewrite this webpage content as clean markdown organized for rapid ' +
      'serial reading: # headings for sections, short paragraphs, bullet ' +
      'lists where natural. Convert tables into short bullet statements. ' +
      'If a chart or figure matters, describe it in one line. Omit ' +
      'navigation, ads, cookie notices, related-article links, and ' +
      'comments. Preserve the substantive content and its order. ' +
      'Output only the markdown.\n\n' + text.slice(0, 30000),
    8192,
    prefer
  );
  return { title: pageTitle(html), markdown: organized || text };
}
