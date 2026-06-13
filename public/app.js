import * as R from './rsvp.js';
import * as P from './parse.js';
import * as E from './epub.js';
import { icon } from './icons.js';

const $ = (id) => document.getElementById(id);

// ---------- settings ----------
const DEFAULTS = {
  font: 'system-ui, sans-serif',
  size: 42,
  color: '#eaeaea',
  bg: '#101014',
  wpm: 300,
  mode: 'standard', // 'standard' | 'build'
  autoplay: true,
  keepOpen: false, // keep the backlog visible while reading
  transcript: true, // live transcript pane that follows the current word
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
    setStatus(`synced · ${items.length} item${items.length === 1 ? '' : 's'}`);
    // an upserted item (e.g. a live Claude session) refreshes the open reader
    const open = cur && !cur.item.live && fresh.find((it) => it.id === cur.item.id);
    if (open && !cur.playing && itemSig(open) !== cur.sig) {
      open.progress = cur.i;
      openItem(open, { start: false });
      toast('Updated with new content');
    } else if (newest && settings.autoplay && (!cur || !cur.playing)) {
      openItem(newest);
      toast('New capture — playing');
    } else {
      maybeOpenLive(live);
    }
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

// collapsed project groups, persisted: keyed `${columnId}/${group}`
const collapsedGroups = new Set(JSON.parse(localStorage.getItem('rr:collapsed') || '[]'));
function toggleGroup(gkey) {
  collapsedGroups.has(gkey) ? collapsedGroups.delete(gkey) : collapsedGroups.add(gkey);
  localStorage.setItem('rr:collapsed', JSON.stringify([...collapsedGroups]));
  lastRender = ''; renderColumns();
}

function renderColumns() {
  const key = JSON.stringify(items.map((i) => [i.id, i.title, i.readAt, i.progress, i.archivedAt, i.group]))
    + (cur?.item.id || '') + JSON.stringify(prefs?.columns || []) + [...selected].join(',') + [...collapsedGroups].join(',');
  if (key === lastRender) return;
  lastRender = key;

  const wrap = $('columns');
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
    const list = byCol[col.id] || [];
    const c = document.createElement('div');
    c.className = 'col';
    const h = document.createElement('div');
    h.className = 'col-h';
    h.innerHTML = `<span class="col-i">${icon(col.icon)}</span><span class="col-n">${col.name}</span><span class="col-c">${list.length}</span>`;
    c.append(h);
    const body = document.createElement('div');
    body.className = 'col-body';
    renderColBody(body, col, list);
    c.append(body);
    wrap.append(c);
  }
  renderSelbar();
}

// Within a column, items with a `group` (e.g. a Claude project folder) render
// under collapsible sub-headers — like the Claude Code sidebar. Ungrouped
// items render flat at the top.
function renderColBody(body, col, list) {
  const ungrouped = list.filter((it) => !it.group);
  for (const it of ungrouped) body.append(itemRow(it, col.id, list));

  const groups = new Map();
  for (const it of list) if (it.group) {
    if (!groups.has(it.group)) groups.set(it.group, []);
    groups.get(it.group).push(it);
  }
  for (const [name, gItems] of groups) {
    const gkey = col.id + '/' + name;
    const collapsed = collapsedGroups.has(gkey);
    const gh = document.createElement('div');
    gh.className = 'group' + (collapsed ? ' collapsed' : '');
    gh.innerHTML = `<span class="caret">▾</span><span class="g-n">${name}</span><span class="g-c">${gItems.length}</span>`;
    gh.onclick = () => toggleGroup(gkey);
    body.append(gh);
    if (!collapsed) for (const it of gItems) body.append(itemRow(it, col.id, gItems));
  }
}

function itemRow(it, colId, colItems) {
  const words = it.words || 0;
  const pct = !it.readAt && it.progress > 0 && words ? Math.round((it.progress / words) * 100) + '%' : '';
  const row = document.createElement('div');
  row.className = 'item'
    + (it.readAt ? '' : ' unread')
    + (cur?.item.id === it.id ? ' active' : '')
    + (selected.has(it.id) ? ' sel' : '');
  row.title = [SOURCE_LABEL[it.sourceType] || it.source, timeLabel(it.createdAt), words + 'w', pct]
    .filter(Boolean).join(' · ');
  const t = document.createElement('div');
  t.className = 't';
  t.textContent = it.title;
  row.append(t);
  row.onclick = (e) => {
    if (e.metaKey || e.ctrlKey) { toggleSelect(it.id); lastClick[colId] = it.id; return; }
    if (e.shiftKey) { selectRange(colId, colItems, it.id); return; }
    if (selected.size) { clearSelection(); }
    lastClick[colId] = it.id;
    cur?.item.id === it.id ? closeReader() : openItem(it);
  };
  return row;
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
    items = items.filter((x) => !selected.has(x.id));
    if (cur && selected.has(cur.item.id)) closeReader();
    clearSelection();
    api('DELETE', 'items', { body: { ids } }).catch(() => {});
  });
  act('Clear', clearSelection);
}

