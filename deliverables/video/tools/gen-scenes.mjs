#!/usr/bin/env node
// Writes the footage scenes (scenes/sNN-<name>.html) and scenes.json from film.config.json.
// Hand-made scenes ("kind": "file": title, hook, agent diagram, close) are only registered, never overwritten.
//
// A footage scene = the real screen capture (footage/<clip>.mp4, 2880x1620 = the app at 1440x810 CSS px, 2x) inside a
// camera that frames named boxes, callouts that point at named boxes, and a caption band at the bottom.
// Boxes are in the app's CSS px (1440x810) and come from footage/marks.json (recorded by capture.mjs at each state);
// config "boxes" overrides them (for things on the WebGL canvas, read off the footage by eye).
// Until a clip exists, the scene shows a still of the approved mockup or a slate, both labelled CAPTURE PENDING,
// framed with the mockup's boxes (footage/pending/boxes.json + config "pendingBoxes").
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const rd = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), "utf8"));
const has = (p) => fs.existsSync(path.join(ROOT, p));
const cfg = rd("film.config.json");
const [VW, VH] = cfg.capture.viewport;                        // app CSS px
const real = has("footage/marks.json") ? rd("footage/marks.json") : { boxes: {} };
const pend = has("footage/pending/boxes.json") ? rd("footage/pending/boxes.json") : {};
const esc = (t) => String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;");
// numbers (with their unit) are set in Martian Mono
// (a name such as "Mars 2020" stays in the sans)
const mono = (t) => esc(t).replace(/(Mars )?(\d[\d.,]*\d|\d)/g, (m, name, n) => (name ? m : `<span class="hm-mono">${n}</span>`));
const r = (x) => +x.toFixed(2);

// Frame layout: the band covers y >= BAND; the camera frames boxes inside the area above it.
const BAND = 880, SIDE = 96, KMIN = BAND / VH, KMAX = 2.4;

function boxFor(ref, scene) {
  if (Array.isArray(ref)) return ref;
  const [name, state] = ref.split("@");
  const realClip = scene.clips.some((c) => c.clip && has(`footage/${c.clip}.mp4`));
  if (realClip) {
    const b = cfg.boxes?.[state]?.[name] ?? real.boxes?.[state]?.[name];
    if (b) return b;
    console.warn(`  ${scene.id}: no real box ${ref}; using the full frame`);
    return [0, 0, VW, VH];
  }
  const ps = cfg.pendingAlias?.[state] ?? state;
  const b = cfg.pendingBoxes?.[ps]?.[name] ?? pend[ps]?.[name];
  if (!b) { console.warn(`  ${scene.id}: no pending box ${ref}; using the full frame`); return [0, 0, VW, VH]; }
  return b;
}
// camera transform (translate tx,ty then scale k, origin 0 0) that frames a box above the band
function fit(box, pad = 0.08, grow) {
  let [x, y, w, h] = box;
  if (grow) { x -= grow[0]; y -= grow[1]; w += grow[0] + grow[2]; h += grow[1] + grow[3]; }
  const pw = w * (1 + 2 * pad), ph = h * (1 + 2 * pad);
  const k = Math.min(KMAX, Math.max(KMIN, Math.min((1920 - 2 * SIDE) / pw, (BAND - 80) / ph)));
  let tx = 960 - (x + w / 2) * k, ty = BAND / 2 - (y + h / 2) * k;
  const W = VW * k, H = VH * k;
  tx = W >= 1920 ? Math.min(0, Math.max(1920 - W, tx)) : (1920 - W) / 2;
  ty = H >= BAND ? Math.min(0, Math.max(BAND - H, ty)) : (BAND - H) / 2;
  return { x: r(tx), y: r(ty), k: +k.toFixed(4) };
}
// fill the frame width; zoom > 1 pushes in on the middle of the area above the band
function fill(z) {
  const k = (1920 / VW) * z;
  return { x: r((1920 - VW * k) / 2), y: z === 1 ? 0 : r(Math.min(0, Math.max(BAND - VH * k, BAND / 2 - (VH / 2) * k))), k: +k.toFixed(4) };
}
const anchorPt = ([x, y, w, h], a = "c") => ({ c: [x + w / 2, y + h / 2], l: [x, y + h / 2], r: [x + w, y + h / 2], t: [x + w / 2, y], b: [x + w / 2, y + h] }[a]);

