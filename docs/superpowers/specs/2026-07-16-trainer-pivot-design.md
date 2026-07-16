# Rapid Reader trainer pivot design

Date: 2026-07-16
Status: approved direction from Charlie; details chosen autonomously and open to revision.

## Why

The original premise (read everything at very high WPM with single-word RSVP) does not hold up.
Comprehension drops sharply at forced high speeds, which matches the published research on RSVP speed reading.
The pivot: Rapid Reader becomes a reading trainer that works on reading speed and comprehension as two separate, measured tracks.
All existing content intake stays exactly as it is (backlog, EPUB, URL fetch, paste, share target, agent capture).

## What changes

### 1. Speed training: cluster RSVP

Skilled readers take in multiple words per fixation.
The trainable skill is widening that span, not flashing single words faster.

- New pure function `clusterize(tokens, size)` in `public/rsvp.js`.
- Groups up to `size` (1 to 4) consecutive tokens into one flash.
- A cluster never spans a paragraph boundary and ends early at a sentence end, so a flash never straddles unrelated thoughts.
- A cluster's display time is the sum of its member tokens' `delayMs`, so a WPM target means the same words-per-minute at any cluster size.
- Display: single-word mode keeps the ORP pivot; multi-word clusters render as centered text without a pivot.
- `settings.cluster` (default 1) with a slider in Settings and a tappable `×N` cycler in the HUD.
- Cluster size composes with the existing standard/build modes, so a speed drill is: pick a cluster size, let the build ramp climb the WPM.

### 2. Comprehension training: post-read Gemini quiz

- New endpoint `api/quiz.js`: `POST { id }` loads the item body server-side and asks Gemini for 5 simple multiple-choice questions (4 choices each) as strict JSON.
- Uses the existing `llm()` helper and `keysFor()` so each signed-in user spends their own free Gemini key; no key means a friendly nudge to the existing key modal.
- JSON is parsed and validated with one retry; failure returns a clear error instead of a broken quiz.
- The quiz is never on the capture/open hot path; it runs only after a completed read, on request.
- Client flow: finishing an item shows a Quiz step; `settings.quizAfterRead` (default on) auto-opens it for book/article/web/manual/docs sources; agent transcripts and live highlights never auto-quiz.
- Grading is client-side in one modal (all questions visible, immediate right/wrong marking on submit).
- The correct answers ride in the payload; this is self-training, not an exam, so no anti-cheat complexity.

### 3. Separate progress tracking

- The stats doc gains a capped `sessions` list (cap 400) of training records: `{ ts, words, wpm, cluster, sourceType, quiz?: { score, total } }`.
- A record is posted when a read finishes; if the user then takes the quiz, the record is posted once with the quiz result attached (held client-side until the quiz is done or skipped).
- Numbers only, never text, consistent with the existing stats privacy rule.
- The stats modal gains a Training section: recent actual WPM trend, recent comprehension percentage, the last sessions as compact rows, and a simple next-target nudge.
- Nudge heuristic: quiz average of the last 3 quizzes at or above 80 percent suggests raising the WPM target; below 60 percent suggests lowering it.

### 4. Honest reframing

- The info panel ("What's the point?") is rewritten around the trainer story: single-word blast reading is not supported by the evidence, so the app trains span (clusters) and verifies comprehension (quizzes) instead of pretending speed is free.
- README and PROJECT_STATUS are updated to describe the trainer loop.
- The name stays Rapid Reader; only the tagline and framing change.

## Approaches considered

1. Separate trainer app or tab with its own drill library.
   Rejected: duplicates the reader, more surface, and the backlog is already the natural source of drill material.
2. Trainer woven into the existing reader (chosen).
   Cluster setting plus build ramp covers speed drills; finish-to-quiz covers comprehension; stats extends with trends.
3. Comprehension-only pivot.
   Rejected: drops the cluster RSVP training that is half the request.

## Testing

- `clusterize` unit tests: sizes, paragraph and sentence boundaries, delay sums, single-token passthrough.
- `api/quiz.js` handler tests with mocked fetch: happy path, malformed JSON with retry, missing key, missing item.
- `api/stats.js` tests for the sessions list: append, cap, quiz attachment shape.
- Full `npm test` plus a manual dev-server pass in a real browser (cluster reading, quiz flow, stats trends).

## Non-goals

- No spaced repetition, curricula, or difficulty-adaptive text selection in this pass.
- No server-side quiz grading or anti-cheat.
- No change to intake, storage, auth, or the buildless architecture.
