# Rapid Reader

**A high-speed review queue for AI coding output, long responses, docs, and summaries.**

AI agents generate more output than humans can review. The bottleneck is no
longer writing code — it is reviewing agent work. Rapid Reader turns that
output into a readable queue: highlight anything, send it to Rapid Reader,
press play, read faster.

It RSVPs the *language around the work* — summaries, plans, explanations,
review notes, docs, articles — never raw code or raw diffs. Code-heavy
captures get summarized into review notes first.

## How it works

1. **Capture** — highlight text anywhere (browser extension), share from your
   phone (PWA), paste manually, or let your coding agent push items directly
   (MCP server). **Live mode** mirrors every selection straight into the
   reader, ready to play, without saving anything — a **＋ keep** chip adds
   it to the backlog only if you want it.
2. **Organize** — items land in a synced backlog with short LLM-generated
   titles, source types (`claude code`, `codex`, `web`, …), unread/reviewed/
   archived states, and filters.
3. **Parse** — structured output is split into sections: headings become
   navigation, bullets and tables become readable sentences, code blocks
   become placeholders (raw source is one tap away).
4. **Play** — Spritz-style RSVP with an ORP pivot letter, smart pacing,
   build-up mode, progress, and time remaining. Reading resumes where you
   left off.
5. **Review** — mark reviewed, archive, skip, or summarize. The stats
   dashboard tracks words reviewed, active time, estimated time saved,
   streaks, and per-source volume.

## Features

- **RSVP player** — ORP pivot letter, smart pacing (long words, numbers,
  clause/sentence/paragraph pauses), tap-to-edit WPM, keyboard controls.
- **Build mode** — starts at 80 WPM, +20 every 15 s until your target.
- **Section navigation** — jump between headings with `[` / `]` or the
  dropdown; raw source always one tap away.
- **Code/diff summaries** — code-heavy items get a one-tap Gemini summary in
  readable language; the raw text is never RSVP'd word-by-word.
- **Synced backlog** — grouped by day, filterable by status and source type,
  capped and stored in your own Redis.
- **Reading stats** — words today, active time, items completed, 7-day
  totals, estimated time saved vs. 250 WPM, day streak, top sources.
  Aggregates only — captured text never enters the stats store.
- **Appearance** — font, size, text and background colors, all live.
- **PWA** — installable on your phone; capture via select → Share.

## Claude Code workflow

Two ways to feed agent output into the queue:

**Highlight capture** — select any Claude Code (or Codex/Copilot) output in
the browser and hit the ▸ RSVP button. Text from `claude.ai` is automatically
tagged `claude code`.

**MCP server** — let the agent push its own summaries:

```sh
cd mcp && npm install
claude mcp add rapid-reader \
  -e RAPID_READER_URL=https://your-app.vercel.app \
  -e RAPID_READER_TOKEN=your-token \
  -- node /path/to/rapid-reader/mcp/server.mjs
```

Tools exposed: `rapid_reader_add_item` (returns a playback deep link),
`rapid_reader_get_item`, `rapid_reader_set_summary`,
`rapid_reader_list_backlog`, `rapid_reader_mark_reviewed`,
`rapid_reader_get_metrics`. Ask your agent to "send a summary of what you did
to my review queue" and it appears in the panel within seconds — auto-playing
if you're idle.

Summarization uses the model you're already talking to: the tool
descriptions steer the connected agent to write plain-language review notes
itself (`get_item` flags code-heavy items, `set_summary` attaches the notes).
The in-app **Σ summarize** button is the fallback for items captured outside
an agent session — it uses your `GEMINI_API_KEY`.

## Deploy (one-time, ~5 minutes, free)

