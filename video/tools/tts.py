#!/usr/bin/env python3
"""Synthesize the demo narration with Kokoro-82M (ONNX) and write a timeline."""

from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
import soundfile as sf
from kokoro_onnx import Kokoro

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "script" / "narration.json"
AUDIO = ROOT / "audio"
MODELS = ROOT / ".cache" / "models"


def ms_to_srt(ms: int) -> str:
    h, rem = divmod(ms, 3_600_000)
    m, rem = divmod(rem, 60_000)
    s, milli = divmod(rem, 1_000)
    return f"{h:02d}:{m:02d}:{s:02d},{milli:03d}"


def main() -> int:
    cfg = json.loads(SCRIPT.read_text())
    AUDIO.mkdir(parents=True, exist_ok=True)
    kokoro = Kokoro(str(MODELS / "kokoro-v1.0.onnx"), str(MODELS / "voices-v1.0.bin"))
    rate = 24_000
    gap = np.zeros(int(rate * cfg["gapMs"] / 1000), dtype=np.float32)
    scene_gap = np.zeros(int(rate * cfg["sceneGapMs"] / 1000), dtype=np.float32)

    pieces: list[np.ndarray] = []
    timeline: list[dict] = []
    srt_rows: list[str] = []
    cursor = 0
    prev_scene: str | None = None
    index = 1

    for line in cfg["lines"]:
        if prev_scene is not None:
            pad = scene_gap if line["scene"] != prev_scene else gap
            pieces.append(pad)
            cursor += int(1000 * len(pad) / rate)
        samples, out_rate = kokoro.create(
            line["text"],
            voice=cfg["voice"],
            speed=float(cfg["speed"]),
            lang=cfg["lang"],
        )
        if out_rate != rate:
            raise SystemExit(f"unexpected sample rate {out_rate}")
        audio = np.asarray(samples, dtype=np.float32)
        peak = float(np.max(np.abs(audio))) or 1.0
        audio = audio * min(0.95, 0.88 / peak)
        start = cursor
        duration_ms = int(1000 * len(audio) / rate)
        end = start + duration_ms
        wav_path = AUDIO / f"{line['id']}.wav"
        sf.write(wav_path, audio, rate)
        pieces.append(audio)
        cursor = end
        entry = {
            **line,
            "startMs": start,
            "endMs": end,
            "durationMs": duration_ms,
            "wav": str(wav_path.relative_to(ROOT)),
        }
        timeline.append(entry)
        srt_rows.append(f"{index}\n{ms_to_srt(start)} --> {ms_to_srt(end)}\n{line['caption']}\n")
        index += 1
        prev_scene = line["scene"]

    tail = np.zeros(int(rate * 0.8), dtype=np.float32)
    pieces.append(tail)
    mix = np.concatenate(pieces)
    narration = AUDIO / "narration.wav"
    sf.write(narration, mix, rate)
    (AUDIO / "timeline.json").write_text(json.dumps({"sampleRate": rate, "durationMs": int(1000 * len(mix) / rate), "lines": timeline}, indent=2))
    (ROOT / "script" / "captions.srt").write_text("\n".join(srt_rows) + "\n")
    seconds = len(mix) / rate
    print(f"wrote {narration} ({seconds:.2f}s, {len(timeline)} lines)")
    if seconds > 179.5:
        print("WARNING: over 3:00 — tighten the script", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
