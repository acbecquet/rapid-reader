// Self-feedback harness: drives the real app in a headless browser at desktop
// AND mobile viewports, seeds representative data, runs input scenarios, and
// writes screenshots + the transcript DOM to tools/harness/shots/. This is how
// we iterate to exactly the described behaviour instead of approximating, with
// no human in the loop.
//
// Sandbox-only (Linux). Uses the npm-bundled serverless Chromium so it works
// within this environment's egress allowlist (Playwright's own browser CDN is
// blocked here). One-time install, not added to package.json so it never touches
// the Vercel deploy:
//   npm i --no-save puppeteer-core @sparticuz/chromium@119.0.2
// Run:  node tools/harness/observe.mjs

import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const SHOTS = join(HERE, 'shots');
const PORT = 3210;
const BASE = `http://localhost:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const VIEWPORTS = {
  desktop: { width: 1280, height: 820, isMobile: false, hasTouch: false, deviceScaleFactor: 1 },
  mobile: { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
};

// A Claude transcript with real structure (sentinels + headings + bullets +
// numbered list + a code fence) so we can see exactly how faithfully it mirrors.
const AGENT_BODY = `[[rr:you]]
Give me the overnight overview.
[[rr:claude]]
## Overnight overview — everything done

### 0. Housekeeping (committed to main)

You asked me to commit the pending repo work first. I split it cleanly:

- feat: tank crew GUNNER — the gunner-scope feature you approved.
- fix: friendly armor no longer flagged as enemy (EnemyScanner).
- fix: TTS audible inside vehicles (BodyVoicePlayer hosts audio).

### 1. Issue — volume doubled

**Root cause:** \`TtsVolume\` and \`RadioVolume\` are \`Clamp01\`'d, so they cap at 1.0.

| Lever | Before | After |
|---|---|---|
| VoiceGain | 2 | 4 |
| RadioGain | 1 | 2 |

\`\`\`js
const VoiceGain = 4; // was 2 — doubled at the PCM level
\`\`\`

### 2. Execution

1. Order reliability + verbose actions.
2. Speaking indicator (world-space dot).
3. Prompt hardening, lossless.
`;

const NEWS_BODY = `# GLP-1 Therapies Silence Spontaneous Physical Activity

A new study reports that GLP-1 receptor agonists reduce spontaneous movement.

- Mice moved less without losing coordination.
- The effect was dose dependent.

The authors caution that the finding needs replication in humans.`;

// four manual notes give the General column enough rows to reorder/rename/delete
const NOTES = ['Alpha note', 'Bravo note', 'Charlie note', 'Delta note'];

async function waitForServer(ms = 12000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try { if ((await fetch(`${BASE}/api/health`)).ok) return; } catch {}
    await sleep(200);
  }
  throw new Error('dev server did not come up on ' + BASE);
}

