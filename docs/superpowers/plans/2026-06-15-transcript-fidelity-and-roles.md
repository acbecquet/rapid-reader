# Transcript Fidelity & Roles — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Faithful, legible Claude Code transcripts — every turn attributed (you / Claude / tool / thinking), full messages never truncated, open transcript live-updating, look customizable per role.

**Architecture:** Capture (`hooks/transcript.mjs`) emits whole-line `[[rr:role]]` sentinels per turn; the pure parser (`public/parse.js`) tags each section with `.role` and drops tool/think from the RSVP stream; the renderer (`public/app.js` `buildTranscript`) groups same-role sections into styled turn blocks driven by per-role prefs. One markdown body format for every source; the role path only activates when sentinels are present, so books/articles/paste/old captures are byte-for-byte unchanged.

**Tech Stack:** Vanilla ES modules, no build step. Pure logic tested with `node --test`. DOM verified on the dev server + `test.acb-apps.com`.

**Spec:** `docs/superpowers/specs/2026-06-15-transcript-fidelity-and-roles-design.md`

---

## File Structure

- `hooks/transcript.mjs` (pure) — **modify**: add typed-block extraction (`blocksOf`) + sentinel emission in `compileTranscript`; replace the 60k hard-cut with a whole-turn safety trim. `oneMessage` stays (still used by `isBackground`).
- `public/parse.js` (pure) — **modify**: detect `[[rr:role]]` sentinels, stamp `.role` on every section, exclude `tool`/`think` from `readingTokens`.
- `public/app.js` (DOM) — **modify**: `buildTranscript` role-aware render; verify `itemSig` covers `words`.
- `public/style.css` — **modify**: `.turn` / `.turn-label` / per-role styling, collapsed tool/think.
- `api/_lib/prefs.js` (pure) — **modify**: `transcript` theming in defaults + merge.
- `api/prefs.js` — **modify**: accept/validate `body.transcript` on PATCH.
- `public/index.html` + `public/app.js` — **modify**: a "Transcript appearance" settings section + wiring.
- `test/transcript.test.mjs`, `test/parse.test.mjs`, `test/prefs.test.mjs` — **modify/add** tests.

---

## Task 1: Capture — typed turns + sentinels (`hooks/transcript.mjs`, pure)

**Files:**
- Modify: `hooks/transcript.mjs`
- Test: `test/transcript.test.mjs`

- [ ] **Step 1: Update existing tests + add new ones (write the failing tests)**

In `test/transcript.test.mjs`, change the faithful-conversation assertions to the sentinel format and add coverage for tool/think/no-truncation:

```js
test('compileTranscript renders a faithful, readable conversation', () => {
  const codex = jl([
    { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'add a join option for squad players' }] },
    { type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Added the join flow and a test.' }] } },
  ]);
  const { md, firstPrompt } = compileTranscript(codex);
  assert.ok(md.startsWith('[[rr:you]]\nadd a join option for squad players'));
  assert.ok(md.includes('[[rr:claude]]\nAdded the join flow'));
  assert.equal(firstPrompt, 'add a join option for squad players');
});

test('compileTranscript captures tool calls and thinking as their own turns', () => {
  const jsonl = jl([
    { type: 'user', message: { role: 'user', content: 'fix it' } },
    { type: 'assistant', message: { role: 'assistant', content: [
      { type: 'thinking', thinking: 'weighing options' },
      { type: 'text', text: 'On it.' },
      { type: 'tool_use', name: 'Bash', input: { command: 'git commit -am fix' } },
    ] } },
    { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', content: '1 file changed' }] } },
  ]);
  const { md } = compileTranscript(jsonl);
  assert.ok(md.includes('[[rr:think]]\nweighing options'));
  assert.ok(md.includes('[[rr:claude]]\nOn it.'));
  assert.ok(md.includes('[[rr:tool Bash]]\ngit commit -am fix'));
  assert.ok(md.includes('1 file changed')); // tool_result folded into the tool turn
});

test('compileTranscript keeps full text — no 60k mid-conversation cut', () => {
  const big = 'word '.repeat(20000).trim(); // ~100k chars of assistant prose
  const { md } = compileTranscript(jl([
    { role: 'user', content: 'start' },
    { role: 'assistant', content: big },
  ]));
  assert.ok(md.includes(big));            // not truncated
  assert.ok(!md.includes('trimmed'));     // ceiling not hit
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/transcript.test.mjs`
Expected: FAIL — current output uses `> ` and drops tool/think; old 60k cap not relevant yet.