1. Import this repo at [vercel.com/new](https://vercel.com/new). Framework
   preset: **Other**. No build command needed.
2. In the project, open **Storage → Create Database → Upstash Redis** (free
   tier) and connect it. This injects the Redis env vars automatically.
3. In **Settings → Environment Variables**, add:
   - `RAPID_READER_TOKEN` — any long random string; this is your private key.
   - `GEMINI_API_KEY` *(optional)* — free key from
     [aistudio.google.com](https://aistudio.google.com/apikey) for titles and
     code summaries. (`GEMINI_MODEL` overrides the default
     `gemini-2.5-flash-lite`.)
4. Redeploy. Open the app and visit `https://your-app.vercel.app/?token=YOURTOKEN`
   once per device to self-configure.

## Multi-user: Google sign-in (optional)

Without this, the app is single-user via your token. With it, anyone you
invite signs in with Google and gets a fully isolated queue (their items,
stats, and live slot live under their own keys — nobody sees anyone else's
data, and no passwords are ever handled).

One-time setup (~15 min):

1. [console.cloud.google.com](https://console.cloud.google.com) → create a
   project → **APIs & Services → OAuth consent screen** → External → fill in
   the app name and your email → save (no scopes needed beyond the defaults).
   Publish the app (or add testers' emails while in testing mode).
2. **Credentials → Create credentials → OAuth client ID → Web application.**
   Add your app origins under **Authorized JavaScript origins**:
   `https://your-app.vercel.app` (plus `http://localhost:3000` for dev and
   any Vercel preview origin you test on).
3. Copy the client ID into a `GOOGLE_CLIENT_ID` env var on Vercel, and add:
   - `OWNER_EMAIL` — your Gmail; signing in with it maps to your existing data.
   - `ALLOWED_EMAILS` *(optional)* — comma-separated guest list. Unset = anyone
     with the URL and a Google account can use it.
4. Redeploy. The panel now shows **Sign in with Google** to anyone without a
   token. Your old token keeps working for your extension/MCP.

Inviting someone: send them your URL. They sign in — that's the whole setup.
If they also want desktop highlight capture or the MCP, they copy their
device token from **⚙ → Copy device token** into the extension options /
MCP env. The panel, phone share, and paste flows need nothing but the
sign-in. Extension and MCP are strictly optional extras.

## Install the capture extension (desktop)

1. `chrome://extensions` → enable Developer mode → **Load unpacked** → select
   the `extension/` folder of this repo.
2. Right-click the extension icon → **Options** → enter your Vercel URL and
   token → **Save & test**.
3. Pick a selection behavior in options:
   - **Button** — highlight, then click the **▸ RSVP** button to send to the backlog.
   - **Instant** — every selection goes straight to the backlog.
   - **Live** — every selection appears in the reader immediately, paused and
     ready to play (nothing is saved; the **＋ keep** chip in the reader adds
     it to the backlog). The ▸ button stays available for deliberate saves.

## Phone

Open your Vercel URL → browser menu → **Add to Home Screen**. After that,
select text in any app → **Share → Rapid Reader** (Android; on iOS use the
**+** paste button).

## Controls

| Key / gesture | Action |
| --- | --- |
| `Space` or tap the word | play / pause |
| `←` / `→` | previous / next sentence |
| `[` / `]` | previous / next section |
| `↑` / `↓` | target WPM ± 10 (or tap the WPM value to type) |
| `Esc` | pause and open the backlog |

## Setting someone else up (e.g. macOS)

With Google sign-in configured (above), a friend needs zero infrastructure:

1. Send them your app URL. They open it and **Sign in with Google** — they
   now have their own private queue on your deployment.
2. App-like window: Chrome → ⋮ → Save and Share → **Install app**; or Safari →
   Share → **Add to Dock** (macOS Sonoma+). iPhone: **Add to Home Screen**,
   then capture via Share → Rapid Reader.
3. *(Optional)* Desktop highlight capture: `git clone` this repo →
   `chrome://extensions` → Developer mode → **Load unpacked** → `extension/`
   folder → in options enter your app URL and the token from
   **⚙ → Copy device token**.
4. *(Optional)* MCP for Claude Code: see the section above, using their own
   device token.

They can stop at step 1 and still have the full reading experience.

## Local development

```sh
npm install
npm run dev    # http://localhost:3000, in-memory store, no token needed
npm test       # unit tests for the RSVP engine, parser, and API
```

Icons regenerate with `python3 scripts/gen_icons.py`.

## Roadmap

The reading/capture loop comes first. Later, pending real usage:
multi-session organization for parallel agent workflows, richer history
search, and hosted convenience features. Raw code/diff RSVP is a non-goal —
review notes in plain language beat flashing braces at 500 WPM.
