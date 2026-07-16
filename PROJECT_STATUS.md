# Rapid Reader Project Status

Last updated: 2026-07-16 America/Phoenix  
Repository: `acbecquet/rapid-reader`  
Current production branch: `main`  
Project state: trainer pivot (see below) on top of live-testable v1.2

This document is the context reset point. If the chat context is crowded, start
from here plus `README.md`.

## Current Goal

Rapid Reader is a reading trainer.
The original premise (read everything at very high WPM with single-word RSVP) did not hold up: comprehension drops sharply at forced high speeds, matching the published research (Rayner et al., 2016).
The app now trains reading speed and comprehension as two separate, measured tracks, using all the existing intake (backlog, EPUB, URL fetch, paste, share, agent capture) as training material.

The main loop is:

1. Capture text from browser selections, clipboard, phone share, manual paste,
   agent hooks, or MCP.
2. Store or preview it in a synced backlog.
3. Parse it into readable sections and RSVP tokens.
4. Train speed: read with the cluster RSVP player (1-4 word phrases per flash,
   honest WPM), with smart pacing, build-up ramp, and progress tracking.
5. Train comprehension: finish a piece, take the Gemini-built quiz, and let the
   stats panel's Training trends say when to push and when to back off.

## Recently Finished

### Trainer pivot: cluster RSVP + comprehension quizzes + training trends

Status: merged to `main` in PR #40 (2026-07-16).

- `public/rsvp.js` gains pure `clusterize()` and `clusterDelayMs()`: up to 4
  words per flash, never spanning clause/sentence/paragraph/section
  boundaries; a cluster's display time is the sum of its members' delays so
  WPM stays true at any cluster size.
- The player runs on clusters everywhere (size 1 = classic single-word RSVP
  with the ORP pivot). Settings slider, HUD `×N` cycler, and the `C` key.
- `api/quiz.js`: POST {id} → 5 Gemini-built multiple-choice questions on the
  item's text, on the user's own key. One retry on malformed JSON, validated
  shape, post-read only.
- Finishing an eligible read (not agent transcripts, not live highlights)
  offers the quiz; `quizAfterRead` (default on) auto-opens it. Graded
  client-side in a modal.
- `api/stats.js` gains a capped `sessions` list of per-read training records
  { ts, words, wpm, cluster, sourceType, quiz? }. The stats panel opens with
  a Training section: speed trend, comprehension trend, recent reads, and a
  next-target nudge (3-quiz average at 80%+ → raise; under 60% → lower).
- Copy reframed around the trainer story (info panel, README, this file).
- Design spec: `docs/superpowers/specs/2026-07-16-trainer-pivot-design.md`.

### Backlog top panel and filled-list behavior

Status: complete, merged to `main` in PR #10.

User request:

- Move the backlog from a side menu to a full-width top panel.
- Allow an option to keep the backlog visible while reading.
- When the backlog has around 20 items, it should grow into the white space
  above the reader, but only to about 2.5x its small height, then become
  scrollable.

Implementation status:

- Top backlog panel exists in `public/index.html`.
- Styling lives in `public/style.css`.
- `#top` is capped at `max-height: min(42vh, 340px)`.
- `#list` flexes inside that cap and scrolls vertically.
- The setting `Keep backlog open while reading` is wired through
  `settings.keepOpen` in `public/app.js`.

Verification performed:

- `npm test` passed: 52 tests, 0 failures.
- Headless Chrome was seeded with 20 backlog items.
- Measured `390x820`: top panel `340px`, list scrollable, reader `480px`.
- Measured `390x720`: top panel `302px`, list scrollable, reader `418px`.

### Compound-word tokenization

Status: complete, already on `main`.

User request:

- Treat dash/slash compound words like `run-of-the-mill` as multiple RSVP words.
- Preserve useful numeric ranges like `2-3` and `1998-2024`.
- Avoid breaking URLs.

Implementation status:

- `public/rsvp.js` splits word-joining hyphens, dashes, and slashes.
- Numeric ranges remain atomic.
- URLs remain atomic and are marked as links.
- Tests live in `test/rsvp.test.mjs`.

## Feature Status Matrix

