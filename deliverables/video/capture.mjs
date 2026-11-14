#!/usr/bin/env node
// Real screen capture of the running app, driven by real clicks and typing.
//   node capture.mjs <baseUrl> [--click 0.30,0.55] [--headed]
// Records one 1920x1080 session (Playwright recordVideo), logs a mark per step, then cuts footage/c02..c06.mp4
// (tools/cut-footage.mjs) to the exact scene lengths. Selector assumptions are listed in README.md.
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(ROOT, "../../package.json")); // the repo's node_modules
const { chromium } = require("@playwright/test");

const args = process.argv.slice(2);
const flag = (k) => { const i = args.indexOf(k); if (i < 0) return null; const v = args[i + 1]; args.splice(i, 2); return v; };
const clickArg = flag("--click") ?? "0.30,0.55";            // fraction of the canvas: the western delta (assumption)
const headed = args.includes("--headed");
const base = (args.find((a) => /^https?:/.test(a)) ?? process.env.BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const [fx, fy] = clickArg.split(",").map(Number);

const Q1 = "Can I get there and back from base?";
const Q2 = "Avoid slopes over 12 degrees and keep 25% battery";
const raw = path.join(ROOT, "footage/raw");
fs.rmSync(raw, { recursive: true, force: true });
fs.mkdirSync(raw, { recursive: true });

const browser = await chromium.launch({
  headless: !headed,
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--enable-webgl", "--hide-scrollbars"],
});
const ctx = await browser.newContext({
  viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1,
  recordVideo: { dir: raw, size: { width: 1920, height: 1080 } },
});
// Headless recordings have no pointer. Draw one that follows the real mouse events (it adds no UI to the app).
await ctx.addInitScript(() => {
  const mk = () => {
    if (document.getElementById("__cur")) return;
    const d = document.createElement("div");
    d.id = "__cur";
    d.style.cssText = "position:fixed;left:0;top:0;width:28px;height:28px;z-index:2147483647;pointer-events:none;transform:translate(-100px,-100px)";
    d.innerHTML = '<svg width="28" height="28" viewBox="0 0 24 24"><path d="M4 2l15 9-6.5 1.5L9 19z" fill="#fff" stroke="#111" stroke-width="1.6" stroke-linejoin="round"/></svg>';
    document.documentElement.appendChild(d);
  };
  addEventListener("DOMContentLoaded", mk);
  addEventListener("mousemove", (e) => { mk(); document.getElementById("__cur").style.transform = `translate(${e.clientX}px,${e.clientY}px)`; }, true);
});
const page = await ctx.newPage();
const t0 = Date.now();
const now = () => (Date.now() - t0) / 1000;
const marks = {};
const mark = (k) => { marks[k] = +now().toFixed(2); console.log(`  ${marks[k].toFixed(2)}s ${k}`); };
const pause = (s) => page.waitForTimeout(s * 1000);
const soft = async (label, fn) => { try { return await fn(); } catch (e) { console.warn(`  WARN ${label}: ${String(e.message).split("\n")[0]}`); return null; } };

async function glide(x, y, steps = 40) { await page.mouse.move(x, y, { steps }); }

console.log(`capturing ${base}`);
await page.goto(base, { waitUntil: "domcontentloaded" });
mark("loadStart");
// 1. terrain loaded: the loading overlay (role=status with progress bars) goes away and the canvas has a size.
await soft("loading overlay", () => page.getByRole("progressbar").first().waitFor({ state: "hidden", timeout: 120000 }));
const canvas = page.getByLabel(/3D terrain/i).or(page.locator("canvas").first()).first();
await canvas.waitFor({ state: "visible", timeout: 60000 });
await pause(1.5);
mark("terrainReady");
const box = await canvas.boundingBox();
await glide(box.x + box.width * 0.5, box.y + box.height * 0.45, 1);
// gentle real orbit drag so the terrain moves in the opening shot (c02)
await page.mouse.down();
await glide(box.x + box.width * 0.5 + 220, box.y + box.height * 0.45 + 30, 90);
await page.mouse.up();
await pause(1.2);
mark("orbitEnd");

// 2. click a point on the western delta
await glide(box.x + box.width * fx - 200, box.y + box.height * fy + 120, 30);
mark("clickStart");
await glide(box.x + box.width * fx, box.y + box.height * fy, 35);
await pause(0.25);
await page.mouse.click(box.x + box.width * fx, box.y + box.height * fy);
await pause(1.8);
mark("pinned");

// 3. ask box: it may sit behind an "Ask the copilot" opener
const opener = page.getByRole("button", { name: /ask the copilot/i });
if (await opener.first().isVisible().catch(() => false)) await opener.first().click();
const ask = page.getByLabel(/question for the copilot/i).or(page.getByPlaceholder(/ask about/i)).or(page.locator("form input[type=text], form input:not([type])")).first();
await ask.waitFor({ state: "visible", timeout: 20000 });
const send = async (text) => {
  await ask.click();
  await ask.pressSequentially(text, { delay: 55 });
  await pause(0.35);
  const answered = page.waitForResponse((r) => /\/api\/agent/.test(r.url()), { timeout: 90000 }).catch(() => null);
  await ask.press("Enter");
  return answered;
};
mark("askStart");
const first = send(Q1);
mark("submitted1");
// 4. wait for the agent, then for the route + profile (SVG role=img "Elevation profile")
await first;
await soft("profile", () => page.getByRole("img", { name: /elevation profile/i }).first().waitFor({ state: "visible", timeout: 60000 }));
await pause(2.2);
mark("routeShown");

// 5. constraint change, replan
mark("limitStart");
const second = send(Q2);
await second;
await pause(0.8);
await soft("replan profile", () => page.getByRole("img", { name: /elevation profile/i }).first().waitFor({ state: "visible", timeout: 30000 }));
await pause(2.4);
mark("replanned");

// 6. Sources panel briefly
const src = page.getByRole("button", { name: /sources/i }).first();
mark("sourcesStart");
if (await src.isVisible().catch(() => false)) {
  await src.click();
  await pause(1.6);
  await page.keyboard.press("Escape");
  await pause(0.3);
} else console.warn("  WARN no Sources button found");
mark("sourcesEnd");

// 7. rover photo strip (RouteDrawer: "Rover photos near the destination")
mark("photosStart");
const photos = page.getByText(/rover photos near the destination/i).first();
if (await photos.isVisible().catch(() => false)) { await photos.scrollIntoViewIfNeeded().catch(() => {}); await pause(0.5); }
else console.warn("  WARN rover photo strip not visible (offline or none near destination); c06 will show the terrain");
await pause(3.2);
mark("photosEnd");

fs.writeFileSync(path.join(ROOT, "footage/marks.json"), JSON.stringify({ base, fps: 25, marks }, null, 2));
await ctx.close();   // flushes the .webm
await browser.close();
const webm = fs.readdirSync(raw).find((f) => f.endsWith(".webm"));
fs.renameSync(path.join(raw, webm), path.join(raw, "session.webm"));
console.log("session recorded; cutting clips");
execFileSync("node", [path.join(ROOT, "tools/cut-footage.mjs")], { stdio: "inherit" });
