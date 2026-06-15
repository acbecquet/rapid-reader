# Backlog Organization — Design

**Status:** draft for review · **Date:** 2026-06-15 · **Sub-project:** B (A = transcript, shipped on #36)

## Goal

Make the backlog directly manageable and forgiving: **delete** (recoverably), **drag-reorder** by hand, **rename** items and subgroups, **theme** columns, and see each live session's **latest activity** at a glance. Design tenet (your call): *nothing destructive without an escape hatch.*

## Background — current model (from the audit)

- Rendering is client-side: `renderColumns` → `renderColBody` → `itemRow` (`public/app.js`). Order within a column = `createdAt` desc (books use `chapterIndex`). **No manual-order field.**
- **Delete is a hard delete** (`DELETE /api/items` removes the stub + body). **Archive** (`archivedAt`) hides without destroying.
- Title override = `PATCH {title}`; `group` is a derived field; collapse state is keyed `columnId/groupName` in localStorage.
- Titles now auto-set to *your most recent prompt* (sub-project A) and update on each sync — so a **manual rename must pin** the title or the next sync/heal clobbers it.

## Decisions (locked in brainstorm)

1. **Delete = soft-delete + Undo toast + "Recently deleted" (Trash)**, ~30-day recovery, permanent erase only from Trash. The soft-delete doubles as a **tombstone** (a re-synced deleted session stays deleted).
2. **Drag-reorder within a column**; the first drag **pins** that column to manual order (new items append at top, don't reshuffle; a "↻ recent" reset clears it).
3. **Rename items** (pinned title) **and subgroups** (alias — items keep their real group, new items inherit the alias, survives live updates).
4. **Rich per-column theming**: name / icon / color / density.
5. **Live preview line**: a dim second line = the session's latest turn ("where we are now"), paired with the title (your recent prompt).
6. **Graceful edge-cases**: rename-to-empty reverts, an invalid drag snaps back, bulk actions are one Undo.

## Data-model changes

**Stub** gains (all optional, lean):
- `deletedAt: number|null` — soft-delete timestamp (body retained until erase/purge).
- `order: number` — manual position within a column (lower = higher).
- `titlePinned: true` — set on manual rename; auto-titling skips it.
- `preview: string` — short latest-turn snippet for the second line.

**Prefs** gains:
- `groupAliases: { [realGroup]: alias }` — subgroup relabels.
- Column model extends with `color?` and `density?` (`name`/`icon`/`sources` already exist).

**API** (`api/items.js`, `api/_lib/ingest.js`, `api/_lib/store.js`):
- `DELETE` → **soft** by default (`deletedAt = now`); permanent erase via `?hard=1` (used only by Trash "erase" + purge).
- `GET` → excludes `deletedAt` items from the main index; returns them only for the Trash view (`?trash=1`).
- `PATCH` → supports `deletedAt` (restore = `null`), `order`, `titlePinned`.
- `ingest.addItem` upsert → preserves `deletedAt` (tombstone) and `titlePinned` (don't clobber a pinned title); sets `preview` from the payload.

## Per-feature design (phased — each phase ships + verifies on test)

### Phase 1 — Soft-delete + Undo + Trash *(safety net first)*
- Delete sets `deletedAt`, hides the item, shows a **"Deleted · Undo"** toast (~8s → `PATCH deletedAt:null`).
- A **Recently-deleted** view (a toggle in the ⋯ menu or a pseudo-column) lists `deletedAt` items, newest first, with **Restore** and **Erase** (`?hard=1`).
- **Auto-purge** items older than 30 days (lazy, on poll).
- **Tombstone:** a re-synced soft-deleted session keeps `deletedAt` (stays gone) until restored.
- Bulk delete = one toast for the batch.

### Phase 2 — Rename items + subgroup alias
- Double-click an item title → inline `contenteditable`; **Enter** saves (`PATCH {title, titlePinned:true}`); **Esc**/empty reverts. Pinned titles are skipped by the auto-title (capture + heal check `titlePinned`).
- Double-click a group header → inline edit → saves `prefs.groupAliases[realGroup]`; render shows the alias; new items in that group inherit it; collapse-state key migrates to the alias.
- Edge: empty reverts; names clamped to ~60 chars.

### Phase 3 — Drag-reorder + manual pin
- Items become `draggable`; drop within a column writes `order` on the moved item (and renormalizes neighbors); the column enters **manual mode** (inferred from any item having `order`, or a `prefs` flag).
- In manual mode, new/updated items append at the top without reshuffling your arrangement; a **"↻ recent"** affordance per column clears `order` (back to recency sort).
- Edge: **within-column only** in v1 (cross-column drag would change source→column routing — out of scope); an invalid drop snaps back.

### Phase 4 — Per-column theming
- Extend the existing column-config modal with **color** + **density**; `renderColBody`/`itemRow` apply them via CSS vars/classes.

### Phase 5 — Live preview line
- Capture (`transcript.mjs`) computes `preview` = the latest turn snippet (most recent assistant turn, else latest), short; carried on the stub.
- `itemRow` renders a dim second line = `preview` for agent items. Existing items get it client-derived in the background (same capped pass as the title heal) until they re-sync.
- Result: **title = your most recent prompt, preview = where the session is now** — your Q1 split, realized.

## Error handling / graceful edges

- Delete is always recoverable (Undo + Trash); permanent erase is explicit.
- Restore of a session whose project/group no longer exists → lands ungrouped in its column.
- Rename-to-empty / whitespace → revert. Drag onto an invalid target → snap back.
- Manual order + a brand-new item → item appears at top, arrangement intact.

## Testing

- **Pure (unit):** `ingest` soft-delete/restore/tombstone + `titlePinned` preservation; `store` order persistence; `prefs` `groupAliases` merge; `transcript` preview extraction.
- **API:** `DELETE` soft vs `?hard=1`; `GET` excludes deleted / `?trash=1` returns them; `PATCH` `order`/`titlePinned`/`deletedAt`.
- **DOM (drag, inline rename, Trash, theming):** verified on the dev server + `test.acb-apps.com` (no headless DOM tests here).

## Non-goals

- Cross-column drag (it changes source routing — separate concern).
- Nested/hierarchical groups.
- AI anything (titles are your most recent prompt; no LLM).
