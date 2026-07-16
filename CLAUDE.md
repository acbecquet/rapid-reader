# Rapid Reader

A pin-to-corner RSVP (Rapid Serial Visual Presentation) reading panel.
Highlight text anywhere → it lands in a synced backlog → read it one word
at a time at high WPM with an ORP pivot, smart pacing, and a build-up mode.

## Architecture (keep it this small)

- `public/` — the entire frontend. Vanilla JS ES modules, no framework, no build step.
  - `rsvp.js` — pure functions only (tokenize, ORP, pacing, build-up, phrase
    clusters for span training). Unit tested.
  - `parse.js` — pure structure parser (sections, code placeholders, tables→sentences,
    code-heaviness detection). Unit tested.
  - `epub.js` — pure EPUB parser (zip via DecompressionStream, chapters→markdown).
    Unit tested in Node.
  - `icons.js` — inline-SVG glyphs for the header action buttons and source toggles.
  - `app.js` — DOM wiring, player loop, polling, settings, 5-column backlog,
    multiselect, source toggles, stats, sessions.
- `api/items.js` — backlog endpoint. GET returns lean index stubs + live + prefs;
  GET `?id` loads one body to read; POST/PATCH/DELETE. No AI on the hot path.
- `api/prefs.js` — per-user ⚡ capture gate, source on/off toggles, column
  layout, and the user's own free Gemini key (validated on save; the raw key is
  stored but never returned — responses carry only hasGeminiKey/needsGeminiKey).
- `api/health.js` — storage probe ({ redis, blob, persistent }); open it to see
  whether the backlog will persist.
- `api/log.js` — frontend error/anomaly log (capped, deduped per signature) so
  bugs surface instead of hiding. Pairs with the AI title self-heal: a bad
  title is logged AND lazily re-derived (items PATCH `retitle`) for the item
  you open — capped per session so it never storms the LLM quota.
- `api/telegram.js`, `api/email.js` — webhook ingestion (shared secret) → owner queue.
- `api/quiz.js` — comprehension quiz endpoint: POST {id} → 5 Gemini-built
  multiple-choice questions on that item's text, on the user's own key
  (keysFor). Post-read only, never on the capture/open hot path; graded
  client-side (self-training, not an exam).
- `api/stats.js` — reading-metrics endpoint. Aggregates only, never raw text,
  plus a capped list of per-read training records (actual wpm, cluster size,
  quiz score) that powers the Training trends in the stats panel.
- `api/_lib/` — `store.js` (Redis lean index + Vercel Blob bodies, in-memory dev
  fallback), `ingest.js` (shared addItem: gate→putBody→index), `prefs.js`
  (defaults + source→column routing), `auth.js` gate, `readable.js` (URL→text,
  no AI), `title.js` (LLM helper, kept but off the hot path).
- `extension/` — MV3 browser extension that captures highlighted text and POSTs it.
- `mcp/` — stdio MCP server (own package.json) so coding agents can push items.
- `hooks/` — CLI-agent capture. `transcript.mjs` (pure, tested) parses Claude
  & Codex JSONL into a faithful, readable transcript. `claude-hook.mjs` is the
  Claude Stop hook (instant). `sync.mjs` reads `~/.claude/projects` and
  `~/.codex/sessions`, backfills recent sessions and `--watch`es for live
  updates; both upsert per `sessionId` (`claude:`/`codex:` + file id), grouped
  by the project cwd. `install.mjs` wires the hook + writes `~/.claude/
  rapid-reader.json` (url+token, since hooks don't get env vars).
- `sync-agents.cmd`/`.command` — double-click launcher for `sync.mjs --watch`.
- `capture-anywhere.cmd`/`.command` — clipboard watcher → live highlight (any app).
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

## Reasoning discipline

Hard-won, from a real mistake — do not repeat it:

1. **Follow your own analysis to its conclusion.** If you've already surfaced
   the facts that settle a question, your recommendation must *be* that
   conclusion — never pair advice with reasoning that undercuts it in the same
   breath. (The mistake: recommending an email allowlist while explaining, in
   the same message, exactly why open sign-in is already perfectly safe here.)
2. **Reason from this app's actual design, not a generic prior.** Don't import a
   threat model the system doesn't have; "lock it down" is not a default.

## Project-specific rules

- The frontend stays buildless. If a change seems to require a bundler,
  reconsider the change.
- `rsvp.js`, `parse.js`, and `epub.js` stay pure (no DOM, no fetch) so they stay
  testable in Node.
- Two-tier storage so the 4s poll stays tiny at any size. The Redis **index**
  holds lean stubs: `{ id, title, sourceType, group?, createdAt, readAt,
  progress, archivedAt, words, bodyUrl, sessionId?, bookId?, chapterIndex?,
  bookmarkAt? }` — never the text. Each item's full text lives in **Vercel
  Blob** at `bodyUrl`, or in a Redis `rr:body:` key when Blob has no token, or
  in-memory in dev — loaded only when opened (`GET /api/items?id=`). Agent
  sessions carry `sessionId` + `group` (project); books are one item per
  chapter sharing a `bookId`/`group`, with a `bookmarkAt` marking the current
  chapter. Same `sessionId` upserts in place + bumps to top.
- Redis keys via `keyFor(base, uid)`: `rr:items[:uid]` lean index (cap 5000),
  `rr:prefs[:uid]` (capture gate + source toggles + columns + the user's own
  Gemini key, redacted out of every client response), `rr:stats[:uid]`
  daily aggregates, `rr:live[:uid]` ephemeral slot. Identity is a stateless
  HMAC session token (Google sign-in via `api/login.js`, or the owner/dev
  token → uid `owner`). No passwords, no server-side sessions, no billing.
- **Open by design — never gate it, and never store anything sensitive.** Google
  sign-in exists *only* to separate backlogs per user and to route each user
  onto their own free Gemini key — it is NOT an access control. `ALLOWED_EMAILS`
  stays unset: any Google account (a brand-new throwaway included) is a welcome
  user, and there is intentionally no `@gmail.com`/domain filter. Per-user
  isolation + bring-your-own-key make open the correct, safe default. Never
  propose allowlists, domain filters, or other gating as "security" — this
  workspace holds nothing sensitive, on purpose.
- **Responsiveness first: no AI on the capture/open path.** Titles are instant
  first-words; URLs are stripped to text (no LLM reorg); code is shown raw in
  the transcript. `title.js` (MiniMax/Gemini) stays for optional future use,
  not the hot path. Never RSVP raw code word-by-word — `parse.js` still turns
  code blocks into placeholders; the transcript shows the real code.
- Stats stay aggregate-only: no captured text in `rr:stats`, ever.
- New env: `BLOB_READ_WRITE_TOKEN` (Vercel Blob), `TELEGRAM_WEBHOOK_SECRET`,
  `EMAIL_WEBHOOK_SECRET`. `/api/health` reports whether Redis/Blob are wired.