- [ ] **Step 3: Implement typed-block extraction + sentinel compile**

In `hooks/transcript.mjs`, raise the cap and add the extractor + new compile. Keep `oneMessage` and `mk` as they are. Replace the `TEXT_CAP` const and `compileTranscript`:

```js
const TEXT_CAP = 1_000_000; // ~1MB safety ceiling; normal sessions never reach it

// Compact, readable summary of a tool_use input (command/desc/path/etc.).
function toolInput(input) {
  if (input == null) return '';
  if (typeof input === 'string') return input;
  const o = input;
  const pick = o.command || o.description || o.file_path || o.path || o.pattern || o.query || o.url;
  if (pick) return String(pick);
  try { return JSON.stringify(o); } catch { return ''; }
}

function toolResultText(content) {
  if (typeof content === 'string') return content.trim();
  if (Array.isArray(content)) return content.map((b) => (typeof b === 'string' ? b : (b?.text || ''))).filter(Boolean).join('\n').trim();
  return String(content?.text || '').trim();
}

// One JSONL entry → { role, blocks:[{kind:'text'|'think'|'tool'|'toolresult', text, name?}] } | null.
// Richer than oneMessage (which stays for isBackground); preserves tool/thinking turns.
export function blocksOf(entry) {
  if (!entry || typeof entry !== 'object') return null;
  const node = entry.message || entry.payload || entry;
  const type = node.type || entry.type;
  let role = node.role || entry.role;
  if (!role) {
    if (/agent|assistant/i.test(type) && (node.message || node.text)) return { role: 'assistant', blocks: [{ kind: 'text', text: String(node.message || node.text).trim() }] };
    if (/user/i.test(type) && (node.message || node.text)) return { role: 'user', blocks: [{ kind: 'text', text: String(node.message || node.text).trim() }] };
    return null;
  }
  if (role !== 'user' && role !== 'assistant') return null;
  const c = node.content;
  const blocks = [];
  const pushText = (t) => { t = String(t || '').trim(); if (t) blocks.push({ kind: 'text', text: t }); };
  if (typeof c === 'string') pushText(c);
  else if (Array.isArray(c)) {
    for (const b of c) {
      if (typeof b === 'string') { pushText(b); continue; }
      if (!b || typeof b !== 'object') continue;
      const bt = b.type || '';
      if (bt === 'thinking' || b.thinking) blocks.push({ kind: 'think', text: String(b.thinking || b.text || '').trim() });
      else if (bt === 'tool_use') blocks.push({ kind: 'tool', name: String(b.name || 'tool'), text: toolInput(b.input) });
      else if (bt === 'tool_result') blocks.push({ kind: 'toolresult', text: toolResultText(b.content) });
      else pushText(b.text || b.content);
    }
  } else if (typeof node.text === 'string') pushText(node.text);
  return blocks.length ? { role, blocks } : null;
}

// JSONL → { md, firstPrompt }. Each turn opens with a [[rr:role]] sentinel line;
// content follows verbatim. Injected context dropped. No mid-turn truncation.
export function compileTranscript(jsonl) {
  const out = [];
  let firstPrompt = '';
  for (const line of jsonl.split('\n')) {
    let entry; try { entry = JSON.parse(line); } catch { continue; }
    const t = blocksOf(entry);
    if (!t) continue;
    for (const b of t.blocks) {
      if (b.kind === 'text') {
        if (t.role === 'user') {
          if (INJECTED.test(b.text)) continue;
          if (!firstPrompt) firstPrompt = b.text.replace(/\s+/g, ' ').trim();
          out.push('[[rr:you]]\n' + b.text);
        } else {
          out.push('[[rr:claude]]\n' + b.text);
        }
      } else if (b.kind === 'think') {
        if (b.text) out.push('[[rr:think]]\n' + b.text);
      } else if (b.kind === 'tool') {
        out.push(`[[rr:tool ${b.name}]]\n` + b.text);
      } else if (b.kind === 'toolresult') {
        if (out.length && out[out.length - 1].startsWith('[[rr:tool')) out[out.length - 1] += '\n' + b.text;
        else if (b.text) out.push('[[rr:tool]]\n' + b.text);
      }
    }
  }
  let md = out.join('\n\n');
  if (md.length > TEXT_CAP) {
    const turns = md.split(/\n\n(?=\[\[rr:)/);
    while (turns.length > 1 && turns.join('\n\n').length > TEXT_CAP) turns.shift();
    md = '(earlier turns trimmed)\n\n' + turns.join('\n\n');
  }
  return { md, firstPrompt };
}
```

