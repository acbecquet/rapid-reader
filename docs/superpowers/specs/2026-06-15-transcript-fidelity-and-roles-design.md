# Transcript Fidelity & Roles — Design

**Status:** draft for review · **Date:** 2026-06-15 · **Sub-project:** A (of A=transcript, B=backlog)

## Goal

Make Claude Code transcripts in Rapid Reader *faithful and legible*: every turn
correctly attributed (you / Claude / tool / thinking), your full messages never
truncated, the open transcript live-updating from the capture pipeline, and the
look richly customizable per role. Success = "get the exact text from Claude,
put it in the reader, and let me always tell my words from Claude's."

## Background — what's broken today (from the code audit)

- **Roles are lost.** `hooks/transcript.mjs:93-99` prefixes *user* turns with
  `> ` but emits *assistant* turns as bare prose with **no marker**. After
  `public/parse.js`, Claude's text is an ordinary `paragraph`, visually identical
  to body text and to `#` headings → the "who-wrote-this?" confusion.
- **Your turns render right-aligned.** `public/app.js` styles `>`-quotes as
  `.you` (right-aligned, "You wrote:") in agent sources — the opposite of the
  left-justify you want, and only *user* turns get any treatment at all.
- **Hard truncation.** `hooks/transcript.mjs:103` caps the compiled body at
  `TEXT_CAP = 60000` and keeps only the **last** 60k chars — earlier conversation
  is silently dropped.
- **Live-update is partial.** `app.js` `liveUpdateOpen()` re-parses an open item
  on the ~4s poll *when the body changed*, but only the `sync.mjs --watch`
  watcher (or the Stop hook) pushes new bodies; nothing is verified end-to-end,
  and refresh keys off body-diff rather than the stub's `words`/timestamp.
- **No per-role customization** exists.

## Decisions (locked in brainstorm)

