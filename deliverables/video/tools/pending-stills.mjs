#!/usr/bin/env node
// Draft-only stand-ins: screenshots of the APPROVED MOCKUP (deliverables/mockup/index.html) at the capture size
// (1440x810 CSS px at 2x), plus the boxes of the elements the film frames and points at. The draft shows them
// labelled "CAPTURE PENDING"; capture.mjs replaces them with real footage and real boxes.
//   node tools/pending-stills.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MOCK = "file://" + path.resolve(ROOT, "../mockup/index.html");
const OUT = path.join(ROOT, "footage/pending");
fs.mkdirSync(OUT, { recursive: true });
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const b = await puppeteer.launch({ executablePath: CHROME, headless: "new", args: ["--allow-file-access-from-files", "--hide-scrollbars"] });
const p = await b.newPage();
await p.setViewport({ width: 1440, height: 810, deviceScaleFactor: 2 });
await p.goto(MOCK, { waitUntil: "networkidle0" });
await p.evaluate(() => document.fonts.ready);
// finish the narration animation at once
await p.evaluate(() => { for (const r of document.querySelectorAll("#live div")) { r.classList.remove("hidden", "now"); r.classList.add("done"); } document.querySelector(".mock")?.remove(); });
await new Promise((r) => setTimeout(r, 400));
const box = (sel, text) => p.evaluate((sel, text) => {
  const els = [...document.querySelectorAll(sel)].filter((e) => !text || e.textContent.includes(text));
  const vis = els.filter((x) => x.getBoundingClientRect().width > 0); if (!vis.length) return null;
  const area = (x) => { const q = x.getBoundingClientRect(); return q.width * q.height; };
  const e = text ? vis.sort((a, b2) => area(a) - area(b2))[0] : vis[0];
  const r = e.getBoundingClientRect(); return [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)];
}, sel, text);
const boxes = {};
const grab = async (state, map) => { boxes[state] = {}; for (const [k, [sel, text]] of Object.entries(map)) boxes[state][k] = await box(sel, text); };
await grab("map", {
  card: [".card"], verdict: [".card .hd"], panel: [".log"], narration: ["#live"], clock: [".clock"], delay: [".clock div", "light"],
  speed: [".speed"], timeline: [".time"], legend: [".legend"], reportCard: [".rep"], formula: [".code", "300 W"], recompute: ["details.steps-box", "Recomputed"],
});
await p.screenshot({ path: path.join(OUT, "map.png") });
// the steps box open: formulas with numbers
await p.evaluate(() => { const d = document.querySelector("details.steps-box"); d.open = true; document.querySelector(".thread")?.scrollTo(0, 0); });
await new Promise((r) => setTimeout(r, 300));
await grab("steps", { panel: [".log"], steps: ["details.steps-box"], formula: [".code", "f_suit"], battery: [".code", "P_suit"], comms: [".code", "mast 2.0 m"] });
await p.screenshot({ path: path.join(OUT, "steps.png") });
// the report viewer
await p.evaluate(() => { document.querySelector("details.steps-box").open = false; openReport(); });
await new Promise((r) => setTimeout(r, 300));
await grab("report", { paper: [".paper"], toc: [".toc"], bar: [".rv .bar"], verdictbox: [".verdictbox"] });
await p.screenshot({ path: path.join(OUT, "report.png") });
await p.evaluate(() => { const h = [...document.querySelectorAll(".paper h2")].find((x) => /validation/i.test(x.textContent)); h.scrollIntoView({ block: "start" }); document.querySelector(".rv .body").scrollBy(0, -40); });
await new Promise((r) => setTimeout(r, 300));
await grab("report2", { paper: [".paper"], validation: [".paper h2", "validation"], validationNote: [".rv .paper *", "708 Perseverance waypoints"] });
await p.screenshot({ path: path.join(OUT, "report2.png") });
fs.writeFileSync(path.join(OUT, "boxes.json"), JSON.stringify(boxes, null, 1) + "\n");
await b.close();
console.log(JSON.stringify(boxes));
