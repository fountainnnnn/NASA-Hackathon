#!/usr/bin/env node
// Real screen capture of the running HeyMars app, driven by real mouse moves, clicks and typing.
//
//   node capture.mjs http://localhost:3990            # all shots, deterministic paths only (no LLM call)
//   node capture.mjs <url> --live                       # the ask in c04 is a free question: ONE paid LLM call
//   node capture.mjs <url> --only click,steps --headed  # some shots, in a visible window
//
// How it records: the app runs at 1440x810 CSS px (the UI spec's QA size) at device scale 2, and the DevTools
// screencast streams every painted frame as a 2880x1620 JPEG with its timestamp (footage/raw/<shot>/). Only the
// shots are recorded, not the waits between them. At each state it also stores the boxes (CSS px) of the elements the
// film frames and points at, in footage/marks.json. tools/cut-footage.mjs then turns each shot into the clips.
//
// What is driven by code rather than the mouse, and why (all of it real app behaviour, nothing staged):
//   - the orbit-to-ground flight in c03 uses the app's own camera flight (window.__planet.view, ?qa=1), so the move
//     is smooth and repeatable; a hand drag would give the same view.
//   - target points are found with the app's own projector (window.__mw.projectJezero / __planet), then the real
//     mouse glides there and clicks.
// Paid calls: without --live, every question typed is one of the app's fixed verbs ("Walk here and back"), which
// runs deterministic code with no model. With --live, c04 types a free question and waits for one MarsAgent turn.
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(ROOT, "../../package.json")); // the repo's node_modules
const { chromium } = require("@playwright/test");
const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, "film.config.json"), "utf8"));
const [VW, VH] = cfg.capture.viewport, SCALE = cfg.capture.scale;

const args = process.argv.slice(2);
const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const live = args.includes("--live"), headed = args.includes("--headed");
const only = opt("--only")?.split(",") ?? null;
const base = (args.find((a) => /^https?:/.test(a)) ?? process.env.BASE_URL ?? "http://localhost:3990").replace(/\/$/, "");
const want = (s) => !only || only.includes(s);

// The walk the film tells (the app's GO path, scripts/qa-layout.mjs GO_TARGET): base to a point on the Jezero fan 2.9 km
// ENE of the base. EVA starts 09:00 local solar time. From the default 10 m mast: NO GO, 2.2 km radio shadow; the card's
// "Raise mast to 20 m" replans to GO, "Every limit holds" (6.16 km, 2 h 32 min, 68.3 % battery at return).
const TARGET = { lon: 77.49357, lat: 18.47162 };
const JEZERO = { lon: 77.45, lat: 18.44 };
// The landing simulation follows the lander with its own cameras only outside the 20 m Jezero patch (inside it the result
// is drawn in the 20 m scene), so the landing shot uses a site on the plains just east of the crater rim.
const LAND = { lon: 78.0, lat: 18.4 };
const Q_LIVE = "Can I walk here and back from base?";
const Q_VERB = "Walk here and back";

const RAW = path.join(ROOT, "footage/raw");
fs.mkdirSync(RAW, { recursive: true });
const marksFile = path.join(ROOT, "footage/marks.json");
const M = fs.existsSync(marksFile) && only ? JSON.parse(fs.readFileSync(marksFile, "utf8")) : { base, viewport: [VW, VH], scale: SCALE, shots: {}, boxes: {} };
M.base = base; M.live = live;

