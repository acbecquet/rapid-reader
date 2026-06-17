import test from 'node:test';
import assert from 'node:assert/strict';
import { parseStructure, readingTokens, isCodeHeavy, deriveTitle, derivePreview } from '../public/parse.js';

const SAMPLE = `# Change Summary

The login flow now detects expired sessions earlier.

## Files Changed
- \`src/api/auth.ts\`: Updates token validation
- \`src/components/Login.tsx\`: Adds error display

| Tier | Price |
|---|---|
| Free | $0 |
| Paid | $3/month |

\`\`\`js
const x = 1;
const y = 2;
\`\`\`

> Check the refresh-token branch carefully.`;

test('parseStructure identifies headings, paragraphs, list items, tables, code', () => {
  const s = parseStructure(SAMPLE);
  assert.deepEqual(s.map((x) => x.type), [
    'heading', 'paragraph', 'heading', 'item', 'item', 'table', 'code', 'quote',
  ]);
  assert.equal(s[0].title, 'Change Summary');
  assert.equal(s[2].title, 'Files Changed');
});

test('list items become individual structured sections (not one flattened blob)', () => {
  const s = parseStructure('- first point\n- second point.');
  assert.deepEqual(s.map((x) => x.type), ['item', 'item']);
  assert.equal(s[0].text, 'first point');
  assert.equal(s[1].text, 'second point.');
  assert.equal(s[0].ordered, false);
});

test('a wrapped list item folds its continuation line in', () => {
  const s = parseStructure('- a point that\n  continues here\n- next');
  assert.deepEqual(s.map((x) => x.type), ['item', 'item']);
  assert.equal(s[0].text, 'a point that continues here');
  assert.equal(s[1].text, 'next');
});

test('ordered + nested list items keep their marker and indent', () => {
  const s = parseStructure('1. first\n2. second\n   - nested bullet');
  assert.deepEqual(s.map((x) => x.type), ['item', 'item', 'item']);
  assert.equal(s[0].ordered, true);
  assert.equal(s[0].marker, '1.');
  assert.equal(s[2].ordered, false);
  assert.ok(s[2].indent >= 2); // the nested bullet is indented under the list
});

