# Rapid Reader — Roadmap (north-star master spec)

**Status:** living · **Date:** 2026-06-16 · **Owns:** the post-A/B wave (mirroring, universal ingest, fetch, help, hotkey)

## How to use this doc

This is the north star. It holds every committed target so none get lost as we
get into the weeds. We resolve them **one at a time**: for each phase we write a
focused plan in `docs/superpowers/plans/` (plus a short design note for anything
still open), build it TDD, ship it to test, and check it off here. The order is a
proposal, not a cage. Rule that never moves: **each phase ships `npm test` green
and is verified on test.acb-apps.com (the `staging` deploy). We test nowhere
else.**

## Where we are now (groundwork already done)

- Sub-project **A** (transcript fidelity + roles) and **B** (backlog org:
  soft-delete/undo/trash, rename, drag-reorder, per-column theming, preview line)
  are built and on test. B's five had a delivery bug, see Phase 0.
- **Deploy discipline fixed:** assets are cache-busted (`app.js?v=` / `style.css?v=`),
  the service-worker cache is versioned (`rr-v4`), and a visible **build stamp**
  (Settings footer + console) tells us exactly what test is serving. Bump the
  stamp + the `?v=` + the sw `CACHE` together on every deploy.

## Principles (do not drift from these)

- **Buildless.** Vanilla ES modules, no bundler, no framework. If a target looks
  like it needs a build step or a heavy dependency, that is a design question to
  resolve in the open, never a silent assumption.
- **Pure core stays pure + tested:** `rsvp.js`, `parse.js`, `epub.js` (no DOM, no
  fetch), so they stay unit-testable in Node. That is also how we get confidence
  without a browser in CI.
- **RSVP is the product; the transcript is its faithful mirror.** The flattened
  word-stream is correct for RSVP; the transcript should look like the source.
- **No AI on the capture/open path.** Responsiveness first.
- **Two-tier storage:** lean Redis index, bodies in Blob. The 4s/10s poll stays
  tiny.

## Phases

### Phase 0 — Close the A/B loop (verify + tidy) `[quick]`
Goal: a clean, trusted base before new work piles on.
- [ ] Confirm B's five work on test now that the cache-bust is live (build stamp
      reads `20260616a`).
- [ ] Consolidate the PR stack: the working branch already holds A + B + the fixes;
      collapse to a single PR into `main` once verified, close the superseded drafts.

Success: stamp confirmed, the five behave, one clean promotable PR.

### Phase 1 — Faithful transcript mirroring `[TOP PRIORITY]`
Goal: the transcript pane mirrors the source's structure the way Claude Code
renders it, so reading (agents, news, books) is legible, with RSVP word-follow and
click-to-seek kept on top.

Why it is broken today: `parse.js` is shared, and its main job is the RSVP
word-stream, so it deliberately flattens every list into one run-on sentence.
The transcript reuses that parse, so numbering, bullets, nesting, and inline
`code` are lost (headings and fenced code survive). Fix: give the transcript its
own faithful render path; keep the flattened stream for RSVP only.

Sub-phases, each shipped to test:
- [ ] **1a — Structure.** Parser retains list items (their marker/number and
      nesting depth) instead of flattening; transcript renders real nested
      numbered/bulleted lists; headings + fenced code blocks kept. Biggest
      readability win.
- [ ] **1b — Inline.** Render inline `code` (monospace) and bold/italic inside
      text, mapped over the RSVP word spans.
- [ ] **1c — Tables.** Render tables as tables in the transcript (still flattened
      to sentences for the RSVP stream).

Approach: enrich the pure parser to keep structure (unit-tested in Node); add a
transcript renderer in `app.js` that mirrors it; the RSVP token stream is
unchanged (still flattens). 

Open questions (settle in the 1x plan): inline spans that cross token boundaries
(multi-word `` `code` ``) vs the per-token click-to-seek model; how literally to
mirror Claude's heading/number styling.

Success: the overnight-summary screenshot reads with its numbers, bullets,
nesting, and code, not as a wall of text.