const browser = await chromium.launch({
  channel: process.env.CAPTURE_CHANNEL ?? "chrome",   // system Chrome: real GPU for Cesium and three.js
  headless: !headed,
  args: [`--force-device-scale-factor=${SCALE}`, "--ignore-gpu-blocklist", "--enable-gpu-rasterization", "--hide-scrollbars", "--disable-features=CalculateNativeWinOcclusion"],
});
const ctx = await browser.newContext({ viewport: { width: VW, height: VH }, deviceScaleFactor: SCALE });
await ctx.addInitScript(() => {
  try { localStorage.setItem("marswalk-intro-seen", "1"); } catch {}
  // Screencast frames have no system pointer. Draw an arrow that follows the real mouse, hidden over the 3D view,
  // where the app draws its own reticle.
  const mk = () => {
    if (document.getElementById("__cur")) return;
    const d = document.createElement("div");
    d.id = "__cur";
    d.style.cssText = "position:fixed;left:0;top:0;width:22px;height:22px;z-index:2147483647;pointer-events:none;transform:translate(-100px,-100px)";
    d.innerHTML = '<svg width="22" height="22" viewBox="0 0 24 24"><path d="M4 2l15 9-6.5 1.5L9 19z" fill="#ece7e1" stroke="#060505" stroke-width="1.6" stroke-linejoin="round"/></svg>';
    document.documentElement.appendChild(d);
  };
  addEventListener("DOMContentLoaded", mk);
  addEventListener("mousemove", (e) => {
    mk();
    const c = document.getElementById("__cur"), t = e.target;
    c.style.transform = `translate(${e.clientX}px,${e.clientY}px)`;
    c.style.opacity = t && t.tagName === "CANVAS" ? "0" : "1";
  }, true);
});
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e.message || e)));
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });

const pause = (s) => page.waitForTimeout(s * 1000);
const soft = async (label, fn) => { try { return await fn(); } catch (e) { console.warn(`  WARN ${label}: ${String(e.message).split("\n")[0]}`); return null; } };
const glide = (x, y, steps = 40) => page.mouse.move(x, y, { steps });

/* ---------------------------------------------------------------- recorder */
const cdp = await ctx.newCDPSession(page);
let rec = null;
cdp.on("Page.screencastFrame", (f) => {
  cdp.send("Page.screencastFrameAck", { sessionId: f.sessionId }).catch(() => {});
  if (!rec) return;
  const n = rec.frames.length;
  const file = `${String(n).padStart(5, "0")}.jpg`;
  fs.writeFileSync(path.join(rec.dir, file), Buffer.from(f.data, "base64"));
  rec.frames.push({ file, ts: f.metadata.timestamp });
});
async function start(shot) {
  const dir = path.join(RAW, shot);
  fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
  rec = { shot, dir, frames: [], t0: Date.now() / 1000, marks: {} };
  await cdp.send("Page.startScreencast", { format: "jpeg", quality: 92, maxWidth: VW * SCALE, maxHeight: VH * SCALE, everyNthFrame: 1 });
  mark("start");
}
function mark(k) {
  if (!rec) return;
  rec.marks[k] = +((Date.now() / 1000) - rec.t0).toFixed(3);
  console.log(`  ${rec.shot} ${rec.marks[k].toFixed(2)}s ${k}`);
}
async function stop() {
  mark("end");
  await cdp.send("Page.stopScreencast");
  await pause(0.2);
  const { shot, frames, marks, t0 } = rec;
  // frame times relative to the shot's wall clock (screencast timestamps are wall-clock seconds)
  const out = frames.map((f) => ({ file: f.file, t: +(f.ts - t0).toFixed(4) }));
  fs.writeFileSync(path.join(RAW, shot, "frames.json"), JSON.stringify(out));
  M.shots[shot] = { marks, frames: out.length, fps: +(out.length / Math.max(0.1, (out.at(-1)?.t ?? 0) - (out[0]?.t ?? 0))).toFixed(1) };
  console.log(`  ${shot}: ${out.length} frames, ${M.shots[shot].fps} fps`);
  rec = null;
}

