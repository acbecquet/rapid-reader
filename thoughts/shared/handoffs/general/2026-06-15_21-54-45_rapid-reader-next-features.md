---
date: 2026-06-15T21:54:45Z
researcher: Charlie Becquet
git_commit: e6b2754 (branch tip; prod main is 0eaa735)
branch: claude/backlog-organization
repository: rapid-reader
topic: "Rapid Reader next-features wave — transcript fidelity (A) + backlog organization (B)"
tags: [implementation, transcript, backlog, rsvp, vercel, titles]
status: in_progress
last_updated: 2026-06-15
last_updated_by: Charlie Becquet
type: implementation_strategy
---

# Handoff: Rapid Reader — transcript fidelity (A) + backlog organization (B), both on test awaiting promotion

## Task(s)
Two independent feature sub-projects, both **built, unit-tested (npm test green), and deployed to test.acb-apps.com** — awaiting the owner's visual verification, then promotion to prod. Prod is intentionally locked.

- **A — Transcript fidelity & roles** — PR **#36**, branch `claude/transcript-fidelity`. **COMPLETE on test.** Role-tagged transcript turns (you / Claude / tool / thinking), full messages (60k cut removed), per-role customization (Settings → Transcript appearance), and the agent-title fix.
- **B — Backlog organization** — PR **#37**, branch `claude/backlog-organization` (**stacked on A**). **COMPLETE on test**, 5 phases: ① soft-delete + Undo + Trash, ② rename items (pinned) + subgroup aliases, ③ drag-reorder + manual pin, ④ per-column theming (color + density), ⑤ live preview line.
- **Dev tooling** — PR **#35**, branch `claude/dev-tooling`. Claude-Code plugins marketplace + obra/superpowers + a `staging`-mirror GitHub Action + CLAUDE.md deploy-flow docs. **NOT merged**; needs repo Actions write-permission + Preview-scoped env vars.

All three are **open draft PRs**. Nothing of this wave is in prod. Prod (`main` `0eaa735`) = `#34` key-modal + a "logo files" commit the owner pushed to main directly.

