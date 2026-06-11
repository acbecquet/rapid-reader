import * as R from './rsvp.js';

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
  token: '',
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
async function api(method, { body, query } = {}) {
  const qs = query ? '?' + new URLSearchParams(query) : '';
  const res = await fetch('api/items' + qs, {
    method,
    headers: {
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(settings.token ? { authorization: 'Bearer ' + settings.token } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw Object.assign(new Error('api ' + res.status), { code: res.status });
  return res.json();
}

// ---------- backlog list ----------
let items = [];
let knownIds = null; // null until first successful fetch
let lastRender = '';

function setStatus(msg, err) {
  $('status').textContent = msg;
  $('status').className = err ? 'err' : '';
}

async function refresh() {
  try {
    const { items: fresh } = await api('GET');
    const newest = knownIds && fresh.find((it) => !knownIds.has(it.id) && !it.readAt);
    items = fresh;
    knownIds = new Set(items.map((i) => i.id));
    renderList();
    setStatus(`synced · ${items.length} item${items.length === 1 ? '' : 's'}`);
    if (newest && settings.autoplay && (!cur || !cur.playing)) {
      openItem(newest);
      toast('New capture — playing');
    }
  } catch (e) {
    setStatus(
      e.code === 401 || e.code === 503
        ? 'unauthorized — set access token in ⚙'
        : 'offline — retrying…',
      true
    );
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

function renderList() {
  const key = JSON.stringify(items.map((i) => [i.id, i.title, i.readAt])) + (cur?.item.id || '');
  if (key === lastRender) return;
  lastRender = key;

  const list = $('list');
  list.textContent = '';
  if (!items.length) {
    const d = document.createElement('div');
    d.className = 'none';
    d.textContent = 'Backlog is empty. Highlight something!';
    list.append(d);
    return;
  }
  let group = '';
  for (const it of items) {
    const g = groupName(it.createdAt);
    if (g !== group) {
      group = g;
      const h = document.createElement('div');
      h.className = 'group';
      h.textContent = g;
      list.append(h);
    }
    const row = document.createElement('div');
    row.className = 'item' + (it.readAt ? '' : ' unread') + (cur?.item.id === it.id ? ' active' : '');
    const t = document.createElement('div');
    t.className = 't';
    t.textContent = it.title;
    const m = document.createElement('div');
    m.className = 'm';
    const words = it.text.split(/\s+/).length;
    m.textContent = [it.source, timeLabel(it.createdAt), words + 'w'].filter(Boolean).join(' · ');
    const del = document.createElement('button');
    del.className = 'del';
    del.textContent = '×';
    del.title = 'Delete';
    del.onclick = async (e) => {
      e.stopPropagation();
      items = items.filter((x) => x.id !== it.id);
      if (cur?.item.id === it.id) closeReader();
      renderList();
      try { await api('DELETE', { query: { id: it.id } }); } catch {}
    };
    row.append(t, m, del);
    row.onclick = () => openItem(it);
    list.append(row);
  }
}

// ---------- player ----------
let cur = null; // { item, tokens, i, playedMs, playing, done }
let timer = null;

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
  updateHud();
}

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
    if (cur.i >= cur.tokens.length - 1) return finish();
    cur.i++;
    tick();
  }, delay);
}

function play() {
  if (!cur) return;
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
  cur.playing = false;
  $('play').textContent = '▶';
  $('paused-hint').hidden = false;
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
  else { showToken(); }
}

function finish() {
  cur.playing = false;
  cur.done = true;
  $('pre').textContent = '';
  $('pivot').textContent = '✓';
  $('post').textContent = '';
  $('bar').style.width = '100%';
  $('time-left').textContent = '0:00';
  $('play').textContent = '▶';
  $('paused-hint').hidden = true;
  markRead(cur.item);
}

async function markRead(item) {
  if (item.readAt) return;
  item.readAt = Date.now();
  renderList();
  try { await api('PATCH', { body: { id: item.id, readAt: item.readAt } }); } catch {}
}

function openItem(item) {
  clearTimeout(timer);
  cur = { item, tokens: R.tokenize(item.text), i: 0, playedMs: 0, playing: false, done: false };
  $('empty').hidden = true;
  $('reader').hidden = false;
  $('item-title').textContent = item.title;
  $('sidebar').classList.remove('open');
  renderList();
  play();
}

function closeReader() {
  clearTimeout(timer);
  cur = null;
  $('reader').hidden = true;
  $('empty').hidden = false;
  renderList();
}

// ---------- controls ----------
$('play').onclick = togglePlay;
$('restart').onclick = () => { if (cur) { cur.playedMs = 0; seek(0); } };
$('back').onclick = () => cur && seek(R.prevSentenceStart(cur.tokens, cur.i));
$('fwd').onclick = () => cur && seek(R.nextSentenceStart(cur.tokens, cur.i));
$('stage').onclick = togglePlay;
$('side-toggle').onclick = () => $('sidebar').classList.toggle('open');

function bumpWpm(d) {
  settings.wpm = Math.max(100, Math.min(1000, settings.wpm + d));
  saveSettings();
  fillSettingsForm();
  if (cur) updateHud();
  toast(settings.wpm + ' wpm target');
}

document.addEventListener('keydown', (e) => {
  if (e.target.matches('input, textarea, select')) return;
  if (!$('settings').hidden || !$('add').hidden) {
    if (e.key === 'Escape') { $('settings').hidden = true; $('add').hidden = true; }
    return;
  }
  if (e.key === 'Escape') {
    if (cur?.playing) pause();
    $('sidebar').classList.add('open');
    return;
  }
  if (!cur) return;
  if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
  else if (e.key === 'ArrowLeft') seek(R.prevSentenceStart(cur.tokens, cur.i));
  else if (e.key === 'ArrowRight') seek(R.nextSentenceStart(cur.tokens, cur.i));
  else if (e.key === 'ArrowUp') { e.preventDefault(); bumpWpm(10); }
  else if (e.key === 'ArrowDown') { e.preventDefault(); bumpWpm(-10); }
});

// ---------- settings UI ----------
function fillSettingsForm() {
  $('s-font').value = settings.font;
  $('s-size').value = settings.size;
  $('s-size-val').textContent = settings.size + 'px';
  $('s-color').value = settings.color;
  $('s-bg').value = settings.bg;
  $('s-wpm').value = settings.wpm;
  $('s-wpm-val').textContent = settings.wpm;
  $('s-mode').value = settings.mode;
  $('s-autoplay').checked = settings.autoplay;
  $('s-token').value = settings.token;
}

$('settings-btn').onclick = () => { fillSettingsForm(); $('settings').hidden = false; };
$('s-close').onclick = () => { $('settings').hidden = true; refresh(); };
$('settings').onclick = (e) => { if (e.target === $('settings')) { $('settings').hidden = true; refresh(); } };

const bind = (id, key, parse = (v) => v) => {
  $(id).oninput = (e) => {
    settings[key] = parse(e.target.type === 'checkbox' ? e.target.checked : e.target.value);
    saveSettings();
    $('s-size-val').textContent = settings.size + 'px';
    $('s-wpm-val').textContent = settings.wpm;
    if (cur) updateHud();
  };
};
bind('s-font', 'font');
bind('s-size', 'size', Number);
bind('s-color', 'color');
bind('s-bg', 'bg');
bind('s-wpm', 'wpm', Number);
bind('s-mode', 'mode');
bind('s-autoplay', 'autoplay');
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
  try {
    await api('POST', { body: { text } });
    toast('Added to backlog');
    await refresh();
  } catch {
    toast('Failed to add — check token');
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

// ---------- share target intake (PWA: select → share → Rapid Reader) ----------
async function intakeShared() {
  const p = new URLSearchParams(location.search);
  const text = (p.get('text') || '').trim() || (p.get('url') || '').trim();
  if (!text) return;
  try {
    await api('POST', { body: { text, url: p.get('url') || '' } });
    // only drop the params once saved, so a failed share survives a reload
    history.replaceState(null, '', location.pathname);
    toast('Shared text added');
  } catch {
    toast('Could not save shared text — set token in ⚙, then reload');
  }
}

// ---------- boot ----------
applySettings();
fillSettingsForm();
// On narrow screens (phone / tight corner) start with the backlog visible.
if (matchMedia('(max-width: 600px)').matches) $('sidebar').classList.add('open');
intakeShared().then(refresh);
setInterval(() => { if (document.visibilityState === 'visible') refresh(); }, 4000);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') refresh();
});
if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js');
}
if (!settings.token) setStatus('set access token in ⚙ to sync', true);
