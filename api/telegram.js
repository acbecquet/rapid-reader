// Telegram Bot webhook: each incoming message lands in the owner backlog.
// Telegram POSTs an "update" JSON object; we accept message / channel_post /
// edited_message the same way. Secured by a shared secret Telegram echoes in
// the X-Telegram-Bot-Api-Secret-Token header (or ?secret= as a fallback).
// Always answers 2xx on a real update so Telegram never retries forever.
import crypto from 'node:crypto';
import { applyCors } from './_lib/auth.js';
import { addItem } from './_lib/ingest.js';

function secretOk(req) {
  const want = process.env.TELEGRAM_WEBHOOK_SECRET || '';
  const got = req.headers['x-telegram-bot-api-secret-token'] || req.query?.secret || '';
  const a = Buffer.from(String(got));
  const b = Buffer.from(want);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export default async function handler(req, res) {
  applyCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' });

  if (!process.env.TELEGRAM_WEBHOOK_SECRET) {
    return res.status(503).json({ error: 'TELEGRAM_WEBHOOK_SECRET not set' });
  }
  if (!secretOk(req)) return res.status(401).json({ error: 'bad secret' });

  const update = req.body || {};
  const msg = update.message || update.channel_post || update.edited_message || {};
  const text = String(msg.text || '').trim();
  if (!text) return res.status(200).json({ ok: true, skipped: true });

  const title = text.split('\n')[0].trim().slice(0, 80);
  try {
    const result = await addItem('owner', { text, sourceType: 'telegram', title });
    if (result.ignored) return res.status(200).json({ ok: true, ignored: true });
    return res.status(200).json({ ok: true, id: result.item.id });
  } catch (e) {
    return res.status(200).json({ ok: true, error: String(e?.message || e) });
  }
}
