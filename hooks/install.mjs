// Registers (or removes) the Rapid Reader Stop hook in ~/.claude/settings.json
// and writes ~/.claude/rapid-reader.json with the deployment url + token (the
// hook reads it, since Claude Code does not pass env vars to hooks).
//   node hooks/install.mjs --url https://your-app.vercel.app --token YOURTOKEN
//   node hooks/install.mjs --remove
//   node hooks/install.mjs --test     # POST a probe item and report the result
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const arg = (name) => {
  const i = process.argv.indexOf('--' + name);
  return i !== -1 ? process.argv[i + 1] : undefined;
};
const has = (name) => process.argv.includes('--' + name);

const claudeDir = join(homedir(), '.claude');
const settingsPath = join(claudeDir, 'settings.json');
const cfgPath = join(claudeDir, 'rapid-reader.json');
const hookPath = join(dirname(fileURLToPath(import.meta.url)), 'claude-hook.mjs');
const command = `node "${hookPath}"`;

mkdirSync(claudeDir, { recursive: true });

// keep existing config; override only what was passed
let cfg = {};
try { cfg = JSON.parse(readFileSync(cfgPath, 'utf8')); } catch {}
const url = arg('url') || process.env.RAPID_READER_URL || cfg.url || 'https://rapid-reader-pi.vercel.app';
const token = arg('token') || process.env.RAPID_READER_TOKEN || cfg.token || '';

if (has('test')) {
  const body = {
    sessionId: 'install-probe',
    sourceType: 'claude_code',
    title: 'Rapid Reader hook test',
    text: 'If you can read this in your Agents column, the Claude Code hook is wired up correctly and your storage is connected.',
  };
  const res = await fetch(url + '/api/items', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) },
    body: JSON.stringify(body),
  }).catch((e) => ({ ok: false, status: 0, _err: e.message }));
  const health = await fetch(url + '/api/health').then((r) => r.json()).catch(() => null);
  console.log(`POST ${url}/api/items → ${res.status}${res._err ? ' (' + res._err + ')' : ''}`);
  if (health) console.log(`storage: redis=${health.redis} blob=${health.blob} persistent=${health.persistent}`);
  console.log(res.ok && health?.persistent
    ? '✅ Working — check your Agents column for "Rapid Reader hook test".'
    : !health?.persistent
      ? '⚠️ The hook reached the server, but storage is NOT persistent — connect Upstash Redis + Blob in Vercel.'
      : '⚠️ The server rejected the post — check the url/token.');
  process.exit(0);
}

let settings = {};
try { settings = JSON.parse(readFileSync(settingsPath, 'utf8')); } catch {}
settings.hooks ||= {};
settings.hooks.Stop ||= [];
const ours = (m) => m.hooks?.some((h) => h.command?.includes('claude-hook.mjs'));
settings.hooks.Stop = settings.hooks.Stop.filter((m) => !ours(m));

if (has('remove')) {
  writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n');
  console.log('Rapid Reader hook removed from ' + settingsPath);
  process.exit(0);
}

settings.hooks.Stop.push({ matcher: '', hooks: [{ type: 'command', command }] });
writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n');
writeFileSync(cfgPath, JSON.stringify({ url, token }, null, 2) + '\n');
console.log(`Rapid Reader live transcripts enabled → ${url}`);
console.log('Restart Claude Code, run a prompt, then check your Agents column.');
console.log('Verify anytime with:  node "' + hookPath.replace('claude-hook.mjs', 'install.mjs') + '" --test');