const wrap = (id, d, css, body, js, attrs = "") => `<!doctype html>
<html>
<head><meta charset="utf-8"></head>
<body>
<template>
  <style>
${css}
  </style>
  <div id="${id}-root" class="rk-scene on-stage" data-composition-id="${id}" data-width="1920" data-height="1080" data-duration="${d}"${attrs}>
    <div id="${id}-ground" class="rk-ground is-stage clip" data-start="0" data-duration="${d}" data-track-index="0"></div>
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

function footageScene(s) {
  const id = s.id, d = s.duration, S = `[data-composition-id="${id}"]`;
  const css = [], body = [], js = [];
  // media: one layer per clip entry, each visible from its "at" to the next entry
  let anyPending = false;
  const layers = [];
  s.clips.forEach((c, i) => {
    const from = c.at, to = s.clips[i + 1]?.at ?? d, len = r(to - from);
    const file = c.clip && `footage/${c.clip}.mp4`;
    if (c.clip === null && s.clips.slice(0, i).some((p) => p.clip && has(`footage/${p.clip}.mp4`))) {
      layers.at(-1).len = r(layers.at(-1).len + len); return;         // the previous real clip keeps playing
    }
    if (file && has(file)) layers.push({ kind: "video", src: file, from, len });
    else if (c.pending?.still) { anyPending = true; layers.push({ kind: "img", src: `footage/pending/${c.pending.still}.png`, from, len }); }
    else { anyPending = true; layers.push({ kind: "slate", text: c.pending?.slate ?? c.clip, from, len }); }
  });
  css.push(`    ${S} .hm-cam { position: absolute; left: 0; top: 0; width: ${VW}px; height: ${VH}px; transform-origin: 0 0; }
    ${S} .hm-media { position: absolute; left: 0; top: 0; width: ${VW}px; height: ${VH}px; object-fit: cover; }
    ${S} .hm-slate { background: #1e1a19; border: 1px solid var(--line-strong); display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 22px; padding: 0 140px; text-align: center; }
    ${S} .hm-slate b { font-size: 56px; font-weight: 600; color: var(--text-2); letter-spacing: 0.02em; }
    ${S} .hm-slate span { font-size: 30px; line-height: 1.35; color: var(--text-3); white-space: normal; }`);
  const camIn = layers.map((l, i) => {
    const lid = `${id}-m${i}`;
    if (l.kind === "video") return `      <video id="${lid}" class="hm-media" src="${l.src}" data-start="${l.from}" data-duration="${l.len}" data-track-index="${1 + i}" muted playsinline></video>`;
    const vis = `data-start="${l.from}" data-duration="${l.len}" data-track-index="${1 + i}"`;
    if (l.kind === "img") return `      <img id="${lid}" class="hm-media clip" src="${l.src}" ${vis} alt="">`;
    return `      <div id="${lid}" class="hm-media hm-slate clip" ${vis} data-qa-ignore><b>CAPTURE PENDING</b><span>${esc(l.text)}</span></div>`;
  }).join("\n");
  // camera keyframes (the first one is also written inline, so frame 0 is right before any seek)
  const cams = s.cam.map((c) => ({ ...c, ...(c.fill ? fill(c.zoom ?? 1) : fit(boxFor(c.box ?? [0, 0, VW, VH], s), c.pad, c.grow)) }));
  body.push(`    <div id="${id}-cam" class="hm-cam" style="transform: translate(${cams[0].x}px, ${cams[0].y}px) scale(${cams[0].k});">\n${camIn}\n    </div>`);
  js.push(`      // camera (app CSS px -> frame px): translate then scale, origin 0 0`);
  js.push(`      tl.set($("${id}-cam"), { x: ${cams[0].x}, y: ${cams[0].y}, scale: ${cams[0].k}, transformOrigin: "0 0" }, 0);`);
  for (let i = 1; i < cams.length; i++) {
    const a = cams[i - 1], b = cams[i], dur = b.dur ?? 0.9, ease = b.ease === "none" ? '"none"' : "RK.E.io";
    js.push(`      tl.fromTo($("${id}-cam"), { x: ${a.x}, y: ${a.y}, scale: ${a.k} }, { x: ${b.x}, y: ${b.y}, scale: ${b.k}, duration: ${dur}, ease: ${ease}, immediateRender: false }, ${b.at});`);
  }
  const camAt = (t) => { let c = cams[0]; for (const k of cams) if (k.at + (k.dur ?? 0.9) <= t + 1e-6 || k.at === 0) c = k; return c; };

  // callouts: a ring on the target, a hairline, a label plate (frame px from the settled camera)
  const lines = [];
  (s.callouts ?? []).forEach((co, i) => {
    if (cams.some((k) => k.at > 0 && co.at > k.at - 1e-6 && co.at < k.at + (k.dur ?? 0.9) - 1e-6)) console.warn(`  ${id}: callout ${i} starts while the camera moves`);
    const c = camAt(co.at), bx = boxFor(co.box, s), cid = `${id}-co${i}`, until = co.until ?? d;
    if (co.kind === "underline") {
      // an ochre bar under the target line (for text on the light report paper, where a ring would sit on words)
      const ux = r(c.x + bx[0] * c.k), uy = r(c.y + (bx[1] + bx[3]) * c.k + 6), uw = r(bx[2] * c.k);
      body.push(`    <div id="${cid}-ul" data-qa-ignore style="position: absolute; left: ${ux}px; top: ${uy}px; width: ${uw}px; height: 5px; background: var(--hm-accent); transform-origin: 0 50%; transform: scaleX(0);"></div>`);
      js.push(`      tl.fromTo($("${cid}-ul"), { scaleX: 0 }, { scaleX: 1, duration: 0.55, ease: RK.E.out, immediateRender: false }, ${co.at});`);
      return;
    }
    const [px, py] = anchorPt(bx, co.anchor);
    const X = r(c.x + px * c.k), Y = r(c.y + py * c.k);
    const estW = co.text.length * 34 * 0.52 + 44, estH = 62;
    // place the label on its side; if it would leave the safe area, shorten the leader first (never below 60 px)
    const place = (L) => {
      let lx = X, ly = Y, tx, ty, tf;
      if (co.side === "left") { lx = X - L; tx = lx; ty = Y; tf = "translate(-100%, -50%)"; }
      else if (co.side === "right") { lx = X + L; tx = lx; ty = Y; tf = "translate(0, -50%)"; }
      else if (co.side === "above") { ly = Y - L; tx = X; ty = ly; tf = "translate(-50%, -100%)"; }
      else { ly = Y + L; tx = X; ty = ly; tf = "translate(-50%, 0)"; }
      const left = tf.startsWith("translate(-100%") ? tx - estW : tf.startsWith("translate(-50%") ? tx - estW / 2 : tx;
      const top = tf.includes("-50%)") ? ty - estH / 2 : tf.includes("-100%)") ? ty - estH : ty;
      const sx = Math.max(SIDE, Math.min(1920 - SIDE - estW, left)) - left, sy = Math.max(60, Math.min(BAND - 24 - estH, top)) - top;
      return { lx, ly, tx, ty, tf, sx, sy };
    };
    let L = co.len ?? 140, p = place(L);
    const toward = () => (co.side === "left" && p.sx > 0) || (co.side === "right" && p.sx < 0) || (co.side === "above" && p.sy > 0) || (co.side === "below" && p.sy < 0);
    while (toward() && L > 60) { L -= 10; p = place(L); }
    if (toward()) console.warn(`  ${id}: callout "${co.text}" is pushed toward its target by ${Math.round(Math.abs(p.sx || p.sy))} px; pick another side`);
    let { lx, ly, tx, ty, tf } = p;
    tx = r(tx + p.sx); ty = r(ty + p.sy); lx = r(lx + p.sx); ly = r(ly + p.sy);
    body.push(`    <div id="${cid}-tag" class="hm-tag" data-qa="box" style="left: ${tx}px; top: ${ty}px; opacity: 0;">${mono(co.text)}</div>`);
    const [xp, yp] = (tf.match(/-?\d+%|0/g) || ["0", "0"]).map((v) => parseFloat(v) || 0);
    js.push(`      gsap.set($("${cid}-tag"), { xPercent: ${xp}, yPercent: ${yp} });`);
    // the hairline runs from the label to the ring's edge and draws toward the target
    const len = Math.hypot(X - lx, Y - ly), cut = r(Math.max(1, len - 16));
    const ex = r(lx + (X - lx) * cut / len), ey = r(ly + (Y - ly) * cut / len);
    lines.push(`      <circle id="${cid}-ring" cx="${X}" cy="${Y}" r="16" opacity="0" fill="none" stroke="#ece7e1" stroke-width="2.5"/>
      <line id="${cid}-line" opacity="0" x1="${lx}" y1="${ly}" x2="${ex}" y2="${ey}" stroke="#ece7e1" stroke-width="2.5" stroke-dasharray="${cut} ${cut}"/>`);
    js.push(`      // callout ${i}: "${co.text.replace(/"/g, "'")}" at (${X}, ${Y})`);
    js.push(`      tl.set([$("${cid}-ring"), $("${cid}-line"), $("${cid}-tag")], { opacity: 0 }, 0);`);
    js.push(`      tl.fromTo($("${cid}-ring"), { opacity: 0, scale: 0.6, transformOrigin: "${X}px ${Y}px" }, { opacity: 1, scale: 1, duration: 0.35, ease: RK.E.out, immediateRender: false }, ${co.at});`);
    js.push(`      tl.fromTo($("${cid}-line"), { opacity: 1, strokeDashoffset: ${cut} }, { opacity: 1, strokeDashoffset: 0, duration: 0.35, ease: RK.E.out, immediateRender: false }, ${r(co.at + 0.08)});`);
    js.push(`      RK.rise(tl, $("${cid}-tag"), ${r(co.at + 0.22)}, { y: 10, dur: 0.45, fade: 0.12 });`);
    if (until < d) js.push(`      tl.to([$("${cid}-ring"), $("${cid}-line"), $("${cid}-tag")], { opacity: 0, duration: 0.2, ease: RK.E.in }, ${until});`);
  });
  if (lines.length) body.push(`    <svg class="hm-lines" data-qa-ignore width="1920" height="1080" viewBox="0 0 1920 1080">\n${lines.join("\n")}\n    </svg>`);

  // overlays drawn over the footage
  if (s.overlay === "wordmark") {
    // title over the opening shot: a flat scrim, the wordmark and the tagline, gone before the caption
    body.push(`    <div id="${id}-scrim" class="hm-scrim" data-qa-ignore></div>
    <div id="${id}-word" class="hm-wordmark" style="top: 300px;">HEYMARS</div>
    <div id="${id}-tag" class="hm-tagline" style="top: 500px;">Point at Mars. Ask. It plans.</div>`);
    js.push(`      tl.fromTo($("${id}-scrim"), { opacity: 0.72 }, { opacity: 0, duration: 0.5, ease: RK.E.in, immediateRender: false }, 1.35);
      RK.rise(tl, $("${id}-word"), 0.0, { y: 14, dur: 0.6, fade: 0.2 });
      RK.words(tl, $("${id}-tag"), 0.3, { stagger: 0.07 });
      RK.out(tl, [$("${id}-word"), $("${id}-tag")], 1.4, { dur: 0.25 });`);
  }
  if (s.overlay === "edl") {
    // Mars 2020 EDL timeline (edl_mars2020.json, NASA/JPL landing press kit): seconds after entry interface
    const P = [["Entry", 0], ["Parachute", 240], ["Heat shield off", 260], ["Powered descent", 350], ["Sky crane", 420]];
    // the rail fills over the clip's own stretch of the landing clock (seconds after entry), read from the capture
    const e0 = s.edl?.from ?? 0, e1 = s.edl?.to ?? 420;
    const x0 = 120, x1 = 1608, X = (t) => r(x0 + (x1 - x0) * t / 420);
    const until = s.overlayUntil ?? d;
    // label slots alternate above and below the rail so the close 240 s and 260 s events never collide
    const marks = P.map(([n, t], i) => {
      const above = i % 2 === 0, x = X(t), align = i === 0 ? "left" : i === P.length - 1 ? "right" : "center";
      const tf = align === "left" ? "translate(0,0)" : align === "right" ? "translate(-100%,0)" : "translate(-50%,0)";
      return `      <div id="${id}-e${i}" class="hm-edl-mark" style="left: ${x}px; top: ${above ? 0 : 92}px; transform: ${tf}; text-align: ${align};"><b>${esc(n)}</b> <span class="hm-mono">${t}</span> s</div>
      <div id="${id}-et${i}" class="hm-edl-tick" style="left: ${x - 1}px;"></div>`;
    }).join("\n");
    body.push(`    <div id="${id}-edl" class="hm-edl" style="top: 96px; opacity: 0;" data-qa="box">
      <div class="hm-edl-rail"></div>
      <div id="${id}-edl-fill" class="hm-edl-fill"></div>
${marks}
    </div>`);
    js.push(`      tl.set($("${id}-edl"), { opacity: 0 }, 0);
      RK.rise(tl, $("${id}-edl"), 0.15, { y: -8, dur: 0.45, fade: 0.15 });
      tl.fromTo($("${id}-edl-fill"), { scaleX: ${r(e0 / 420)} }, { scaleX: ${r(e1 / 420)}, duration: ${r(until - 0.4)}, ease: "none", transformOrigin: "0 50%" }, 0.15);
${P.map((_, i) => { const tt = 0.15 + (until - 0.4) * (P[i][1] - e0) / Math.max(1, e1 - e0); return tt <= 0.15 ? "" : `      tl.fromTo($("${id}-e${i}"), { opacity: 0.4 }, { opacity: 1, duration: 0.15 }, ${r(Math.min(until - 0.3, tt))});`; }).filter(Boolean).join("\n")}
      tl.to($("${id}-edl"), { opacity: 0, duration: 0.2, ease: RK.E.in }, ${r(until - 0.15)});`);
  }
  if (anyPending) {
    body.push(`    <div id="${id}-pending" class="hm-pending" data-qa-ignore>CAPTURE PENDING${layers.some((l) => l.kind === "img") ? ": approved mockup still, real footage replaces it" : ""}</div>`);
  }

  // caption band: one line per beat, swapped in one slot; the data credit under it
  const caps = s.captions ?? [];
  body.push(`    <div id="${id}-band" class="hm-band"></div>
${caps.map((c, i) => `    <div id="${id}-cap${i}" class="hm-cap">${mono(c.text)}</div>`).join("\n")}
    <div id="${id}-credit" class="hm-credit">${esc(s.credit ?? cfg.credit)}</div>`);
  caps.forEach((c, i) => {
    if (i === 0) { js.push(`      RK.words(tl, $("${id}-cap0"), ${c.at}, { stagger: 0.05, dur: 0.45 });`); return; }
    js.push(`      tl.set($("${id}-cap${i}"), { opacity: 0 }, 0);`);
    js.push(`      RK.swap(tl, $("${id}-cap${i - 1}"), $("${id}-cap${i}"), ${c.at}, { words: true, stagger: 0.05, dur: 0.45 });`);
  });
  return wrap(id, d, css.join("\n"), body.join("\n"), js.join("\n"), ` data-qa-hold="${d}" data-qa-endhold="${d}"`);
}