function bulk(mutate, patch) {
  const ids = [...selected];
  for (const it of items) if (selected.has(it.id)) mutate(it);
  clearSelection();
  for (const id of ids) api('PATCH', 'items', { body: { id, ...patch } }).catch(() => {});
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
    const del = document.createElement('button');
    del.className = 'chip';
    del.textContent = '× remove';
    del.onclick = () => { draftCols.splice(idx, 1); renderColCfg(); };
    card.append(name, srcs, del);
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
  { id: 'agents', name: 'Agents', icon: 'agents', sources: ['claude_code', 'codex', 'copilot'] },
  { id: 'books', name: 'Books', icon: 'book', sources: ['book'] },
  { id: 'email', name: 'Email', icon: 'email', sources: ['email'] },
  { id: 'news', name: 'News', icon: 'news', sources: ['article', 'web'] },
  { id: 'general', name: 'General', icon: 'general', sources: ['manual', 'docs', 'telegram', 'other'] },
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
  return settings.mode === 'build' ? R.buildWpm(cur.playedMs, settings.wpm) : settings.wpm;
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
  cur.sections.forEach((sec, idx) => {
    if (!bySec[idx].length) return;
    if (sec.type === 'code') {
      // show the real code here — this is where you read it normally
      const pre = document.createElement('pre');
      pre.textContent = sec.raw.replace(/^\s*(```|~~~).*\n?/, '').replace(/\n?\s*(```|~~~)\s*$/, '');
      pre.dataset.i = bySec[idx][0][1];
      box.append(pre);
      return;
    }
    const para = document.createElement('p');
    if (sec.type === 'heading') para.className = 'h';
    for (const [t, i] of bySec[idx]) {
      const s = document.createElement('span');
      s.textContent = t.w;
      s.dataset.i = i;
      if (t.link) s.classList.add('link');
      para.append(s, ' ');
    }
    box.append(para);
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
  $('transcript').hidden = !settings.transcript || !cur;
  $('script-btn').classList.toggle('on', settings.transcript);
  if (cur) markTranscript();
}

function markTranscript() {
  if (!settings.transcript || $('transcript').hidden) return;
  nowSpan?.classList.remove('now');
  nowSpan = $('transcript').querySelector(`[data-i="${cur.i}"]`);
  if (nowSpan) {
    nowSpan.classList.add('now');
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
  $('paused-hint').hidden = true;
  tick();
}

function pause() {
  clearTimeout(timer);
  if (cur.playing && sess) sess.pauses += 1;
  cur.playing = false;
  $('play').textContent = '▶';
  $('paused-hint').hidden = false;
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
  $('paused-hint').hidden = true;
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
    title: '⚡ ' + (source || 'live highlight'),
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
    } catch {
      toast('Could not load that item');
      return;
    }
  }
  clearTimeout(timer);
  if (cur) saveProgress();
  startSession(item);
  const sections = P.parseStructure(text);
  const tokens = P.readingTokens(sections);
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
  $('empty').hidden = true;
  $('reader').hidden = false;
  $('item-title').textContent = item.title;
  $('keep-btn').hidden = !item.live;
  buildSectionNav();
  buildTranscript();
  if (!settings.keepOpen) setBacklog(false);
  renderColumns();
  if (start) {
    play();
  } else {
    showToken();
    $('play').textContent = '▶';
    $('paused-hint').hidden = false;
  }
}

$('close-reader').onclick = () => closeReader();

function closeReader() {
  clearTimeout(timer);
  if (cur) saveProgress();
  flushSession();
  cur = null;
  applyTranscript();
  $('reader').hidden = true;
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
  if (e.target.matches('input, textarea, select')) return;
  const modals = ['settings', 'add', 'rawview', 'stats', 'linkmodal', 'colcfg'];
  const open = modals.find((m) => !$(m).hidden);
  if (open) {
    if (e.key === 'Escape') $(open).hidden = true;
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
  $('s-mode').value = settings.mode;
  $('s-autoplay').checked = settings.autoplay;
  $('s-keepopen').checked = settings.keepOpen;
  $('s-token').value = settings.token;
  $('s-account').hidden = !settings.account;
  if (settings.account) $('s-email').textContent = settings.account.email || settings.account.name;
}

$('settings-btn').onclick = () => { fillSettingsForm(); $('settings').hidden = false; };
$('s-close').onclick = () => { $('settings').hidden = true; refresh(); };
$('settings').onclick = (e) => { if (e.target === $('settings')) { $('settings').hidden = true; refresh(); } };

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
bind('s-mode', 'mode');
bind('s-autoplay', 'autoplay');
bind('s-keepopen', 'keepOpen');
$('s-keepopen').addEventListener('input', (e) => { if (e.target.checked) setBacklog(true); });
bind('s-token', 'token');

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
    const text = E.compileBook(book);
    const { item } = await api('POST', 'items', {
      body: {
        text,
        title: book.title + (book.author ? ' — ' + book.author : ''),
        sourceType: 'book',
        words: text.split(/\s+/).length,
      },
    });
    toast(`📖 ${book.title} — ${book.chapters.length} chapters added`);
    await refresh();
  } catch (err) {
    toast('Could not read that EPUB — ' + (err.message || 'is it DRM-free?'));
  }
};

// ---------- toast ----------
let toastTimer;
function toast(msg) {
  $('toast').textContent = msg;
  $('toast').hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { $('toast').hidden = true; }, 2200);
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
fillSettingsForm();
initAuth();
// /?item=<id> (e.g. MCP playbackUrl) deep-links straight into an item.
const wantedItem = new URLSearchParams(location.search).get('item');
intakeShared().then(refresh).then(() => {
  if (!wantedItem) return;
  history.replaceState(null, '', location.pathname);
  const it = items.find((x) => x.id === wantedItem);
  if (it) openItem(it);
});
setInterval(() => { if (document.visibilityState === 'visible') refresh(); }, 4000);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') refresh();
  else { if (cur) saveProgress(); flushSession(); }
});
addEventListener('pagehide', () => { if (cur) saveProgress(); flushSession(); });
if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js');
}
if (!settings.token) setStatus('set access token in ⚙ to sync', true);
