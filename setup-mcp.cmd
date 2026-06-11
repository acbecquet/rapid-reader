@echo off
setlocal
REM Rapid Reader MCP setup (Windows) — double-click to clone the repo,
REM install the server, and register it with Claude Code.
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

set /p TOKEN="Paste your Rapid Reader token (app: gear icon -> Copy device token): "
call claude mcp add rapid-reader ^
  -e RAPID_READER_URL=https://rapid-reader-pi.vercel.app ^
  -e RAPID_READER_TOKEN=%TOKEN% ^
  -- node "%DIR%\mcp\server.mjs"

echo.
echo Done. Restart Claude Code, then try: "send a summary of what you did to my review queue"
pause
