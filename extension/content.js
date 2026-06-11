// Offers a small "▸ RSVP" button near a fresh text selection, or sends it
// instantly when instant mode is on. The POST happens in background.js.
let btn = null;

document.addEventListener('mouseup', (e) => {
  if (btn && btn.contains(e.target)) return;
  setTimeout(maybeOffer, 0); // selection state settles after mouseup
});

document.addEventListener('selectionchange', () => {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed) removeBtn();
});

function selectedText() {
  const sel = window.getSelection();
  return sel && !sel.isCollapsed ? sel.toString().trim() : '';
}

function maybeOffer() {
  const text = selectedText();
  if (text.split(/\s+/).length < 3) return removeBtn(); // ignore stray selections
  chrome.storage.sync.get({ instant: false }, ({ instant }) => {
    if (instant) {
      send(text);
      window.getSelection().removeAllRanges();
    } else {
      showBtn(text);
    }
  });
}

function send(text) {
  removeBtn();
  chrome.runtime.sendMessage(
    { type: 'capture', text, url: location.href },
    (resp) => toast(resp?.ok ? '✓ sent to Rapid Reader' : '✗ ' + (resp?.error || 'failed'))
  );
}

function showBtn(text) {
  removeBtn();
  const sel = window.getSelection();
  if (!sel.rangeCount) return;
  const rect = sel.getRangeAt(0).getBoundingClientRect();
  btn = document.createElement('button');
  btn.textContent = '▸ RSVP';
  Object.assign(btn.style, {
    position: 'fixed',
    left: Math.min(rect.right, window.innerWidth - 70) + 'px',
    top: Math.min(rect.bottom + 6, window.innerHeight - 32) + 'px',
    zIndex: 2147483647,
    background: '#16161c',
    color: '#eaeaea',
    border: '1px solid #e0443e',
    borderRadius: '6px',
    padding: '3px 9px',
    font: '12px system-ui, sans-serif',
    cursor: 'pointer',
    boxShadow: '0 2px 10px rgba(0,0,0,.4)',
  });
  btn.addEventListener('mousedown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    send(text);
  });
  document.documentElement.append(btn);
}

function removeBtn() {
  btn?.remove();
  btn = null;
}

function toast(msg) {
  const el = document.createElement('div');
  el.textContent = msg;
  Object.assign(el.style, {
    position: 'fixed',
    right: '14px',
    bottom: '14px',
    zIndex: 2147483647,
    background: '#16161c',
    color: '#eaeaea',
    border: '1px solid #26262e',
    borderRadius: '8px',
    padding: '7px 13px',
    font: '12px system-ui, sans-serif',
    pointerEvents: 'none',
  });
  document.documentElement.append(el);
  setTimeout(() => el.remove(), 1800);
}