/* ---------------------------------------------------------------- page helpers */
// Box (CSS px) of the smallest visible element whose text matches `re`, optionally inside `within`.
const boxOf = (sel, re, within) => page.evaluate(([sel, src, flags, within]) => {
  const root = within ? document.querySelector(within) : document;
  if (!root) return null;
  const re = src ? new RegExp(src, flags) : null;
  const vis = [...root.querySelectorAll(sel)].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 2 && r.height > 2 && r.bottom > 0 && r.top < innerHeight && (!re || re.test(e.textContent || "")); });
  if (!vis.length) return null;
  const area = (e) => { const r = e.getBoundingClientRect(); return r.width * r.height; };
  const e = re ? vis.sort((a, b) => area(a) - area(b))[0] : vis[0];
  const r = e.getBoundingClientRect();
  return [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)];
}, [sel, re?.source ?? null, re?.flags ?? "", within ?? null]);
async function boxes(state, map) {
  M.boxes[state] = M.boxes[state] ?? {};
  for (const [k, spec] of Object.entries(map)) {
    let b = null;
    for (const [sel, re, within] of spec) { b = await boxOf(sel, re, within).catch(() => null); if (b) break; }
    if (b) M.boxes[state][k] = b; else console.warn(`  WARN box ${state}.${k} not found`);
  }
}
/* ---------------------------------------------------------------- app driver (after scripts/qa-layout.mjs) */
const sleep = pause;
const park = () => page.mouse.move(640, 20, { steps: 12 });
const ask = (text, origin = "tool") => page.evaluate(([t, o]) => window.__mw.ask(t, { origin: o, at: null }), [text, origin]);
const turnCount = () => page.evaluate(() => window.__mw.thread.getState().turns.length);
/** Wait until the newest turn after `before` is finished and every narration line has been revealed. */
async function waitTurn(before, timeout = 90000) {
  await page.waitForFunction((b) => {
    const m = window.__mw, ts = m.thread.getState().turns;
    if (ts.length <= b) return false;
    const t = ts[ts.length - 1];
    return t.status !== "working" && (m.reveal.getState().shown[t.id] ?? 0) >= t.narration.length;
  }, before, { timeout });
}
async function askWait(text, origin = "tool", timeout = 90000) { const b = await turnCount(); await ask(text, origin); await waitTurn(b, timeout); }
const closeAll = async () => {
  await page.evaluate(() => { const m = window.__mw; m.hud.getState().patch({ popover: null }); m.hud.getState().setSheet(null); m.companion.getState().closeBubble(); m.shell.getState().setReport(false); });
  await sleep(0.25);
};
const project = (p) => page.evaluate((p) => {
  const w = window.__mw;
  return w.globe.getState().mode === "jezero" ? w.projectJezero(p) : (w.projectPlanet ?? w.projectGlobe)(p);
}, p);
const stageBox = () => page.locator("[data-stage]").boundingBox();
const CARD = "section[data-companion]";
/** Glide the real mouse to a locator and click it. */
async function clickLoc(loc, label) {
  const el = loc.first();
  if (!(await el.isVisible().catch(() => false))) { console.warn(`  WARN not visible: ${label}`); return false; }
  const bb = await el.boundingBox();
  await glide(bb.x + bb.width / 2, bb.y + bb.height / 2, 28);
  await pause(0.15);
  await el.click();
  return true;
}
/** Type into an input the way a person does, then Enter. */
async function typeInto(sel, text) {
  const el = page.locator(sel).first();
  await el.waitFor({ state: "visible", timeout: 15000 });
  const bb = await el.boundingBox();
  await glide(bb.x + 40, bb.y + bb.height / 2, 24);
  await el.click();
  await el.pressSequentially(text, { delay: 45 });
  await pause(0.3);
  await el.press("Enter");
}
const cardVerdict = () => page.evaluate((sel) => document.querySelector(`${sel} [data-tone]`)?.textContent ?? null, CARD);
const simT = () => page.evaluate(() => +window.__mw.playback.getState().t.toFixed(1));
const speedBtn = (x) => page.locator(`[aria-label="${x} times speed"]`);

/* ---------------------------------------------------------------- session */
// Order: the planet shots first (orbit, landing), then Jezero (click, steps, replan, walk, report).
console.log(`capturing ${base} at ${VW}x${VH} x${SCALE}${live ? " (LIVE: one MarsAgent call)" : ""}`);
await page.addInitScript(() => { try { localStorage.removeItem("heymars-panel-open"); } catch {} });
await page.goto(`${base}/?qa=1`, { waitUntil: "load", timeout: 120000 });
await page.waitForFunction("window.__mw && window.__mw.ready() && !!window.__planet", null, { timeout: 150000 });
await soft("intro", async () => { const s = page.getByRole("button", { name: "Start", exact: true }); if (await s.isVisible({ timeout: 2000 })) await s.click(); });
await pause(2.5);
await park();

