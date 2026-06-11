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
  keepOpen: false, // keep the backlog visible while reading
  transcript: true, // live transcript pane that follows the current word
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
  let para = document.createElement('p');
  cur.tokens.forEach((t, i) => {
    const s = document.createElement('span');
    s.textContent = t.w;
    s.dataset.i = i;
    para.append(s, ' ');
    if (t.paraEnd) {
      box.append(para);
      para = document.createElement('p');
    }
  });
  if (para.childNodes.length) box.append(para);
  box.onclick = (e) => {
    const i = e.target.dataset?.i;
    if (i !== undefined) seek(Number(i));
  };
  applyTranscript();
}

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
  buildTranscript();
  if (!settings.keepOpen) setBacklog(false);
  renderList();
  play();
}

function closeReader() {
  clearTimeout(timer);
  cur = null;
  applyTranscript();
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
  if (!$('settings').hidden || !$('add').hidden) {
    if (e.key === 'Escape') { $('settings').hidden = true; $('add').hidden = true; }
    return;
  }
  if (e.key === 'Escape') {
    if (cur?.playing) pause();
    setBacklog(true);
    return;
  }
  if (!cur) return;
  if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
  else if (e.key === 'ArrowLeft') seek(R.prevSentenceStart(cur.tokens, cur.i));
  else if (e.key === 'ArrowRight') seek(R.nextSentenceStart(cur.tokens, cur.i));
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
intakeShared().then(refresh);
setInterval(() => { if (document.visibilityState === 'visible') refresh(); }, 4000);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') refresh();
});
if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js');
}
if (!settings.token) setStatus('set access token in ⚙ to sync', true);