### Phase 2 — Universal ＋ (file loader)
Goal: the ＋ accepts any standard human-reading file, alongside paste-text/URL.
Targets: `.txt`, `.epub` (routes straight into the existing book flow, the
purposeful redundancy with 📖 you asked for), `.docx`, `.pptx`, `.pdf`.

Buildless tension to resolve FIRST (this sizes the whole phase):
- `.txt` — trivial (read as text).
- `.epub` — already solved (`epub.js`, zip via `DecompressionStream`).
- `.docx` / `.pptx` — these are zip-of-XML; the same `DecompressionStream` plus a
  small XML text-extract should work buildless, no heavy dep. Likely feasible.
- `.pdf` — the hard one. No simple buildless parser; `pdf.js` is large. Options to
  decide: (a) load `pdf.js` as an ESM module from a CDN on demand (keeps the repo
  buildless, adds a runtime fetch), (b) extract server-side in an `api/` function,
  (c) ship txt/epub/docx/pptx first and defer `.pdf`.

Open questions: client vs server extraction; the `pdf.js` dependency stance vs the
buildless rule.

Success: choose or drag a file of each shipped type and it lands in the backlog as
readable text (epub as a book).

### Phase 3 — Fetch / freshest ingestor data
Goal: a fetch control to the right of the Telegram toggle that pulls the latest
from the active ingestors on demand; auto-updating as the real goal.

Reality to resolve FIRST: the backlog already polls every 10s; webhook sources
(telegram/email) push server-side; the local agent sync runs on your machine and
the browser cannot trigger it. So "fetch" needs a precise meaning. Candidates:
force an immediate poll, re-pull a specific source, and/or show per-source
"last updated" with a manual refresh.

Open questions: what each ingestor can actually be fetched from in a browser; what
"auto-updating" adds beyond the existing poll.

Success: one click visibly refreshes the freshest available data, with honest
per-source status.

### Phase 4 — Settings → Help tab
Goal: a Help tab in Settings documenting every feature in plain language. House
rule for this copy: **simple words, and no em dashes — it must not read like AI.**

Scope: a section per feature (capture ⚡, sources, columns + theming, RSVP
controls, build mode, transcript, delete/trash, rename, drag-reorder, books,
stats, bring-your-own key) with short how-to copy. There is plenty of room in the
settings modal.

Success: a newcomer can learn every feature from this one tab.

### Phase 5 — Keep Help current automatically
Goal: whenever a feature changes (each push to `main`/prod), check whether Help
needs updating, and update it right then.

Mechanism to resolve: a CI step or a Claude Code hook on push that compares the
change against the Help content and either flags or edits it. Auto-editing docs
needs an LLM step; flag-only is simpler and cheaper. Could also ride the existing
autofix.

Open questions: hook vs GitHub Action vs existing autofix; flag-only vs auto-edit;
where it runs and what triggers it.

Success: Help never silently drifts out of date.

### Phase 6 — "Open in Rapid Reader" hotkey `[stretch]`
Goal: a GitHub-`.`-style jump from a Claude (or news) page straight into the RSVP
reader, the thing you're after with the hotkey idea.

Approach: extend the existing capture extension with a content script + hotkey or
button on claude.ai that posts the current conversation and opens `/?item=<id>`
(the deep-link already exists). Worth building only once Phase 1 mirroring is
faithful, since that is the whole point.

Success: one key from a Claude page opens it in RSVP, faithfully.

## Sequencing + tracking

Proposed order: **0 → 1 → 2 → 3 → 4 → 5 → 6**, adjustable. Phase 1 (mirroring) is
the priority and is foundational to the whole "reading hub" value, so it leads the
build work. Sub-items get checked off here as they ship; each phase gets its own
plan in `docs/superpowers/plans/` when we start it.

## Non-goals (for now)

- A build step / bundler.
- AI on the capture/open path.
- Cross-column drag, nested/hierarchical groups (prior non-goals stand).