| Area | Status | Main files | Notes |
| --- | --- | --- | --- |
| RSVP reader | Complete | `public/app.js`, `public/rsvp.js`, `public/style.css` | ORP pivot, WPM, smart delays, progress bar, time remaining, keyboard/tap controls. |
| Build mode | Complete | `public/rsvp.js`, `public/app.js` | Starts at 200 WPM, ramps by a configurable step until target. |
| Cluster RSVP (span training) | Complete | `public/rsvp.js`, `public/app.js` | 1-4 words per flash, phrase-bounded, honest WPM. Settings slider, HUD ×N, `C` key. |
| Comprehension quizzes | Complete | `api/quiz.js`, `api/_lib/title.js`, `public/app.js` | Post-read Gemini MCQs on the user's own key; graded client-side; quizAfterRead setting. |
| Training trends | Complete | `api/stats.js`, `public/app.js` | Capped per-read records (wpm, cluster, quiz score); Training section with speed + comprehension curves and a next-target nudge. |
| Top backlog | Complete | `public/index.html`, `public/style.css`, `public/app.js` | Full-width top panel, day grouping, filters, unread dots, one-line rows, scroll cap. |
| Keep backlog open while reading | Complete | `public/app.js`, `public/index.html` | Toggle in settings. If off, opening an item closes backlog. If on, backlog stays visible. |
| Browser extension capture | Complete | `extension/` | MV3 extension. Supports button, instant, and live selection modes. |
| Live highlight mode | Complete | `api/live.js`, `public/app.js`, `extension/background.js`, `extension/content.js` | Ephemeral slot, overwritten on each selection. Not saved unless user taps `+ keep`. |
| Capture-anywhere clipboard watcher | Complete | `capture-anywhere.cmd`, `capture-anywhere.command` | Watches clipboard so non-browser selections can be mirrored into live mode. |
| PWA phone use | Complete with iOS limitation | `public/manifest.webmanifest`, `public/sw.js`, `public/app.js` | Android supports Share to installed PWA. iOS does not support PWA share targets, so use copy/paste. |
| Manual add | Complete | `public/app.js`, `api/items.js` | `+` panel accepts pasted text or URLs. |
| URL intake | Complete | `api/_lib/readable.js`, `api/items.js` | Bare URL is fetched and converted into readable text. Optional LLM improves structure. |
| URL links inside transcript | Complete | `public/app.js` | Clicking a URL token asks whether to save/read now, save for later, or stay. |
| Parsing structured text | Complete | `public/parse.js` | Headings, bullets, tables, blockquotes, code blocks, and prose are converted into readable sections. |
| Code-heavy handling | Complete | `public/parse.js`, `api/_lib/title.js`, `api/items.js` | Code/diff content can be summarized before reading. Raw source remains available. |
| Live transcript pane | Complete | `public/app.js`, `public/style.css` | Shows full text below RSVP word, follows current token, allows clicking to jump. |
| EPUB import | Complete | `public/epub.js`, `api/books.js`, `public/app.js` | DRM-free EPUB parsing, chapter sections, resume support. PDFs are not supported yet. |
| Stats dashboard | Complete | `api/stats.js`, `public/app.js` | Daily/weekly words, active time, completed items, estimated saved time, source breakdown. |
| MiniMax/Gemini LLM fallback | Complete | `api/_lib/title.js`, `api/_lib/readable.js` | MiniMax preferred when configured; Gemini fallback; graceful no-key fallback. |
| Google sign-in multi-user mode | Complete | `api/login.js`, `api/_lib/auth.js`, `public/app.js` | Optional. Per-user isolated queues and stats. Token entry still works. |
| Public demo mode | Complete | `api/_lib/auth.js`, tests | `PUBLIC_DEMO=1` lets tokenless visitors share the owner/dev queue. |
| Claude Code hook | Complete | `hooks/` | Stop hook sends Claude transcripts into backlog, updating by session ID. |
| MCP server | Complete | `mcp/server.mjs` | Agents can add/list/read/mark items and attach summaries. |
| Tests and CI | Complete | `test/`, `.github/workflows` if present | Local `npm test` currently passes 110 tests. |

## Deployment State

The app is designed for Vercel with no build step.

Required production setup:

- Import `acbecquet/rapid-reader` into Vercel.
- Framework preset: `Other`.
- Connect Upstash Redis from Vercel Storage.
- Set `RAPID_READER_TOKEN` to a long private string.
- Redeploy after env var changes.

Optional env vars:

- `MINIMAX_API_KEY`: preferred LLM for titles, summaries, page reorganization.
- `MINIMAX_MODEL`: optional override, default is `MiniMax-M2`.
- `MINIMAX_BASE_URL`: optional override, default is `https://api.minimax.io/v1`.
- `GEMINI_API_KEY`: fallback LLM (owner only — each signed-in user brings
  their own free Gemini key, set on sign-in and stored in their prefs, so
  growing the tester pool doesn't drain the owner's quota).
- `GEMINI_MODEL`: optional override, default is `gemini-2.5-flash-lite`.
- `GOOGLE_CLIENT_ID`: enables Google sign-in.
- `OWNER_EMAIL`: maps owner Google sign-in to the existing owner queue.
- `ALLOWED_EMAILS`: optional comma-separated guest list.
- `PUBLIC_DEMO=1`: tokenless shared demo mode.