// c03 orbit: the whole planet, then the app's own camera flight down to Jezero Crater
if (want("orbit")) {
  await page.evaluate(() => window.__planet.view(70, 15, 9000, { pitchDeg: -90, instant: true }));
  await page.waitForFunction(() => window.__planet.stats().tilesLoaded, null, { timeout: 60000 }).catch(() => {});
  await pause(1.5);
  await start("orbit");
  await pause(0.4);
  mark("fly");
  await page.evaluate(([lon, lat]) => window.__planet.view(lon, lat, 160, { pitchDeg: -38, headingDeg: 15 }), [JEZERO.lon, JEZERO.lat]);
  mark("landed");
  await page.waitForFunction(() => window.__planet.stats().tilesLoaded, null, { timeout: 30000 }).catch(() => {});
  mark("sharp");
  await pause(1.2);
  await stop();
}

// c03b tilt: Coprates Chasma (Valles Marineris) top-down, then the app's Tilt (T) swings down to the canyon walls
if (want("tilt")) {
  await page.evaluate(() => window.__planet.view(-66, -13.5, 120, { pitchDeg: -89, headingDeg: 270, instant: true }));
  await page.waitForFunction(() => window.__planet.stats().tilesLoaded, null, { timeout: 60000 }).catch(() => {});
  await pause(2.0);
  await park();
  await start("tilt");
  await pause(0.4);
  mark("press");
  await page.keyboard.press("t");
  await pause(1.3);
  mark("tilted");
  await page.waitForFunction(() => window.__planet.stats().tilesLoaded, null, { timeout: 20000 }).catch(() => {});
  mark("sharp");
  await pause(2.0);
  await stop();
}

// c08a landing: click the planet, "Landing check", "Run landing simulation". At 60x until the back shell separates
// (340 s after entry), then 10x so the sky crane is seen from the ground-level tracking camera.
if (want("landing")) {
  await page.evaluate(([lon, lat]) => window.__planet.view(lon, lat, 400, { pitchDeg: -60, instant: true }), [LAND.lon, LAND.lat]);
  await page.waitForFunction(() => window.__planet.stats().tilesLoaded, null, { timeout: 60000 }).catch(() => {});
  await pause(1);
  const st = await stageBox();
  let b = await turnCount();
  await glide(st.x + st.width * 0.5, st.y + st.height * 0.5, 30);
  await page.mouse.click(st.x + st.width * 0.5, st.y + st.height * 0.5);
  await waitTurn(b, 60000);
  await askWait("Landing check", "map", 60000);
  b = await turnCount();
  await ask("Run landing simulation", "tool");
  await page.waitForFunction("window.__mw.hud.getState().landing && window.__mw.playback.getState().durationS > 0", null, { timeout: 120000 });
  await start("landing");
  mark("descent");
  M.simT = { descent: await simT() };
  await page.waitForFunction(() => window.__mw.playback.getState().t >= 330, null, { timeout: 60000 }).catch(() => console.warn("  WARN landing clock did not reach 330 s"));
  await soft("10x", () => speedBtn(10).click());
  mark("slow"); M.simT.slow = await simT();
  await page.waitForFunction(() => window.__mw.playback.getState().t >= 420, null, { timeout: 30000 }).catch(() => {});
  mark("touchdown"); M.simT.touchdown = await simT();
  await pause(2.0);
  // then the 10,000 seeded test landings fall into the ellipse (115 to 535 s after touchdown), at 60x
  await soft("60x", () => speedBtn(60).click());
  await page.waitForFunction(() => window.__mw.playback.getState().t >= 420 + 105, null, { timeout: 30000 }).catch(() => {});
  mark("mc"); M.simT.mc = await simT();
  await page.waitForFunction(() => window.__mw.playback.getState().t >= 420 + 540, null, { timeout: 30000 }).catch(() => console.warn("  WARN test landings did not finish"));
  mark("mcdone"); M.simT.mcdone = await simT();
  await pause(1.5);
  await boxes("mc", { counter: [["[data-done]"]] });
  await stop();
  await waitTurn(b, 30000).catch(() => {});
  await closeAll();
}

