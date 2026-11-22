#!/usr/bin/env node
/** Concatenate recorded clips, mix Kokoro narration, burn captions, write YouTube master. */
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FF = path.join(ROOT, ".cache", "ffmpeg", "ffmpeg");
const FP = path.join(ROOT, ".cache", "ffmpeg", "ffprobe");
const OUT = path.join(ROOT, "out");

function probeDuration(file) {
  const raw = execFileSync(FP, ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file], {
    encoding: "utf8",
  }).trim();
  return Number(raw);
}

function run(args) {
  execFileSync(FF, args, { stdio: "inherit" });
}

async function main() {
  const timeline = JSON.parse(await readFile(path.join(ROOT, "audio", "timeline.json"), "utf8"));
  const manifest = JSON.parse(await readFile(path.join(ROOT, "capture", "manifest.json"), "utf8"));
  await mkdir(OUT, { recursive: true });
  const tmp = path.join(ROOT, "capture", "normalized");
  await mkdir(tmp, { recursive: true });

  const sceneOrder = ["title", "problem", "architecture", "product", "proof", "close"];
  const sceneStart = {};
  for (const line of timeline.lines) {
    if (sceneStart[line.scene] == null) sceneStart[line.scene] = line.startMs;
  }
  const sceneDur = {};
  for (let i = 0; i < sceneOrder.length; i++) {
    const scene = sceneOrder[i];
    const start = sceneStart[scene];
    const next = sceneOrder[i + 1];
    const end = next ? sceneStart[next] : timeline.durationMs;
    sceneDur[scene] = (end - start) / 1000;
  }

  const ordered = [];
  for (const clip of manifest.clips) {
    const src = clip.file;
    const mp4 = path.join(tmp, `${clip.scene}.mp4`);
    const dur = sceneDur[clip.scene];
    const srcDur = probeDuration(src);
    const filter =
      srcDur >= dur
        ? `trim=duration=${dur.toFixed(3)},setpts=PTS-STARTPTS,fps=30,format=yuv420p,scale=1920:1080:flags=lanczos`
        : `tpad=stop_mode=clone:stop_duration=${(dur - srcDur).toFixed(3)},fps=30,format=yuv420p,scale=1920:1080:flags=lanczos`;
    run(["-y", "-i", src, "-an", "-vf", filter, "-c:v", "libx264", "-preset", "fast", "-crf", "16", "-t", dur.toFixed(3), mp4]);
    ordered.push(mp4);
  }

  const list = path.join(tmp, "concat.txt");
  await writeFile(list, ordered.map((f) => `file '${f}'`).join("\n") + "\n");
  const silent = path.join(tmp, "picture.mp4");
  run(["-y", "-f", "concat", "-safe", "0", "-i", list, "-c", "copy", silent]);

  const bed = path.join(tmp, "bed.wav");
  run([
    "-y", "-f", "lavfi", "-i", "anoisesrc=color=brown:amplitude=0.035:sample_rate=24000",
    "-t", (timeline.durationMs / 1000 + 1).toFixed(3),
    "-af", "lowpass=f=180,volume=0.22",
    bed,
  ]);

  const srt = path.join(ROOT, "script", "captions.srt");
  const master = path.join(OUT, "eyes-without-a-face-demo.mp4");
  const style =
    "FontName=Liberation Sans,FontSize=20,PrimaryColour=&H00F7EAEE,BackColour=&HCC0A0905,OutlineColour=&H00120A09,BorderStyle=3,Outline=8,Shadow=0,MarginV=36,Alignment=2";
  run([
    "-y",
    "-i", silent,
    "-i", path.join(ROOT, "audio", "narration.wav"),
    "-i", bed,
    "-filter_complex",
    `[1:a]loudnorm=I=-16:TP=-1.5:LRA=11[voice];[2:a]volume=0.12[amb];[voice][amb]amix=inputs=2:duration=first:dropout_transition=0[a];[0:v]subtitles=${srt}:force_style='${style}',format=yuv420p[v]`,
    "-map", "[v]",
    "-map", "[a]",
    "-c:v", "libx264",
    "-preset", "slow",
    "-crf", "14",
    "-c:a", "aac",
    "-b:a", "192k",
    "-ar", "48000",
    "-movflags", "+faststart",
    "-shortest",
    master,
  ]);

  const seconds = probeDuration(master);
  console.log(`master ${master} (${seconds.toFixed(2)}s)`);
  if (seconds > 180) {
    console.error("WARNING: longer than 3:00");
    process.exit(2);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