1. Build transcript sub-project **first**.
2. Render: **your messages left-justified in a labelled tinted box; Claude
   distinct; tool-calls & thinking collapsed** (never RSVP'd word-by-word).
3. Architecture **A — role markers in the markdown** (not a JSON body fork).
4. **Rich per-role customization** (color / alignment / label / show-hide).
5. **Never truncate a turn**; remove the 60k cut.

## Architecture

### The role-marker syntax (the heart of approach A)

Capture emits a **sentinel line** to open each turn; the turn's content runs
until the next sentinel or EOF. Sentinel grammar (must be the whole line):

```
[[rr:you]]
[[rr:claude]]
[[rr:tool <label>]]      e.g. [[rr:tool Bash]]
[[rr:think]]
```

Detection regex (parse side): `^\[\[rr:(you|claude|tool|think)\b([^\]]*)\]\]$`.

Rationale: a whole-line `[[rr:…]]` token is collision-free against prose and
even against code/diff lines (`@@ -1 +1 @@`, `[[wiki]]`) because it must match
the *entire* line; it stays inside the one markdown body format (books,
articles, paste are never touched); and it's human-readable in the raw "source"
view.

### Data flow (raw JSONL → reader)

```
Claude/Codex JSONL
  └─ hooks/transcript.mjs  ── typed turns ──▶  markdown body w/ [[rr:…]] sentinels
       └─ POST /api/items (sessionId upsert)  ──▶  Blob/Redis body  (NO 60k cut)
            └─ GET /api/items?id=             ──▶  body text
                 └─ public/parse.js           ──▶  sections, each tagged .role
                      ├─ RSVP tokens: you+claude only (tool/think excluded, like code)
                      └─ app.js buildTranscript: group consecutive same-role
                         sections into a styled "turn" block, per-role prefs
```

### Section model change (minimal)

`parse.js` keeps its **flat section array**; we add **one field**: `role`
(`'you'|'claude'|'tool'|'think'|null`). The parser tracks `currentRole` (set by
the most recent sentinel, default `null`), tags every emitted section with it,
and does **not** emit a section for the sentinel line itself. Non-agent content
has `role:null` everywhere → renders exactly as today.

**Activation guard:** the role pipeline only engages when the body contains at
least one `[[rr:…]]` sentinel. Bodies without sentinels (old captures, articles,
books, paste) take the legacy path untouched — zero regression, gradual upgrade
as sessions re-sync.

## Components (files to touch)

### `hooks/transcript.mjs` (pure, unit-tested) — capture fidelity
- Expand `oneMessage()` → preserve **block types** within a JSONL message:
  assistant `text`, assistant `tool_use`, user `tool_result`, and `thinking`
  blocks (today they're flattened to one `{role,text}`).
- `compileTranscript()` emits a sentinel per turn:
  - user text → `[[rr:you]]` + verbatim text
  - assistant text → `[[rr:claude]]` + verbatim text
  - assistant `tool_use` → `[[rr:tool <name>]]` + a compact input summary
  - user `tool_result` → folded into the preceding `[[rr:tool …]]` block
  - `thinking` → `[[rr:think]]` + verbatim text
- **Remove the `TEXT_CAP` hard slice.** Keep full text. Retain only a generous
  safety ceiling (drop *whole oldest turns* with a visible
  `(earlier turns trimmed)` note, never mid-turn) to avoid pathological blobs —
  ceiling set high (≈1 MB) so normal sessions are never cut.
- Title derivation (12 words/90 chars) is unchanged — that's the backlog label,
  not the body.

### `public/parse.js` (pure, unit-tested) — typed sections
- Recognize sentinel lines; maintain `currentRole`; add `role` to every section.
- Code fences inside a turn stay code sections (already handled) and inherit the
  turn's role.
- Expose role so the tokenizer can exclude `tool`/`think` from the RSVP stream
  (same mechanism that already excludes code placeholders).

### `public/app.js` — render + live-update + settings
- `buildTranscript()`: walk sections; when `role` changes, open a new `.turn`
  block with the role's class, label chip, and per-role prefs (align/color/box);
  render `tool`/`think` blocks **collapsed** (click to expand). Legacy bodies
  (no roles) use the current renderer.
- RSVP tokenizer: skip `role∈{tool,think}` sections; keep `you`+`claude`.
- `liveUpdateOpen()`: refresh the open item when the stub's `words`/timestamp
  advances (not only on body-diff); preserve reading position; rebuild the
  transcript in place.
- New **Transcript appearance** section in the settings modal (see prefs below).

### `public/style.css`
- `.turn.you / .turn.claude / .turn.tool / .turn.think` styles; collapsed
  tool/think affordance; the labelled tinted box for `you`. Driven by CSS custom
  properties so prefs can override at runtime.

### `api/_lib/prefs.js` + `api/prefs.js`
- Add `transcript` theming to prefs defaults + accept/validate on PATCH.

## Prefs / data model

```js
prefs.transcript = {
  roles: {
    you:    { label: "You",      align: "left", color: "#e6e6ea", box: true,  show: true },
    claude: { label: "Claude",   align: "left", color: "#cfe8d8", box: false, show: true },
    tool:   { label: "tool",     align: "left", color: "#8a8a96", show: true, collapsed: true },
    think:  { label: "thinking", align: "left", color: "#8a8a96", show: true, collapsed: true },
  }
}
```

`align ∈ left|right|center`; `color` = text color; `box` = tinted bordered card;
`show=false` hides the role entirely; `collapsed` = start folded. Stored in
`rr:prefs[:uid]`, redacted of nothing new. Defaults give you **both turns
left-justified, you in a box with a "You" label, Claude in a distinct tint** —
the exact distinction you asked for, customizable from there.

## Error handling

- Unknown/malformed sentinel → rendered as literal text (no throw).
- No sentinels in body → legacy path (protects articles/books/old captures).
- `tool_result` with no preceding `tool_use` → its own `[[rr:tool]]` block.
- Live-update race (item closed mid-refresh) → no-op guard, as today.

## Testing (TDD — pure layers first)

- `test/` for `hooks/transcript.mjs`: feed sample Claude JSONL containing user
  text, assistant text + `tool_use`, `tool_result`, and `thinking` → assert the
  emitted markdown has the right sentinels in order, **full** text (no 60k cut),
  and a compact tool summary.
- `test/` for `public/parse.js`: feed markdown with sentinels → assert each
  section's `role`; assert `tool`/`think` excluded from the RSVP token source;
  assert a no-sentinel body is byte-for-byte the legacy section list.
- DOM rendering + settings: verified on the dev server and on `test.acb-apps.com`
  (no headless DOM tests in this repo today).

## Non-goals (this spec)

- **Backlog organization** (delete/drag/rename) → separate spec B.
- **MCP server** changes — it pushes plain summaries, not turns; unaffected.
- **Codex** faithful roles — Claude first; Codex inherits the same parser if its
  JSONL exposes the block types (stretch, noted in the plan).

## Open questions for review

1. Tool block content: compact summary (`Bash: git push…`) vs. the full command
   + first lines of output? Default proposed: **command/desc + a few result
   lines**, expandable.
2. Should `you`+`claude` both feed the RSVP word-stream (proposed **yes** — it's
   a conversation), or Claude-only?
