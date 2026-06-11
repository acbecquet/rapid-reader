// POSTs captured text to the Rapid Reader server. Runs the fetch here (not
// in the content script) so page CSP can't block it.
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'rr-send',
    title: 'Send to Rapid Reader',
    contexts: ['selection'],
  });
});

chrome.contextMenus.onClicked.addListener((info) => {
  if (info.menuItemId === 'rr-send' && info.selectionText) {
    capture({ text: info.selectionText, url: info.pageUrl }).then((r) => flashBadge(r.ok));
  }
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'capture') {
    capture(msg).then(sendResponse);
    return true; // async response
  }
  if (msg.type === 'live') {
    // silent mirror to the ephemeral live slot; only failures get a badge
    capture(msg, 'live').then((r) => { if (!r.ok) flashBadge(false); });
  }
});

async function capture({ text, url }, path = 'items') {
  const { server, token } = await chrome.storage.sync.get({ server: '', token: '' });
  if (!server) return { ok: false, error: 'set server URL in extension options' };
  try {
    const res = await fetch(server.replace(/\/+$/, '') + '/api/' + path, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: 'Bearer ' + token } : {}),
      },
      body: JSON.stringify({ text, url }),
    });
    if (res.status === 401) return { ok: false, error: 'bad token — check options' };
    if (!res.ok) return { ok: false, error: 'server error ' + res.status };
    return { ok: true };
  } catch {
    return { ok: false, error: 'network error — check server URL' };
  }
}

function flashBadge(ok) {
  chrome.action.setBadgeBackgroundColor({ color: ok ? '#2e7d32' : '#c62828' });
  chrome.action.setBadgeText({ text: ok ? '✓' : '!' });
  setTimeout(() => chrome.action.setBadgeText({ text: '' }), 1500);
}
