#!/usr/bin/env node
// Rapid Reader MCP server (stdio). Lets Claude Code and other agents push
// their summaries/explanations into your review queue and check it.
//
// Env: RAPID_READER_URL   e.g. https://your-app.vercel.app
//      RAPID_READER_TOKEN your access token
//
// Register with Claude Code:
//   claude mcp add rapid-reader \
//     -e RAPID_READER_URL=https://your-app.vercel.app \
//     -e RAPID_READER_TOKEN=… \
//     -- node /path/to/rapid-reader/mcp/server.mjs
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const BASE = (process.env.RAPID_READER_URL || '').replace(/\/+$/, '');
const TOKEN = process.env.RAPID_READER_TOKEN || '';

async function api(method, path, body) {
  if (!BASE) throw new Error('RAPID_READER_URL env var is not set');
  const res = await fetch(`${BASE}/api/${path}`, {
    method,
    headers: {
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(TOKEN ? { authorization: `Bearer ${TOKEN}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`Rapid Reader API ${res.status}: ${await res.text()}`);
  return res.json();
}

const text = (o) => ({ content: [{ type: 'text', text: JSON.stringify(o, null, 2) }] });
const fail = (e) => ({ content: [{ type: 'text', text: `Error: ${e.message}` }], isError: true });

const server = new McpServer({ name: 'rapid-reader', version: '1.0.0' });

server.registerTool('rapid_reader_add_item', {
  description: 'Add a reading item to the Rapid Reader review queue. Send natural-language ' +
    'content (summaries, plans, explanations, review notes) — not raw code or raw diffs.',
  inputSchema: {
    text: z.string().min(1).describe('The text to queue for RSVP review'),
    title: z.string().optional().describe('Short title (generated if omitted)'),
    sourceType: z.enum(['claude_code', 'codex', 'copilot', 'manual', 'web', 'docs', 'email', 'article', 'other'])
      .optional().describe('Where this came from (default claude_code)'),
    sourceUrl: z.string().optional().describe('Link back to the source'),
  },
}, async ({ text: body, title, sourceType, sourceUrl }) => {
  try {
    const { item } = await api('POST', 'items', {
      text: body,
      title,
      sourceType: sourceType || 'claude_code',
      url: sourceUrl,
    });
    const wordCount = item.text.split(/\s+/).length;
    return text({
      itemId: item.id,
      title: item.title,
      wordCount,
      estimatedDurationMs: Math.round((wordCount / 300) * 60000),
      playbackUrl: `${BASE}/?item=${item.id}`,
    });
  } catch (e) { return fail(e); }
});

server.registerTool('rapid_reader_list_backlog', {
  description: 'List items in the Rapid Reader backlog.',
  inputSchema: {
    status: z.enum(['unread', 'all']).optional().describe('Filter (default unread)'),
  },
}, async ({ status }) => {
  try {
    const { items } = await api('GET', 'items');
    const visible = items.filter((it) => !it.archivedAt && (status === 'all' || !it.readAt));
    return text(visible.map((it) => ({
      itemId: it.id,
      title: it.title,
      sourceType: it.sourceType,
      wordCount: it.text.split(/\s+/).length,
      unread: !it.readAt,
      createdAt: new Date(it.createdAt).toISOString(),
    })));
  } catch (e) { return fail(e); }
});

server.registerTool('rapid_reader_mark_reviewed', {
  description: 'Mark a Rapid Reader item as reviewed.',
  inputSchema: { itemId: z.string().describe('The item id') },
}, async ({ itemId }) => {
  try {
    const { item } = await api('PATCH', 'items', { id: itemId, readAt: Date.now(), progress: 0 });
    return text({ itemId: item.id, title: item.title, reviewed: true });
  } catch (e) { return fail(e); }
});

server.registerTool('rapid_reader_get_metrics', {
  description: 'Get Rapid Reader reading metrics (today and last 7 days).',
  inputSchema: {},
}, async () => {
  try {
    const { days } = await api('GET', 'stats');
    const todayKey = new Date().toISOString().slice(0, 10);
    const week = Object.keys(days || {})
      .filter((k) => (Date.now() - new Date(k + 'T12:00Z')) / 86400000 < 7);
    const sum = (f) => week.reduce((a, k) => a + f(days[k]), 0);
    return text({
      today: days?.[todayKey] || { ms: 0, words: 0, sessions: 0, completed: 0 },
      last7days: {
        words: sum((d) => d.words),
        activeMs: sum((d) => d.ms),
        sessions: sum((d) => d.sessions),
        itemsCompleted: sum((d) => d.completed),
      },
    });
  } catch (e) { return fail(e); }
});

await server.connect(new StdioServerTransport());