const scenes = [];
for (const [i, s] of cfg.scenes.entries()) {
  let file = s.file;
  if (s.kind === "footage") {
    file = `scenes/${s.id}-${s.name}.html`;
    fs.writeFileSync(path.join(ROOT, file), footageScene(s));
  } else if (!has(file)) console.warn(`  ${s.id}: ${file} does not exist yet`);
  else {
    // the end card's link comes from film.config.json "link"
    const src = fs.readFileSync(path.join(ROOT, file), "utf8");
    const out = src.replace(/(<div id="s\d+-link"[^>]*>)[^<]*(<\/div>)/, `$1${esc(cfg.link)}$2`);
    if (out !== src) fs.writeFileSync(path.join(ROOT, file), out);
  }
  const e = { id: s.id, file, duration: s.duration, sfx: s.sfx ?? [] };
  if (i > 0) e.in = { type: s.in ?? "zoom-in", dur: cfg.transition ?? 0.4 };
  scenes.push(e);
}
const prev = has("scenes.json") ? rd("scenes.json") : {};
fs.writeFileSync(path.join(ROOT, "scenes.json"), JSON.stringify({ drift: 0.012, ...(prev.music ? { music: prev.music } : {}), scenes }, null, 2) + "\n");
const clips = cfg.scenes.flatMap((s) => (s.clips ?? []).map((c) => c.clip).filter(Boolean));
console.log(`generated ${scenes.length} scenes; footage: ` + clips.map((c) => c + (has(`footage/${c}.mp4`) ? "=real" : "=pending")).join(" "));