Device setup shortcut:

- Visit `https://your-app.vercel.app/?token=YOURTOKEN` once per device.
- The app stores the token locally and removes it from the URL.

## Phone Testing Checklist

Android:

1. Open the Vercel URL in Chrome.
2. Install with `Add to Home screen`.
3. Open the installed app.
4. Confirm the footer/status says synced and item count is correct.
5. Select text in another app.
6. Share to Rapid Reader.
7. Confirm the item appears and can be played.

iPhone:

1. Open the Vercel URL in Safari.
2. Add to Home Screen.
3. Use copy text, open Rapid Reader, tap `+`, paste, and add.
4. iOS PWA share targets are not supported, so direct Share to app is a known
   platform limitation.

Cross-device live pipeline:

1. Leave the phone app open.
2. On desktop, configure the Chrome extension with the same app URL and token.
3. Set extension mode to `Live` or use the `RSVP` selection button.
4. Highlight text on desktop.
5. The phone app should pick up the live slot on the next poll, roughly within
   one 4-second cycle when visible.

## Known Limitations and Non-Goals

- iOS does not support PWA share targets. Copy/paste is the intended path there.
- PDFs are not supported yet.
- DRM-locked Kindle, Apple Books, and Google Play books cannot be imported.
- Syncing reading position with Kindle/Apple/Google reading apps is not planned.
- Raw code/diff RSVP is intentionally avoided; code-heavy captures should be
  summarized into review notes first.
- Live highlight mode is ephemeral and one-slot only; the latest selection
  overwrites the previous one unless saved with `+ keep`.
- Local development uses in-memory storage if Redis is not configured.
- Vercel/Redis production is the intended synced deployment.

## Test Status

Fresh local verification before this document:

```text
npm test
110 tests passed
0 tests failed
```

Important covered areas:

- API auth and CRUD.
- Public demo behavior.
- Google sign-in token handling.
- RSVP tokenization, ORP, delays, build mode, sentence navigation.
- Hyphen/slash compound splitting and URL preservation.
- Parser behavior for headings, bullets, tables, code, prose.
- Readable URL intake.
- Live slot behavior.
- EPUB parsing and book storage.
- Stats aggregation.
- LLM provider fallback.
- Claude hook payload construction.

## Suggested Next Work After Live Testing

These are not commitments; they are likely next improvements based on current
state and user feedback so far.

1. Tune top backlog cap after using it on the actual phone screen.
   Current cap is `min(42vh, 340px)`.
2. Decide whether the backlog should remember open/closed state across reloads.
   Today it is controlled by current UI state plus the keep-open setting while
   reading.
3. Add a small in-app "connection test" or diagnostics panel if token/Redis
   setup confusion appears during live use.
4. Consider PDF import only if real usage makes it worth the complexity.
5. Consider richer backlog search/history after enough items accumulate.
6. Consider a more explicit first-run phone setup flow if sharing the app with
   other people.

## Useful Commands

Local dev:

```sh
npm install
npm run dev
```

Tests:

```sh
npm test
```

Regenerate icons:

```sh
python scripts/gen_icons.py
```

Install Claude Code hook:

```sh
node hooks/install.mjs
```

Remove Claude Code hook:

```sh
node hooks/install.mjs --remove
```

MCP local setup:

```sh
cd mcp
npm install
```

## Files To Read First In A New Session

1. `PROJECT_STATUS.md` - this state map.
2. `README.md` - user-facing setup and full feature guide.
3. `public/app.js` - frontend state machine, backlog, reader, settings.
4. `public/rsvp.js` - tokenization and RSVP timing.
5. `public/parse.js` - structure parser.
6. `api/items.js` - backlog API and summarization hooks.
7. `api/_lib/auth.js` - token/demo/user scoping.
8. `extension/` - Chrome capture behavior.
9. `hooks/` and `mcp/` - agent integrations.

## Current Repo Summary

Rapid Reader is no longer just v0. It is now a fairly complete personal review
queue with:

- Synced backlog.
- Full-width top backlog panel with a filled-list scroll cap.
- Desktop extension and clipboard capture.
- Phone PWA.
- RSVP player plus transcript view.
- URL, EPUB, Claude transcript, and MCP intake.
- Optional multi-user auth.
- Stats.
- Tests covering the core engine and APIs.

The repo is ready for live testing on the Vercel deployment. The main thing to
learn from real use is whether the backlog height cap, phone capture workflow,
and live transcript ergonomics feel right on actual hardware.