Then make `buildPayload`'s thin-check ignore sentinel tokens (line ~113):

```js
  if (md.replace(/\[\[rr:[^\]]*\]\]/g, '').split(/\s+/).filter(Boolean).length < 8) return null;
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test test/transcript.test.mjs`
Expected: PASS (all, including the unchanged `isBackground`/`buildPayload`/title tests).

- [ ] **Step 5: Commit**

```bash
git add hooks/transcript.mjs test/transcript.test.mjs
git commit -m "Transcript capture: typed turns + [[rr:role]] sentinels, no 60k cut"
```

---

## Task 2: Parser — role tagging + RSVP exclusion (`public/parse.js`, pure)

**Files:**
- Modify: `public/parse.js`
- Test: `test/parse.test.mjs`

- [ ] **Step 1: Write the failing tests**

Add to `test/parse.test.mjs`:

```js
const CHAT = `[[rr:you]]
fix the crash

[[rr:claude]]
Done. Here's the fix.

[[rr:tool Bash]]
git commit -am fix

[[rr:think]]
considering edge cases`;

test('parseStructure stamps role from [[rr:…]] sentinels', () => {
  const s = parseStructure(CHAT);
  assert.deepEqual(s.map((x) => x.role), ['you', 'claude', 'tool', 'think']);
  assert.equal(s[0].text, 'fix the crash');
  assert.equal(s[1].text, "Done. Here's the fix.");
});

test('readingTokens excludes tool and think turns from the RSVP stream', () => {
  const t = readingTokens(parseStructure(CHAT));
  const secs = new Set(t.map((x) => x.sec));
  assert.ok(secs.has(0) && secs.has(1));   // you + claude are read
  assert.ok(!secs.has(2) && !secs.has(3)); // tool + think are not
});

test('bodies without sentinels keep role null (legacy unchanged)', () => {
  const s = parseStructure('Just prose.\n\n> a quote');
  assert.deepEqual(s.map((x) => x.role), [null, null]);
});
```

- [ ] **Step 2: Run to verify fail**

Run: `node --test test/parse.test.mjs`
Expected: FAIL — `x.role` is `undefined`; tool/think sections still tokenized.

- [ ] **Step 3: Implement sentinel detection + role stamping**

In `public/parse.js`, add the regex near the other consts (after line 12):

```js
const SENTINEL = /^\[\[rr:(you|claude|tool|think)\b[^\]]*\]\]\s*$/;
```

In `parseStructure`, add role tracking + a stamping helper, and intercept sentinels at the top of the loop. Replace the function body's setup and the para flush so every section carries `role`:

```js
export function parseStructure(text) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const sections = [];
  let para = [];
  let role = null;
  const pushSec = (sec) => { sec.role = role; sections.push(sec); };

  const flushPara = () => {
    const t = para.join(' ').trim();
    if (t) pushSec({ type: 'paragraph', text: t, raw: para.join('\n') });
    para = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    const sm = line.match(SENTINEL);
    if (sm) { flushPara(); role = sm[1]; continue; }
    // ... (FENCE / HEADING / TABLE / BULLET / blockquote blocks unchanged,
    //      but every `sections.push(...)` becomes `pushSec(...)`)
```

Replace each `sections.push(...)` inside the loop (code, heading, table, bullets, quote) with `pushSec(...)`. Leave `flushPara()` after the loop and the helper functions as-is.

Update `readingTokens` to skip collapsed roles:

```js
export function readingTokens(sections) {
  const tokens = [];
  sections.forEach((s, sec) => {
    if (s.role === 'tool' || s.role === 'think') return; // collapsed, never RSVP'd
    if (s.type === 'code') {
      tokens.push({ w: s.text, sec, code: true, paraEnd: true, sentenceEnd: true });
      return;
    }
    for (const t of tokenize(s.text)) tokens.push({ ...t, sec });
    if (tokens.length) tokens[tokens.length - 1].paraEnd = true;
  });
  return tokens;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `node --test test/parse.test.mjs`
Expected: PASS (legacy tests unaffected — they only assert `.type`/`.text`).

- [ ] **Step 5: Commit**

```bash
git add public/parse.js test/parse.test.mjs
git commit -m "Parser: stamp section .role from sentinels; drop tool/think from RSVP"
```

---

## Task 3: Render — role-aware transcript (`public/app.js` + `public/style.css`, verify live)

**Files:**
- Modify: `public/app.js` (`buildTranscript`, ~626-675; add `stripFence` helper)
- Modify: `public/style.css` (after the `#transcript p.quote` block, ~376)

