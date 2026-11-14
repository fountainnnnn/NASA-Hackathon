#!/usr/bin/env node
// Cuts footage/raw/session.webm into footage/c02..c06.mp4, each exactly its scene length (film.config.json).
// Idle waits are trimmed by choosing the source window from capture marks; a window longer than the scene is sped
// up (max 1.6x, else trimmed at the end), a shorter one is held on its last frame. Nothing is synthesised.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { marks: m } = JSON.parse(fs.readFileSync(path.join(ROOT, "footage/marks.json"), "utf8"));
const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, "film.config.json"), "utf8"));
const FF = path.join(ROOT, ".bin/ffmpeg");
const LEAD = 0.15; // the recorder starts a touch before our clock
// scene clip -> [source start, source end] in session seconds
const win = {
  c02: [m.terrainReady - 0.3, m.orbitEnd],
  c03: [m.orbitEnd - 0.2, m.pinned + 0.8],
  c04: [m.askStart, m.routeShown + 0.5],
  c05: [m.limitStart, m.replanned + 0.2],
  c06: [m.sourcesStart, m.photosEnd],
};
fs.mkdirSync(path.join(ROOT, "footage"), { recursive: true });
for (const s of cfg.scenes.filter((x) => x.clip)) {
  const [a, b] = win[s.clip], src = Math.max(0, b - a), D = s.duration;
  let speed = src / D;
  let vf;
  if (speed > 1.6) { speed = 1.6; vf = `setpts=PTS/${speed}`; }
  else if (speed >= 1) vf = `setpts=PTS/${speed}`;
  else vf = `setpts=PTS/${Math.max(speed, 0.8)},tpad=stop_mode=clone:stop_duration=${D}`;
  const out = path.join(ROOT, `footage/${s.clip}.mp4`);
  execFileSync(FF, ["-y", "-v", "error", "-ss", String(Math.max(0, a + LEAD)), "-i", path.join(ROOT, "footage/raw/session.webm"),
    "-t", String(src), "-an", "-vf", `${vf},fps=30,scale=1920:1080,format=yuv420p`, "-t", String(D), "-c:v", "libx264", "-crf", "16", "-preset", "medium", "-movflags", "+faststart", out]);
  console.log(`  ${s.clip}: source ${a.toFixed(1)}-${b.toFixed(1)}s (${src.toFixed(1)}s) -> ${D}s, speed x${speed.toFixed(2)}${speed < 0.8 ? " (held on last frame)" : ""}`);
}
