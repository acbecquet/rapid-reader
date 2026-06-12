@echo off
title Rapid Reader - capture anywhere (close this window to stop)
echo Watching your clipboard. Highlight text in ANY app, press Ctrl+C,
echo and it appears in Rapid Reader instantly. Close this window to stop.
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$last=''; while($true){ $t=Get-Clipboard -Raw -ErrorAction SilentlyContinue; if($t -and $t -ne $last -and ($t.Trim() -split '\s+').Count -ge 3){ $last=$t; try{ Invoke-RestMethod -Method Post -Uri 'https://rapid-reader-pi.vercel.app/api/live' -ContentType 'application/json; charset=utf-8' -Body ([System.Text.Encoding]::UTF8.GetBytes((@{text=$t}|ConvertTo-Json -Compress))) | Out-Null; Write-Host ('sent ' + $t.Substring(0, [Math]::Min(60, $t.Length))) }catch{ Write-Host 'send failed - check your connection' } }; Start-Sleep -Milliseconds 700 }"