## Critical References
- `docs/superpowers/specs/2026-06-15-transcript-fidelity-and-roles-design.md` — A design.
- `docs/superpowers/specs/2026-06-15-backlog-organization-design.md` + `docs/superpowers/plans/2026-06-15-backlog-organization.md` — B design + phased plan.
- `CLAUDE.md` — architecture + project rules (the "Environments & deploy flow" section lives on #35).

## Recent changes
On `claude/backlog-organization` (contains A's commits, then B's):
- **A:** `hooks/transcript.mjs` (typed turns + `[[rr:role]]` sentinels, no 60k cut, `title = lastPrompt`, `isJunkPrompt`, `lastClaude` preview); `public/parse.js` (`role` on sections, `deriveTitle`, `derivePreview`, `readingTokens` excludes tool/think); `public/app.js` `buildTranscript()` (role-aware render), `healAgentTitles()`, settings panel; `api/_lib/prefs.js`/`api/prefs.js` (`transcript` theming); `hooks/sync.mjs` (dropped the LLM `nativeTitle` override).
- **B:** `api/items.js` (soft-delete default + `?hard=1`, `?trash=1`, lazy 30-day purge; PATCH `deletedAt`/`titlePinned`/`order`/`preview`; `GET?id` 404s soft-deleted); `api/_lib/ingest.js` (tombstone via in-place upsert, pinned title preserved, `preview`); `public/app.js` (Trash modal + 🗑 btn, Undo toast, inline rename of items+groups, HTML5 drag-reorder + `reorderWithin`/`bySaved`, per-column `--col-accent`/`.compact`, preview line); `api/_lib/prefs.js`/`api/prefs.js` (`groupAliases`, column `color`/`density`); `public/index.html`, `public/style.css`.

## Learnings
- **Deploy flow:** `main` → prod (`rapid-reader.acb-apps.com`); `staging` → test (`test.acb-apps.com`). Put a branch on test by force-pushing it to staging: `git push --force origin <branch>:refs/heads/staging`. (#35's Action automates this per PR once merged.)
- **Titles/preview are computed at capture by the LOCAL hook** (`hooks/transcript.mjs` runs on the owner's machine, not the server). So title/preview improvements only fully apply to **new/re-synced** sessions after the owner pulls this branch's hooks locally. For **existing** items on test, `healAgentTitles()` (public/app.js) re-derives title + preview from the stored body — idle sessions only, capped, no LLM — that's the only thing that cleans the *deployed* backlog.
- **Title decision is final:** title = your **most recent prompt** (`deriveTitle` = last clean `[[rr:you]]` turn, skipping command/markup/handoff/trim junk). Preview line = Claude's latest turn. The owner explicitly chose this over "Claude session summary + Gemini retitle." Do **not** reintroduce AI titling.
- **CI:** a GitHub Actions `test` workflow runs `npm test` on pushes — to the branch AND to the staging mirror — so **run `npm test` before every push** or it emails "run failed." (One such failure happened in B Phase 1: a soft-delete change broke `test/epub.test.mjs`; fixed in `3a72188`.)
- **Storage:** lean Redis stub index + Blob bodies. New stub fields this wave: `deletedAt`, `titlePinned`, `order`, `preview` (+ `prefs.transcript`, `prefs.groupAliases`, column `color`/`density`).
- **Drag-and-drop (B Phase 3) was NOT browser-verified** — logic is sound but needs a real test; if finicky, tune the HTML5 DnD handlers in `itemRow` (public/app.js).
- Tests share an in-memory store across files (module-level Map) — watch cross-file ordering.

## Artifacts
- PRs: **#36** (A), **#37** (B, stacked on #36), **#35** (dev tooling).
- Specs/plans: the three files under `docs/superpowers/specs|plans/` listed in Critical References.
- This handoff: `thoughts/shared/handoffs/general/2026-06-15_21-54-45_rapid-reader-next-features.md`.
- New handoff tooling (this branch `claude/handoff`): `.claude/commands/create_handoff.md`, `.claude/commands/resume_handoff.md`, `scripts/spec_metadata.sh`.

## Action Items & Next Steps
1. **Owner verifies A + B on `test.acb-apps.com`** — especially **drag-reorder** (unverified) and the title/preview behaviour.
2. **On approval, promote to prod:** merge **#36 (A)** into `main` first; then **retarget #37 (B)'s base** from `claude/transcript-fidelity` to `main` and merge it; then **reset `staging` to `main`**. (Prod auto-deploys on push to `main`.)
3. **For live titles/preview on the owner's real sessions:** owner pulls this branch's `hooks/transcript.mjs` + `hooks/sync.mjs` into their local rapid-reader clone and restarts the sync watcher (`sync-agents` / `sync.mjs --watch`).
4. **#35 dev tooling:** repo Settings → Actions → "Read and write permissions"; tick Preview-scope for env vars (`GOOGLE_CLIENT_ID`, storage tokens, `OWNER_EMAIL`); add `https://test.acb-apps.com` to the Google OAuth client's **Authorized JavaScript origins** (sign-in on test needs it).
5. Optional follow-ups discussed but not built: nothing outstanding inside A/B beyond the above.

## Other Notes
- Frontend is **buildless** vanilla JS in `public/`. `rsvp.js`/`parse.js`/`epub.js` stay pure (Node-testable). Local dev: `npm run dev` → http://localhost:3000. Tests: `npm test`.
- Sign-in is Google OIDC and is **open by design — never gate it** (see CLAUDE.md). Prod = `rapid-reader.acb-apps.com`, test = `test.acb-apps.com`.
- Methodology this wave: obra/superpowers (brainstorm → spec → plan → TDD), registered in `.claude/settings.json` on #35.
