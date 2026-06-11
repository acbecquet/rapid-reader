const $ = (id) => document.getElementById(id);

chrome.storage.sync.get({ server: '', token: '', instant: false, mode: '' }, (cfg) => {
  $('server').value = cfg.server;
  $('token').value = cfg.token;
  $('mode').value = cfg.mode || (cfg.instant ? 'instant' : 'button');
});

$('save').onclick = async () => {
  const cfg = {
    server: $('server').value.trim().replace(/\/+$/, ''),
    token: $('token').value.trim(),
    mode: $('mode').value,
  };
  await chrome.storage.sync.set(cfg);
  const msg = $('msg');
  msg.textContent = 'testing…';
  msg.className = '';
  if (!cfg.server) {
    msg.textContent = 'Saved. Enter a server URL to test.';
    return;
  }
  try {
    const res = await fetch(cfg.server + '/api/items', {
      headers: cfg.token ? { authorization: 'Bearer ' + cfg.token } : {},
    });
    if (res.ok) {
      const { items } = await res.json();
      msg.textContent = `Saved ✓ — connected, ${items.length} item(s) in backlog`;
      msg.className = 'ok';
    } else if (res.status === 401 || res.status === 503) {
      msg.textContent = 'Saved, but the token was rejected (401). Check RAPID_READER_TOKEN.';
      msg.className = 'err';
    } else {
      msg.textContent = `Saved, but the server returned ${res.status}.`;
      msg.className = 'err';
    }
  } catch {
    msg.textContent = 'Saved, but could not reach the server. Check the URL.';
    msg.className = 'err';
  }
};
