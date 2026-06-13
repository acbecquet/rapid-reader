#!/bin/sh
# Rapid Reader — agent sync (macOS). Double-click to keep Claude Code and Codex
# sessions flowing into the Agents column (grouped by project, live). Ctrl+C to stop.
echo 'Watching Claude Code and Codex sessions… they appear in the Agents column, live. Ctrl+C to stop.'
exec node "$HOME/rapid-reader/hooks/sync.mjs" --watch