async function seed() {
  const post = (body) => fetch(`${BASE}/api/items`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  await post({ sourceType: 'claude_code', sessionId: 'harness:overnight', text: AGENT_BODY });
  await post({ sourceType: 'article', title: 'GLP-1 Therapies Silence Spontaneous Physical Activity', text: NEWS_BODY });
  for (const n of NOTES) await post({ sourceType: 'manual', text: n + ' — a short note to read later.' });
}

async function loadBrowser() {
  try {
    const chromium = (await import('@sparticuz/chromium')).default;
    const puppeteer = (await import('puppeteer-core')).default;
    return await puppeteer.launch({
      args: chromium.args, executablePath: await chromium.executablePath(), headless: 'shell',
    });
  } catch (e) {
    console.error('\nCould not start the browser. One-time install (sandbox-only, not committed):');
    console.error('  npm i --no-save puppeteer-core @sparticuz/chromium@119.0.2\n');
    throw e;
  }
}

const shoot = (page, name) => page.screenshot({ path: join(SHOTS, name + '.png') }).then(() => console.log('  shot', name));

async function openApp(browser, vp) {
  const page = await browser.newPage();
  await page.setViewport(VIEWPORTS[vp]);
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.col, .none', { timeout: 8000 }).catch(() => {});
  await sleep(800); // let the first poll render
  return page;
}

// titles in a named column, top to bottom
const colTitles = (page, colId) => page.evaluate((id) =>
  [...document.querySelectorAll(`.col[data-col="${id}"] .item .t`)].map((e) => e.textContent.trim()), colId);

// ---------- Phase A: observe the transcript mirroring (both viewports) ----------
async function observe(browser) {
  for (const vp of Object.keys(VIEWPORTS)) {
    console.log('observe:', vp);
    const page = await openApp(browser, vp);
    await shoot(page, `${vp}-01-backlog`);
    const opened = await page.evaluate(() => {
      const t = [...document.querySelectorAll('.item .t')].find((e) => /overnight|overview|housekeeping/i.test(e.textContent));
      if (!t) return false;
      t.closest('.item').click();
      return true;
    });
    await sleep(700);
    await shoot(page, `${vp}-02-transcript`);
    if (opened) writeFileSync(join(SHOTS, `${vp}-transcript.html`),
      await page.evaluate(() => document.getElementById('transcript')?.innerHTML || '(none)'));
    await page.close();
  }
}

// ---------- Phase B: verify the five backlog features (desktop) ----------
async function verifyB(browser) {
  const page = await openApp(browser, 'desktop');
  const r = {};

  // PREVIEW — the agent item shows a dim second line
  r.preview = await page.evaluate(() =>
    !!document.querySelector('.col[data-col="agents"] .item .item-pv')?.textContent.trim());

  // RENAME — double-click a title, select-all is automatic, type, Enter
  try {
    const before = await colTitles(page, 'general');
    const handles = await page.$$('.col[data-col="general"] .item .t');
    let h = null;
    for (const x of handles) if ((await x.evaluate((e) => e.textContent)).includes('Delta')) { h = x; break; }
    // genuine double-click: two down/up at the same point (clickCount:2 and two
    // separate click() calls do NOT reliably fire the 'dblclick' event)
    const box = await h.boundingBox();
    const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
    await page.mouse.move(cx, cy);
    await page.mouse.down({ clickCount: 1 }); await page.mouse.up({ clickCount: 1 });
    await page.mouse.down({ clickCount: 2 }); await page.mouse.up({ clickCount: 2 });
    await sleep(200);
    let editable = await page.evaluate(() => !!document.querySelector('.item .t[contenteditable="true"]'));
    r.rename_dbg_mouseDblclick = editable;
    if (!editable) {
      // isolate the edit path from gesture detection
      await page.evaluate(() => [...document.querySelectorAll('.col[data-col="general"] .item .t')]
        .find((e) => e.textContent.includes('Delta'))
        ?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true })));
      await sleep(200);
      editable = await page.evaluate(() => !!document.querySelector('.item .t[contenteditable="true"]'));
      r.rename_dbg_syntheticDblclick = editable;
    }
    r.rename_dbg_state = await page.evaluate(() => ({
      active: (document.activeElement?.tagName || '') + '.' + (document.activeElement?.className || ''),
      activeEditable: document.activeElement?.isContentEditable === true,
      sel: getSelection().toString().slice(0, 30),
    }));
    await page.keyboard.type('Renamed by harness');
    await sleep(80);
    r.rename_dbg_afterType = await page.evaluate(() =>
      document.querySelector('.item .t[contenteditable="true"]')?.textContent?.slice(0, 40) ?? '(not editable)');
    await page.keyboard.press('Enter');
    await sleep(300);
    r.rename_dbg_afterEnter = await page.evaluate(() => ({
      stillEditable: !!document.querySelector('.item .t[contenteditable="true"]'),
    }));
    const after = await colTitles(page, 'general');
    r.rename = after.some((t) => t.includes('Renamed by harness')) && !after.some((t) => t.includes('Delta'));
    r.rename_before = before; r.rename_after = after;
  } catch (e) { r.rename = 'ERR ' + e.message; }
  await shoot(page, 'desktop-03-after-rename');

  // DRAG-REORDER — synthesize an HTML5 drag of the bottom note onto the top one
  try {
    const before = await colTitles(page, 'general');
    await page.evaluate(() => {
      const items = [...document.querySelectorAll('.col[data-col="general"] .item')];
      const src = items[items.length - 1]; // bottom
      const tgt = items[0];                 // top
      const dt = new DataTransfer();
      const fire = (el, type) => el.dispatchEvent(new DragEvent(type, { dataTransfer: dt, bubbles: true, cancelable: true }));
      fire(src, 'dragstart'); fire(tgt, 'dragover'); fire(tgt, 'drop'); fire(src, 'dragend');
    });
    await sleep(300);
    const after = await colTitles(page, 'general');
    r.drag = before.length > 1 && after[0] === before[before.length - 1] && JSON.stringify(after) !== JSON.stringify(before);
    r.drag_before = before; r.drag_after = after;
  } catch (e) { r.drag = 'ERR ' + e.message; }
  await shoot(page, 'desktop-04-after-drag');

  // DELETE — click the ✕ on a note, expect it gone + an Undo toast
  try {
    const before = await colTitles(page, 'general');
    const target = before.find((t) => t.includes('Bravo')) || before[0];
    const dels = await page.$$('.col[data-col="general"] .item');
    for (const item of dels) {
      const txt = await item.evaluate((e) => e.querySelector('.t')?.textContent || '');
      if (txt.includes(target.slice(0, 6))) { await (await item.$('.item-del')).click(); break; }
    }
    await sleep(300);
    const after = await colTitles(page, 'general');
    const toast = await page.evaluate(() => { const t = document.getElementById('toast'); return t && !t.hidden ? t.textContent : ''; });
    r.delete = after.length === before.length - 1 && /Deleted/i.test(toast);
    r.delete_toast = toast;
  } catch (e) { r.delete = 'ERR ' + e.message; }
  await shoot(page, 'desktop-05-after-delete');

  // THEME — open ▦, set the General column's colour, close, expect it themed
  try {
    await page.click('#cols-btn');
    await sleep(250);
    await page.evaluate(() => {
      const rows = [...document.querySelectorAll('.colcfg-row')];
      const row = rows.find((x) => x.querySelector('.colcfg-name')?.value.toLowerCase() === 'general') || rows[0];
      const c = row.querySelector('.colcfg-color');
      c.value = '#3aa0ff';
      c.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await page.click('#colcfg-close');
    await sleep(400);
    r.theme = await page.evaluate(() => {
      const col = document.querySelector('.col[data-col="general"]');
      return !!col && col.classList.contains('themed') && getComputedStyle(col).getPropertyValue('--col-accent').trim() !== '';
    });
  } catch (e) { r.theme = 'ERR ' + e.message; }
  await shoot(page, 'desktop-06-after-theme');

  console.log('\nB verification:', JSON.stringify(r, null, 2));
  await page.close();
  return r;
}

async function run() {
  rmSync(SHOTS, { recursive: true, force: true });
  mkdirSync(SHOTS, { recursive: true });
  const server = spawn('node', ['dev-server.mjs'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore' });
  try {
    await waitForServer();
    await seed();
    const browser = await loadBrowser();
    try {
      await observe(browser);
      await verifyB(browser);
    } finally {
      await browser.close();
    }
  } finally {
    server.kill();
  }
  console.log('\nharness done →', SHOTS);
}

run().catch((e) => { console.error('HARNESS FAIL:', e.message); process.exit(1); });
