# Rapid Reader

A pin-to-corner RSVP (Rapid Serial Visual Presentation) reading panel.
Highlight text anywhere → it lands in a synced backlog → read it one word
at a time at high WPM with an ORP pivot, smart pacing, and a build-up mode.

## Architecture (keep it this small)

- `public/` — the entire frontend. Vanilla JS ES modules, no framework, no build step.
  - `rsvp.js` — pure functions only (tokenize, ORP, pacing, build-up). Unit tested.
  - `parse.js` — pure structure parser (sections, code placeholders, tables→sentences,
    code-heaviness detection). Unit tested.
  - `app.js` — DOM wiring, player loop, polling, settings, filters, stats, sessions.
- `api/items.js` — backlog endpoint (GET/POST/PATCH/DELETE), bearer-token auth.
- `api/stats.js` — reading-metrics endpoint. Aggregates only, never raw text.
- `api/_lib/` — storage (Upstash Redis, in-memory fallback), shared auth gate,
  Gemini title + code-summary generation.
- `extension/` — MV3 browser extension that captures highlighted text and POSTs it.
- `mcp/` — stdio MCP server (own package.json) so coding agents can push items.
- `dev-server.mjs` — local dev: serves `public/` and mounts the api handlers with the
  in-memory store. `npm run dev`, then http://localhost:3000.
- `test/` — `node --test` over the pure logic and the API handlers.

Deployed on Vercel free tier: static files from `public/`, bare Node functions
from `api/`. No framework preset, no build command.

## Guidelines (Karpathy)

These follow Andrej Karpathy's guidelines for LLM-assisted coding. They are not
optional decoration; apply them to every change.

1. **Think before coding.** Don't assume; don't hide confusion; surface tradeoffs.
   State assumptions explicitly. Present interpretations rather than choosing
   silently. Mention the simpler alternative when one exists.
2. **Simplicity first.** Minimum code that solves the problem, nothing speculative.
   No unrequested features, no abstractions for single-use code, no flexibility
   nobody asked for, no error handling for impossible scenarios. If 200 lines
   could be 50, rewrite. Test: would a senior engineer call it overcomplicated?
3. **Surgical changes.** Touch only what you must; clean up only your own mess.
   Preserve unrelated code and formatting. Match the established style. Every
   changed line should directly serve the request.
4. **Goal-driven execution.** Define success criteria, loop until verified.
   Turn vague tasks into measurable outcomes; for anything non-trivial, run
   `npm test` and exercise the dev server before calling it done.

## Project-specific rules

- The frontend stays buildless. If a change seems to require a bundler,
  reconsider the change.
- `rsvp.js` and `parse.js` stay pure (no DOM, no fetch) so they stay testable in Node.
- Item schema: `{ id, text, title, url, source, sourceType, createdAt, readAt,
  progress, archivedAt, summary }`.
- Storage is JSON documents in Redis (`rr:items` newest-first capped,
  `rr:stats` daily aggregates). This is a single-user app; don't add
  multi-tenancy machinery.
- Never RSVP raw code or raw diffs: parse them out or summarize them into
  language first. Raw source stays accessible.
- Stats stay aggregate-only: no captured text in `rr:stats`, ever.
