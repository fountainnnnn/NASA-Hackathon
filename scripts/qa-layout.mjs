#!/usr/bin/env node
/**
 * Automated HUD layout QA (plan phase 6 gate).
 *   node scripts/qa-layout.mjs                 # E2E_BASE_URL or http://localhost:3000 (server must be running)
 *   QA_STATE=route node scripts/qa-layout.mjs  # also select a point + plan a route first so the drawer is checked
 * Per viewport (1440x810, 1280x720, 1024x768, 390x844) it checks every visible element inside the HUD root:
 *   (a) no two interactive/text/panel boxes overlap by > 4 px unless one contains the other
 *   (b) nothing is clipped by the viewport (or by an overflow:hidden ancestor)
 *   (c) text contrast >= 4.5:1 (computed colour vs nearest opaque background; text over the canvas is
 *       measured from a pixel sample with text hidden, and listed under overCanvasText)
 *   (d) every button/input is reachable by Tab and shows a visible focus style
 * Writes test-results/layout-report.json and test-results/layout-<state>-<w>x<h>.png. Exit 1 on violations, 2 on setup error.
 */
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import sharp from 'sharp';

const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:3000';
const OUT = 'test-results';
const VIEWPORTS = [[1440, 810], [1280, 720], [1024, 768], [390, 844]];
const OVERLAP_PX = 4, MIN_CONTRAST = 4.5;
// Keep in sync with tests/e2e/selectors.ts (HUD_ROOT_CSS)
const HUD_ROOT_CSS = 'main > [class*="hud"]';
const WITH_ROUTE = process.env.QA_STATE === 'route';
// States checked at every viewport. 'intro' = first-visit welcome dialog (Intro.tsx, root = its backdrop);
// 'hud' = intro dismissed via localStorage; 'route' (QA_STATE=route) = a selected point + planned route so the drawer is on screen.
const STATES = [
  { name: 'intro', seen: false, rootCss: '[class*="introBack"]' },
  { name: 'hud', seen: true, rootCss: HUD_ROOT_CSS },
  ...(WITH_ROUTE ? [{ name: 'route', seen: true, rootCss: HUD_ROOT_CSS }] : []),
];

