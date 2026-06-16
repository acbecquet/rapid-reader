// Self-feedback harness: drives the real app in a headless browser at desktop
// AND mobile viewports, seeds representative data, runs input scenarios, and
// writes screenshots + the transcript DOM to tools/harness/shots/. This is how
// we iterate to exactly the described behaviour instead of approximating, with
// no human in the loop.
//
// Sandbox-only (Linux). It uses the npm-bundled serverless Chromium so it works
// within this environment's egress allowlist (Playwright's own browser CDN is
// blocked here). One-time install, not added to package.json so it never touches
// the Vercel deploy:
//   npm i --no-save puppeteer-core @sparticuz/chromium@119.0.2
// Run:  node tools/harness/observe.mjs   (or: npm run harness)

import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const SHOTS = join(HERE, 'shots');
const PORT = 3210;
const BASE = `http://localhost:${PORT}`;

// desktop + a phone, so we observe both layouts the way you do
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

Root cause: TtsVolume and RadioVolume are Clamp01'd, so they cap at 1.0.

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

async function waitForServer(ms = 12000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try { if ((await fetch(`${BASE}/api/health`)).ok) return; } catch {}
    await sleep(200);
  }
  throw new Error('dev server did not come up on ' + BASE);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function seed() {
  const post = (body) => fetch(`${BASE}/api/items`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  await post({ sourceType: 'claude_code', sessionId: 'harness:overnight', text: AGENT_BODY });
  await post({ sourceType: 'article', title: 'GLP-1 Therapies Silence Spontaneous Physical Activity', text: NEWS_BODY });
  await post({ sourceType: 'manual', text: 'A short manual note, pasted by hand, to read later.' });
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

async function shoot(page, name) {
  await page.screenshot({ path: join(SHOTS, name + '.png') });
  console.log('  shot', name);
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
      for (const [vp, opts] of Object.entries(VIEWPORTS)) {
        console.log('viewport:', vp);
        const page = await browser.newPage();
        await page.setViewport(opts);
        await page.goto(BASE, { waitUntil: 'domcontentloaded' });
        await page.waitForSelector('.col, .none', { timeout: 8000 }).catch(() => {});
        await sleep(800); // let the first poll render
        await shoot(page, `${vp}-01-backlog`);

        // open the structured agent transcript
        const opened = await page.evaluate(() => {
          const t = [...document.querySelectorAll('.item .t')]
            .find((e) => /overnight|overview|housekeeping/i.test(e.textContent));
          if (!t) return false;
          t.closest('.item').click();
          return true;
        });
        await sleep(700);
        await shoot(page, `${vp}-02-transcript`);
        if (opened) {
          const html = await page.evaluate(() => document.getElementById('transcript')?.innerHTML || '(none)');
          writeFileSync(join(SHOTS, `${vp}-transcript.html`), html);
        } else {
          console.log('  (could not find the agent item to open)');
        }
        await page.close();
      }
    } finally {
      await browser.close();
    }
  } finally {
    server.kill();
  }
  console.log('\nharness done →', SHOTS);
}

run().catch((e) => { console.error('HARNESS FAIL:', e.message); process.exit(1); });
