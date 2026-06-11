# Rapid Reader

A pin-to-corner RSVP (Rapid Serial Visual Presentation) reading panel.
Highlight text anywhere → it lands in a synced backlog → read it one word
at a time at high WPM with an ORP pivot, smart pacing, and a build-up mode.

## Architecture (keep it this small)

- `public/` — the entire frontend. Vanilla JS ES modules, no framework, no build step.
  - `rsvp.js` — pure functions only (tokenize, ORP, pacing, build-up). Unit tested.
  - `app.js` — DOM wiring, player loop, polling, settings.
- `api/items.js` — the single API endpoint (GET/POST/PATCH/DELETE), bearer-token auth.
- `api/_lib/` — storage (Upstash Redis, in-memory fallback) and Gemini title generation.
- `extension/` — MV3 browser extension that captures highlighted text and POSTs it.
- `dev-server.mjs` — local dev: serves `public/` and mounts `api/items.js` with the
  in-memory store. `npm run dev`, then http://localhost:3000.
- `test/` — `node --test` over the pure logic in `rsvp.js` and the API handler.

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
- `rsvp.js` stays pure (no DOM, no fetch) so it stays testable in Node.
- The API stays one file. Item schema:
  `{ id, text, title, url, source, createdAt, readAt }`.
- Storage is a single JSON document in Redis (`rr:items`, newest first,
  capped). This is a single-user app; don't add multi-tenancy machinery.