/* ------------------------------------------------------------------ in-page collector */
function collectInPage({ hudCss, overlapPx }) {
  const root = document.querySelector(hudCss);
  if (!root) return { error: `HUD root not found (${hudCss})` };
  const vw = window.innerWidth, vh = window.innerHeight;
  const INTERACTIVE = 'button, a[href], input, select, textarea, summary, [role="button"], [role="switch"], [role="tab"], [role="radio"], [role="checkbox"], [tabindex]:not([tabindex="-1"])';
  const rectOf = (r) => ({ l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height });
  const path = (el) => {
    const parts = [];
    for (let e = el; e && e !== root.parentElement && parts.length < 4; e = e.parentElement) {
      const cls = typeof e.className === 'string' && e.className ? '.' + e.className.split(/\s+/)[0].replace(/^.*__/, '').replace(/_[A-Za-z0-9]{5,}$/, '') : '';
      parts.unshift(e.tagName.toLowerCase() + cls);
    }
    return parts.join(' > ');
  };
  const visible = (el) => {
    if (!el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return false;
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return false;
    const cs = getComputedStyle(el);
    // sr-only pattern
    if (r.width <= 1 && r.height <= 1 && (cs.overflow === 'hidden' || cs.clip !== 'auto')) return false;
    return true;
  };
  // visible rect after clipping by overflow ancestors; reports whether an overflow:hidden|clip ancestor cut it
  const clipByAncestors = (el, rect) => {
    let cur = { ...rect }, cutBy = null;
    for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
      const cs = getComputedStyle(a);
      const ox = cs.overflowX, oy = cs.overflowY;
      if (ox === 'visible' && oy === 'visible') continue;
      const ar = a.getBoundingClientRect();
      const nl = ox !== 'visible' ? Math.max(cur.l, ar.left) : cur.l, nr = ox !== 'visible' ? Math.min(cur.r, ar.right) : cur.r;
      const nt = oy !== 'visible' ? Math.max(cur.t, ar.top) : cur.t, nb = oy !== 'visible' ? Math.min(cur.b, ar.bottom) : cur.b;
      const cut = nl > cur.l + 0.5 || nr < cur.r - 0.5 || nt > cur.t + 0.5 || nb < cur.b - 0.5;
      if (cut && !cutBy) {
        const scrolls = /(auto|scroll)/.test(ox + oy);
        cutBy = { scroll: scrolls, ellipsis: cs.textOverflow === 'ellipsis', node: path(a) };
      }
      cur = { l: nl, r: nr, t: nt, b: nb, w: Math.max(0, nr - nl), h: Math.max(0, nb - nt) };
      if (cur.w <= 0 || cur.h <= 0) return { rect: null, cutBy };
    }
    return { rect: cur, cutBy };
  };

  const boxes = []; // {kind,label,el,rect,cutBy}
  const clipped = [];
  const add = (kind, el, rect, label) => {
    const { rect: vis, cutBy } = clipByAncestors(el, rect);
    if (!vis) return null; // scrolled out of its container: not visible
    const b = { kind, el, rect: vis, full: rect, label, cutBy, sel: path(el) };
    boxes.push(b);
    if (cutBy && !cutBy.scroll) clipped.push({ type: cutBy.ellipsis ? 'ellipsis-truncated' : 'clipped-by-ancestor', severity: cutBy.ellipsis ? 'warning' : 'violation', element: b.sel, label, by: cutBy.node });
    return b;
  };

  // panels = direct children of the HUD root
  for (const c of root.children) if (visible(c)) add('panel', c, rectOf(c.getBoundingClientRect()), c.getAttribute('aria-label') ?? c.tagName.toLowerCase());
  // interactive
  const focusables = [];
  for (const el of root.querySelectorAll(INTERACTIVE)) {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    const hiddenSwitch = cs.opacity === '0' && r.width > 0 && r.height > 0; // visually-hidden native input drawn by a sibling
    if (!hiddenSwitch && !visible(el)) continue;
    if (el.disabled || el.getAttribute('aria-disabled') === 'true') continue;
    focusables.push(el);
    if (!hiddenSwitch) add('interactive', el, rectOf(r), (el.getAttribute('aria-label') ?? el.textContent ?? el.tagName).trim().slice(0, 50));
  }
  // text nodes (per line box)
  const textNodes = [];
  const tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = tw.nextNode(); n; n = tw.nextNode()) {
    const txt = n.textContent.replace(/\s+/g, ' ').trim();
    if (!txt) continue;
    const el = n.parentElement;
    if (!el || ['SCRIPT', 'STYLE', 'OPTION'].includes(el.tagName) || !visible(el)) continue;
    const range = document.createRange(); range.selectNodeContents(n);
    for (const cr of range.getClientRects()) {
      if (cr.width < 1 || cr.height < 1) continue;
      const b = add('text', el, rectOf(cr), txt.slice(0, 50));
      if (b) textNodes.push({ el, box: b, text: txt });
    }
  }

  const contains = (A, B, tol = 1.5) => B.l >= A.l - tol && B.r <= A.r + tol && B.t >= A.t - tol && B.b <= A.b + tol;
  const violations = [], seen = new Set();
  const push = (v) => { const k = v.type + v.a + '|' + v.b; if (!seen.has(k)) { seen.add(k); violations.push(v); } };

  // (a) overlaps
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const A = boxes[i], B = boxes[j];
      const ox = Math.min(A.rect.r, B.rect.r) - Math.max(A.rect.l, B.rect.l);
      const oy = Math.min(A.rect.b, B.rect.b) - Math.max(A.rect.t, B.rect.t);
      if (ox <= overlapPx || oy <= overlapPx) continue;
      if (contains(A.rect, B.rect) || contains(B.rect, A.rect)) continue;
      if (A.el.contains(B.el) || B.el.contains(A.el)) continue; // text inside its own control / panel content
      if (A.kind === 'panel' && B.kind !== 'panel' && A.el.contains(B.el)) continue;
      push({ type: 'overlap', severity: 'violation', a: `${A.kind}:${A.label}`, b: `${B.kind}:${B.label}`, aSel: A.sel, bSel: B.sel, overlapPx: [Math.round(ox), Math.round(oy)] });
    }
  }
  // (b) viewport clipping
  for (const b of boxes) {
    const f = b.rect;
    const outside = f.l < -1 || f.t < -1 || f.r > vw + 1 || f.b > vh + 1;
    if (!outside) continue;
    const fully = f.r < 0 || f.l > vw || f.b < 0 || f.t > vh;
    push({ type: fully ? 'offscreen' : 'clipped-by-viewport', severity: fully ? 'warning' : 'violation', a: `${b.kind}:${b.label}`, b: '', aSel: b.sel,
      rect: { l: Math.round(f.l), t: Math.round(f.t), r: Math.round(f.r), b: Math.round(f.b) }, viewport: [vw, vh] });
  }
  for (const c of clipped) push({ ...c, a: c.label, b: c.by });
  // occlusion: an interactive control whose centre is covered by something unrelated
  for (const b of boxes.filter((x) => x.kind === 'interactive')) {
    const x = Math.min(vw - 1, Math.max(0, (b.rect.l + b.rect.r) / 2)), y = Math.min(vh - 1, Math.max(0, (b.rect.t + b.rect.b) / 2));
    const top = document.elementFromPoint(x, y);
    if (top && !(b.el.contains(top) || top.contains(b.el) || b.el.closest('label')?.contains(top))) {
      push({ type: 'occluded', severity: 'violation', a: `interactive:${b.label}`, b: path(top), aSel: b.sel });
    }
  }

  // text colours for contrast (resolved in node with sampled pixels when needed)
  const parse = (s) => { const m = s.match(/rgba?\(([^)]+)\)/); if (!m) return [0, 0, 0, 1]; const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return [p[0], p[1], p[2], p[3] ?? 1]; };
  const over = (fg, bg) => { const a = fg[3]; return [fg[0] * a + bg[0] * (1 - a), fg[1] * a + bg[1] * (1 - a), fg[2] * a + bg[2] * (1 - a), 1]; };
  const texts = [];
  for (const t of textNodes) {
    const el = t.el;
    if (el.closest('[disabled], [aria-disabled="true"]')) continue; // WCAG exempts inactive controls
    const f = t.box.rect;
    if (f.r < 0 || f.l > vw || f.b < 0 || f.t > vh || f.w < 1 || f.h < 1) continue;
    const cs = getComputedStyle(el);
    let fg = parse(cs.color);
    // opacity of ancestors dims the text
    let op = 1; for (let a = el; a && a !== document.body; a = a.parentElement) op *= parseFloat(getComputedStyle(a).opacity || '1');
    fg[3] *= op;
    const layers = []; let opaque = null;
    for (let a = el; a && a !== document.documentElement; a = a.parentElement) {
      const bg = parse(getComputedStyle(a).backgroundColor);
      if (bg[3] <= 0) continue;
      if (bg[3] >= 0.99) { opaque = bg; break; }
      layers.push(bg);
    }
    texts.push({
      text: t.text.slice(0, 60), sel: t.box.sel, size: parseFloat(cs.fontSize), weight: cs.fontWeight,
      fg, layers, opaque, rect: { x: Math.max(0, f.l), y: Math.max(0, f.t), w: Math.min(vw, f.r) - Math.max(0, f.l), h: Math.min(vh, f.b) - Math.max(0, f.t) },
      backdropBlur: (() => { for (let a = el; a && a !== document.body; a = a.parentElement) { const b = getComputedStyle(a).backdropFilter; if (b && b !== 'none') return true; } return false; })(),
    });
  }

  // (d) focus baseline
  const sig = (el) => { const cs = getComputedStyle(el); return [cs.outlineStyle, cs.outlineWidth, cs.outlineColor, cs.boxShadow, cs.backgroundColor, cs.borderTopColor, cs.color, cs.textDecorationLine, cs.filter].join('|'); };
  const trio = (el) => [el, el.nextElementSibling, el.parentElement].filter(Boolean);
  window.__qa = { base: new Map(), trio, sig, focusables };
  focusables.forEach((el) => window.__qa.base.set(el, trio(el).map(sig)));
  return {
    vw, vh, counts: { panels: boxes.filter((b) => b.kind === 'panel').length, interactive: boxes.filter((b) => b.kind === 'interactive').length, text: boxes.filter((b) => b.kind === 'text').length, focusables: focusables.length },
    violations, texts,
    focusables: focusables.map((el, i) => { el.setAttribute('data-qa-i', i); return { i, sel: path(el), label: (el.getAttribute('aria-label') ?? el.textContent ?? el.tagName).trim().slice(0, 50) }; }),
  };
}

