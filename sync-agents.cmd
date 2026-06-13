@echo off
title Rapid Reader - agent sync (close this window to stop)
echo Watching Claude Code and Codex sessions and syncing them into Rapid Reader.
echo Your prompts and the agents' replies appear in the Agents column, grouped by
echo project, updating live. Close this window to stop.
node "%USERPROFILE%\rapid-reader\hooks\sync.mjs" --watch
pause
