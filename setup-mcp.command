#!/bin/sh
# Rapid Reader MCP setup (macOS/Linux) — double-click. Clones the repo,
# installs the server, and registers it with Claude Code. No input needed.
set -e
DIR="$HOME/rapid-reader"

command -v git >/dev/null || { echo 'Install git first (macOS: xcode-select --install)'; exit 1; }
command -v npm >/dev/null || { echo 'Install Node.js first: https://nodejs.org'; exit 1; }
command -v claude >/dev/null || { echo 'Install Claude Code first: npm install -g @anthropic-ai/claude-code'; exit 1; }

if [ -d "$DIR/.git" ]; then git -C "$DIR" pull --ff-only; else git clone https://github.com/acbecquet/rapid-reader "$DIR"; fi
npm install --prefix "$DIR/mcp" --no-audit --no-fund

claude mcp add rapid-reader \
  -e RAPID_READER_URL=https://rapid-reader-pi.vercel.app \
  -e RAPID_READER_TOKEN=dghhdsaw87665432wwdghy456dfjjout3 \
  -- node "$DIR/mcp/server.mjs"

echo 'Done. Restart Claude Code, then try: "send a summary of what you did to my review queue".'
