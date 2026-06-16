import * as R from './rsvp.js';
import * as P from './parse.js';
import * as E from './epub.js';
import { icon } from './icons.js';

const $ = (id) => document.getElementById(id);

// Visible build stamp. Bump on every deploy, in lockstep with the ?v= query on
// app.js/style.css in index.html and the CACHE name in sw.js — so a stale cache
// is instantly distinguishable from a real bug on test/prod (see CLAUDE.md).
const BUILD = '20260616b';

// On phones the RSVP reader takes the whole screen; the backlog and transcript
// live behind toggles instead of splitting the small viewport. This gates those.
const isMobile = () => matchMedia('(max-width: 640px)').matches;

// ---------- settings ----------
const DEFAULTS = {
  font: 'system-ui, sans-serif',
  size: 42,
  color: '#eaeaea',
  bg: '#101014',
  wpm: 600,
  mode: 'standard', // 'standard' | 'build'
  buildStep: 20, // build mode: wpm added each interval
  buildEvery: 15, // build mode: interval in seconds
  autoplay: false, // open an item already playing (vs. paused) when you click it
  keepOpen: true, // keep the backlog visible while reading
  aiDisabled: false, // master off-switch: skip every AI call, pass raw text through
  transcript: true, // live transcript pane that follows the current word
  blinkCues: false, // eye relief: gentle nudge to blink while reading
  breakReminders: false, // eye relief: pause for a periodic look-away break
  breakEvery: 20, // eye relief: minutes of reading between look-away breaks
  token: '',
  account: null, // { name, email } when signed in with Google
};
let settings = { ...DEFAULTS, ...JSON.parse(localStorage.getItem('rr:settings') || '{}') };

function saveSettings() {
  localStorage.setItem('rr:settings', JSON.stringify(settings));
  applySettings();
}

function applySettings() {
  const s = document.documentElement.style;
  s.setProperty('--reader-font', settings.font);
  s.setProperty('--reader-size', settings.size + 'px');
  s.setProperty('--reader-fg', settings.color);
  s.setProperty('--reader-bg', settings.bg);
}

