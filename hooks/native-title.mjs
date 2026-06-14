// Native-model titling for agent coding sessions. Background-only (sync.mjs):
// the instant Stop hook keeps its quick title; here we ask the model the user
// is already subscribed to — Claude for claude_code, Codex for codex — for a
// terse 3-7 word title biased to the MOST RECENT direction of the work, then
// override payload.title before the upsert. Degrade-safe: any failure → null,
// and the caller keeps the quick title. No API key, no third-party API.
import { execFile } from 'node:child_process';

const TIMEOUT_MS = 30000;
const TAIL = 6000; // bias to recent: only the last messages of the transcript

// PURE: the instruction. Recent-direction bias comes from passing the tail.
export function buildTitlePrompt(transcriptMarkdown) {
  const tail = String(transcriptMarkdown || '').slice(-TAIL);
  return (
    'In 3 to 7 words, output ONLY a terse title summarizing this coding ' +
    'session, focused on the MOST RECENT direction of the work. No quotes, ' +
    'no punctuation at the end.\n\n' +
    'Transcript (most recent part):\n' +
    tail
  );
}

// PURE: turn raw model output into a clean title, or '' for empty/garbage.
export function cleanTitle(raw) {
  let t = String(raw || '');
  // drop the fence markers (keep the text a model may have wrapped in them) and
  // inline-code backticks. A leading ```lang tag on its own line goes too.
  t = t.replace(/^```[^\n]*$/gm, ' ').replace(/`/g, ' ');
  // first non-empty line (models sometimes add a preamble or trailing notes)
  t = (t.split('\n').map((l) => l.trim()).find(Boolean) || '');
  // strip markdown emphasis/heading/list/quote markers, then collapse so the
  // quote/punctuation strips below see the real start/end (no stray spaces).
  t = t.replace(/[*_#>~]+/g, ' ').replace(/\s+/g, ' ').trim();
  // strip wrapping quotes (straight + curly), then trailing punctuation
  t = t.replace(/^["“”'']+|["“”'']+$/g, '');
  t = t.replace(/[.!?,;:]+$/g, '');
  t = t.trim();
  if (!t) return '';
  const words = t.split(' ');
  if (words.length > 9) t = words.slice(0, 9).join(' ');
  return t.slice(0, 80).trim();
}

// claude -p runs headless/one-shot on the user's logged-in subscription (no API
// key) and spawns a fresh independent session — safe from background tooling.
// codex exec is the Codex analog; under-documented, so we try and degrade.
// Pass the whole prompt as the positional arg — the documented `claude -p
// "PROMPT"` form. execFile uses no shell (nothing to escape) and the ~6k tail
// is well under the OS arg limit, so this is more reliable than piping stdin.
function cliFor(sourceType, prompt) {
  if (sourceType === 'codex') return { cmd: 'codex', args: ['exec', prompt] };
  return { cmd: 'claude', args: ['-p', prompt, '--model', 'haiku', '--output-format', 'text'] };
}

function run(cmd, args) {
  return new Promise((resolve) => {
    try {
      execFile(cmd, args, { timeout: TIMEOUT_MS, maxBuffer: 1 << 20 }, (err, stdout) => {
        resolve(err ? null : String(stdout || ''));
      });
    } catch {
      resolve(null); // cmd not found / spawn error
    }
  });
}

// IMPURE: returns the cleaned native title, or null on any failure/timeout.
export async function nativeTitle({ sourceType, transcript }) {
  if (!transcript) return null;
  const { cmd, args } = cliFor(sourceType, buildTitlePrompt(transcript));
  const out = await run(cmd, args);
  if (out == null) return null;
  return cleanTitle(out) || null;
}
