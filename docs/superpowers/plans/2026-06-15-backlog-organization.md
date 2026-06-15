# Backlog Organization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (inline, phase-by-phase). Steps use `- [ ]`. Each phase ships, tests green, and is verifiable on test.acb-apps.com before the next.

**Goal:** Directly manageable, forgiving backlog — soft-delete+Undo+Trash, drag-reorder with pinning, rename items+subgroups, per-column theming, and a live preview line.

**Architecture:** Lean stub gains `deletedAt`/`order`/`titlePinned`/`preview`; prefs gain `groupAliases` + column `color`/`density`. Delete is soft by default; auto-titling skips pinned titles; manual `order` pins a column's sort.

**Tech Stack:** Vanilla ES modules, no build. Pure logic via `node --test`; DOM verified on the dev server + test.

**Spec:** `docs/superpowers/specs/2026-06-15-backlog-organization-design.md`

## File Structure
- `api/_lib/ingest.js` — upsert preserves `deletedAt`/`titlePinned`; carries `preview`.
- `api/items.js` — `DELETE` soft (default) vs `?hard=1`; `GET` excludes deleted (`?trash=1` returns them) + lazy purge; `PATCH` `deletedAt`/`order`/`titlePinned`.
- `api/_lib/prefs.js` + `api/prefs.js` — `groupAliases`; column `color`/`density`.
- `hooks/transcript.mjs` — compute `preview` (latest turn).
- `public/app.js` — soft-delete + Undo + Trash view; inline rename (items+groups); drag-reorder; column theming; preview line; background preview-derive.
- `public/style.css` — trash/undo, drag affordances, density, preview line.
- `public/index.html` — Trash entry + column-config color/density.
- `test/` — ingest, api, prefs, transcript additions.

---

## Phase 1 — Soft-delete + Undo + Trash

**Files:** `api/items.js`, `api/_lib/ingest.js`, `test/api.test.mjs`, `public/app.js`, `public/style.css`, `public/index.html`

- [ ] **Step 1: Tests (write failing)** — `test/api.test.mjs`: DELETE soft-sets `deletedAt` + body kept + excluded from GET; `?hard=1` removes; PATCH `deletedAt:null` restores; `?trash=1` returns deleted.
- [ ] **Step 2: Run → fail.** `node --test test/api.test.mjs`
- [ ] **Step 3: `api/items.js`** — `DELETE`: if `?hard=1` (or body `hard`), remove stub+body (current behavior); else set `deletedAt = Date.now()` and persist (keep body). `GET`: filter `!it.deletedAt` for the index; when `req.query.trash` return only `deletedAt` items (newest first); lazy purge `deletedAt < now-30d` (hard-remove). `PATCH`: allow `deletedAt` (number|null).
- [ ] **Step 4: `api/_lib/ingest.js`** — in the sessionId upsert, carry `if (prev.deletedAt) item.deletedAt = prev.deletedAt` (tombstone) unless explicitly restored.
- [ ] **Step 5: Run → pass.**
- [ ] **Step 6: `public/app.js`** — selbar Delete + per-row delete → `PATCH {deletedAt:Date.now()}` (not hard DELETE); optimistic hide; `toast('Deleted · Undo', …)` with an Undo that PATCHes `deletedAt:null`. A Trash view (⋯ → "Recently deleted") that fetches `?trash=1`, lists with Restore (`deletedAt:null`) / Erase (`DELETE ?hard=1`).
- [ ] **Step 7: css/html** — toast Undo button, trash list styling, ⋯ menu entry.
- [ ] **Step 8: Verify on dev server**, commit.

```bash
git commit -m "Backlog: soft-delete + Undo + Recently-deleted (recoverable, tombstoned)"
```

## Phase 2 — Rename items + subgroup alias

**Files:** `api/items.js`, `api/_lib/ingest.js`, `api/_lib/prefs.js`, `api/prefs.js`, `hooks/transcript.mjs` (skip pinned), `public/app.js`, `test/*`

- [ ] **Step 1: Tests** — prefs `groupAliases` merge; ingest upsert keeps `titlePinned` + doesn't overwrite a pinned title.
- [ ] **Step 2: Run → fail.**
- [ ] **Step 3:** `api/items.js` PATCH accepts `titlePinned`; `ingest` upsert: `if (prev.titlePinned) { item.title = prev.title; item.titlePinned = true; }`. `prefs.js`/`api/prefs.js`: `groupAliases` (object, clamped).
- [ ] **Step 4:** `public/app.js` — `itemRow` title double-click → inline `contenteditable`; Enter → `PATCH {title, titlePinned:true}`; Esc/empty revert. Group header double-click → inline edit → `PATCH /api/prefs {groupAliases:{[real]:alias}}`; render shows alias (lookup in `renderColBody`); collapse-key uses real group still.
- [ ] **Step 5: Run → pass; verify; commit.**

## Phase 3 — Drag-reorder + manual pin

**Files:** `api/items.js`, `public/app.js`, `public/style.css`, `test/*`

- [ ] **Step 1: Tests** — `PATCH {order}` persists; GET preserves it.
- [ ] **Step 2–3:** `itemRow` `draggable=true`; dragstart stores id; drop on a row computes a new `order` (midpoint of neighbors) → `PATCH {order}`. `renderColBody`: when any item in the column has `order`, sort by `order` (asc) then `createdAt`; new items (no `order`) sort to top. A per-column "↻" clears `order` on all its items.
- [ ] **Step 4:** css drag affordances (`.dragging`, drop indicator).
- [ ] **Step 5: verify; commit.**

## Phase 4 — Per-column theming

**Files:** `api/_lib/prefs.js`, `api/prefs.js`, `public/app.js`, `public/style.css`, `public/index.html`, `test/*`

- [ ] Column model + validation gain `color` (string) + `density` (`'cozy'|'compact'`). Column-config modal adds a color input + density toggle. `renderColBody`/`itemRow` apply `--col-accent` + a `.compact` class. Test prefs validation; verify; commit.

## Phase 5 — Live preview line

**Files:** `hooks/transcript.mjs`, `api/_lib/ingest.js`, `api/items.js`, `public/app.js`, `public/parse.js` (reuse), `public/style.css`, `test/*`

- [ ] `transcript.mjs`: compute `preview` = latest turn snippet (last assistant turn, else last turn; ~80 chars), return from `buildPayload`. `ingest`/`items` carry `preview` on the stub. `itemRow`: dim second line = `preview` for agent items. Background derive for existing items (extend the title-heal pass to also set a client preview via a `derivedPreview(text)` in parse.js). Test preview extraction; verify; commit.

---

## Self-Review
- Spec coverage: delete/undo/trash (P1), rename+alias (P2), drag+pin (P3), theming (P4), preview (P5), graceful edges throughout ✓.
- Field consistency: `deletedAt`/`order`/`titlePinned`/`preview` used identically across ingest/items/app ✓.
- No placeholders in executed steps (code written at build time per file).

## Execution
Inline, phase by phase; `npm test` green per phase; push branch + mirror to `staging` after each phase so test.acb-apps.com tracks progress; final report when all 5 land.