/** After a Tab press: which candidate has focus and does it show a visible focus style? */
function focusProbe() {
  const el = document.activeElement;
  if (!el || el === document.body) return null;
  const q = window.__qa;
  const i = el.getAttribute('data-qa-i');
  const base = q.base.get(el);
  const outline = (e) => { const cs = getComputedStyle(e); return cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0 && !/rgba\(\d+, \d+, \d+, 0\)/.test(cs.outlineColor); };
  let visible = false;
  if (base) {
    const now = q.trio(el);
    visible = now.some(outline) || now.map(q.sig).some((s, k) => s !== base[k]);
  }
  return { i: i === null ? null : Number(i), visible, tag: el.tagName.toLowerCase(), inHud: !!el.closest('[data-qa-hud]') };
}

/* ------------------------------------------------------------------ node-side helpers */
const lin = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const over = (fg, bg) => { const a = fg[3]; return [fg[0] * a + bg[0] * (1 - a), fg[1] * a + bg[1] * (1 - a), fg[2] * a + bg[2] * (1 - a), 1]; };

async function samplePixels(png, rect, vw, vh) {
  const img = sharp(png);
  const meta = await img.metadata();
  const sx = meta.width / vw, sy = meta.height / vh;
  const left = Math.max(0, Math.floor(rect.x * sx)), top = Math.max(0, Math.floor(rect.y * sy));
  const width = Math.max(1, Math.min(meta.width - left, Math.ceil(rect.w * sx))), height = Math.max(1, Math.min(meta.height - top, Math.ceil(rect.h * sy)));
  const { data, info } = await sharp(png).extract({ left, top, width, height }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const px = [];
  for (let i = 0; i < data.length; i += 3 * Math.max(1, Math.floor(data.length / 3 / 400))) px.push([data[i], data[i + 1], data[i + 2]]);
  const mean = [0, 1, 2].map((k) => px.reduce((s, p) => s + p[k], 0) / px.length);
  return { mean, px, w: info.width };
}

/* ------------------------------------------------------------------ main */
async function waitForServer() {
  for (let i = 0; i < 90; i++) {
    try { const r = await fetch(BASE); if (r.ok || r.status < 500) return true; } catch { /* retry */ }
    await new Promise((r) => setTimeout(r, 2000));
  }
  return false;
}

async function main() {
  await mkdir(OUT, { recursive: true });
  if (!(await waitForServer())) { console.error(`qa-layout: cannot reach ${BASE}. Start the app (npm run dev) or set E2E_BASE_URL.`); process.exit(2); }
  const browser = await chromium.launch({ executablePath: process.env.E2E_CHROMIUM_PATH || undefined, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--use-gl=angle', '--ignore-gpu-blocklist', '--enable-webgl'] });
  const report = { base: BASE, date: new Date().toISOString(), states: STATES.map((x) => x.name), thresholds: { overlapPx: OVERLAP_PX, minContrast: MIN_CONTRAST }, viewports: [] };
  let failed = false;

  for (const [w, h] of VIEWPORTS) for (const st of STATES) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, hasTouch: w < 600, isMobile: w < 600 });
    await ctx.addInitScript(([seen]) => { try { if (seen) localStorage.setItem('marswalk-intro-seen', '1'); else localStorage.removeItem('marswalk-intro-seen'); } catch { /* ignore */ } }, [st.seen]);
    const page = await ctx.newPage();
    const vr = { viewport: `${w}x${h}`, state: st.name, violations: [], warnings: [], contrast: { checked: 0, failures: [], overCanvasText: [] }, focus: { candidates: 0, reached: 0, unreached: [], noFocusStyle: [] } };
    report.viewports.push(vr);
    try {
      await page.goto(BASE, { waitUntil: 'load', timeout: 120_000 });
      try { await page.waitForFunction(() => document.body.dataset.sceneReady === '1', null, { timeout: 150_000 }); }
      catch { vr.violations.push({ type: 'app-not-ready', severity: 'violation', a: 'body[data-scene-ready] never became 1', b: '' }); }
      await page.waitForTimeout(1200);
      if (st.name === 'route' && w >= 700) {
        const box = await page.locator('main canvas').first().boundingBox();
        if (box) { await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2); await page.waitForTimeout(500); }
        const plan = page.getByRole('button', { name: /plan round trip/i });
        if (await plan.count()) { await plan.first().click().catch(() => {}); await page.waitForTimeout(3000); }
      }
      await page.evaluate((css) => document.querySelector(css)?.setAttribute('data-qa-hud', ''), st.rootCss);
      await page.mouse.move(0, 0);
      await page.screenshot({ path: `${OUT}/layout-${st.name}-${w}x${h}.png` });

      const data = await page.evaluate(collectInPage, { hudCss: st.rootCss, overlapPx: OVERLAP_PX });
      if (data.error) { vr.violations.push({ type: 'no-hud-root', severity: 'violation', a: data.error, b: '' }); continue; }
      vr.counts = data.counts;
      for (const v of data.violations) (v.severity === 'warning' ? vr.warnings : vr.violations).push(v);

      // (c) contrast — screenshot with text hidden gives true backgrounds (incl. blur over the canvas)
      await page.addStyleTag({ content: `[data-qa-hud] *, [data-qa-hud] { color: transparent !important; text-shadow: none !important; -webkit-text-fill-color: transparent !important; caret-color: transparent !important; }` }).then(async (tag) => {
        const bgShot = await page.screenshot();
        await tag.evaluate((n) => n.remove());
        for (const t of data.texts) {
          vr.contrast.checked++;
          let bg, source;
          if (t.opaque) {
            // nearest opaque background plus any translucent layers above it
            bg = t.opaque.slice(); for (const l of t.layers.slice().reverse()) bg = over(l, bg); source = 'dom';
          } else { source = 'canvas-sample'; }
          let r, worst;
          if (source === 'dom') {
            r = ratio(over(t.fg, bg), bg); worst = r;
          } else {
            const s = await samplePixels(bgShot, t.rect, data.vw, data.vh);
            const fgMean = over(t.fg, s.mean);
            r = ratio(fgMean, s.mean);
            worst = Math.min(...s.px.map((p) => ratio(over(t.fg, p), p)));
          }
          const rec = { text: t.text, sel: t.sel, fontPx: t.size, ratio: +r.toFixed(2), worstPixelRatio: +worst.toFixed(2), source };
          (vr.contrast.lowest ??= []).push(rec);
          if (source === 'canvas-sample') vr.contrast.overCanvasText.push(rec);
          if (r < MIN_CONTRAST) vr.contrast.failures.push(rec);
        }
      });
      if (vr.contrast.lowest) vr.contrast.lowest = vr.contrast.lowest.sort((a, b) => a.ratio - b.ratio).slice(0, 5); // lowest 5 ratios, pass or fail, for sanity checks
      // translucent-panel text with no opaque ancestor is "over canvas": reported above, and it fails the gate only when the mean ratio is low
      for (const f of vr.contrast.failures) vr.violations.push({ type: 'low-contrast', severity: 'violation', a: `"${f.text}" ${f.ratio}:1 (${f.source})`, b: '', aSel: f.sel });

      // (d) keyboard reachability + visible focus
      await page.evaluate(() => document.activeElement?.blur?.());
      const reached = new Map();
      vr.focus.candidates = data.focusables.length;
      for (let i = 0; i < data.focusables.length + 12; i++) {
        await page.keyboard.press('Tab');
        const p = await page.evaluate(focusProbe);
        if (!p || p.i === null) continue;
        if (!reached.has(p.i)) reached.set(p.i, p.visible);
        else if (p.visible) reached.set(p.i, true);
      }
      vr.focus.reached = reached.size;
      for (const f of data.focusables) {
        if (!reached.has(f.i)) vr.focus.unreached.push(f);
        else if (!reached.get(f.i)) vr.focus.noFocusStyle.push(f);
      }
      for (const f of vr.focus.unreached) vr.violations.push({ type: 'not-keyboard-reachable', severity: 'violation', a: f.label, b: '', aSel: f.sel });
      for (const f of vr.focus.noFocusStyle) vr.violations.push({ type: 'no-visible-focus', severity: 'violation', a: f.label, b: '', aSel: f.sel });
    } catch (e) {
      vr.violations.push({ type: 'qa-error', severity: 'violation', a: String(e?.message ?? e), b: '' });
    } finally {
      await ctx.close();
    }
    if (vr.violations.length) failed = true;
    console.log(`${vr.viewport.padEnd(9)} ${st.name.padEnd(6)} ${vr.violations.length ? 'FAIL' : 'ok  '}  violations=${vr.violations.length} warnings=${vr.warnings.length} text-checked=${vr.contrast.checked} over-canvas=${vr.contrast.overCanvasText.length} focus=${vr.focus.reached}/${vr.focus.candidates}`);
    const by = {}; for (const v of vr.violations) by[v.type] = (by[v.type] ?? 0) + 1;
    if (vr.violations.length) console.log('          ' + Object.entries(by).map(([k, n]) => `${k}:${n}`).join('  '));
  }
  await browser.close();
  report.passed = !failed;
  await writeFile(`${OUT}/layout-report.json`, JSON.stringify(report, null, 2));
  console.log(`report: ${OUT}/layout-report.json  ->  ${failed ? 'VIOLATIONS FOUND' : 'clean'}`);
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(2); });
