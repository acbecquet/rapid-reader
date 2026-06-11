import * as R from './rsvp.js';
import * as P from './parse.js';

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
  copilot: 'copilot', docs: 'docs', email: 'email', article: 'article', other: 'other',
};
let items = [];
let knownIds = null; // null until first successful fetch
let lastRender = '';
let filter = 'all'; // all | unread | done | archived | <sourceType>

function setStatus(msg, err) {
  $('status').textContent = msg;
  $('status').className = err ? 'err' : '';
}

async function refresh() {
  try {
    const { items: fresh, live } = await api('GET', 'items');
    const newest = knownIds && fresh.find((it) => !knownIds.has(it.id) && !it.readAt);
    items = fresh;
    knownIds = new Set(items.map((i) => i.id));
    renderList();
    setStatus(`synced · ${items.length} item${items.length === 1 ? '' : 's'}`);
    if (newest && settings.autoplay && (!cur || !cur.playing)) {
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

function matchesFilter(it) {
  if (filter === 'archived') return !!it.archivedAt;
  if (it.archivedAt) return false;
  if (filter === 'all') return true;
  if (filter === 'unread') return !it.readAt;
  if (filter === 'done') return !!it.readAt;
  return (it.sourceType || 'web') === filter;
}

function renderFilters() {
  const bar = $('filters');
  if (!items.length) { bar.hidden = true; return; }
  bar.hidden = false;
  const sources = [...new Set(items.filter((i) => !i.archivedAt).map((i) => i.sourceType || 'web'))];
  const chips = [
    ['all', 'all'], ['unread', 'unread'], ['done', 'done'],
    ...sources.map((s) => [s, SOURCE_LABEL[s] || s]),
    ...(items.some((i) => i.archivedAt) ? [['archived', 'archived']] : []),
  ];
  if (!chips.some(([k]) => k === filter)) filter = 'all';
  bar.textContent = '';
  for (const [key, label] of chips) {
    const b = document.createElement('button');
    b.className = 'chip' + (filter === key ? ' on' : '');
    b.textContent = label;
    b.onclick = () => { filter = key; lastRender = ''; renderList(); };
    bar.append(b);
  }
}

function renderList() {
  const key = JSON.stringify(items.map((i) => [i.id, i.title, i.readAt, i.progress, i.archivedAt]))
    + (cur?.item.id || '') + filter;
  if (key === lastRender) return;
  lastRender = key;
  renderFilters();

  const list = $('list');
  list.textContent = '';
  const visible = items.filter(matchesFilter);
  if (!visible.length) {
    const d = document.createElement('div');
    d.className = 'none';
    d.textContent = items.length ? 'Nothing here.' : 'Backlog is empty. Highlight something!';
    list.append(d);
    return;
  }
  let group = '';
  for (const it of visible) {
    const g = groupName(it.createdAt);
    if (g !== group) {
      group = g;
      const h = document.createElement('div');
      h.className = 'group';
      h.textContent = g;
      list.append(h);
    }
    const row = document.createElement('div');
    row.className = 'item'
      + (it.readAt || it.archivedAt ? '' : ' unread')
      + (cur?.item.id === it.id ? ' active' : '')
      + (it.archivedAt ? ' archived' : '');
    const t = document.createElement('div');
    t.className = 't';
    t.textContent = it.title;
    const m = document.createElement('div');
    m.className = 'm';
    const words = it.text.split(/\s+/).length;
    const pct = !it.readAt && it.progress > 0 ? Math.round((it.progress / words) * 100) + '%' : '';
    m.textContent = [SOURCE_LABEL[it.sourceType] || it.source, timeLabel(it.createdAt), words + 'w', pct]
      .filter(Boolean).join(' · ');

    const acts = document.createElement('div');
    acts.className = 'acts';
    const mk = (txt, title, fn) => {
      const b = document.createElement('button');
      b.textContent = txt;
      b.title = title;
      b.onclick = (e) => { e.stopPropagation(); fn(); };
      acts.append(b);
    };
    mk('✓', it.readAt ? 'Mark unread' : 'Mark reviewed', () => {
      it.readAt = it.readAt ? null : Date.now();
      renderList();
      api('PATCH', 'items', { body: { id: it.id, readAt: it.readAt } }).catch(() => {});
    });
    mk(it.archivedAt ? '⤴' : '⤵', it.archivedAt ? 'Unarchive' : 'Archive', () => {
      it.archivedAt = it.archivedAt ? null : Date.now();
      renderList();
      api('PATCH', 'items', { body: { id: it.id, archivedAt: it.archivedAt } }).catch(() => {});
    });
    mk('×', 'Delete', () => {
      items = items.filter((x) => x.id !== it.id);
      if (cur?.item.id === it.id) closeReader();
      renderList();
      api('DELETE', 'items', { query: { id: it.id } }).catch(() => {});
    });

    row.append(t, m, acts);
    row.onclick = () => openItem(it);
    list.append(row);
  }
}

// ---------- player ----------
let cur = null; // { item, sections, tokens, anchors, i, playedMs, playing, done, fromSummary }
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
    renderList();
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
  renderList();
  try { await api('PATCH', 'items', { body: { id: item.id, readAt: item.readAt, progress: 0 } }); } catch {}
}

function saveProgress() {
  if (!cur || cur.done) return;
  const it = cur.item;
  // progress only tracks the original-text stream; summaries are short
  if (it.live || cur.fromSummary || cur.i < 5 || it.progress === cur.i) return;
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
    summary: null,
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
function openItem(item, { start = true } = {}) {
  clearTimeout(timer);
  if (cur) saveProgress();
  startSession(item);
  const fromSummary = !!item.summary;
  const sections = P.parseStructure(fromSummary ? item.summary : item.text);
  const tokens = P.readingTokens(sections);
  const anchors = [];
  sections.forEach((s, idx) => {
    if (s.type === 'heading') {
      const at = tokens.findIndex((t) => t.sec === idx);
      if (at !== -1) anchors.push({ sec: idx, title: s.title, at });
    }
  });
  cur = { item, sections, tokens, anchors, i: 0, playedMs: 0, playing: false, done: false, fromSummary };
  if (!fromSummary && item.progress > 5 && item.progress < tokens.length - 1) {
    cur.i = item.progress;
    toast('Resumed — ⟲ to restart');
  }
  $('empty').hidden = true;
  $('reader').hidden = false;
  $('item-title').textContent = (fromSummary ? '∑ ' : '') + item.title;
  $('summarize-btn').hidden = fromSummary || item.live || !P.isCodeHeavy(item.text);
  $('keep-btn').hidden = !item.live;
  buildSectionNav();
  buildTranscript();
  if (!settings.keepOpen) setBacklog(false);
  renderList();
  if (start) {
    play();
  } else {
    showToken();
    $('play').textContent = '▶';
    $('paused-hint').hidden = false;
  }
}

function closeReader() {
  clearTimeout(timer);
  if (cur) saveProgress();
  flushSession();
  cur = null;
  applyTranscript();
  $('reader').hidden = true;
  $('empty').hidden = false;
  renderList();
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

// ---------- summarize (code/diff → language) ----------
$('summarize-btn').onclick = async () => {
  if (!cur) return;
  pause();
  const btn = $('summarize-btn');
  btn.disabled = true;
  btn.textContent = 'summarizing…';
  try {
    const { item } = await api('PATCH', 'items', { body: { id: cur.item.id, summarize: true } });
    cur.item.summary = item.summary;
    toast('Summary ready — playing');
    openItem(cur.item);
  } catch (e) {
    toast(e.message || 'Summary failed');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Σ summarize';
  }
};

// ---------- raw source view ----------
$('raw-btn').onclick = () => {
  if (!cur) return;
  if (cur.playing) pause();
  $('raw-text').textContent = cur.item.text;
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
  const modals = ['settings', 'add', 'rawview', 'stats', 'linkmodal'];
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

// ---------- add text ----------
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
    await api('POST', 'items', { body: { text, sourceType: $('add-source').value } });
    toast(isUrl ? 'Page added to backlog' : 'Added to backlog');
    await refresh();
  } catch (e) {
    toast(e.message || 'Failed to add — check token');
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
  renderList();
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
