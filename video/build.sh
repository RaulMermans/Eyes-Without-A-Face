#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
export PLAYWRIGHT_BROWSERS_PATH="$ROOT/.cache/pw-browsers"
cd "$ROOT/.."
"$ROOT/.cache/venv/bin/python" "$ROOT/tools/tts.py"
node "$ROOT/tools/capture.mjs"
node "$ROOT/tools/compose.mjs"
cp "$ROOT/script/captions.srt" "$OUT/captions.srt" 2>/dev/null || cp "$ROOT/script/captions.srt" "$ROOT/out/captions.srt"
python3 -c "import json,pathlib; r=pathlib.Path('$ROOT'); t=json.loads((r/'script/narration.json').read_text())['youtubeDescription']; (r/'out/youtube-description.txt').write_text(t)"
ls -lh "$ROOT/out/eyes-without-a-face-demo.mp4"
