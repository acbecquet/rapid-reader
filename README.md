# Rapid Reader

A tiny RSVP (Rapid Serial Visual Presentation) reading panel you can pin to a
corner of your screen or install on your phone. Highlight text anywhere — it
lands in a synced backlog and starts playing one word at a time, anchored at
the optimal recognition point, at whatever WPM you choose.

The pipeline: **highlight → server → RSVP**. Built as a review-speed
complement to voice-input prompting.

## Features

- **Live capture** — browser extension sends any highlighted text straight to
  your backlog (hover button, right-click menu, or instant mode that fires on
  every selection). On the panel, new captures auto-play when you're idle.
- **Synced backlog** — items grouped Claude-style (Today / Yesterday /
  Previous 7 days / Older) in a compact scrollable sidebar, with short
  LLM-generated titles, unread dots, word counts, and sources.
- **RSVP player** — Spritz-style ORP pivot letter, smart pacing (extra time on
  long words, numbers, clause/sentence/paragraph ends), progress bar, and time
  remaining.
- **Build mode** — starts at 80 WPM and ramps +20 every 15 s until your target
  WPM, or standard mode at a constant rate.
- **Appearance** — font, font size, text color, and background color, all live.
- **PWA** — installable on your phone; capture there via select → Share →
  Rapid Reader.

## Deploy (one-time, ~5 minutes, free)

1. Import this repo at [vercel.com/new](https://vercel.com/new). Framework
   preset: **Other**. No build command needed.
2. In the project, open **Storage → Create Database → Upstash Redis** (free
   tier) and connect it. This injects the Redis env vars automatically.
3. In **Settings → Environment Variables**, add:
   - `RAPID_READER_TOKEN` — any long random string; this is your private key.
   - `GEMINI_API_KEY` *(optional)* — free key from
     [aistudio.google.com](https://aistudio.google.com/apikey) for short
     sidebar titles. Without it, titles fall back to the first words.
     (`GEMINI_MODEL` overrides the default `gemini-2.5-flash-lite`.)
4. Redeploy. Open the app, hit **⚙**, and paste your token.

## Install the capture extension (desktop)

1. `chrome://extensions` → enable Developer mode → **Load unpacked** → select
   the `extension/` folder of this repo.
2. Right-click the extension icon → **Options** → enter your Vercel URL and
   token → **Save & test**.
3. Highlight text on any page → click the **▸ RSVP** button that appears (or
   enable **instant mode** to send every selection automatically). The panel
   picks it up within a few seconds and starts playing.

## Phone

Open your Vercel URL → browser menu → **Add to Home Screen**. After that,
select text in any app → **Share → Rapid Reader** to add it to the backlog.

## Controls

| Key / gesture | Action |
| --- | --- |
| `Space` or tap the word | play / pause |
| `←` / `→` | previous / next sentence |
| `↑` / `↓` | target WPM ± 10 |
| `Esc` | pause and open the backlog |

## Local development

```sh
npm install
npm run dev    # http://localhost:3000, in-memory store, no token needed
npm test       # unit tests for the RSVP engine and the API
```

Icons regenerate with `python3 scripts/gen_icons.py`.
