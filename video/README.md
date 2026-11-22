# Submission video pipeline

Produces a ≤ 3:00 1080p master for YouTube (`out/eyes-without-a-face-demo.mp4`). Upload still needs explicit owner approval.

**Honest about inference.** Motion graphics describe the real hybrid architecture. The product segment is the current three-stage UI on fictional CRM data, with the labelled simulated test planner — never presented as Gemini. Captions say so.

## Tools (open source)

| Piece | Project | Role |
| --- | --- | --- |
| Voice | [Kokoro-82M](https://huggingface.co/hexgrad/Kokoro-82M) via [kokoro-onnx](https://github.com/thewh1teagle/kokoro-onnx) | Local TTS, voice `am_michael` |
| Capture | Playwright (already in this repo) | Real UI walkthrough + HTML scenes |
| Mix | FFmpeg (static binary in `.cache/ffmpeg`) | Concat, captions, loudness |

## Build

```bash
video/.cache/venv/bin/python video/tools/tts.py
node video/tools/capture.mjs
node video/tools/compose.mjs
```

Requires Node 22, the repo’s Playwright browsers, Python 3.12 venv, and the Kokoro ONNX files in `video/.cache/models`.