test('a turn marker ends an unclosed code fence — the sentinel is never swallowed', () => {
  // a you-turn pastes code behind a fence that is never closed; the following
  // [[rr:claude]] / [[rr:tool]] markers must still switch speaker (not get eaten
  // by the open fence, which strands content under the wrong speaker and prints
  // the marker as literal text)
  const s = parseStructure([
    '[[rr:you]]',
    'set it up like this:',
    '```cs',
    'private static Step R(float deg) => new(StepKind.Rotate, arg: deg);',
    '[[rr:claude]]',
    'Good call — wired the resolver.',
    '[[rr:tool Bash]]',
    'wc -l log.txt',
    '[[rr:claude]]',
    'That log has 2803 lines.',
  ].join('\n'));
  const code = s.find((x) => x.type === 'code');
  assert.ok(code && code.role === 'you');               // unclosed fence stays under you
  assert.ok(code.raw.includes('StepKind.Rotate'));
  const claude = s.filter((x) => x.role === 'claude');
  assert.ok(claude.some((x) => /Good call/.test(x.text)));   // speaker switched
  assert.ok(claude.some((x) => /2803 lines/.test(x.text)));  // and switched back
  assert.ok(s.some((x) => x.role === 'tool'));               // the tool turn registered
  assert.ok(!s.some((x) => /\[\[rr:/.test((x.text || '') + (x.raw || '')))); // no literal markers
});

test('tables turn into readable sentences', () => {
  const s = parseStructure('| Tier | Price |\n|---|---|\n| Free | $0 |');
  assert.equal(s[0].type, 'table');
  assert.equal(s[0].text, 'Tier: Free, Price: $0.');
});

test('code blocks become a placeholder, raw preserved', () => {
  const s = parseStructure('```py\nx = 1\n\ny = 2\n```');
  assert.equal(s[0].type, 'code');
  assert.equal(s[0].text, '⟨code · 2 lines⟩');
  assert.ok(s[0].raw.includes('x = 1'));
});

test('blockquotes become quote sections (the reader renders them as "You wrote")', () => {
  const s = parseStructure('> quoted advice\n> on two lines');
  assert.equal(s[0].type, 'quote');
  assert.equal(s[0].text, 'quoted advice on two lines');
});

test('readingTokens tags sections and collapses code to one token', () => {
  const t = readingTokens(parseStructure(SAMPLE));
  const codeTokens = t.filter((x) => x.code);
  assert.equal(codeTokens.length, 1);
  assert.equal(codeTokens[0].w, '⟨code · 2 lines⟩');
  assert.ok(codeTokens[0].paraEnd); // long pause on the placeholder
  // heading tokens carry their section index for navigation
  assert.equal(t[0].sec, 0);
  assert.ok(t.every((x) => typeof x.sec === 'number'));
  // section indices are non-decreasing
  for (let i = 1; i < t.length; i++) assert.ok(t[i].sec >= t[i - 1].sec);
});

test('plain prose parses as paragraphs and round-trips through tokens', () => {
  const t = readingTokens(parseStructure('Just two sentences. Nothing fancy here.'));
  assert.deepEqual(t.map((x) => x.w).slice(0, 3), ['Just', 'two', 'sentences.']);
});

test('isCodeHeavy detects diffs and code dumps, not prose', () => {
  assert.equal(isCodeHeavy('diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -1 +1 @@\n-old\n+new'), true);
  const dump = '```\n' + 'let a = 1;\n'.repeat(30) + '```\nTiny note.';
  assert.equal(isCodeHeavy(dump), true);
  assert.equal(isCodeHeavy(SAMPLE), false);
  assert.equal(isCodeHeavy('Plain explanation of the work that was done across several sentences and lines.\nMore prose.\nEven more.\nAnd more.'), false);
});

const CHAT = `[[rr:you]]
fix the crash

[[rr:claude]]
Done. Here's the fix.

[[rr:tool Bash]]
git commit -am fix

[[rr:think]]
considering edge cases`;

test('parseStructure stamps role from [[rr:…]] sentinels', () => {
  const s = parseStructure(CHAT);
  assert.deepEqual(s.map((x) => x.role), ['you', 'claude', 'tool', 'think']);
  assert.equal(s[0].text, 'fix the crash');
  assert.equal(s[1].text, "Done. Here's the fix.");
});

test('readingTokens excludes tool and think turns from the RSVP stream', () => {
  const t = readingTokens(parseStructure(CHAT));
  const secs = new Set(t.map((x) => x.sec));
  assert.ok(secs.has(0) && secs.has(1));   // you + claude are read
  assert.ok(!secs.has(2) && !secs.has(3)); // tool + think are not
});

test('bodies without sentinels keep role null (legacy unchanged)', () => {
  const s = parseStructure('Just prose.\n\n> a quote');
  assert.deepEqual(s.map((x) => x.role), [null, null]);
});

test('deriveTitle skips command/markup turns, picks the first real human line', () => {
  const body = '[[rr:you]]\n<command-message>resume_handoff</command-message>\n\n[[rr:you]]\nFix the crash in the crew controller and add a test\n\n[[rr:claude]]\nDone.';
  assert.equal(deriveTitle(body), 'Fix the crash in the crew controller and add a…');
  // legacy '>'-quote body with a leaked command first
  const legacy = '> <command-name>/resume_handoff</command-name>\n\n> please refactor the auth module\n\nSure.';
  assert.equal(deriveTitle(legacy), 'please refactor the auth module');
  assert.equal(deriveTitle('```\n```'), ''); // nothing usable
});

test('deriveTitle picks your MOST RECENT prompt, not the first', () => {
  const body = '[[rr:you]]\nset up the project\n\n[[rr:claude]]\nok\n\n[[rr:you]]\nnow add the scoreboard overlay';
  assert.equal(deriveTitle(body), 'now add the scoreboard overlay');
});

test('derivePreview takes Claude\'s latest turn', () => {
  const body = '[[rr:you]]\ndo X\n\n[[rr:claude]]\nfirst reply\n\n[[rr:you]]\ndo Y\n\n[[rr:claude]]\nsecond reply with the result';
  assert.equal(derivePreview(body), 'second reply with the result');
});

test('deriveTitle skips handoff/markdown/trim/path junk and Claude prose', () => {
  assert.equal(deriveTitle('# Resume work from a handoff document\nYou are tasked\n\n> add a dogfight scoring mode'), 'add a dogfight scoring mode');
  assert.equal(deriveTitle('(earlier conversation trimmed)\n\n> wire up the squad join flow'), 'wire up the squad join flow');
  // no real prompt from you (only Claude prose) → empty, never titled with Claude's words
  assert.equal(deriveTitle('[[rr:claude]]\nI\'ll start by looking at the script.'), '');
});
