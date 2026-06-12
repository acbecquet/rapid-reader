#!/bin/sh
# Rapid Reader — capture anywhere (macOS). Double-click to start watching the
# clipboard: highlight text in ANY app, press Cmd+C, and it appears in the
# reader instantly. Press Ctrl+C in this window (or close it) to stop.
echo 'Watching your clipboard — highlight + Cmd+C in any app. Ctrl+C here to stop.'
exec python3 - <<'EOF'
import subprocess, time, json, urllib.request
last = ''
while True:
    t = subprocess.run(['pbpaste'], capture_output=True, text=True).stdout
    if t and t != last and len(t.split()) >= 3:
        last = t
        try:
            req = urllib.request.Request(
                'https://rapid-reader-pi.vercel.app/api/live',
                data=json.dumps({'text': t}).encode(),
                headers={'content-type': 'application/json'})
            urllib.request.urlopen(req, timeout=5)
            print('sent', t[:60].replace('\n', ' '))
        except Exception:
            print('send failed — check your connection')
    time.sleep(0.7)
EOF
