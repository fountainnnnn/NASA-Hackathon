#!/usr/bin/env node
// Turns the recorded shots (footage/raw/<shot>/NNNNN.jpg + frames.json, from capture.mjs) into the film's clips,
// footage/<clip>.mp4 at 2880x1620, 60 fps, each exactly as long as its slot in film.config.json.
//
// film.config.json "cuts" says where each clip comes from:
//   "c04": { "shot": "click", "from": "start", "to": "answered+0.6", "skip": [["asked+0.5", "answered-1.0"]], "maxSpeed": 1.6 }
// Times are shot marks (+/- seconds). "skip" drops idle waits (a jump cut, never a fake frame). If what is left is
// longer than the slot it plays faster, up to maxSpeed (default 1.5), then the end is trimmed; if shorter, the last
// frame is held. Every printed line says what happened, so check it after each capture.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, "film.config.json"), "utf8"));
const M = JSON.parse(fs.readFileSync(path.join(ROOT, "footage/marks.json"), "utf8"));
const FF = fs.existsSync(path.join(ROOT, ".bin/ffmpeg")) ? path.join(ROOT, ".bin/ffmpeg") : "ffmpeg";
const [VW, VH] = cfg.capture.viewport, S = cfg.capture.scale, FPS = cfg.capture.fps ?? 60;
const only = (() => { const i = process.argv.indexOf("--only"); return i > 0 ? process.argv[i + 1].split(",") : null; })();

// slot length of every clip: from its "at" to the next clip entry (or the scene end)
const slots = {};
for (const s of cfg.scenes) (s.clips ?? []).forEach((c, i, a) => {
  if (!c.clip) return;
  let end = s.duration;
  for (let j = i + 1; j < a.length; j++) if (a[j].clip) { end = a[j].at; break; }
  slots[c.clip] = +(end - c.at).toFixed(3);
});

const at = (shot, expr) => {
  const m = String(expr).match(/^([a-zA-Z0-9]+)([+-][\d.]+)?$/);
  if (!m) throw new Error(`bad mark "${expr}"`);
  const v = M.shots[shot]?.marks?.[m[1]];
  if (v == null) throw new Error(`shot ${shot}: no mark "${m[1]}"`);
  return v + (m[2] ? parseFloat(m[2]) : 0);
};

for (const [clip, c] of Object.entries(cfg.cuts ?? {})) {
  if (only && !only.includes(clip)) continue;
  const D = slots[clip];
  if (!D) { console.warn(`  ${clip}: not used by any scene, skipped`); continue; }
  const dir = path.join(ROOT, "footage/raw", c.shot);
  if (!fs.existsSync(path.join(dir, "frames.json"))) { console.warn(`  ${clip}: shot "${c.shot}" not recorded, skipped`); continue; }
  const frames = JSON.parse(fs.readFileSync(path.join(dir, "frames.json"), "utf8"));
  const from = Math.max(0, at(c.shot, c.from)), to = at(c.shot, c.to);
  // the kept ranges
  let ranges = [[from, to]];
  for (const [a, b] of c.skip ?? []) {
    const sa = at(c.shot, a), sb = at(c.shot, b);
    if (sb <= sa) continue;
    ranges = ranges.flatMap(([x, y]) => (sb <= x || sa >= y ? [[x, y]] : [[x, sa], [sb, y]].filter(([p, q]) => q - p > 0.02)));
  }
  const src = ranges.reduce((n, [x, y]) => n + (y - x), 0);
  const maxSpeed = c.maxSpeed ?? 1.5;
  const speed = Math.min(maxSpeed, Math.max(1, src / D));
  // frame list: each kept frame lasts until the next one (screencast frames come only when the page repaints)
  const list = [];
  for (const [x, y] of ranges) {
    const fs_ = frames.filter((f) => f.t >= x - 0.05 && f.t < y);
    if (!fs_.length) { const prev = [...frames].reverse().find((f) => f.t < x); if (prev) list.push({ file: prev.file, d: (y - x) / speed }); continue; }
    // the frame showing at x
    const prev = [...frames].reverse().find((f) => f.t <= x);
    if (prev && prev.file !== fs_[0].file && fs_[0].t > x) list.push({ file: prev.file, d: (fs_[0].t - x) / speed });
    fs_.forEach((f, i) => list.push({ file: f.file, d: ((fs_[i + 1]?.t ?? y) - Math.max(f.t, x)) / speed }));
  }
  let total = list.reduce((n, f) => n + f.d, 0);
  if (total < D) list.at(-1).d += D - total;   // hold the last frame
  const concat = path.join(dir, `${clip}.ffconcat`);
  fs.writeFileSync(concat, "ffconcat version 1.0\n" + list.map((f) => `file '${f.file}'\nduration ${Math.max(0.001, f.d).toFixed(5)}`).join("\n") + `\nfile '${list.at(-1).file}'\n`);
  const out = path.join(ROOT, `footage/${clip}.mp4`);
  execFileSync(FF, ["-y", "-v", "error", "-f", "concat", "-safe", "0", "-i", concat, "-t", String(D), "-an",
    "-vf", `fps=${FPS},scale=${VW * S}:${VH * S}:flags=lanczos,format=yuv420p`, "-c:v", "libx264", "-crf", "14", "-preset", "slow", "-movflags", "+faststart", out]);
  const note = src / D > maxSpeed ? `, end trimmed by ${(src - D * maxSpeed).toFixed(1)}s` : src < D ? `, last frame held ${(D - src).toFixed(1)}s` : "";
  console.log(`  ${clip}: ${c.shot} ${from.toFixed(1)}-${to.toFixed(1)}s, ${ranges.length} range(s), ${src.toFixed(1)}s -> ${D}s at x${speed.toFixed(2)}${note}; ${M.shots[c.shot].fps} fps recorded`);
}