// a fresh session for the Jezero part, so the panel thread holds only the walk's turns
if (want("orbit") || want("landing")) {
  await page.goto(`${base}/?qa=1`, { waitUntil: "load", timeout: 120000 });
  await page.waitForFunction("window.__mw && window.__mw.ready() && !!window.__planet", null, { timeout: 150000 });
  await pause(2.5);
}
// into the 20 m Jezero scene (the app's own verb), then wait for the base to be on screen
await askWait("Take me to Jezero", "tool", 150000);
await page.waitForFunction("window.__mw.globe.getState().mode === 'jezero' && window.__mw.projectJezero({lon: window.__mw.world.getState().base.lon, lat: window.__mw.world.getState().base.lat}).visible", null, { timeout: 150000 });
await pause(3.5);
await closeAll();

// c04 click: the reticle trails the cursor to the fan target, dwells (readout), clicks; the card answers at the cursor.
// Then the ask line on the card: "Walk here and back" (fixed code) or, with --live, a free question (one model call).
if (want("click")) {
  const p = await project(TARGET);
  const st = await stageBox();
  const onStage = p.visible && p.x > st.x + 12 && p.x < st.x + st.width - 12 && p.y > st.y + 12 && p.y < st.y + st.height - 12;
  if (!onStage) console.warn("  WARN fan target not on screen; clicking the stage centre");
  const tx = onStage ? p.x : st.x + st.width * 0.55, ty = onStage ? p.y : st.y + st.height * 0.5;
  await page.mouse.move(tx - 240, ty + 160);
  await start("click");
  await glide(tx - 50, ty + 30, 45);
  mark("dwell");
  await glide(tx, ty, 25);
  await pause(0.9);
  let b = await turnCount();
  await page.mouse.click(tx, ty);
  mark("clicked");
  await waitTurn(b, 60000);
  await pause(0.6);
  await boxes("clicked", { card: [[CARD]] });
  mark("ask");
  b = await turnCount();
  await typeInto("#marsagent-card-input", live ? Q_LIVE : Q_VERB);
  mark("asked");
  await waitTurn(b, live ? 120000 : 90000);
  await pause(1.0);
  mark("answered");
  M.verdict1 = await cardVerdict();
  console.log(`  verdict: ${M.verdict1}`);
  await boxes("click", {
    card: [[CARD]], verdict: [[`${CARD} [data-tone]`]], headline: [[`${CARD} h2`]],
    delay: [["*", /^Earth light delay/i, "header"], ["div", /Earth light delay/]],
  });
  await pause(0.8);
  await stop();
}

// c06 steps: the panel's narration of that turn, then "How I worked it out" open on a formula with real numbers
if (want("steps")) {
  await page.evaluate(() => { const log = document.querySelector("#marsagent-panel [role=log]"); const art = [...log.querySelectorAll("article")].pop(); log.scrollTop += art.getBoundingClientRect().top - log.getBoundingClientRect().top - 8; });
  await pause(0.4);
  await start("steps");
  await boxes("steps", { narration: [["#marsagent-panel [role=log] article:last-of-type ol[aria-label='What MarsAgent is doing']"]], panel: [["#marsagent-panel"]] });
  await pause(0.9);
  mark("expand");
  const sum = page.locator("#marsagent-panel [role=log] article").last().locator("details summary");
  await clickLoc(sum, "How I worked it out");
  await pause(0.5);
  await page.evaluate(() => {
    const log = document.querySelector("#marsagent-panel [role=log]");
    const art = [...log.querySelectorAll("article")].pop();
    const pres = [...art.querySelectorAll("details[open] pre")];
    const pre = pres.find((e) => /battery|%/i.test(e.getAttribute("aria-label") + e.textContent) && /=/.test(e.textContent)) ?? pres.find((e) => /=/.test(e.textContent)) ?? pres[0];
    if (pre) { pre.setAttribute("data-film-formula", "1"); log.scrollTo({ top: log.scrollTop + pre.getBoundingClientRect().top - log.getBoundingClientRect().top - log.clientHeight * 0.3, behavior: "smooth" }); }
  });
  await pause(1.4);
  await boxes("steps", { formula: [["[data-film-formula]"]] });
  mark("formula");
  await pause(1.6);
  await stop();
}

