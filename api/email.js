// Forwarded-email webhook: a forwarded email lands in the owner backlog.
// POSTed by an email-forwarding webhook (Cloudflare Email Worker, Mailgun /
// Postmark inbound) or an email MCP server. The body shape varies, so we read
// subject / text / from with fallbacks and accept HTML when that's all there is.
// Secured by a shared secret passed as ?secret= or the X-Webhook-Secret header.
import crypto from 'node:crypto';
import { applyCors } from './_lib/auth.js';
import { htmlToText } from './_lib/readable.js';
import { addItem } from './_lib/ingest.js';

function secretOk(req) {
  const want = process.env.EMAIL_WEBHOOK_SECRET || '';
  const got = req.headers['x-webhook-secret'] || req.query?.secret || '';
  const a = Buffer.from(String(got));
  const b = Buffer.from(want);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export default async function handler(req, res) {
  applyCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' });

  if (!process.env.EMAIL_WEBHOOK_SECRET) {
    return res.status(503).json({ error: 'EMAIL_WEBHOOK_SECRET not set' });
  }
  if (!secretOk(req)) return res.status(401).json({ error: 'bad secret' });

  try {
    const body = req.body || {};
    const subject = String(body.subject || body.Subject || '').trim();
    const from = String(body.from || body.From || body.sender || '').trim();
    let text = body.text || body.body || body['body-plain'] || body['stripped-text'] || body['html-stripped'] || '';
    if (!text) {
      const html = body.html || body['body-html'] || '';
      if (html) text = htmlToText(String(html));
    }
    text = String(text).trim();

    if (!text && !subject) return res.status(200).json({ ok: true, skipped: true });

    const composed = (subject ? `# ${subject}\n\n` : '')
      + (from ? `From: ${from}\n\n` : '')
      + text;
    if (!composed.trim()) return res.status(200).json({ ok: true, skipped: true });

    const title = (subject || text.split('\n')[0]).trim().slice(0, 100);
    const result = await addItem('owner', { text: composed, sourceType: 'email', title });
    if (result.ignored) return res.status(200).json({ ok: true, ignored: true });
    return res.status(200).json({ ok: true, id: result.item.id });
  } catch (e) {
    return res.status(200).json({ ok: true, error: String(e?.message || e) });
  }
}