- [ ] **Step 1: Replace `buildTranscript` with the role-aware renderer**

Role mode activates only when a section has `.role`; otherwise the legacy path (quote→`.you`) runs verbatim. Tool/think render as collapsed `<details>` from `raw` (they carry no tokens):

```js
function buildTranscript() {
  const box = $('transcript');
  box.textContent = '';
  nowSpan = null;
  const bySec = cur.sections.map(() => []);
  cur.tokens.forEach((t, i) => bySec[t.sec].push([t, i]));
  const hasRoles = cur.sections.some((s) => s.role);
  const theme = (prefs.transcript && prefs.transcript.roles) || {};
  let turn = box, turnRole;

  cur.sections.forEach((sec, idx) => {
    if (hasRoles && sec.role !== turnRole) {
      turnRole = sec.role;
      const th = sec.role ? (theme[sec.role] || {}) : null;
      if (th && th.show === false) { turn = null; }
      else {
        turn = document.createElement('div');
        turn.className = 'turn' + (sec.role ? ' ' + sec.role : '');
        if (th) {
          if (th.box) turn.classList.add('boxed');
          if (th.align) turn.style.textAlign = th.align;
          if (th.color) turn.style.color = th.color;
          const lbl = document.createElement('span');
          lbl.className = 'turn-label';
          lbl.textContent = th.label || sec.role;
          turn.append(lbl);
        }
        box.append(turn);
      }
    }
    if (!turn) return; // hidden role

    if (sec.role === 'tool' || sec.role === 'think') {
      const det = document.createElement('details');
      det.open = (theme[sec.role] || {}).collapsed === false;
      const sum = document.createElement('summary');
      sum.textContent = (sec.role === 'tool' ? '⚙ ' : '◇ ') + (sec.type === 'code' ? 'code' : (sec.text || '').slice(0, 64));
      const pre = document.createElement('pre');
      pre.textContent = sec.type === 'code' ? stripFence(sec.raw) : (sec.raw || sec.text || '');
      det.append(sum, pre);
      turn.append(det);
      return;
    }

    if (sec.type === 'code') {
      const pre = document.createElement('pre');
      pre.textContent = stripFence(sec.raw);
      if (bySec[idx][0]) pre.dataset.i = bySec[idx][0][1];
      turn.append(pre);
      return;
    }
    if (!bySec[idx].length) return;

    const para = document.createElement('p');
    if (sec.type === 'heading') para.className = 'h';
    else if (!hasRoles && sec.type === 'quote') {
      if (AGENT_SOURCES.has(cur.item.sourceType)) {
        para.className = 'you';
        const lbl = document.createElement('span');
        lbl.className = 'you-label';
        lbl.textContent = 'You wrote:';
        para.append(lbl);
      } else para.className = 'quote';
    }
    for (const [t, i] of bySec[idx]) {
      const s = document.createElement('span');
      s.textContent = t.w;
      s.dataset.i = i;
      if (t.link) s.classList.add('link');
      para.append(s, ' ');
    }
    turn.append(para);
  });

  box.onclick = (e) => {
    const el = e.target.closest('[data-i]');
    if (!el) return;
    const i = Number(el.dataset.i);
    const tok = cur?.tokens[i];
    if (tok?.link) return openLinkModal(linkHref(tok.w));
    seek(i);
  };
  applyTranscript();
}

function stripFence(raw) {
  return (raw || '').replace(/^\s*(```|~~~).*\n?/, '').replace(/\n?\s*(```|~~~)\s*$/, '');
}
```

- [ ] **Step 2: Add the role styles to `public/style.css`** (after line ~376)

```css
#transcript .turn { margin: 0 0 14px; }
#transcript .turn-label { display: block; font-size: 10px; text-transform: uppercase; letter-spacing: .08em; opacity: .55; margin-bottom: 3px; }
#transcript .turn.boxed { background: color-mix(in srgb, var(--accent) 10%, transparent); border: 1px solid var(--line); border-radius: 8px; padding: 8px 10px; }
#transcript .turn.claude { color: var(--reader-fg); }
#transcript .turn.tool, #transcript .turn.think { opacity: .7; }
#transcript .turn details > summary { cursor: pointer; color: var(--dim); font-size: 12px; list-style: none; }
#transcript .turn details > summary::-webkit-details-marker { display: none; }
#transcript .turn details[open] > summary { color: var(--reader-fg); }
#transcript .turn details pre { margin: 6px 0 0; }
```

- [ ] **Step 3: Verify on the dev server**

Run: `npm run dev`, open http://localhost:3000, POST a sample agent transcript (use `curl` against `/api/items` with a body containing `[[rr:you]]…[[rr:claude]]…[[rr:tool Bash]]…[[rr:think]]…`), open it.
Expected: your turn left in a labelled box, Claude distinct, tool/thinking collapsed; clicking a word still seeks; non-agent items (paste an article) look exactly as before.

- [ ] **Step 4: Commit**

```bash
git add public/app.js public/style.css
git commit -m "Transcript render: role turns (you boxed, Claude distinct, tool/think collapsed)"
```

---

## Task 4: Live-update — verify + sign on `words` (`public/app.js`)

**Files:**
- Modify (if needed): `public/app.js` (`itemSig`)

- [ ] **Step 1: Confirm `itemSig` changes when a session grows**

Find `itemSig` (used at `refresh:155`, `openItem:935`). Confirm it incorporates a field that advances on upsert — `words` and/or `createdAt`. If it does **not** include `words`, add it so a re-synced transcript triggers `liveUpdateOpen`. Example shape:

```js
const itemSig = (it) => [it.id, it.title, it.words, it.readAt, it.progress, it.archivedAt].join('|');
```

- [ ] **Step 2: Verify the live path end-to-end**

On the dev server: open an agent item, then POST the same `sessionId` with a longer body (simulating `sync.mjs --watch`). Within one poll (~4s) the open transcript should grow in place without moving your word position or pausing.
Expected: new turns appear; `cur.i` preserved (`liveUpdateOpen:995`).

- [ ] **Step 3: Commit (only if `itemSig` changed)**

```bash
git add public/app.js
git commit -m "Live-update: ensure itemSig tracks word growth so open transcripts refresh"
```

---

## Task 5: Per-role theming prefs (`api/_lib/prefs.js` + `api/prefs.js`, pure)

**Files:**
- Modify: `api/_lib/prefs.js`, `api/prefs.js`
- Test: `test/prefs.test.mjs`

- [ ] **Step 1: Write the failing test**

Add to `test/prefs.test.mjs`:

```js
test('defaultPrefs ships transcript role theming; merge fills gaps', () => {
  const d = defaultPrefs();
  assert.equal(d.transcript.roles.you.align, 'left');
  assert.equal(d.transcript.roles.you.box, true);
  assert.equal(d.transcript.roles.tool.collapsed, true);
  const m = mergePrefs({ transcript: { roles: { claude: { color: '#abc' } } } });
  assert.equal(m.transcript.roles.claude.color, '#abc'); // override kept
  assert.equal(m.transcript.roles.you.label, 'You');     // default preserved
});
```

- [ ] **Step 2: Run to verify fail**

Run: `node --test test/prefs.test.mjs`
Expected: FAIL — `d.transcript` is undefined.

- [ ] **Step 3: Implement defaults + merge**

In `api/_lib/prefs.js`:

```js
export function defaultTranscript() {
  return { roles: {
    you:    { label: 'You',      align: 'left', color: '', box: true,  show: true },
    claude: { label: 'Claude',   align: 'left', color: '', box: false, show: true },
    tool:   { label: 'tool',     align: 'left', color: '', show: true, collapsed: true },
    think:  { label: 'thinking', align: 'left', color: '', show: true, collapsed: true },
  } };
}

function mergeTranscript(stored) {
  const d = defaultTranscript();
  if (!stored || !stored.roles) return d;
  for (const r of Object.keys(d.roles)) d.roles[r] = { ...d.roles[r], ...(stored.roles[r] || {}) };
  return d;
}
```

Add `transcript: defaultTranscript(),` to `defaultPrefs()`'s return, and `transcript: mergeTranscript(stored.transcript),` to `mergePrefs()`'s return. (`publicPrefs` already spreads everything except `geminiKey`, so the client receives `transcript` automatically.)

- [ ] **Step 4: Validate on PATCH** in `api/prefs.js` (after the `columns` block, ~35):

```js
if (body.transcript && body.transcript.roles) {
  const roles = {};
  for (const r of ['you', 'claude', 'tool', 'think']) {
    const v = body.transcript.roles[r] || {};
    roles[r] = {
      label: String(v.label || r).slice(0, 24),
      align: ['left', 'right', 'center'].includes(v.align) ? v.align : 'left',
      color: String(v.color || '').slice(0, 24),
      box: !!v.box,
      show: v.show !== false,
      collapsed: v.collapsed !== false,
    };
  }
  prefs.transcript = { roles };
}
```

- [ ] **Step 5: Run to verify pass**

Run: `node --test test/prefs.test.mjs test/api.test.mjs`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add api/_lib/prefs.js api/prefs.js test/prefs.test.mjs
git commit -m "Prefs: per-role transcript theming (defaults, merge, PATCH validation)"
```

---

## Task 6: Transcript appearance settings panel (`public/index.html` + `public/app.js`, verify live)

**Files:**
- Modify: `public/index.html` (settings modal), `public/app.js` (wiring)

- [ ] **Step 1: Add a settings section** in `index.html`'s settings modal:

```html
<h3 class="s-h">Transcript appearance</h3>
<p class="hint">How agent chats look — your turns, Claude's, tools, and thinking.</p>
<div id="s-roles"></div>
```

- [ ] **Step 2: Render per-role controls + persist** in `app.js`. Build rows from `prefs.transcript.roles`; on change, PATCH and re-render the open transcript:

```js
function renderRoleSettings() {
  const box = $('s-roles');
  const roles = (prefs.transcript && prefs.transcript.roles) || {};
  box.textContent = '';
  for (const r of ['you', 'claude', 'tool', 'think']) {
    const v = roles[r] || {};
    const row = document.createElement('div');
    row.className = 'role-row';
    row.innerHTML = `
      <b>${r}</b>
      <label><input type="checkbox" data-k="show" ${v.show !== false ? 'checked' : ''}> show</label>
      <input data-k="label" value="${v.label || r}" maxlength="24" class="num">
      <select data-k="align"><option ${v.align==='left'?'selected':''}>left</option><option ${v.align==='center'?'selected':''}>center</option><option ${v.align==='right'?'selected':''}>right</option></select>
      <input type="color" data-k="color" value="${v.color || '#cfe8d8'}">
      <label><input type="checkbox" data-k="box" ${v.box ? 'checked' : ''}> box</label>`;
    row.onchange = (e) => {
      const k = e.target.dataset.k; if (!k) return;
      const val = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
      prefs.transcript.roles[r] = { ...prefs.transcript.roles[r], [k]: val };
      api('PATCH', 'prefs', { body: { transcript: prefs.transcript } }).catch(() => {});
      if (cur) buildTranscript();
    };
    box.append(row);
  }
}
```

Call `renderRoleSettings()` where the settings modal opens (alongside the existing settings population), and ensure `prefs.transcript` exists (it arrives from the poll once Task 5 ships).

- [ ] **Step 3: Minimal styling** in `style.css`:

```css
.role-row { display: flex; align-items: center; gap: 6px; margin: 5px 0; font-size: 11px; flex-wrap: wrap; }
.role-row input.num { width: 90px; }
```

- [ ] **Step 4: Verify on the dev server** — open settings, change your-role to right-aligned / recolor Claude / hide thinking; confirm the open transcript updates immediately and the choice survives a reload (persisted in prefs).

- [ ] **Step 5: Commit**

```bash
git add public/index.html public/app.js public/style.css
git commit -m "Settings: Transcript appearance panel (per-role show/label/align/color/box)"
```

---

## Self-Review

- **Spec coverage:** role tagging end-to-end (T1-3) ✓; truncation removed (T1) ✓; live-update verified/hardened (T4) ✓; per-role customization (T5-6) ✓; backward-compat via the `hasRoles`/no-sentinel guard (T2-3) ✓; tool summary + you/Claude both in RSVP (T1-2, matches the two confirmed defaults) ✓.
- **Placeholders:** none — every code step carries real code.
- **Type consistency:** `blocksOf` block kinds (`text|think|tool|toolresult`) ↔ sentinels (`you|claude|tool|think`) ↔ section `.role` (`you|claude|tool|think|null`) ↔ prefs `roles.{you,claude,tool,think}` are consistent across tasks.

## Non-goals (tracked, not built here)

- Backlog organization (delete/drag/rename) → spec B.
- Codex faithful tool/think (its JSONL rarely exposes those blocks) — `blocksOf` handles them if present; no special-casing.
- MCP summary path unchanged.