// c07 replan: the NO GO card with its reason on the map, then the card's "Raise mast to 20 m" and the replan to GO
if (want("replan")) {
  await park();
  await start("replan");
  await boxes("route", { card: [[CARD]], verdict: [[`${CARD} [data-tone]`]], headline: [[`${CARD} h2`]] });
  await pause(1.4);
  mark("change");
  const b = await turnCount();
  await clickLoc(page.locator(`${CARD} button`, { hasText: /^Raise mast to \d+ m$/ }), "Raise mast");
  await waitTurn(b, 90000).catch(() => console.warn("  WARN replan turn did not finish"));
  mark("replanned");
  M.verdict2 = await cardVerdict();
  console.log(`  verdict after replan: ${M.verdict2}`);
  await pause(1.4);
  await boxes("replan", { card: [[CARD]], verdict: [[`${CARD} [data-tone]`]], headline: [[`${CARD} h2`]] });
  await stop();
}

// c08b walk: "Walk it" on the card, then 600x on the playback bar: the chase camera follows the two crew
if (want("walk")) {
  await start("walk");
  const b = await turnCount();
  if (!(await clickLoc(page.locator(`${CARD} button`, { hasText: /^Walk it$/ }), "Walk it"))) await ask("Walk it");
  await page.waitForFunction("window.__mw.hud.getState().walkOn", null, { timeout: 30000 }).catch(() => console.warn("  WARN walk did not start"));
  await pause(0.8);
  await clickLoc(speedBtn(600), "600x");
  mark("speed");
  await boxes("walk", { speed: [["[aria-label='600 times speed']"]], playback: [["[role=group][aria-label=Playback]"]] });
  await park();
  await pause(5);
  mark("helmet");
  await ask("Helmet view");
  await pause(4);
  await page.evaluate(() => window.__mw.walkUi.getState().setHelmet(false));
  await waitTurn(b, 20000).catch(() => {});
  await stop();
}

// c09 report: the report card's Open, then the contents' "Data sources" entry (section 6, the 708-waypoint check)
if (want("report")) {
  await closeAll();
  await page.evaluate(() => { const log = document.querySelector("#marsagent-panel [role=log]"); log.scrollTop = log.scrollHeight; });
  await pause(0.6);
  await start("report");
  if (!(await clickLoc(page.locator("#marsagent-panel button", { hasText: /^Open$/ }).last(), "report Open"))) await page.evaluate(() => window.__mw.shell.getState().setReport(true));
  await page.waitForSelector("[data-report-root]", { timeout: 15000 }).catch(() => console.warn("  WARN report did not open"));
  await pause(1.0);
  mark("open");
  await boxes("report", { paper: [["[data-report-paper]"]], toc: [["[data-report-root] nav"]] });
  await pause(0.6);
  mark("scroll");
  if (!(await clickLoc(page.locator("[data-report-root] nav button", { hasText: /data sources|validation/i }), "Data sources"))) {
    await page.evaluate(() => { const sc = document.querySelector("[data-report-scroll]"); const h = [...sc.querySelectorAll("h2")].find((x) => /validation|data sources/i.test(x.textContent)); if (h) sc.scrollTo({ top: h.offsetTop - 16, behavior: "smooth" }); });
  }
  await pause(1.2);
  await boxes("report2", { paper: [["[data-report-paper]"]], validationNote: [["[data-report-paper] *", /708 Perseverance/]] });
  mark("validation");
  await pause(1.6);
  await stop();
  await closeAll();
}

fs.writeFileSync(marksFile, JSON.stringify(M, null, 2));
if (errors.length) console.warn(`  page errors (${errors.length}): ${errors.slice(0, 5).join(" | ")}`);
await ctx.close();
await browser.close();
console.log("recorded; cutting clips");
execFileSync("node", [path.join(ROOT, "tools/cut-footage.mjs")], { stdio: "inherit" });