// ---------- api ----------
async function api(method, path, { body, query, keepalive } = {}) {
  const qs = query ? '?' + new URLSearchParams(query) : '';
  const res = await fetch('api/' + path + qs, {
    method,
    keepalive,
    headers: {
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(settings.token ? { authorization: 'Bearer ' + settings.token } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    let msg = '';
    try { msg = (await res.json()).error; } catch {}
    throw Object.assign(new Error(msg || 'api ' + res.status), { code: res.status });
  }
  return res.json();
}

// ---------- error log + AI self-heal ----------
// Anything that throws or looks wrong is logged to the backend (deduped,
// capped) so bugs surface and get fixed — never silently hidden.
const loggedSigs = new Set();
let logCount = 0;
function logError(kind, message, context = '') {
  const msg = String(message || '').slice(0, 500);
  const ctx = String(context || '').slice(0, 200);
  const sig = kind + '|' + msg + '|' + ctx;
  if (!msg || loggedSigs.has(sig) || logCount > 60) return;
  loggedSigs.add(sig); logCount++;
  api('POST', 'log', { body: { kind, message: msg, context: ctx }, keepalive: true }).catch(() => {});
}
addEventListener('error', (e) => logError('window-error', e.message, (e.filename || '') + ':' + (e.lineno || '')));
addEventListener('unhandledrejection', (e) => logError('unhandled-rejection', e.reason?.message || String(e.reason || '')));

// A title that "looks wrong": empty, only symbols, leaked markdown/markup, a
// file path, or slash-command / handoff / trim-marker text — i.e. not a title.
function looksBadTitle(t) {
  t = String(t || '').trim();
  if (t.length < 2) return true;
  if (/^[#*\-–—.·•\s>]+$/.test(t)) return true;                 // only markdown/punctuation
  if (/^[<{[(]/.test(t)) return true;                           // markup/paren leak: < { [ (
  if (/^(#{1,6}\s|\*{1,2}\S|>\s|[-*]\s)/.test(t)) return true;  // leading heading/bold/quote/bullet
  if (/^[@"']*[A-Za-z]:[\\/]/.test(t)) return true;             // a Windows file path, not a title
  if (/environment_context|AGENTS\.md|command-(name|message|args)|resume_handoff|handoff document|earlier (conversation|turns) trimmed/i.test(t)) return true;
  return false;
}
// lazy + capped: heal only items you open, once each, a handful per session
const healed = new Set();
let healCount = 0;
async function healTitle(item) {
  if (healed.has(item.id) || healCount >= 8) return;
  healed.add(item.id); healCount++;
  logError('bad-title', item.title, item.sourceType + ':' + item.id);
  try {
    const { item: fixed } = await api('PATCH', 'items', { body: { id: item.id, retitle: true } });
    if (fixed?.title && !looksBadTitle(fixed.title)) {
      item.title = fixed.title;
      const cached = items.find((i) => i.id === item.id);
      if (cached) cached.title = fixed.title;
      if (cur?.item.id === item.id) $('item-title').textContent = fixed.title;
      lastRender = ''; renderColumns();
    }
  } catch { /* logged already; leave the heuristic title */ }
}

// Title every agent item with the user's most recent prompt (deriveTitle),
// re-derived from the body — a few per poll, capped. Only IDLE sessions (no
// sync in ~2 min) so we never fight an actively-syncing session's own title.
const agentHealed = new Set();
let agentHealCount = 0;
async function healAgentTitles() {
  if (agentHealCount >= 40) return;
  const idle = Date.now() - 120000;
  // title re-derivation stays gated (idle + un-pinned) so we never fight an
  // actively-syncing session's own title; the preview line has no such risk, so
  // any agent item still missing one is a candidate (incl. pinned/recent).
  const titleable = (it) => !it.titlePinned && (it.createdAt || 0) < idle;
  const cand = items.filter((it) => AGENT_SOURCES.has(it.sourceType) && !it.bookId
    && !agentHealed.has(it.id) && (!it.preview || titleable(it)));
  let changed = false;
  for (const it of cand.slice(0, 4)) {
    agentHealed.add(it.id); agentHealCount++;
    try {
      const { text } = await api('GET', 'items', { query: { id: it.id } });
      const patch = {};
      if (titleable(it)) {
        const title = P.deriveTitle(text);
        if (title && title !== it.title) patch.title = title;
      }
      const preview = P.derivePreview(text);
      if (preview && preview !== it.preview) patch.preview = preview;
      if (Object.keys(patch).length) {
        Object.assign(it, patch);
        api('PATCH', 'items', { body: { id: it.id, ...patch } }).catch(() => {});
        changed = true;
      }
    } catch { /* try a different item next poll */ }
  }
  if (changed) { lastRender = ''; renderColumns(); }
}

// ---------- backlog list ----------
const SOURCE_LABEL = {
  manual: 'manual', web: 'web', claude_code: 'claude code', codex: 'codex',
  copilot: 'copilot', docs: 'docs', email: 'email', article: 'article',
  book: 'book', telegram: 'telegram', other: 'other',
};
// Header source toggles (each gates its own ingestion). Order = display order.
const SOURCE_TOGGLES = [
  ['claude_code', 'claude', 'Claude Code'],
  ['codex', 'codex', 'Codex'],
  ['copilot', 'copilot', 'Copilot'],
  ['docs', 'docs', 'Docs'],
  ['email', 'email', 'Email'],
  ['telegram', 'telegram', 'Telegram'],
];
let items = [];
let prefs = null; // { capture, sources:{}, columns:[] }
let knownIds = null; // null until first successful fetch
let lastRender = '';
const selected = new Set(); // multiselected item ids
let lastClick = {}; // columnId → last-clicked item id (for shift-range)

function setStatus(msg, err) {
  $('status').textContent = msg;
  $('status').className = err ? 'err' : '';
}

function itemSig(it) {
  return (it.words || 0) + ':' + (it.bodyUrl || '') + ':' + (it.title || '');
}

async function refresh() {
  try {
    const { items: fresh, live, prefs: p } = await api('GET', 'items');
    prefs = p;
    applyPrefs();
    const newest = knownIds && fresh.find((it) => !knownIds.has(it.id) && !it.readAt);
    items = fresh;
    knownIds = new Set(items.map((i) => i.id));
    renderColumns();
    healAgentTitles();
    updateMcp();
    setStatus(`synced · ${items.length} item${items.length === 1 ? '' : 's'}`);
    // an upserted item (e.g. a live agent session) updates the open reader in
    // place — never moving your spot or pausing (#2: no reading interruptions)
    const open = cur && !cur.item.live && fresh.find((it) => it.id === cur.item.id);
    if (open && itemSig(open) !== cur.sig) {
      liveUpdateOpen(open);
    } else if (newest && settings.autoplay && (!cur || !cur.playing)) {
      openItem(newest);
      toast('New capture — playing');
    } else {
      maybeOpenLive(live);
    }
    cleanupNoise();    // once: drop stale observer/sessions noise
    reconcileBooks();  // number + title every book chapter, a batch per poll
    maybePromptForKey(); // nudge signed-in guests to add their own free key
  } catch (e) {
    setStatus(
      e.code === 401 || e.code === 503
        ? (googleClientId ? 'sign in to sync your queue' : 'unauthorized — set access token in ⚙')
        : 'offline — retrying…',
      true
    );
    if (e.code === 401 && settings.token && googleClientId) {
      // stale/revoked token — fall back to the sign-in screen
      settings.token = '';
      settings.account = null;
      saveSettings();
      renderAuth();
    }
  }
}

function groupName(ts) {
  const day = (d) => new Date(d).setHours(0, 0, 0, 0);
  const diff = Math.round((day(Date.now()) - day(ts)) / 86400000);
  if (diff <= 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  if (diff < 7) return 'Previous 7 days';
  return 'Older';
}

function timeLabel(ts) {
  const d = new Date(ts);
  return groupName(ts) === 'Today'
    ? d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    : d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

// Compact "time since the last message" for agent rows (now / 4m / 2h / 3d).
function relTime(ts) {
  const s = Math.max(0, (Date.now() - ts) / 1000);
  if (s < 60) return 'now';
  if (s < 3600) return Math.round(s / 60) + 'm';
  if (s < 86400) return Math.round(s / 3600) + 'h';
  return Math.round(s / 86400) + 'd';
}

// ---------- header: ⚡ ＋ 📖 actions + source toggles ----------
function applyPrefs() {
  $('capture-btn').innerHTML = icon('lightning');
  $('add-btn').innerHTML = icon('plus');
  $('epub-btn').innerHTML = icon('book');
  $('capture-btn').classList.toggle('on', prefs?.capture !== false);
  captureState = prefs?.capture !== false;
  renderSources();
}

function renderSources() {
  const box = $('sources');
  box.textContent = '';
  for (const [key, ic, label] of SOURCE_TOGGLES) {
    const on = prefs?.sources?.[key] !== false;
    const b = document.createElement('button');
    b.className = 'icon-btn src' + (on ? ' on' : '');
    b.innerHTML = icon(ic);
    b.title = `${label} ingestion: ${on ? 'on' : 'off'}`;
    b.onclick = async () => {
      try {
        const { prefs: np } = await api('PATCH', 'prefs', { body: { source: key, on: !on } });
        prefs = np;
        renderSources();
        toast(`${label} ${np.sources[key] ? 'on' : 'off'}`);
      } catch { toast('Could not toggle'); }
    };
    box.append(b);
  }
}

// Route an item to a column by its source type.
function columnFor(it) {
  const cols = prefs?.columns || [];
  const st = it.sourceType || 'web';
  const hit = cols.find((c) => (c.sources || []).includes(st));
  return hit?.id || cols[0]?.id || 'general';
}

// ---------- agents column: pick which agent you're looking at ----------
// The agents column carries every coding agent. Rather than mix them, a header
// dropdown switches between Claude Code (default), Codex, and everything else
// ("Agents") — each with its own project subgroups and scroll.
const AGENT_VIEWS = [
  { id: 'claude_code', label: 'Claude Code' },
  { id: 'codex', label: 'Codex' },
  { id: 'telegram', label: 'Telegram' },
  { id: 'agents', label: 'Agents' },
];
let agentView = localStorage.getItem('rr:agentView') || 'claude_code';
const isAgentCol = (col) => (col.sources || []).some((s) => s === 'claude_code' || s === 'codex');
function agentMatch(it) {
  if (agentView === 'agents') return !['claude_code', 'codex', 'telegram'].includes(it.sourceType);
  return it.sourceType === agentView;
}
const agentLabel = () => (AGENT_VIEWS.find((v) => v.id === agentView) || {}).label || 'agents';
// the ⌁ → upright bolt, and the label follows the picker so you connect whoever
// is selected ("Connect to Claude Code" / "Connect to Codex" / …)
function updateConnectLabel() {
  $('mcp-init').innerHTML = icon('lightning') + ' Connect to ' + agentLabel();
}
// background noise that should never surface in the agents column
const NOISE_GROUP = /^(observer|memory|background)|^sessions$/i;
// stale noise to delete outright — strict, exact names only (safe to remove)
const NOISE_EXACT = /^(observer-sessions|observer|memory|background|sessions)$/i;
// agent/chat sources: they live in the agents column and get the "You wrote:"
// conversational transcript
const AGENT_SOURCES = new Set(['claude_code', 'codex', 'copilot', 'telegram']);

function colNameSpan(name) {
  const s = document.createElement('span');
  s.className = 'col-n';
  s.textContent = name;
  return s;
}
function colCountSpan(n) {
  const s = document.createElement('span');
  s.className = 'col-c';
  s.textContent = n;
  return s;
}
function agentPicker() {
  const wrap = document.createElement('span');
  wrap.className = 'col-n';
  const sel = document.createElement('select');
  sel.className = 'agent-pick';
  for (const v of AGENT_VIEWS) {
    const o = document.createElement('option');
    o.value = v.id;
    o.textContent = v.label;
    if (v.id === agentView) o.selected = true;
    sel.append(o);
  }
  sel.onchange = () => {
    agentView = sel.value;
    localStorage.setItem('rr:agentView', agentView);
    updateConnectLabel();
    lastRender = '';
    renderColumns();
  };
  wrap.append(sel);
  return wrap;
}

// collapsed project groups, persisted: keyed `${columnId}/${group}`
const collapsedGroups = new Set(JSON.parse(localStorage.getItem('rr:collapsed') || '[]'));
// where you left off in each non-agent panel (columnId → itemId), persisted so
// it's easy to resume your spot after days away
const resumeMap = JSON.parse(localStorage.getItem('rr:resume') || '{}');
function toggleGroup(gkey) {
  collapsedGroups.has(gkey) ? collapsedGroups.delete(gkey) : collapsedGroups.add(gkey);
  localStorage.setItem('rr:collapsed', JSON.stringify([...collapsedGroups]));
  lastRender = ''; renderColumns();
}

function renderColumns() {
  // Never rebuild the DOM mid-gesture: a drag in flight or an inline rename would
  // have its element yanked out from under it (this is why both "didn't work" —
  // the 4s/10s poll fired during the gesture). The gesture's own completion
  // (drop / Enter / blur) clears the flag and forces the render.
  if (dragId || inlineEditing) return;
  const key = JSON.stringify(items.map((i) => [i.id, i.title, i.readAt, i.progress, i.archivedAt, i.group, i.createdAt, i.bookmarkAt]))
    + (cur?.item.id || '') + JSON.stringify(prefs?.columns || []) + [...selected].join(',') + [...collapsedGroups].join(',') + agentView + Math.floor(Date.now() / 60000);
  if (key === lastRender) return;
  lastRender = key;

  const wrap = $('columns');
  // preserve each column's scroll position across the rebuild
  const scroll = {};
  for (const el of wrap.querySelectorAll('.col')) {
    const b = el.querySelector('.col-body');
    if (el.dataset.col && b) scroll[el.dataset.col] = b.scrollTop;
  }
  wrap.textContent = '';
  const cols = prefs?.columns || [];
  const visible = items.filter((it) => !it.archivedAt);
  const byCol = Object.fromEntries(cols.map((c) => [c.id, []]));
  for (const it of visible) {
    const cid = columnFor(it);
    (byCol[cid] ||= []).push(it);
  }

  if (!items.length) {
    const d = document.createElement('div');
    d.className = 'none';
    d.textContent = 'Backlog is empty — ⚡ highlight, ＋ paste, 📖 open a book, or connect a source.';
    wrap.append(d);
    renderSelbar();
    return;
  }

  for (const col of cols) {
    let list = byCol[col.id] || [];
    const agentCol = isAgentCol(col);
    // the agents column shows one agent at a time, never the noise groups
    if (agentCol) list = list.filter((it) => agentMatch(it) && !NOISE_GROUP.test(it.group || ''));
    const c = document.createElement('div');
    c.className = 'col' + (col.density === 'compact' ? ' compact' : '') + (col.color ? ' themed' : '');
    c.dataset.col = col.id;
    if (col.color) c.style.setProperty('--col-accent', col.color);
    const h = document.createElement('div');
    h.className = 'col-h';
    h.innerHTML = `<span class="col-i">${icon(col.icon)}</span>`;
    h.append(agentCol ? agentPicker() : colNameSpan(col.name), colCountSpan(list.length));
    if (list.some((it) => it.order != null)) h.append(colResetBtn(list));
    c.append(h);
    const body = document.createElement('div');
    body.className = 'col-body';
    renderColBody(body, col, list);
    c.append(body);
    wrap.append(c);
  }
  // restore scroll once the columns are laid out in the DOM
  for (const el of wrap.querySelectorAll('.col')) {
    const b = el.querySelector('.col-body');
    if (b && scroll[el.dataset.col] != null) b.scrollTop = scroll[el.dataset.col];
  }
  renderSelbar();
}

// Within a column, items with a `group` (e.g. a Claude project folder) render
// under collapsible sub-headers — like the Claude Code sidebar. Ungrouped
// items render flat at the top.
const byNewest = (a, b) => (b.createdAt || 0) - (a.createdAt || 0);
let dragId = null;
let inlineEditing = false; // a title/group rename is in progress — don't rebuild under it
// Manual order pins a column: ordered items sort by `order`; new (un-ordered)
// items float to the top by recency, so arrivals don't disturb your arrangement.
const bySaved = (a, b) => {
  if (a.order == null && b.order == null) return byNewest(a, b);
  if (a.order == null) return -1;
  if (b.order == null) return 1;
  return a.order - b.order;
};

// Drop `dragId` next to `targetId` within one list, renumber `order`, persist.
function reorderWithin(list, dragId, targetId) {
  const from = list.findIndex((x) => x.id === dragId);
  const to = list.findIndex((x) => x.id === targetId);
  if (from < 0 || to < 0) return;
  const arr = [...list];
  const [moved] = arr.splice(from, 1);
  arr.splice(to, 0, moved);
  arr.forEach((it, i) => {
    if (it.order !== i) { it.order = i; api('PATCH', 'items', { body: { id: it.id, order: i } }).catch(() => {}); }
  });
  lastRender = ''; renderColumns();
}

// Clear manual order on a column → back to sort-by-recent.
function colResetBtn(list) {
  const b = document.createElement('button');
  b.className = 'col-reset';
  b.textContent = '↻';
  b.title = 'Sort by recent (clear manual order)';
  b.onclick = (e) => {
    e.stopPropagation();
    for (const it of list) if (it.order != null) { delete it.order; api('PATCH', 'items', { body: { id: it.id, order: null } }).catch(() => {}); }
    lastRender = ''; renderColumns();
  };
  return b;
}

function renderColBody(body, col, list) {
  const ungrouped = list.filter((it) => !it.group).sort(bySaved);
  for (const it of ungrouped) body.append(itemRow(it, col.id, ungrouped));

  // groups ordered by their most recent item (newest project on top)
  const groups = new Map();
  for (const it of list) if (it.group) {
    if (!groups.has(it.group)) groups.set(it.group, []);
    groups.get(it.group).push(it);
  }
  const ordered = [...groups.entries()].sort((a, b) => byNewest(
    a[1].reduce((m, x) => (x.createdAt > (m.createdAt || 0) ? x : m), {}),
    b[1].reduce((m, x) => (x.createdAt > (m.createdAt || 0) ? x : m), {}),
  ));
  for (const [name, gItems] of ordered) {
    // a book group: chapters in reading order, with a bookmark on the current one
    const isBook = gItems.some((it) => it.bookId);
    if (isBook) gItems.sort((a, b) => (a.chapterIndex || 0) - (b.chapterIndex || 0));
    else gItems.sort(bySaved); // agents/other: manual order if set, else most recent on top
    const bm = isBook
      ? gItems.reduce((a, b) => ((b.bookmarkAt || 0) > (a?.bookmarkAt || 0) ? b : a), null)
      : null;
    const gkey = col.id + '/' + name;
    const collapsed = collapsedGroups.has(gkey);
    const gh = document.createElement('div');
    gh.className = 'group' + (collapsed ? ' collapsed' : '');
    const caret = document.createElement('span'); caret.className = 'caret'; caret.textContent = '▾';
    const gn = document.createElement('span'); gn.className = 'g-n';
    gn.textContent = (prefs.groupAliases && prefs.groupAliases[name]) || name;
    gn.title = 'Double-click to rename';
    gn.onclick = (e) => { if (gn.isContentEditable) e.stopPropagation(); }; // editing → don't toggle collapse
    gn.ondblclick = (e) => { e.stopPropagation(); editGroupAlias(gn, name); };
    gh.append(caret, gn);
    if (bm?.bookmarkAt) {
      // one-click resume — open the bookmarked chapter at its saved spot, even
      // when the book is collapsed and you've been away for days
      const chNum = (bm.title.match(/chapter\s+(\d+)/i) || [])[1];
      const badge = document.createElement('button');
      badge.className = 'g-bm';
      badge.textContent = '📖 ' + (chNum ? 'Ch ' + chNum : 'resume');
      badge.title = 'Resume — ' + bm.title;
      badge.onclick = (e) => { e.stopPropagation(); openItem(bm); };
      gh.append(badge);
    }
    const gc = document.createElement('span');
    gc.className = 'g-c';
    gc.textContent = gItems.length;
    gh.append(gc);
    gh.onclick = () => toggleGroup(gkey);
    body.append(gh);
    if (!collapsed) for (const it of gItems) body.append(itemRow(it, col.id, gItems, it === bm && !!bm.bookmarkAt));
  }
}

function itemRow(it, colId, colItems, isBookmark) {
  const words = it.words || 0;
  const pct = !it.readAt && it.progress > 0 && words ? Math.round((it.progress / words) * 100) + '%' : '';
  const row = document.createElement('div');
  row.className = 'item'
    + (it.readAt ? '' : ' unread')
    + (cur?.item.id === it.id ? ' active' : '')
    + (isBookmark ? ' bookmark' : '')
    + (resumeMap[colId] === it.id && cur?.item.id !== it.id ? ' resume' : '')
    + (selected.has(it.id) ? ' sel' : '');
  row.draggable = !it.bookId; // chapters stay in reading order
  if (row.draggable) {
    // setData is required or Firefox refuses to start the drag at all.
    row.ondragstart = (e) => { dragId = it.id; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', it.id); row.classList.add('dragging'); };
    row.ondragend = () => { dragId = null; row.classList.remove('dragging'); document.querySelectorAll('.item.drop-target').forEach((el) => el.classList.remove('drop-target')); };
    row.ondragover = (e) => { if (dragId && dragId !== it.id && colItems.some((x) => x.id === dragId)) { e.preventDefault(); row.classList.add('drop-target'); } };
    row.ondragleave = () => row.classList.remove('drop-target');
    // drop fires before dragend, so clear dragId here (a local copy drives the
    // reorder) — otherwise the render guard would block the reorder's repaint.
    row.ondrop = (e) => {
      e.preventDefault();
      row.classList.remove('drop-target');
      const from = dragId; dragId = null;
      if (from && from !== it.id) reorderWithin(colItems, from, it.id);
    };
  }
  row.title = [SOURCE_LABEL[it.sourceType] || it.source, timeLabel(it.createdAt), words + 'w', pct]
    .filter(Boolean).join(' · ');
  const t = document.createElement('div');
  t.className = 't';
  t.textContent = (isBookmark ? '📖 ' : '') + it.title;
  row.append(t);
  if (AGENT_SOURCES.has(it.sourceType)) {
    const ago = document.createElement('span');
    ago.className = 'ago';
    ago.textContent = relTime(it.createdAt);
    row.append(ago);
  }
  const del = document.createElement('button');
  del.className = 'item-del';
  del.title = 'Delete (recoverable)';
  del.textContent = '✕';
  del.onclick = (e) => {
    e.stopPropagation();
    const gone = [it];
    items = items.filter((x) => x.id !== it.id);
    if (cur?.item.id === it.id) closeReader();
    api('DELETE', 'items', { body: { id: it.id } }).catch(() => {}); // soft (recoverable)
    lastRender = ''; renderColumns();
    toast('Deleted', { label: 'Undo', fn: () => undelete(gone) });
  };
  row.append(del);
  if (it.preview && !it.bookId) {
    const pv = document.createElement('div');
    pv.className = 'item-pv';
    pv.textContent = it.preview;
    row.append(pv);
  }
  const activate = (e) => {
    if (e.metaKey || e.ctrlKey) { toggleSelect(it.id); lastClick[colId] = it.id; return; }
    if (e.shiftKey) { selectRange(colId, colItems, it.id); return; }
    if (selected.size) { clearSelection(); }
    lastClick[colId] = it.id;
    cur?.item.id === it.id ? closeReader() : openItem(it, { start: settings.autoplay });
  };
  row.onclick = activate;
  // double-click the title to rename; single-click still opens (debounced so the
  // gestures don't fight). A manual rename pins the title against auto-titling.
  let tTimer;
  t.onclick = (e) => {
    // while editing, swallow clicks entirely so they don't bubble to the row's
    // open/close handler (that re-render was destroying the edit field mid-type)
    if (t.isContentEditable) { e.stopPropagation(); return; }
    e.stopPropagation();
    if (e.detail > 1) return;
    clearTimeout(tTimer);
    tTimer = setTimeout(() => activate(e), 200);
  };
  t.ondblclick = (e) => {
    e.stopPropagation();
    clearTimeout(tTimer);
    if (t.isContentEditable) return; // already editing → let the native word-select happen
    editItemTitle(t, it);
  };
  return row;
}

// Inline-edit a backlog item's title; Enter saves + pins it, Esc/empty reverts.
function editItemTitle(span, it) {
  if (span.isContentEditable) return; // already editing this title
  inlineEditing = true;               // freeze re-renders so the poll can't yank the field
  const row = span.closest('.item');
  // a contentEditable nested in a draggable element won't accept typing in Chrome
  // (selection collapses, keys are swallowed) — turn dragging off for the edit.
  if (row) row.draggable = false;
  span.contentEditable = 'true';
  span.textContent = it.title;
  // defer focus+select-all to the next frame, so it lands after the double-click /
  // drag-arm gesture fully settles (otherwise the selection collapses immediately)
  requestAnimationFrame(() => {
    span.focus();
    const sel = getSelection(); const r = document.createRange();
    r.selectNodeContents(span); sel.removeAllRanges(); sel.addRange(r);
  });
  let done = false;
  const finish = (save) => {
    if (done) return; done = true;
    inlineEditing = false;
    span.contentEditable = 'false';
    if (row) row.draggable = !it.bookId;
    const val = span.textContent.replace(/\s+/g, ' ').trim().slice(0, 120);
    if (save && val && val !== it.title) {
      it.title = val; it.titlePinned = true;
      // a poll may have swapped `items` for a fresh array mid-edit; pin the rename
      // onto the live object too so the optimistic title survives the next render
      const live = items.find((x) => x.id === it.id);
      if (live) { live.title = val; live.titlePinned = true; }
      if (cur?.item.id === it.id) $('item-title').textContent = val;
      api('PATCH', 'items', { body: { id: it.id, title: val, titlePinned: true } }).catch(() => {});
    }
    lastRender = ''; renderColumns();
  };
  span.onkeydown = (e) => {
    if (e.key === 'Enter') { e.preventDefault(); finish(true); }
    else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
  };
  span.onblur = () => finish(true);
}

// Inline-edit a subgroup's display name → a per-user alias (the real group is
// kept, so new items joining inherit the alias and live updates survive).
function editGroupAlias(span, realGroup) {
  if (span.isContentEditable) return;
  inlineEditing = true; // freeze re-renders so the poll can't yank the field mid-edit
  span.contentEditable = 'true';
  requestAnimationFrame(() => {
    span.focus();
    const sel = getSelection(); const r = document.createRange();
    r.selectNodeContents(span); sel.removeAllRanges(); sel.addRange(r);
  });
  let done = false;
  const finish = (save) => {
    if (done) return; done = true;
    inlineEditing = false;
    span.contentEditable = 'false';
    const val = span.textContent.replace(/\s+/g, ' ').trim().slice(0, 60);
    if (save && val) {
      prefs.groupAliases = { ...(prefs.groupAliases || {}), [realGroup]: val };
      api('PATCH', 'prefs', { body: { groupAliases: prefs.groupAliases } }).then((res) => { if (res?.prefs) prefs = res.prefs; }).catch(() => {});
    }
    lastRender = ''; renderColumns();
  };
  span.onkeydown = (e) => {
    if (e.key === 'Enter') { e.preventDefault(); finish(true); }
    else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
  };
  span.onblur = () => finish(true);
}

// ---------- multiselect (ctrl/cmd-click toggle, shift-click range) ----------
function toggleSelect(id) {
  selected.has(id) ? selected.delete(id) : selected.add(id);
  lastRender = ''; renderColumns();
}

function selectRange(colId, colItems, id) {
  const ids = colItems.map((i) => i.id);
  const from = ids.indexOf(lastClick[colId] ?? id);
  const to = ids.indexOf(id);
  if (from < 0 || to < 0) { toggleSelect(id); return; }
  const [a, b] = from < to ? [from, to] : [to, from];
  for (let i = a; i <= b; i++) selected.add(ids[i]);
  lastRender = ''; renderColumns();
}

function clearSelection() {
  selected.clear();
  lastRender = ''; renderColumns();
}

function renderSelbar() {
  const bar = $('selbar');
  if (!selected.size) { bar.hidden = true; bar.textContent = ''; return; }
  bar.hidden = false;
  bar.textContent = '';
  const n = document.createElement('span');
  n.className = 'sel-n';
  n.textContent = `${selected.size} selected`;
  bar.append(n);
  const act = (label, fn) => {
    const b = document.createElement('button');
    b.className = 'chip';
    b.textContent = label;
    b.onclick = fn;
    bar.append(b);
  };
  act('Mark read', () => bulk((it) => { it.readAt = Date.now(); it.progress = 0; }, { readAt: Date.now(), progress: 0 }));
  act('Archive', () => bulk((it) => { it.archivedAt = Date.now(); }, { archivedAt: Date.now() }));
  act('Delete', () => {
    const ids = [...selected];
    const gone = items.filter((x) => selected.has(x.id));
    items = items.filter((x) => !selected.has(x.id));
    if (cur && selected.has(cur.item.id)) closeReader();
    clearSelection();
    api('DELETE', 'items', { body: { ids } }).catch(() => {}); // soft (recoverable)
    lastRender = ''; renderColumns();
    toast(`Deleted ${ids.length} item${ids.length === 1 ? '' : 's'}`, { label: 'Undo', fn: () => undelete(gone) });
  });
  act('Clear', clearSelection);
}

function bulk(mutate, patch) {
  const ids = [...selected];
  for (const it of items) if (selected.has(it.id)) mutate(it);
  clearSelection();
  for (const id of ids) api('PATCH', 'items', { body: { id, ...patch } }).catch(() => {});
}

// Bring soft-deleted items back: re-show locally + clear deletedAt server-side.
function undelete(arr) {
  for (const it of arr) {
    it.deletedAt = null;
    if (!items.find((x) => x.id === it.id)) items.push(it);
    api('PATCH', 'items', { body: { id: it.id, deletedAt: null } }).catch(() => {});
  }
  lastRender = ''; renderColumns();
}

// ---------- column customization ----------
const ALL_SOURCES = ['claude_code', 'codex', 'copilot', 'docs', 'email', 'telegram',
  'article', 'web', 'book', 'manual', 'other'];
let draftCols = null;

function openColCfg() {
  draftCols = JSON.parse(JSON.stringify(prefs?.columns || []));
  $('colcfg').hidden = false;
  renderColCfg();
}

function renderColCfg() {
  const box = $('colcfg-list');
  box.textContent = '';
  draftCols.forEach((col, idx) => {
    const card = document.createElement('div');
    card.className = 'colcfg-row';
    const name = document.createElement('input');
    name.value = col.name;
    name.className = 'colcfg-name';
    name.oninput = () => { col.name = name.value; col.id = name.value.toLowerCase().replace(/\s+/g, '-') || 'col'; };
    const srcs = document.createElement('div');
    srcs.className = 'colcfg-srcs';
    for (const s of ALL_SOURCES) {
      const on = (col.sources || []).includes(s);
      const chip = document.createElement('button');
      chip.className = 'chip tiny' + (on ? ' on' : '');
      chip.textContent = SOURCE_LABEL[s] || s;
      chip.onclick = () => {
        col.sources = on ? col.sources.filter((x) => x !== s) : [...(col.sources || []), s];
        renderColCfg();
      };
      srcs.append(chip);
    }
    const color = document.createElement('input');
    color.type = 'color';
    color.className = 'colcfg-color';
    color.value = col.color || '#e0443e';
    color.title = 'Column accent';
    color.oninput = () => { col.color = color.value; };
    const dens = document.createElement('button');
    dens.className = 'chip tiny' + (col.density === 'compact' ? ' on' : '');
    dens.textContent = 'compact';
    dens.title = 'Denser rows';
    dens.onclick = () => { col.density = col.density === 'compact' ? 'cozy' : 'compact'; renderColCfg(); };
    const del = document.createElement('button');
    del.className = 'chip';
    del.textContent = '× remove';
    del.onclick = () => { draftCols.splice(idx, 1); renderColCfg(); };
    card.append(name, color, dens, srcs, del);
    box.append(card);
  });
}

$('cols-btn').onclick = openColCfg;
$('colcfg-add').onclick = () => { draftCols.push({ id: 'new', name: 'New', icon: 'general', sources: [] }); renderColCfg(); };
$('colcfg-reset').onclick = () => { draftCols = JSON.parse(JSON.stringify(DEFAULT_COLUMNS_CLIENT)); renderColCfg(); };
$('colcfg-close').onclick = async () => {
  $('colcfg').hidden = true;
  if (draftCols) await saveCols(draftCols);
  draftCols = null;
};
$('colcfg').onclick = (e) => { if (e.target === $('colcfg')) $('colcfg-close').click(); };

const DEFAULT_COLUMNS_CLIENT = [
  { id: 'books', name: 'Books', icon: 'book', sources: ['book'] },
  { id: 'news', name: 'News', icon: 'news', sources: ['article', 'web'] },
  { id: 'agents', name: 'Agents', icon: 'agents', sources: ['claude_code', 'codex', 'copilot', 'telegram'] },
  { id: 'general', name: 'General', icon: 'general', sources: ['manual', 'docs', 'other'] },
  { id: 'email', name: 'Email', icon: 'email', sources: ['email'] },
];

async function saveCols(cols) {
  try {
    const { prefs: np } = await api('PATCH', 'prefs', { body: { columns: cols } });
    prefs = np;
    lastRender = '';
    renderColumns();
  } catch { toast('Could not save columns'); }
}

// ---------- player ----------
let cur = null; // { item, sections, tokens, anchors, i, playedMs, playing, done }
let timer = null;
let sess = null; // { sourceType, playbackMs, words, pauses, rewinds, skips, completed }

function currentWpm() {
  return settings.mode === 'build'
    ? R.buildWpm(cur.playedMs, settings.wpm, { stepWpm: settings.buildStep, stepSec: settings.buildEvery })
    : settings.wpm;
}

function fmt(ms) {
  const s = Math.round(ms / 1000);
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
}

function showToken() {
  const t = cur.tokens[cur.i];
  const p = R.orpIndex(t.w);
  $('pre').textContent = t.w.slice(0, p);
  $('pivot').textContent = t.w[p] || '';
  $('post').textContent = t.w.slice(p + 1);
  $('word').classList.toggle('code', !!(t.code || t.link)); // long tokens shrink
  syncSectionNav(t.sec);
  markTranscript();
  updateHud();
}

// ---------- live transcript ----------
// The full text, one span per token, following the current word — so you
// can drop out of RSVP into normal reading (and click any word to jump
// the player there) without losing your place.
let nowSpan = null;

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
    // role mode: open a new turn block each time the speaker changes
    if (hasRoles && sec.role !== turnRole) {
      turnRole = sec.role;
      const th = sec.role ? (theme[sec.role] || {}) : null;
      if (th && th.show === false) {
        turn = null;
      } else {
        turn = document.createElement('div');
        turn.className = 'turn' + (sec.role ? ' ' + sec.role : '');
        if (th) {
          if (th.box) turn.classList.add('boxed');
          if (th.align) { turn.style.textAlign = th.align; if (th.box) turn.classList.add('a-' + th.align); }
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

    // tool calls + thinking: collapsed, read from raw (they carry no RSVP tokens)
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
      // show the real code here — this is where you read it normally
      const pre = document.createElement('pre');
      pre.textContent = stripFence(sec.raw);
      if (bySec[idx][0]) pre.dataset.i = bySec[idx][0][1];
      turn.append(pre);
      return;
    }
    if (!bySec[idx].length) return;

    // list items mirror the source: a marker (• or the number) + indent for
    // nesting, with the words still tokenized for RSVP highlight + click-to-seek
    if (sec.type === 'item') {
      const li = document.createElement('div');
      li.className = 'li';
      if (sec.indent) li.style.marginLeft = (sec.indent * 0.8) + 'em';
      const mark = document.createElement('span');
      mark.className = 'li-mark';
      mark.textContent = sec.ordered ? sec.marker : '•';
      const body = document.createElement('div');
      body.className = 'li-body';
      for (const [t, i] of bySec[idx]) {
        const s = document.createElement('span');
        s.textContent = t.w; s.dataset.i = i;
        if (t.link) s.classList.add('link');
        body.append(s, ' ');
      }
      li.append(mark, body);
      turn.append(li);
      return;
    }

    const para = document.createElement('p');
    if (sec.type === 'heading') para.className = 'h';
    else if (!hasRoles && sec.type === 'quote') {
      // legacy (pre-sentinel) transcript: your prompts as a right-aligned label
      if (AGENT_SOURCES.has(cur.item.sourceType)) {
        para.className = 'you';
        const lbl = document.createElement('span');
        lbl.className = 'you-label';
        lbl.textContent = 'You wrote:';
        para.append(lbl);
      } else {
        para.className = 'quote';
      }
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

// ---------- linked pages (URL inside a text → its own backlog item) ----------
function linkHref(w) {
  return w.replace(/^[("'\[«]+/, '').replace(/[).,;:!?\]'"»”]+$/, '');
}

let pendingLink = null;

function openLinkModal(url) {
  pendingLink = url;
  if (cur?.playing) pause();
  $('link-url').textContent = url;
  $('linkmodal').hidden = false;
}

async function saveLink(readNow) {
  const url = pendingLink;
  pendingLink = null;
  $('linkmodal').hidden = true;
  if (!url) return;
  toast('Fetching page…');
  try {
    const { item } = await api('POST', 'items', { body: { text: url } });
    items = [item, ...items];
    knownIds?.add(item.id);
    lastRender = '';
    renderColumns();
    if (readNow) openItem(item);
    else toast('Saved to backlog');
  } catch (e) {
    toast(e.message || 'Could not read that page');
  }
}

$('link-read').onclick = () => saveLink(true);
$('link-later').onclick = () => saveLink(false);
$('link-cancel').onclick = () => { pendingLink = null; $('linkmodal').hidden = true; };
$('linkmodal').onclick = (e) => { if (e.target === $('linkmodal')) $('link-cancel').click(); };

function applyTranscript() {
  const show = settings.transcript && !!cur;
  $('transcript').hidden = !show;
  // when the transcript is showing it fills the reader; the word sits in a thin
  // row flush under the backlog (otherwise the word stays centered, classic)
  $('reader').classList.toggle('reading-script', show);
  $('script-btn').classList.toggle('on', settings.transcript);
  if (cur) markTranscript();
}

function markTranscript() {
  if (!settings.transcript || $('transcript').hidden) return;
  nowSpan?.classList.remove('now');
  nowSpan = $('transcript').querySelector(`[data-i="${cur.i}"]`);
  if (nowSpan) nowSpan.classList.add('now');
  // agent chats read like a messenger: newest pinned to the bottom — unless
  // you're actively RSVP-playing, then the transcript follows the word
  if (AGENT_SOURCES.has(cur.item.sourceType) && !cur.playing) {
    const box = $('transcript');
    box.scrollTop = box.scrollHeight;
  } else if (nowSpan) {
    nowSpan.scrollIntoView({ block: 'nearest' });
  }
}

$('script-btn').onclick = () => {
  settings.transcript = !settings.transcript;
  saveSettings();
  applyTranscript();
};

function updateHud() {
  const wpm = currentWpm();
  $('wpm-now').textContent =
    settings.mode === 'build' && wpm < settings.wpm
      ? `${wpm} → ${settings.wpm} wpm`
      : `${wpm} wpm`;
  $('time-left').textContent = fmt(R.remainingMs(cur.tokens, cur.i, wpm));
  $('bar').style.width = (cur.i / cur.tokens.length) * 100 + '%';
}

function tick() {
  showToken();
  const delay = R.delayMs(cur.tokens[cur.i], currentWpm());
  timer = setTimeout(() => {
    cur.playedMs += delay;
    if (sess) { sess.playbackMs += delay; sess.words += 1; }
    if (cur.i >= cur.tokens.length - 1) return finish();
    cur.i++;
    tick();
  }, delay);
}

function play() {
  if (!cur) return;
  if (!sess) startSession(cur.item); // session was flushed (tab hidden, stats)
  if (cur.done) {
    cur.i = 0;
    cur.playedMs = 0;
    cur.done = false;
  }
  cur.playing = true;
  $('play').textContent = '⏸';
  tick();
}

function pause() {
  clearTimeout(timer);
  if (cur.playing && sess) sess.pauses += 1;
  cur.playing = false;
  $('play').textContent = '▶';
  saveProgress();
}

function togglePlay() {
  if (!cur) return;
  cur.playing ? pause() : play();
}

function seek(i) {
  clearTimeout(timer);
  cur.i = Math.max(0, Math.min(i, cur.tokens.length - 1));
  cur.done = false;
  if (cur.playing) tick();
  else showToken();
}

function finish() {
  cur.playing = false;
  cur.done = true;
  $('pre').textContent = '';
  $('pivot').textContent = '✓';
  $('post').textContent = '';
  $('word').classList.remove('code');
  $('bar').style.width = '100%';
  $('time-left').textContent = '0:00';
  $('play').textContent = '▶';
  if (sess) sess.completed = true;
  flushSession();
  markRead(cur.item);
}

async function markRead(item) {
  if (item.live || item.readAt) return;
  item.readAt = Date.now();
  item.progress = 0;
  renderColumns();
  try { await api('PATCH', 'items', { body: { id: item.id, readAt: item.readAt, progress: 0 } }); } catch {}
}

function saveProgress() {
  if (!cur || cur.done) return;
  const it = cur.item;
  if (it.live || cur.i < 5 || it.progress === cur.i) return;
  it.progress = cur.i;
  api('PATCH', 'items', { body: { id: it.id, progress: cur.i }, keepalive: true }).catch(() => {});
}

// ---------- reading sessions (metrics) ----------
function startSession(item) {
  flushSession();
  sess = {
    sourceType: item.sourceType || 'web',
    playbackMs: 0, words: 0, pauses: 0, rewinds: 0, skips: 0, completed: false,
  };
}

function flushSession() {
  if (!sess || sess.playbackMs < 3000) { sess = null; return; }
  const dateKey = new Date().toLocaleDateString('sv-SE'); // YYYY-MM-DD local
  api('POST', 'stats', { body: { dateKey, ...sess }, keepalive: true }).catch(() => {});
  sess = null;
}

// ---------- live highlight (ephemeral — never in the backlog) ----------
let liveSeen = 0;
let captureState = true; // mirror of prefs.capture for quick reads

$('capture-btn').onclick = async () => {
  try {
    const { prefs: np } = await api('PATCH', 'prefs', { body: { capture: !captureState } });
    prefs = np;
    applyPrefs();
    toast(np.capture ? 'live highlight on' : 'live highlight off');
  } catch {
    toast('Could not toggle — check connection');
  }
};

function maybeOpenLive(live) {
  if (!live?.ts || live.ts === liveSeen || !live.text) return;
  if (Date.now() - live.ts > 10 * 60000) { liveSeen = live.ts; return; } // stale
  liveSeen = live.ts;
  if (cur?.playing) return; // never yank an active read
  let source = '';
  try { source = new URL(live.url).hostname; } catch {}
  openItem({
    id: '__live__',
    live: true,
    title: source || 'Highlight', // the red ⚡ capture button already signals highlight mode
    text: live.text,
    url: live.url || '',
    sourceType: 'web',
    progress: 0,
    readAt: null,
  }, { start: false }); // ready to read, not auto-playing
}

$('keep-btn').onclick = async () => {
  if (!cur?.item.live) return;
  $('keep-btn').hidden = true;
  try {
    await api('POST', 'items', { body: { text: cur.item.text, url: cur.item.url } });
    api('DELETE', 'live').catch(() => {}); // slot consumed
    toast('Kept — added to backlog');
    refresh();
  } catch {
    $('keep-btn').hidden = false;
    toast('Could not save — check token');
  }
};

// ---------- open / close ----------
const bodyCache = new Map(); // itemId → full text (per session)

async function openItem(item, { start = true } = {}) {
  // live items carry their text; backlog stubs load the body from Blob on open
  let text = item.live ? item.text : bodyCache.get(item.id);
  if (text === undefined) {
    try {
      ({ text } = await api('GET', 'items', { query: { id: item.id } }));
      bodyCache.set(item.id, text);
    } catch (e) {
      logError('load-failed', e.message, item.id);
      toast('Could not load that item');
      return;
    }
  }
  // lazy AI self-heal (non-agent items only — agent sessions are titled by the
  // native model in the sync hook, not Gemini/MiniMax): only what you opened
  if (!item.live && !settings.aiDisabled && !AGENT_SOURCES.has(item.sourceType) && looksBadTitle(item.title)) healTitle(item);
  // backfill the preview line ("where we are now") for an agent item the moment
  // you open it — free, since the body is already loaded here (no extra fetch)
  if (!item.live && !item.bookId && AGENT_SOURCES.has(item.sourceType)) {
    const preview = P.derivePreview(text);
    if (preview && preview !== item.preview) {
      item.preview = preview;
      const live = items.find((x) => x.id === item.id);
      if (live) live.preview = preview;
      api('PATCH', 'items', { body: { id: item.id, preview } }).catch(() => {});
    }
  }
  clearTimeout(timer);
  if (cur) saveProgress();
  startSession(item);
  let sections, tokens;
  try {
    sections = P.parseStructure(text);
    tokens = P.readingTokens(sections);
  } catch (e) {
    logError('parse-failed', e.message, item.sourceType + ':' + item.id);
    sections = [{ type: 'paragraph', raw: text }];
    tokens = R.tokenize(text).map((t) => ({ ...t, sec: 0 }));
  }
  const anchors = [];
  sections.forEach((s, idx) => {
    if (s.type === 'heading') {
      const at = tokens.findIndex((t) => t.sec === idx);
      if (at !== -1) anchors.push({ sec: idx, title: s.title, at });
    }
  });
  cur = { item, text, sections, tokens, anchors, i: 0, playedMs: 0, playing: false, done: false, sig: itemSig(item) };
  if (item.progress > 5 && item.progress < tokens.length - 1) {
    cur.i = item.progress;
    toast('Resumed — ⟲ to restart');
  }
  // a book chapter becomes the bookmark (current spot) the moment it's opened
  if (item.bookId) {
    item.bookmarkAt = Date.now();
    api('PATCH', 'items', { body: { id: item.id, bookmarkAt: item.bookmarkAt } }).catch(() => {});
  }
  // remember this as the resume point for its panel (agents stay live, excluded)
  if (!item.live && !AGENT_SOURCES.has(item.sourceType)) {
    resumeMap[columnFor(item)] = item.id;
    localStorage.setItem('rr:resume', JSON.stringify(resumeMap));
  }
  $('empty').hidden = true;
  $('reader').hidden = false;
  $('now-reading').hidden = false;
  $('item-title').textContent = item.title;
  $('keep-btn').hidden = !item.live;
  buildSectionNav();
  buildTranscript();
  if (!settings.keepOpen || isMobile()) setBacklog(false); // phones: reader full-screen
  renderColumns();
  if (start) {
    play();
  } else {
    showToken();
    $('play').textContent = '▶';
  }
}

$('close-reader').onclick = (e) => { e.stopPropagation(); closeReader(); };

// Update the open item's content in place when it grows (e.g. a live agent
// session) WITHOUT moving your RSVP spot, pausing, or yanking the reader —
// #2: no unexpected interruptions while reading.
async function liveUpdateOpen(fresh) {
  let text;
  try { ({ text } = await api('GET', 'items', { query: { id: fresh.id } })); }
  catch { return; }
  if (!cur || cur.item.id !== fresh.id) return; // closed/switched while fetching
  bodyCache.set(fresh.id, text);
  let sections, tokens;
  try {
    sections = P.parseStructure(text);
    tokens = P.readingTokens(sections);
  } catch { return; }
  cur.item = fresh;
  cur.text = text;
  cur.sig = itemSig(fresh);
  cur.sections = sections;
  cur.tokens = tokens;
  cur.anchors = [];
  sections.forEach((s, idx) => {
    if (s.type === 'heading') {
      const at = tokens.findIndex((t) => t.sec === idx);
      if (at !== -1) cur.anchors.push({ sec: idx, title: s.title, at });
    }
  });
  cur.i = Math.min(cur.i, tokens.length - 1);
  $('item-title').textContent = fresh.title;
  buildSectionNav();
  buildTranscript();
  if (!cur.playing) showToken();
  updateHud();
}

function closeReader() {
  clearTimeout(timer);
  if (cur) saveProgress();
  flushSession();
  cur = null;
  applyTranscript();
  $('reader').hidden = true;
  $('now-reading').hidden = true;
  $('empty').hidden = false;
  renderColumns();
}

// ---------- section navigation ----------
function buildSectionNav() {
  const sel = $('sections');
  sel.textContent = '';
  sel.hidden = cur.anchors.length < 2;
  for (const a of cur.anchors) {
    const o = document.createElement('option');
    o.value = a.at;
    o.textContent = a.title.slice(0, 60);
    sel.append(o);
  }
}

function syncSectionNav(sec) {
  if ($('sections').hidden || sec === undefined) return;
  let at = '';
  for (const a of cur.anchors) if (a.sec <= sec) at = a.at;
  if (String($('sections').value) !== String(at)) $('sections').value = at;
}

function jumpAnchor(dir) {
  if (!cur || !cur.anchors.length) return;
  if (dir < 0) {
    const prev = [...cur.anchors].reverse().find((a) => a.at < cur.i);
    seek((prev || cur.anchors[0]).at);
  } else {
    const next = cur.anchors.find((a) => a.at > cur.i);
    if (next) seek(next.at);
  }
}

$('sections').onchange = (e) => seek(Number(e.target.value));

// ---------- raw source view ----------
$('raw-btn').onclick = () => {
  if (!cur) return;
  if (cur.playing) pause();
  $('raw-text').textContent = cur.text;
  const link = $('raw-link');
  link.hidden = !cur.item.url;
  link.href = cur.item.url || '#';
  $('rawview').hidden = false;
};
$('raw-close').onclick = () => { $('rawview').hidden = true; };
$('rawview').onclick = (e) => { if (e.target === $('rawview')) $('rawview').hidden = true; };

// ---------- stats dashboard ----------
const num = (n) => n.toLocaleString();

function statsHtml(days) {
  const todayKey = new Date().toLocaleDateString('sv-SE');
  const keys = Object.keys(days).sort();
  const lastN = (n) => keys.filter((k) => (Date.now() - new Date(k + 'T12:00')) / 86400000 < n);
  const sum = (ks, f) => ks.reduce((a, k) => a + f(days[k]), 0);

  const today = days[todayKey] || { ms: 0, words: 0, completed: 0 };
  const week = lastN(7);
  const weekWords = sum(week, (d) => d.words);
  const weekMs = sum(week, (d) => d.ms);
  const savedMs = Math.max(0, (weekWords / 250) * 60000 - weekMs); // vs 250 wpm baseline

  let streak = 0;
  for (let d = new Date(); ; d.setDate(d.getDate() - 1)) {
    const k = d.toLocaleDateString('sv-SE');
    if (days[k]?.words > 0) streak++;
    else if (k === todayKey) continue; // today can still be empty
    else break;
  }

  const bySource = {};
  for (const k of week) {
    for (const [s, v] of Object.entries(days[k].bySource || {})) {
      bySource[s] = (bySource[s] || 0) + v.words;
    }
  }
  const srcRows = Object.entries(bySource).sort((a, b) => b[1] - a[1]).slice(0, 5)
    .map(([s, w]) => `<div class="src"><span>${SOURCE_LABEL[s] || s}</span><span>${num(w)} words</span></div>`)
    .join('') || '<div class="src"><span>no sessions yet</span></div>';

  return `
    <div class="grid">
      <div><div class="big">${num(today.words)}</div><div class="lbl">words today</div></div>
      <div><div class="big">${fmt(today.ms)}</div><div class="lbl">active today</div></div>
      <div><div class="big">${today.completed}</div><div class="lbl">items done</div></div>
      <div><div class="big">${num(weekWords)}</div><div class="lbl">words · 7d</div></div>
      <div><div class="big">${fmt(savedMs)}</div><div class="lbl">est. saved · 7d</div></div>
      <div><div class="big">${streak}</div><div class="lbl">day streak</div></div>
    </div>
    <h3>Top sources · 7d</h3>${srcRows}
    <h3>All time</h3>
    <div class="src"><span>${num(sum(keys, (d) => d.words))} words</span><span>${fmt(sum(keys, (d) => d.ms))} active</span><span>${sum(keys, (d) => d.completed)} items</span></div>`;
}

$('stats-btn').onclick = async () => {
  $('stats').hidden = false;
  $('stats-body').textContent = 'loading…';
  if (cur?.playing) pause();
  flushSession(); // so today's numbers include the session just read
  try {
    const { days } = await api('GET', 'stats');
    $('stats-body').innerHTML = statsHtml(days || {});
  } catch {
    $('stats-body').textContent = 'Could not load stats — check token.';
  }
};
$('stats-close').onclick = () => { $('stats').hidden = true; };
$('stats').onclick = (e) => { if (e.target === $('stats')) $('stats').hidden = true; };

// ---------- "what's the point?" info panel ----------
$('info-btn').onclick = () => { $('infomodal').hidden = false; };
$('info-close').onclick = () => { $('infomodal').hidden = true; };
$('infomodal').onclick = (e) => { if (e.target === $('infomodal')) $('infomodal').hidden = true; };

// ---------- controls ----------
$('play').onclick = togglePlay;
$('restart').onclick = () => {
  if (!cur) return;
  if (sess) sess.rewinds += 1;
  cur.playedMs = 0;
  seek(0);
};
$('back').onclick = () => {
  if (!cur) return;
  if (sess) sess.rewinds += 1;
  seek(R.prevSentenceStart(cur.tokens, cur.i));
};
$('fwd').onclick = () => {
  if (!cur) return;
  if (sess) sess.skips += 1;
  seek(R.nextSentenceStart(cur.tokens, cur.i));
};
$('stage').onclick = togglePlay;

function setBacklog(open) {
  $('top').classList.toggle('closed', !open);
}
$('toggle-btn').onclick = () => setBacklog($('top').classList.contains('closed'));

function setWpm(v) {
  settings.wpm = Math.max(100, Math.min(1000, Math.round(v) || settings.wpm));
  saveSettings();
  fillSettingsForm();
  if (cur) updateHud();
}

function bumpWpm(d) {
  setWpm(settings.wpm + d);
  toast(settings.wpm + ' wpm target');
}

// Tap the HUD wpm value to type a target directly.
$('wpm-now').onclick = () => {
  if (!cur || $('wpm-now').querySelector('input')) return;
  const wasPlaying = cur.playing;
  if (wasPlaying) pause();
  const span = $('wpm-now');
  span.textContent = '';
  const inp = document.createElement('input');
  inp.type = 'number';
  inp.min = 100; inp.max = 1000; inp.step = 10;
  inp.value = settings.wpm;
  span.append(inp);
  inp.focus();
  inp.select();
  inp.onkeydown = (e) => {
    if (e.key === 'Enter') inp.blur();
    if (e.key === 'Escape') { inp.value = settings.wpm; inp.blur(); }
  };
  inp.onblur = () => {
    setWpm(Number(inp.value));
    inp.remove();
    updateHud();
    if (wasPlaying) play();
  };
};

document.addEventListener('keydown', (e) => {
  // never hijack keys while typing in a field or an inline rename — otherwise
  // Space toggles the player (and is swallowed), arrows seek, etc.
  if (e.target.matches('input, textarea, select') || e.target.isContentEditable) return;
  const modals = ['settings', 'add', 'rawview', 'stats', 'linkmodal', 'colcfg', 'mcpmodal', 'infomodal', 'keymodal', 'breakmodal'];
  const open = modals.find((m) => !$(m).hidden);
  if (open) {
    if (e.key === 'Escape') { if (open === 'keymodal') closeKeyModal(); else $(open).hidden = true; }
    return;
  }
  if (e.key === 'Escape') {
    if (cur?.playing) pause();
    setBacklog(true);
    return;
  }
  if (!cur) return;
  if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
  else if (e.key === 'ArrowLeft') { if (sess) sess.rewinds += 1; seek(R.prevSentenceStart(cur.tokens, cur.i)); }
  else if (e.key === 'ArrowRight') { if (sess) sess.skips += 1; seek(R.nextSentenceStart(cur.tokens, cur.i)); }
  else if (e.key === '[') jumpAnchor(-1);
  else if (e.key === ']') jumpAnchor(1);
  else if (e.key === 'ArrowUp') { e.preventDefault(); bumpWpm(10); }
  else if (e.key === 'ArrowDown') { e.preventDefault(); bumpWpm(-10); }
  else if (e.key === 't' || e.key === 'T') $('script-btn').click();
});

// ---------- settings UI ----------
function fillSettingsForm() {
  $('s-font').value = settings.font;
  $('s-size').value = settings.size;
  $('s-size-val').textContent = settings.size + 'px';
  $('s-color').value = settings.color;
  $('s-bg').value = settings.bg;
  $('s-wpm').value = settings.wpm;
  $('s-wpm-num').value = settings.wpm;
  renderMode();
  fillBuild();
  $('s-autoplay').checked = settings.autoplay;
  // phones: the backlog is a full-screen sheet, so "keep open while reading"
  // can't apply — show it off and disabled there
  $('s-keepopen').checked = settings.keepOpen && !isMobile();
  $('s-keepopen').disabled = isMobile();
  $('s-noai').checked = settings.aiDisabled;
  $('s-blink').checked = settings.blinkCues;
  $('s-breaks').checked = settings.breakReminders;
  $('s-break-every').value = settings.breakEvery;
  // Bring-your-own Gemini key — manageable here once you can sync (have a token)
  const hasKey = !!prefs?.hasGeminiKey;
  $('s-aikey').hidden = !settings.token;
  $('s-aikey-status').innerHTML = hasKey
    ? '✓ Your own Gemini key is set — titles run on your quota.'
    : 'No personal key yet. Add a <span class="free">free</span> Gemini key to run AI titles on your own quota.';
  $('s-aikey-btn').textContent = hasKey ? 'Replace your Gemini key' : 'Add your free Gemini key';
  $('s-account').hidden = !settings.account;
  if (settings.account) $('s-email').textContent = settings.account.email || settings.account.name;
  renderRoleSettings();
}

// Per-role transcript appearance controls (you / claude / tool / think). Each
// change patches prefs.transcript and re-renders the open transcript at once.
function renderRoleSettings() {
  const box = $('s-roles');
  if (!box) return;
  const roles = (prefs && prefs.transcript && prefs.transcript.roles) || {};
  box.textContent = '';
  for (const r of ['you', 'claude', 'tool', 'think']) {
    const v = roles[r] || {};
    const row = document.createElement('div');
    row.className = 'role-row';
    row.innerHTML = `
      <b>${r}</b>
      <label><input type="checkbox" data-k="show" ${v.show !== false ? 'checked' : ''}> show</label>
      <input data-k="label" value="${v.label || r}" maxlength="24" class="num">
      <select data-k="align"><option ${v.align === 'left' ? 'selected' : ''}>left</option><option ${v.align === 'center' ? 'selected' : ''}>center</option><option ${v.align === 'right' ? 'selected' : ''}>right</option></select>
      <input type="color" data-k="color" value="${v.color || '#cfe8d8'}">
      <label><input type="checkbox" data-k="box" ${v.box ? 'checked' : ''}> box</label>`;
    row.onchange = async (e) => {
      const k = e.target.dataset.k;
      if (!k) return;
      const val = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
      const t = (prefs.transcript && prefs.transcript.roles) ? prefs.transcript : { roles: {} };
      t.roles[r] = { ...t.roles[r], [k]: val };
      prefs.transcript = t;
      try { const { prefs: np } = await api('PATCH', 'prefs', { body: { transcript: t } }); prefs = np; } catch {}
      if (cur) buildTranscript();
    };
    box.append(row);
  }
}

$('settings-btn').onclick = () => { fillSettingsForm(); $('settings').hidden = false; };
$('s-close').onclick = () => { $('settings').hidden = true; refresh(); };
$('settings').onclick = (e) => { if (e.target === $('settings')) { $('settings').hidden = true; refresh(); } };
// Reset everything to defaults — quick undo for a bad setting. Keeps you signed in.
$('s-reset').onclick = () => {
  const { token, account } = settings;
  settings = { ...DEFAULTS, token, account };
  saveSettings();
  fillSettingsForm();
  setBacklog(true);
  if (cur) updateHud();
  toast('Settings reset to defaults');
};

const bind = (id, key, parse = (v) => v) => {
  $(id).oninput = (e) => {
    settings[key] = parse(e.target.type === 'checkbox' ? e.target.checked : e.target.value);
    saveSettings();
    $('s-size-val').textContent = settings.size + 'px';
    if (cur) updateHud();
  };
};
bind('s-font', 'font');
bind('s-size', 'size', Number);
bind('s-color', 'color');
bind('s-bg', 'bg');
$('s-wpm').oninput = (e) => setWpm(Number(e.target.value));
$('s-wpm-num').onchange = (e) => setWpm(Number(e.target.value));
// Mode is a Standard/Build radio (circular indicators); Build reveals its two
// sliders — wpm-per-interval and the interval (which live-updates the other's label).
function renderMode() {
  document.querySelectorAll('#s-mode .seg-opt').forEach((b) => b.classList.toggle('on', b.dataset.v === settings.mode));
  $('build-opts').hidden = settings.mode !== 'build';
}
function fillBuild() {
  $('s-build-step').value = settings.buildStep;
  $('s-build-every').value = settings.buildEvery;
  $('bld-step').textContent = settings.buildStep;
  document.querySelectorAll('.bld-every').forEach((e) => { e.textContent = settings.buildEvery; });
}
document.querySelectorAll('#s-mode .seg-opt').forEach((b) => {
  b.onclick = () => { settings.mode = b.dataset.v; saveSettings(); renderMode(); if (cur) updateHud(); };
});
$('s-build-step').oninput = (e) => {
  settings.buildStep = Number(e.target.value); saveSettings();
  $('bld-step').textContent = settings.buildStep; if (cur) updateHud();
};
$('s-build-every').oninput = (e) => {
  settings.buildEvery = Number(e.target.value); saveSettings();
  document.querySelectorAll('.bld-every').forEach((el) => { el.textContent = settings.buildEvery; });
  if (cur) updateHud();
};
bind('s-autoplay', 'autoplay');
bind('s-keepopen', 'keepOpen');
bind('s-noai', 'aiDisabled');
$('s-keepopen').addEventListener('input', (e) => { if (e.target.checked) setBacklog(true); });

// ---------- eye relief (optional comfort aids) ----------
// Calm color/contrast presets just write the existing reader fg/bg (real
// evidence for visual stress); blink cues + look-away breaks run off a 1s tick
// that only accrues while you're actually playing.
function applyPreset(fg, bg) {
  settings.color = fg; settings.bg = bg;
  $('s-color').value = fg; $('s-bg').value = bg;
  saveSettings(); // applySettings() repaints --reader-fg/--reader-bg
  if (cur) updateHud();
}
document.querySelectorAll('#s-presets .preset').forEach((b) => {
  b.onclick = () => applyPreset(b.dataset.fg, b.dataset.bg);
});
bind('s-blink', 'blinkCues');
bind('s-breaks', 'breakReminders');
$('s-break-every').onchange = (e) => {
  settings.breakEvery = Math.max(5, Math.min(60, Number(e.target.value) || 20));
  e.target.value = settings.breakEvery;
  saveSettings();
};

let blinkAcc = 0, breakAcc = 0, breakTimer = null;
function flashBlink() {
  const c = $('blink-cue');
  c.classList.remove('show'); void c.offsetWidth; // restart the CSS pulse
  c.classList.add('show');
}
function takeBreak() {
  if (cur?.playing) pause();
  let left = 20;
  $('break-count').textContent = left;
  $('breakmodal').hidden = false;
  clearInterval(breakTimer);
  breakTimer = setInterval(() => {
    left -= 1;
    $('break-count').textContent = Math.max(0, left);
    if (left <= 0) clearInterval(breakTimer);
  }, 1000);
}
function endBreak() { clearInterval(breakTimer); $('breakmodal').hidden = true; }
$('break-skip').onclick = endBreak;
$('breakmodal').onclick = (e) => { if (e.target === $('breakmodal')) endBreak(); };
// 1s tick: blink nudge every 20s of reading; look-away break every N minutes
setInterval(() => {
  if (!cur?.playing) return;
  if (settings.blinkCues && ++blinkAcc >= 20) { blinkAcc = 0; flashBlink(); }
  if (settings.breakReminders && ++breakAcc >= settings.breakEvery * 60) { breakAcc = 0; takeBreak(); }
}, 1000);

// ---------- mobile "⋯ more" menu ----------
// The desktop-leaning header tools don't fit a phone bar, so on narrow screens
// we relocate them into a dropdown (kept inline on desktop). Capture each tool's
// home slot now, before any move, so we can put them back when the window widens.
const MORE_IDS = ['mcp-init', 'mcp-status', 'status', 'info-btn', 'capture-btn', 'epub-btn', 'sources', 'stats-btn', 'cols-btn', 'trash-btn'];
const moreEls = MORE_IDS.map((id) => $(id)).filter(Boolean);
const moreHome = new Map(moreEls.map((el) => [el, [el.parentElement, el.nextElementSibling]]));
function layoutTools() {
  const menu = $('more-menu');
  if (isMobile()) {
    moreEls.forEach((el) => { if (el.parentElement !== menu) menu.appendChild(el); });
  } else {
    menu.classList.remove('open');
    // restore in reverse so each tool's original next-sibling is already back
    [...moreEls].reverse().forEach((el) => {
      const [parent, next] = moreHome.get(el);
      if (el.parentElement !== parent) parent.insertBefore(el, next);
    });
  }
}
$('more-btn').onclick = (e) => { e.stopPropagation(); $('more-menu').classList.toggle('open'); };
$('more-menu').onclick = (e) => e.stopPropagation(); // keep open while using the tools
document.addEventListener('click', () => $('more-menu').classList.remove('open'));
addEventListener('resize', layoutTools);
layoutTools();

// ---------- Recently deleted (Trash) ----------
$('trash-btn').onclick = openTrash;
$('trash-close').onclick = () => { $('trash').hidden = true; };
$('trash').onclick = (e) => { if (e.target === $('trash')) $('trash').hidden = true; };
async function openTrash() {
  $('trash').hidden = false;
  const list = $('trash-list');
  list.textContent = 'Loading…';
  let deleted = [];
  try { ({ items: deleted } = await api('GET', 'items', { query: { trash: 1 } })); } catch {}
  list.textContent = '';
  if (!deleted.length) { list.innerHTML = '<p class="hint">Nothing deleted recently.</p>'; return; }
  for (const it of deleted) {
    const row = document.createElement('div');
    row.className = 'trash-row';
    const t = document.createElement('span');
    t.className = 'trash-t';
    t.textContent = it.title || '(untitled)';
    const restore = document.createElement('button');
    restore.className = 'chip';
    restore.textContent = 'Restore';
    restore.onclick = () => { api('PATCH', 'items', { body: { id: it.id, deletedAt: null } }).catch(() => {}); row.remove(); refresh(); };
    const erase = document.createElement('button');
    erase.className = 'chip';
    erase.textContent = 'Erase';
    erase.onclick = () => { api('DELETE', 'items', { query: { id: it.id, hard: 1 } }).catch(() => {}); row.remove(); };
    row.append(t, restore, erase);
    list.append(row);
  }
}

// ---------- add text / URL (paste only — sources have their own toggles) ----------
$('add-btn').onclick = () => { $('add').hidden = false; $('add-text').focus(); };
$('add-cancel').onclick = () => { $('add').hidden = true; };
$('add').onclick = (e) => { if (e.target === $('add')) $('add').hidden = true; };
$('add-save').onclick = async () => {
  const text = $('add-text').value.trim();
  if (!text) return;
  $('add').hidden = true;
  $('add-text').value = '';
  const isUrl = /^https?:\/\/\S+$/i.test(text);
  if (isUrl) toast('Fetching page…');
  try {
    await api('POST', 'items', { body: { text } });
    toast(isUrl ? 'Page added to backlog' : 'Added to backlog');
    await refresh();
  } catch (e) {
    toast(e.message || 'Failed to add — check token');
  }
};

// ---------- 📖 EPUB (parsed locally, stored as a 'book' item) ----------
$('epub-btn').onclick = () => $('add-epub').click();
$('add-epub').onchange = async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  toast('Reading book…');
  try {
    const book = await E.parseEpub(await file.arrayBuffer());
    const bookId = crypto.randomUUID();
    const group = book.title + (book.author ? ' — ' + book.author : '');
    // one item per chapter, grouped under the book; sessionId makes a
    // re-upload upsert in place instead of duplicating.
    for (let i = 0; i < book.chapters.length; i++) {
      const ch = book.chapters[i];
      await api('POST', 'items', {
        body: {
          text: E.chapterMarkdown(ch), title: ch.title, sourceType: 'book', group, bookId,
          chapterIndex: i, sessionId: `book:${bookId}:${i}`,
          words: ch.text.split(/\s+/).length,
        },
      });
      if (i % 5 === 0) toast(`Reading book… ${i + 1}/${book.chapters.length}`);
    }
    toast(`📖 ${book.title} — ${book.chapters.length} chapters added`);
    await refresh(); // reconcileBooks() (run from refresh) numbers + titles every chapter
  } catch (err) {
    toast('Could not read that EPUB — ' + (err.message || 'is it DRM-free?'));
  }
};

// ---------- books: number every chapter once, then leave it alone ----------
// Book chapters are numbers only — "Chapter N" — never descriptions (the EPUB's
// or an AI's), which spoil the story. Front matter / dividers keep their own
// name. Each book is reconciled ONCE per numbering version with the shared
// epub.js classifier; bump BOOK_VER to re-clean every loaded book exactly once.
// Only the title relabels, so your place (bookmark + progress) is never touched.
const BOOK_VER = 2;
const bookVer = JSON.parse(localStorage.getItem('rr:bookVer') || '{}');
function reconcileBooks() {
  const byBook = new Map();
  for (const it of items) if (it.bookId && !it.archivedAt) {
    (byBook.get(it.bookId) || byBook.set(it.bookId, []).get(it.bookId)).push(it);
  }
  const fixes = [];
  let saved = false;
  for (const [bookId, chs] of byBook) {
    if (bookVer[bookId] === BOOK_VER) continue; // already numbered at this version — never again
    chs.sort((a, b) => (a.chapterIndex || 0) - (b.chapterIndex || 0));
    const bookTitle = (chs[0]?.group || '').split(' — ')[0];
    const marks = E.enumerateChapters(chs.map((it) => it.title), bookTitle);
    const bookFixes = [];
    chs.forEach((it, i) => {
      const { num, category } = marks[i];
      const want = category !== 'chapter'
        ? (E.bareTitle(it.title) || it.title)  // front matter / dividers / back keep their own name
        : `Chapter ${num}`;                    // chapters: number only — strips old AI spoiler titles
      if (it.title !== want) bookFixes.push({ it, title: want });
    });
    if (bookFixes.length) fixes.push(...bookFixes);
    else { bookVer[bookId] = BOOK_VER; saved = true; } // converged → mark done, skip forever
  }
  if (saved) localStorage.setItem('rr:bookVer', JSON.stringify(bookVer));
  if (!fixes.length) return;
  for (const f of fixes.slice(0, 60)) {
    f.it.title = f.title; // optimistic — renumbers in place, your spot is unchanged
    api('PATCH', 'items', { body: { id: f.it.id, title: f.title } }).catch(() => {});
  }
  lastRender = ''; renderColumns();
}

// One-time per device: delete the stale background sessions (observer/sessions)
// captured before they were filtered at the source — so they're gone, not hidden.
async function cleanupNoise() {
  if (localStorage.getItem('rr:noiseCleanup')) return;
  localStorage.setItem('rr:noiseCleanup', '1');
  const ids = items.filter((it) => AGENT_SOURCES.has(it.sourceType) && NOISE_EXACT.test(it.group || '')).map((it) => it.id);
  if (!ids.length) return;
  items = items.filter((it) => !ids.includes(it.id));
  ids.forEach((id) => knownIds?.delete(id));
  lastRender = ''; renderColumns();
  try { await api('DELETE', 'items', { body: { ids } }); toast(`Cleared ${ids.length} background session${ids.length === 1 ? '' : 's'}`); } catch {}
}

// ---------- connect this computer (agent capture / MCP) ----------
// The indicator shows whether agent data is reaching your queue. A browser
// can't run a local command or inspect your machine, so the button hands you
// a personalized one-click script (and a copy-paste command) instead.
function detectOS() {
  const p = (navigator.userAgent + ' ' + (navigator.platform || '')).toLowerCase();
  if (p.includes('win')) return 'win';
  if (p.includes('mac') || p.includes('iphone') || p.includes('ipad')) return 'mac';
  return 'linux';
}

function mcpParts() {
  const url = location.origin;
  const tok = settings.token || '';
  return { url, tok };
}

function mcpScript(os) {
  const { url, tok } = mcpParts();
  const repo = 'https://github.com/acbecquet/rapid-reader';
  if (os === 'win') {
    return ['@echo off', 'setlocal', 'set "DIR=%USERPROFILE%\\rapid-reader"',
      'where git >nul 2>nul || (echo Install Git from https://git-scm.com ^& pause ^& exit /b 1)',
      'where node >nul 2>nul || (echo Install Node.js from https://nodejs.org ^& pause ^& exit /b 1)',
      `if exist "%DIR%\\.git" ( git -C "%DIR%" pull --ff-only ) else ( git clone ${repo} "%DIR%" )`,
      'pushd "%DIR%\\mcp" & call npm install --no-audit --no-fund & popd',
      `where claude >nul 2>nul && call claude mcp add rapid-reader -e RAPID_READER_URL=${url}${tok ? ' -e RAPID_READER_TOKEN=' + tok : ''} -- node "%DIR%\\mcp\\server.mjs"`,
      `node "%DIR%\\hooks\\install.mjs" --url ${url}${tok ? ' --token ' + tok : ''}`,
      `node "%DIR%\\hooks\\sync.mjs" --days 30`,
      'echo Done. Double-click sync-agents.cmd in %DIR% for live updates.', 'pause', ''].join('\r\n');
  }
  return ['#!/bin/sh', 'set -e', 'DIR="$HOME/rapid-reader"',
    "command -v git >/dev/null || { echo 'Install git first'; exit 1; }",
    "command -v node >/dev/null || { echo 'Install Node.js: https://nodejs.org'; exit 1; }",
    `[ -d "$DIR/.git" ] && git -C "$DIR" pull --ff-only || git clone ${repo} "$DIR"`,
    'npm install --prefix "$DIR/mcp" --no-audit --no-fund',
    `command -v claude >/dev/null && claude mcp add rapid-reader -e RAPID_READER_URL=${url}${tok ? ' -e RAPID_READER_TOKEN=' + tok : ''} -- node "$DIR/mcp/server.mjs"`,
    `node "$DIR/hooks/install.mjs" --url ${url}${tok ? ' --token ' + tok : ''}`,
    `node "$DIR/hooks/sync.mjs" --days 30`,
    "echo 'Done. Double-click sync-agents.command for live updates.'", ''].join('\n');
}

function mcpOneLiner(os) {
  const { url, tok } = mcpParts();
  const t = tok ? ` --token ${tok}` : '';
  if (os === 'win') {
    return `git clone https://github.com/acbecquet/rapid-reader "%USERPROFILE%\\rapid-reader" & cd /d "%USERPROFILE%\\rapid-reader" & node hooks\\install.mjs --url ${url}${t} & node hooks\\sync.mjs --days 30`;
  }
  return `git clone https://github.com/acbecquet/rapid-reader ~/rapid-reader 2>/dev/null; cd ~/rapid-reader && node hooks/install.mjs --url ${url}${t} && node hooks/sync.mjs --days 30`;
}

function renderMcpModal() {
  const os = $('mcp-os').value;
  $('mcp-cmd').textContent = mcpOneLiner(os);
  $('mcp-origin').textContent = location.origin;
  $('mcp-note').textContent = settings.token
    ? 'The script uses your own access token — it stays on your computer.'
    : 'Tip: sign in or set your token in ⚙ first, so capture lands in your private queue.';
}

$('mcp-init').onclick = () => { $('mcp-os').value = detectOS(); renderMcpModal(); $('mcpmodal').hidden = false; };
$('mcp-os').onchange = renderMcpModal;
$('mcp-modal-close').onclick = () => { $('mcpmodal').hidden = true; };
$('mcpmodal').onclick = (e) => { if (e.target === $('mcpmodal')) $('mcpmodal').hidden = true; };
$('mcp-copy').onclick = async () => {
  try { await navigator.clipboard.writeText(mcpOneLiner($('mcp-os').value)); toast('Command copied — paste it into a terminal'); }
  catch { toast('Copy failed'); }
};
$('mcp-download').onclick = () => {
  const os = $('mcp-os').value;
  const name = os === 'win' ? 'setup-rapid-reader.cmd' : 'setup-rapid-reader.command';
  const blob = new Blob([mcpScript(os)], { type: 'text/plain' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
  toast(os === 'win' ? 'Downloaded — double-click setup-rapid-reader.cmd' : 'Downloaded — right-click → Open the .command file');
};

// green when agent sessions are reaching this queue, red otherwise
function updateMcp() {
  const on = items.some((it) => it.sourceType === 'claude_code' || it.sourceType === 'codex');
  $('mcp-dot').className = on ? 'on' : 'off';
  $('mcp-label').textContent = on ? 'agents connected' : 'agents off';
}

// ---------- toast ----------
let toastTimer;
// `action` = { label, fn }: shows a clickable button (e.g. Undo) + a longer hold.
function toast(msg, action) {
  const el = $('toast');
  el.textContent = msg;
  if (action) {
    const b = document.createElement('button');
    b.className = 'toast-action';
    b.textContent = action.label;
    b.onclick = () => { el.hidden = true; clearTimeout(toastTimer); action.fn(); };
    el.append(' ', b);
  }
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, action ? 7000 : 2200);
}

// ---------- Google sign-in (optional — token entry still works without it) ----------
let googleClientId = null;

async function initAuth() {
  try {
    ({ clientId: googleClientId } = await (await fetch('api/login')).json());
  } catch {}
  renderAuth();
}

function renderAuth() {
  $('auth').hidden = !googleClientId || !!settings.token;
  if (!$('auth').hidden) mountGsiButton();
}

let gsiMounted = false;
async function mountGsiButton() {
  if (gsiMounted) return;
  gsiMounted = true;
  try {
    await new Promise((ok, err) => {
      if (window.google?.accounts) return ok();
      const s = document.createElement('script');
      s.src = 'https://accounts.google.com/gsi/client';
      s.onload = ok;
      s.onerror = err;
      document.head.append(s);
    });
    window.google.accounts.id.initialize({
      client_id: googleClientId,
      callback: onGoogleCredential,
    });
    window.google.accounts.id.renderButton($('gsi-btn'), {
      theme: 'filled_black', size: 'large', shape: 'pill',
    });
  } catch {
    gsiMounted = false;
    setStatus('could not load Google sign-in — check connection', true);
  }
}

async function onGoogleCredential(resp) {
  try {
    const r = await fetch('api/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ credential: resp.credential }),
    });
    const data = await r.json();
    if (!r.ok) return toast(data.error || 'Sign-in failed');
    settings.token = data.token;
    settings.account = { name: data.name, email: data.email };
    saveSettings();
    fillSettingsForm();
    renderAuth();
    knownIds = null;
    lastRender = '';
    toast('Signed in as ' + (data.email || data.name));
    refresh();
  } catch {
    toast('Sign-in failed — try again');
  }
}

$('s-signout').onclick = () => {
  settings.token = '';
  settings.account = null;
  saveSettings();
  fillSettingsForm();
  items = [];
  knownIds = null;
  lastRender = '';
  closeReader();
  renderColumns();
  renderAuth();
  $('settings').hidden = true;
  setStatus('signed out', true);
};

$('s-copytoken').onclick = async () => {
  try {
    await navigator.clipboard.writeText(settings.token);
    toast('Token copied — paste it into the extension or MCP setup');
  } catch {
    toast('Copy failed — token is in the field below');
  }
};

// ---------- bring-your-own Gemini key (each user spends their own free quota) ----------
// Stored server-side per user (api/prefs geminiKey); the raw key never comes
// back to the browser — the poll only tells us hasGeminiKey / needsGeminiKey.
let keyPromptShown = false; // once per session — don't renag on every poll

function setKeyMsg(msg, err) {
  const el = $('key-msg');
  el.textContent = msg || '';
  el.hidden = !msg;
  el.classList.toggle('err', !!err);
}

function openKeyModal(fromSettings = false) {
  const hasKey = !!prefs?.hasGeminiKey;
  $('key-title').textContent = hasKey ? 'Replace your Gemini key' : 'One quick setup step';
  $('key-input').value = '';
  $('key-skip').textContent = hasKey ? 'Cancel' : 'Skip for now';
  // Auto-nudge only: reassure first-run guests it's optional and re-addable.
  // Hidden when opened from Settings — they're already in the right place.
  $('key-later').hidden = fromSettings;
  setKeyMsg('');
  $('keymodal').hidden = false;
  $('key-input').focus();
}
function closeKeyModal() {
  $('keymodal').hidden = true;
  keyPromptShown = true;
}

// Auto-nudge: only signed-in Google users who still need a key, never if
// they've turned AI off — and at most once per session.
function maybePromptForKey() {
  if (keyPromptShown || !settings.account || settings.aiDisabled) return;
  if (!prefs?.needsGeminiKey) return;
  keyPromptShown = true;
  openKeyModal();
}

async function saveKey() {
  const key = $('key-input').value.trim();
  if (!key) return setKeyMsg('Paste your key first — or tap Get your free key above.', true);
  setKeyMsg('Checking your key…');
  $('key-save').disabled = true;
  try {
    const { prefs: np } = await api('PATCH', 'prefs', { body: { geminiKey: key } });
    prefs = np;
    applyPrefs();
    fillSettingsForm();
    closeKeyModal();
    toast('Gemini key saved — you’re all set ⚡');
  } catch (e) {
    setKeyMsg(e.message || 'That didn’t work — double-check the key and try again.', true);
  } finally {
    $('key-save').disabled = false;
  }
}

$('key-get').onclick = () => { keyPromptShown = true; }; // they're getting one — stop nagging
$('key-paste').onclick = async () => {
  try {
    const t = (await navigator.clipboard.readText()).trim();
    if (t) { $('key-input').value = t; setKeyMsg(''); }
    else setKeyMsg('Clipboard is empty — copy your key first, then tap 📋 again.', true);
  } catch {
    setKeyMsg('Couldn’t read the clipboard — paste the key into the box by hand.', true);
    $('key-input').focus();
  }
};
$('key-save').onclick = saveKey;
$('key-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') saveKey(); });
$('key-skip').onclick = () => {
  const hadKey = !!prefs?.hasGeminiKey;
  closeKeyModal();
  if (!hadKey) toast('No problem — add your free Gemini key anytime in ⚙ Settings');
};
$('keymodal').onclick = (e) => { if (e.target === $('keymodal')) closeKeyModal(); };
$('s-aikey-btn').onclick = () => { $('settings').hidden = true; openKeyModal(true); };

// ---------- share target intake (PWA: select → share → Rapid Reader) ----------
async function intakeShared() {
  const p = new URLSearchParams(location.search);
  const text = (p.get('text') || '').trim() || (p.get('url') || '').trim();
  if (!text) return;
  try {
    await api('POST', 'items', { body: { text, url: p.get('url') || '' } });
    // only drop the params once saved, so a failed share survives a reload
    history.replaceState(null, '', location.pathname);
    toast('Shared text added');
  } catch {
    toast('Could not save shared text — set token in ⚙, then reload');
  }
}

// ---------- boot ----------
// Opening the app as /?token=… stores the token (one-time device setup
// without typing it) and strips it from the URL.
{
  const p = new URLSearchParams(location.search);
  if (p.get('token')) {
    settings.token = p.get('token');
    saveSettings();
    p.delete('token');
    history.replaceState(null, '', location.pathname + (p.size ? '?' + p : ''));
  }
}
applySettings();
console.log('Rapid Reader build', BUILD);
{ const bt = $('build-tag'); if (bt) bt.textContent = 'build ' + BUILD; }
fillSettingsForm();
updateConnectLabel();
initAuth();
if (isMobile()) setBacklog(false); // phones start on the full-screen reader; ▾ opens the backlog sheet
// /?item=<id> (e.g. MCP playbackUrl) deep-links straight into an item.
const wantedItem = new URLSearchParams(location.search).get('item');
intakeShared().then(refresh).then(() => {
  if (!wantedItem) return;
  history.replaceState(null, '', location.pathname);
  const it = items.find((x) => x.id === wantedItem);
  if (it) openItem(it);
});
setInterval(() => { if (document.visibilityState === 'visible') refresh(); }, 10000);
// fast lane: the live-highlight slot is tiny, so poll it on its own ~1s — a
// highlight appears almost instantly instead of waiting for the 10s backlog
// poll. Skipped when capture is off or the tab is hidden, so it stays cheap.
async function pollLive() {
  if (document.visibilityState !== 'visible' || !captureState || !settings.token) return;
  try { const { live } = await api('GET', 'live'); maybeOpenLive(live); } catch {}
}
setInterval(pollLive, 1000);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') { refresh(); pollLive(); }
  else { if (cur) saveProgress(); flushSession(); }
});
addEventListener('focus', pollLive);
addEventListener('pagehide', () => { if (cur) saveProgress(); flushSession(); });
if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js');
}
if (!settings.token) setStatus('set access token in ⚙ to sync', true);
