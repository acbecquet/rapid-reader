@echo off
setlocal
REM Rapid Reader MCP setup (Windows) — double-click. Clones the repo,
REM installs the server, and registers it with Claude Code. No input needed.
set "DIR=%USERPROFILE%\rapid-reader"

where git >nul 2>nul || (echo Install git first: https://git-scm.com & pause & exit /b 1)
where npm >nul 2>nul || (echo Install Node.js first: https://nodejs.org & pause & exit /b 1)
where claude >nul 2>nul || (echo Install Claude Code first: npm install -g @anthropic-ai/claude-code & pause & exit /b 1)

if exist "%DIR%\.git" (
  git -C "%DIR%" pull --ff-only
) else (
  git clone https://github.com/acbecquet/rapid-reader "%DIR%"
)
if errorlevel 1 (pause & exit /b 1)

pushd "%DIR%\mcp"
call npm install --no-audit --no-fund
if errorlevel 1 (popd & pause & exit /b 1)
popd

call claude mcp add rapid-reader ^
  -e RAPID_READER_URL=https://rapid-reader-pi.vercel.app ^
  -e RAPID_READER_TOKEN=dghhdsaw87665432wwdghy456dfjjout3 ^
  -- node "%DIR%\mcp\server.mjs"

node "%DIR%\hooks\install.mjs"

echo.
echo Done. Restart Claude Code — its responses now stream to your queue,
echo and you can ask it to "send a summary of what you did to my review queue"
pause
