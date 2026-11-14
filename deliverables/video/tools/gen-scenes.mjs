#!/usr/bin/env node
// Writes scenes/*.html and scenes.json from film.config.json.
// A footage scene plays footage/<clip>.mp4 when it exists; otherwise a grey "CAPTURE PENDING" frame stands in.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, "film.config.json"), "utf8"));
fs.mkdirSync(path.join(ROOT, "scenes"), { recursive: true });
const esc = (t) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;");
const wrap = (id, d, css, body, js, attrs = "") => `<!doctype html>
<html>
<head><meta charset="utf-8"></head>
<body>
<template>
  <style>
${css}
  </style>
  <div id="${id}-root" class="rk-scene" data-composition-id="${id}" data-width="1920" data-height="1080" data-duration="${d}" data-qa-center="x"${attrs}>
    <div id="${id}-ground" class="rk-ground clip" data-start="0" data-duration="${d}" data-track-index="0"></div>
${body}
  </div>
  <script>
    (() => {
      const $ = (i) => document.getElementById(i);
      const tl = gsap.timeline({ paused: true });
${js}
      window.__timelines["${id}"] = tl;
    })();
  </script>
</template>
</body>
</html>
`;
const scenes = [];
for (const [i, s] of cfg.scenes.entries()) {
  const id = s.id, d = s.duration;
  let file, html;
  if (s.kind === "title") {
    file = `scenes/${id}-title.html`;
    html = wrap(id, d,
`    [data-composition-id="${id}"] .${id}-a { position: absolute; left: 0; top: 432px; width: 1920px; white-space: nowrap; }
    [data-composition-id="${id}"] .${id}-b { position: absolute; left: 0; top: 595px; width: 1920px; white-space: nowrap; text-align: center; color: var(--muted); }`,
`    <div id="${id}-world" class="rk-world" data-qa-camera>
      <div id="${id}-a" class="${id}-a t-hero">${esc(cfg.title)}</div>
      <div id="${id}-b" class="${id}-b t-sub">${esc(cfg.byline)}</div>
    </div>`,
`      RK.words(tl, $("${id}-a"), 0.0, { stagger: 0.12, dur: 0.6 });
      RK.rise(tl, $("${id}-b"), 0.5, { y: 12, dur: 0.6 });
      tl.fromTo($("${id}-world"), { scale: 1 }, { scale: 1.04, duration: ${d}, ease: "none", transformOrigin: "960px 540px" }, 0);`);
  } else if (s.kind === "link") {
    file = `scenes/${id}-link.html`;
    html = wrap(id, d,
`    [data-composition-id="${id}"] .${id}-line { position: absolute; left: 0; top: 473px; width: 1920px; white-space: nowrap; }`,
`    <div id="${id}-world" class="rk-world" data-qa-camera>
      <div id="${id}-line" class="${id}-line t-hero">${esc(cfg.link)}</div>
    </div>`,
`      RK.words(tl, $("${id}-line"), 0.2, { stagger: 0.1, dur: 0.6 });
      tl.fromTo($("${id}-world"), { scale: 1 }, { scale: 1.04, duration: ${d}, ease: "none", transformOrigin: "960px 540px" }, 0);`);
  } else {
    file = `scenes/${id}-${s.clip}.html`;
    const have = fs.existsSync(path.join(ROOT, "footage", `${s.clip}.mp4`));
    const media = have
      ? `    <video id="${id}-v" class="${id}-media" src="footage/${s.clip}.mp4" data-start="0" data-duration="${d}" data-track-index="1" muted playsinline></video>`
      : `    <div id="${id}-v" class="${id}-media ${id}-pending t-title" data-qa-ignore>CAPTURE PENDING</div>`;
    html = wrap(id, d,
`    [data-composition-id="${id}"] .${id}-media { position: absolute; left: 0; top: 0; width: 1920px; height: 1080px; object-fit: cover; }
    [data-composition-id="${id}"] .${id}-pending { background: #cfd0d4; color: #65656d; display: flex; align-items: center; justify-content: center; padding-bottom: 200px; font-size: 64px; }
    [data-composition-id="${id}"] .${id}-cap { position: absolute; left: 0; bottom: 70px; width: 1920px; display: flex; justify-content: center; }
    [data-composition-id="${id}"] .${id}-pill { background: #fff; border-radius: 80px; padding: 24px 64px 28px; box-shadow: var(--shadow-md); font-size: 64px; line-height: 1.1; letter-spacing: -0.03em; white-space: nowrap; }
    [data-composition-id="${id}"] .${id}-credit { position: absolute; left: 60px; top: 60px; background: #fff; border-radius: 60px; padding: 16px 40px 18px; box-shadow: var(--shadow-md); font-size: 30px; line-height: 1.2; white-space: nowrap; }`,
`${media}
    <div id="${id}-cap" class="${id}-cap"><div id="${id}-pill" class="${id}-pill">${esc(s.caption)}</div></div>${s.credit ? `
    <div id="${id}-credit" class="${id}-credit" data-qa-ignore>${esc(cfg.credit)}</div>` : ""}`,
`      RK.rise(tl, $("${id}-pill"), 0.45, { y: 14, dur: 0.5 });${s.credit ? `
      RK.rise(tl, $("${id}-credit"), 0.9, { y: 10, dur: 0.5 });` : ""}`,
` data-qa-hold="${d}" data-qa-endhold="${d}"`);
  }
  fs.writeFileSync(path.join(ROOT, file), html);
  const e = { id, file, duration: d, sfx: [] };
  if (i > 0) e.in = { type: s.in ?? "zoom-in", dur: 0.5 };
  scenes.push(e);
}
fs.writeFileSync(path.join(ROOT, "scenes.json"), JSON.stringify({ drift: 0.015, scenes }, null, 2) + "\n");
console.log(`generated ${scenes.length} scenes; footage: ` + cfg.scenes.filter((s) => s.clip).map((s) => s.clip + (fs.existsSync(path.join(ROOT, "footage", s.clip + ".mp4")) ? "=real" : "=pending")).join(" "));
