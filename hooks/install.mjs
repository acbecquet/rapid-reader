// Registers (or removes) the Rapid Reader Stop hook in ~/.claude/settings.json
// so every Claude Code response is pushed to the reading queue.
// Usage: node hooks/install.mjs [--remove]
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const settingsPath = join(homedir(), '.claude', 'settings.json');
const hookPath = join(dirname(fileURLToPath(import.meta.url)), 'claude-hook.mjs');
const command = `node "${hookPath}"`;

let settings = {};
try { settings = JSON.parse(readFileSync(settingsPath, 'utf8')); } catch {}
settings.hooks ||= {};
settings.hooks.Stop ||= [];

const ours = (m) => m.hooks?.some((h) => h.command?.includes('claude-hook.mjs'));
settings.hooks.Stop = settings.hooks.Stop.filter((m) => !ours(m));
if (!process.argv.includes('--remove')) {
  settings.hooks.Stop.push({ matcher: '', hooks: [{ type: 'command', command }] });
}

mkdirSync(dirname(settingsPath), { recursive: true });
writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n');
console.log(
  process.argv.includes('--remove')
    ? 'Rapid Reader hook removed from ' + settingsPath
    : 'Rapid Reader live transcripts enabled — every Claude Code response now lands in your queue.'
);
