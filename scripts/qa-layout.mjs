#!/usr/bin/env node
/**
 * Automated layout QA (plan gate 6): no overlapping or clipped UI, text contrast >= 4.5:1, keyboard reaches every control.
 *
 *   npx next build && npx next start -p 3950 &
 *   E2E_BASE_URL=http://localhost:3950 node scripts/qa-layout.mjs
 *
 * Env: QA_VIEWPORTS="1440x810,390x844"  QA_STATES="intro,globe-idle,..."  QA_OUT=deliverables/qa/<timestamp> (default)  QA_NO_ANNOTATE=1
 * Drives EVERY app state (deterministic verbs only, the live language model is never called) at 1440x810, 1280x720, 1024x768 and
 * 390x844 (portrait phone, touch emulation) and checks, per state:
 *   1. DOM overlap: every visible text / interactive / panel / marker / scene-label box against every other (> 2 px),
 *      unless one contains the other or the pair is on the ALLOWLIST below (each entry carries its reason).
 *   2. Clipping: nothing partially outside the viewport or cut by an overflow ancestor; no text spilling out of its box.
 *   3. Label on label: drei Html labels are ordinary DOM boxes, so rule 1 covers them against each other and the HUD.
 *   4. Contrast: >= 4.5:1 (>= 3:1 at 24 px and up). Text over the WebGL canvas is measured against the rendered pixels
 *      behind it (screenshot with all text hidden), worst sampled pixel reported.
 *   5. Keyboard: Tab reaches every interactive control in the state and shows a visible focus indicator.
 * Writes <QA_OUT>/layout-report.json and <QA_OUT>/qa/<viewport>/<state>.png (QA_OUT defaults to deliverables/qa/<UTC timestamp>,
 * outside test-results, which every Playwright run empties). Exit 1 on violations, 2 on setup error.
 */
import { chromium } from '@playwright/test';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import sharp from 'sharp';

const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:3000';
// outside test-results: a Playwright run empties that folder, and the screenshots are review evidence
const OUT = process.env.QA_OUT ?? `deliverables/qa/${new Date().toISOString().slice(0, 16).replace(/[T:]/g, '-')}`;
const ALL_VIEWPORTS = [[1440, 810], [1280, 720], [1024, 768], [390, 844]];
const VIEWPORTS = process.env.QA_VIEWPORTS ? process.env.QA_VIEWPORTS.split(',').map((s) => s.split('x').map(Number)) : ALL_VIEWPORTS;
const OVERLAP_PX = 2, MIN_CONTRAST = 4.5, MIN_CONTRAST_LARGE = 3;
const INTRO_SCOPE = '[role="dialog"][aria-labelledby="intro-title"]';

/**
 * Intentional layering. Matched against "kind|class path|label" of each box (a and b are regexes, symmetric).
 * Keep this list short: every entry must say why the overlap is by design and cannot read as a collision.
 */
const ALLOWLIST = [
  {
    id: 'map-label-at-map-edge', kind: 'clip', a: '^$', b: '^$',
    reason: 'A label pinned to a point on the terrain (crew tag, route tick, scene pin) is cut by the edge of the map when that point is near the edge, exactly like the terrain under it. Only labels inside the stage and outside every HUD block, card, dialog and bar qualify; chrome is never allowed to clip.',
  },
  {
    id: 'phone-card-sheet-over-map-labels', kind: 'sheet', a: '^$', b: '^$',
    reason: 'On a phone the MarsAgent card is a bottom sheet over the map (opaque, 0.97). Labels pinned to the terrain (route time ticks, crew tags) pass under it exactly like the terrain does; nothing of the card is covered.',
  },
  {
    id: 'modal-over-hud', kind: 'modal', a: '.', b: '.',
    reason: 'The intro card, the Sources sheet and the report viewer are opaque modals (data-modal, background alpha >= 0.94) that stack over the shell by design. A pair is allowed only when the modal completely covers the other box, so nothing half-hidden can pass.',
  },
];

/* ------------------------------------------------------------------ in-page collector */
function collectInPage({ scopeCss, overlapPx, allow }) {
  const scope = document.querySelector(scopeCss);
  if (!scope) return { error: `scope not found (${scopeCss})` };
  const vw = window.innerWidth, vh = window.innerHeight;
  const INTERACTIVE = 'button, a[href], input, select, textarea, summary, [role="button"], [role="slider"], [role="switch"], [tabindex]:not([tabindex="-1"])';
  const rectOf = (r) => ({ l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height });
  const cls = (e) => (typeof e.className === 'string' && e.className ? e.className.split(/\s+/)[0].replace(/^.*?__?(?=[a-zA-Z]+__)/, '').replace(/__[A-Za-z0-9_-]{4,}$/, '').replace(/^[a-z]+_/, '') : '');
  const path = (el) => {
    const parts = [];
    for (let e = el; e && e !== document.body && parts.length < 4; e = e.parentElement) { const c = cls(e); parts.unshift(e.tagName.toLowerCase() + (c ? '.' + c : '')); }
    return parts.join(' > ');
  };
  const visible = (el) => {
    if (!el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return false;
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return false;
    const cs = getComputedStyle(el);
    if (r.width <= 1 && r.height <= 1 && (cs.overflow === 'hidden' || cs.clip !== 'auto')) return false; // sr-only
    return true;
  };
  const inScope = (el) => scope.contains(el) && !(scopeCss === 'body' && el.closest(INTRO_SCOPE_CSS)) && !el.closest('canvas, [data-qa-ignore]');
  const INTRO_SCOPE_CSS = '[role="dialog"][aria-labelledby="intro-title"]';
  const parse = (s) => { const m = s && s.match(/rgba?\(([^)]+)\)/); if (!m) return [0, 0, 0, 0]; const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return [p[0], p[1], p[2], p[3] ?? 1]; };
  const hasBox = (cs) => parse(cs.backgroundColor)[3] > 0.05 || (parseFloat(cs.borderTopWidth) > 0 && parse(cs.borderTopColor)[3] > 0.05) || (parseFloat(cs.borderLeftWidth) > 0 && parse(cs.borderLeftColor)[3] > 0.05);

  // visible rect after clipping by overflow ancestors; reports the first ancestor that cut it
  const clipByAncestors = (el, rect, self = false) => {
    let cur = { ...rect }, cutBy = null;
    for (let a = self ? el : el.parentElement; a && a !== document.body && a !== document.documentElement; a = a.parentElement) {
      const cs = getComputedStyle(a);
      const ox = cs.overflowX, oy = cs.overflowY;
      if (ox === 'visible' && oy === 'visible') continue;
      const ar = a.getBoundingClientRect();
      const nl = ox !== 'visible' ? Math.max(cur.l, ar.left) : cur.l, nr = ox !== 'visible' ? Math.min(cur.r, ar.right) : cur.r;
      const nt = oy !== 'visible' ? Math.max(cur.t, ar.top) : cur.t, nb = oy !== 'visible' ? Math.min(cur.b, ar.bottom) : cur.b;
      const cut = nl > cur.l + 1 || nr < cur.r - 1 || nt > cur.t + 1 || nb < cur.b - 1;
      if (cut && !cutBy) cutBy = { scroll: /(auto|scroll)/.test(ox + oy), ellipsis: cs.textOverflow === 'ellipsis', node: path(a), el: a };
      cur = { l: nl, r: nr, t: nt, b: nb, w: Math.max(0, nr - nl), h: Math.max(0, nb - nt) };
      if (cur.w <= 0 || cur.h <= 0) return { rect: null, cutBy };
    }
    return { rect: cur, cutBy };
  };

  const boxes = [];
  const add = (kind, el, rect, label, extra = {}) => {
    const { rect: vis, cutBy } = clipByAncestors(el, rect, kind === 'text');
    if (!vis) return null;
    const b = { kind, el, rect: vis, full: rect, label, cutBy, sel: path(el), ...extra };
    b.desc = `${kind}|${b.sel}|${label}`;
    boxes.push(b);
    return b;
  };

  // containers: positioned boxes with a visible fill/border that hold something (panels, popovers, labels, sheets, bars)
  const all = scope.querySelectorAll('*');
  for (const el of all) {
    if (!inScope(el) || el.matches(INTERACTIVE)) continue;
    if (el.tagName === 'svg' && el.getAttribute('aria-hidden') === 'true') continue;
    const cs = getComputedStyle(el);
    if (el.tagName === 'svg' || el instanceof SVGElement) {
      if (el.tagName === 'svg' && el.getAttribute('role') === 'img' && visible(el)) add('graphic', el, rectOf(el.getBoundingClientRect()), el.getAttribute('aria-label') ?? 'svg');
      continue;
    }
    if (!visible(el)) continue;
    if (el.querySelector('canvas')) continue; // canvas hosts (the globe / scene roots) are the backdrop, not a panel
    const marker = /pinDot|reticle/.test(typeof el.className === 'string' ? el.className : '');
    const positioned = cs.position === 'fixed' || cs.position === 'absolute' || cs.position === 'sticky';
    if (marker) { add('marker', el, rectOf(el.getBoundingClientRect()), 'marker ring'); continue; }
    const fullscreen = el.getBoundingClientRect().width * el.getBoundingClientRect().height > 0.9 * vw * vh;
    if (positioned && !fullscreen && hasBox(cs) && el.textContent.trim()) add('panel', el, rectOf(el.getBoundingClientRect()), (el.getAttribute('aria-label') ?? el.textContent).trim().slice(0, 40));
  }
  // interactive
  const focusables = [];
  for (const el of scope.querySelectorAll(INTERACTIVE)) {
    if (!inScope(el)) continue;
    const r = el.getBoundingClientRect();
    if (!visible(el)) continue;
    if (el.disabled || el.getAttribute('aria-disabled') === 'true') continue;
    focusables.push(el);
    const lab = (el.getAttribute('aria-label') ?? el.textContent ?? el.tagName).trim().replace(/\s+/g, ' ').slice(0, 50);
    const frags = getComputedStyle(el).display === 'inline' ? [...el.getClientRects()].filter((q) => q.width > 1 && q.height > 1) : [];
    if (frags.length > 1) for (const q of frags) add('interactive', el, rectOf(q), lab); // a wrapped link is one box per line, not their union
    else add('interactive', el, rectOf(r), lab);
  }
  // text (one box per line)
  const textNodes = [];
  const tw = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
  for (let n = tw.nextNode(); n; n = tw.nextNode()) {
    const txt = n.textContent.replace(/\s+/g, ' ').trim();
    if (!txt) continue;
    const el = n.parentElement;
    if (!el || ['SCRIPT', 'STYLE', 'OPTION', 'TITLE'].includes(el.tagName) || !inScope(el) || !visible(el)) continue;
    const range = document.createRange(); range.selectNodeContents(n);
    for (const cr of range.getClientRects()) {
      if (cr.width < 1 || cr.height < 1) continue;
      const b = add('text', el, rectOf(cr), txt.slice(0, 50));
      if (b) textNodes.push({ el, box: b, text: txt });
    }
  }

  const contains = (A, B, tol = 1.5) => B.l >= A.l - tol && B.r <= A.r + tol && B.t >= A.t - tol && B.b <= A.b + tol;
  const violations = [], allowlisted = [], seen = new Set();
  const push = (v) => { const k = v.type + v.a + '|' + v.b; if (!seen.has(k)) { seen.add(k); violations.push(v); } };
  const allowRe = allow.filter((a) => !['modal', 'clip', 'sheet'].includes(a.kind)).map((a) => ({ ...a, ra: new RegExp(a.a), rb: new RegExp(a.b) }));
  const isAllowed = (A, B) => allowRe.find((a) => (a.ra.test(A.desc) && a.rb.test(B.desc)) || (a.ra.test(B.desc) && a.rb.test(A.desc)));
  // an opaque modal (intro card, Sources sheet) is meant to stack over the HUD and the canvas: the pair is fine when the modal fully covers the other box
  const modalCovers = (A, B) => {
    if (!allow.some((a) => a.kind === 'modal')) return null;
    const ma = A.el.closest('[data-modal]'), mb = B.el.closest('[data-modal]');
    const check = (m, other) => {
      if (!m || m === other.el.closest('[data-modal]')) return false;
      if (parse(getComputedStyle(m).backgroundColor)[3] < 0.94) return false;
      const r = m.getBoundingClientRect();
      return other.rect.l >= r.left - 1 && other.rect.r <= r.right + 1 && other.rect.t >= r.top - 1 && other.rect.b <= r.bottom + 1;
    };
    return check(ma, B) || check(mb, A) ? allow.find((a) => a.kind === 'modal') : null;
  };
  // group = nearest container-ish ancestor, used to de-duplicate text-on-text reports
  const group = (b) => { for (let e = b.el; e && e !== scope; e = e.parentElement) { const c = boxes.find((x) => x.el === e && (x.kind === 'panel' || x.kind === 'interactive')); if (c) return c.label; } return b.label; };

  // 1 + 3. overlaps (includes scene labels vs each other and vs the HUD)
  const isLabel = (b) => /pinLabel|pinDot|contour|tick|mark|tag|dragLabel|readout|marker/.test(b.sel + ' ' + b.label);
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const A = boxes[i], B = boxes[j];
      const ox = Math.min(A.rect.r, B.rect.r) - Math.max(A.rect.l, B.rect.l);
      const oy = Math.min(A.rect.b, B.rect.b) - Math.max(A.rect.t, B.rect.t);
      if (ox <= overlapPx || oy <= overlapPx) continue;
      if (A.el.contains(B.el) || B.el.contains(A.el)) continue;
      if (A.el === B.el) continue;
      const isMapLabel = (X) => !!X.el.closest('[data-stage]') && !X.el.closest('[data-avoid], [data-companion], [role="dialog"], footer');
      const inSheet = (X) => !!X.el.closest('section[data-companion]') && /cardSheet/.test(X.el.closest('section[data-companion]').className);
      const sheetOverLabel = (inSheet(A) && isMapLabel(B)) || (inSheet(B) && isMapLabel(A)) ? allow.find((x) => x.id === 'phone-card-sheet-over-map-labels') : null;
      const al = sheetOverLabel ?? isAllowed(A, B) ?? modalCovers(A, B);
      if (al) { allowlisted.push({ id: al.id, a: A.desc, b: B.desc }); continue; }
      push({ type: isLabel(A) && isLabel(B) ? 'label-on-label' : 'overlap', severity: 'violation', a: `${A.kind}:${A.label}`, b: `${B.kind}:${B.label}`, aSel: A.sel, bSel: B.sel, overlapPx: [Math.round(ox), Math.round(oy)],
        rects: [A.rect, B.rect].map((r) => ({ x: Math.round(r.l), y: Math.round(r.t), w: Math.round(r.w), h: Math.round(r.h) })), grp: group(A) + '|' + group(B) });
    }
  }
  // 2. clipping by viewport / ancestors / own box
  for (const b of boxes) {
    const f = b.rect;
    const fully = f.r < 0 || f.l > vw || f.b < 0 || f.t > vh;
    if (fully) continue;
    if (f.l < -1 || f.t < -1 || f.r > vw + 1 || f.b > vh + 1) push({ type: 'clipped-by-viewport', severity: 'violation', a: `${b.kind}:${b.label}`, b: '', aSel: b.sel, rects: [{ x: Math.round(f.l), y: Math.round(f.t), w: Math.round(f.w), h: Math.round(f.h) }], viewport: [vw, vh] });
    const mapLabel = b.cutBy && !!b.cutBy.el.closest('[data-stage]') && !b.el.closest('[data-avoid], [data-companion], [role="dialog"], footer');
    if (b.cutBy && !b.cutBy.scroll && mapLabel) { allowlisted.push({ id: 'map-label-at-map-edge', a: b.desc, b: b.cutBy.node }); continue; }
    if (b.cutBy && !b.cutBy.scroll) push({ type: b.cutBy.ellipsis ? 'text-truncated' : 'clipped-by-ancestor', severity: 'violation', a: `${b.kind}:${b.label}`, b: b.cutBy.node, aSel: b.sel });
  }
  for (const t of textNodes) {
    // text spilling out of the nearest box (a panel / control with its own fill or border)
    for (let e = t.el; e && e !== scope.parentElement && e !== document.body; e = e.parentElement) {
      const cs = getComputedStyle(e);
      if (!hasBox(cs) && !e.matches(INTERACTIVE)) continue;
      const r = e.getBoundingClientRect(), f = t.box.rect;
      if (r.height < 4 || r.width < 4) continue; // a hairline rule is not a box
      if (f.l < r.left - 1.5 || f.r > r.right + 1.5 || f.t < r.top - 1.5 || f.b > r.bottom + 1.5) {
        if (!(e.scrollHeight > e.clientHeight + 1 && /(auto|scroll)/.test(cs.overflowY))) push({ type: 'text-overflows-box', severity: 'violation', a: `"${t.text.slice(0, 40)}"`, b: path(e), aSel: t.box.sel });
      }
      break;
    }
  }
  for (const el of new Set(textNodes.map((t) => t.el))) {
    const cs = getComputedStyle(el);
    if (el instanceof SVGElement) continue;
    if ((cs.overflowX === 'hidden' || cs.overflowX === 'clip') && el.scrollWidth > el.clientWidth + 1 && cs.display !== 'inline') push({ type: 'text-clipped', severity: 'violation', a: `"${el.textContent.trim().slice(0, 40)}"`, b: `scrollWidth ${el.scrollWidth} > clientWidth ${el.clientWidth}`, aSel: path(el) });
  }
  // occlusion: a control whose centre is covered by something unrelated (Scout while it follows the cursor is pointer-events: none on purpose)
  for (const b of boxes.filter((x) => x.kind === 'interactive')) {
    if (getComputedStyle(b.el).pointerEvents === 'none') continue;
    const x = Math.min(vw - 1, Math.max(0, (b.rect.l + b.rect.r) / 2)), y = Math.min(vh - 1, Math.max(0, (b.rect.t + b.rect.b) / 2));
    const top = document.elementFromPoint(x, y);
    if (top && !top.closest('[data-modal]') && !(b.el.contains(top) || top.contains(b.el) || b.el.closest('label')?.contains(top))) push({ type: 'occluded', severity: 'violation', a: `interactive:${b.label}`, b: path(top), aSel: b.sel });
  }

  // contrast inputs
  const texts = [];
  for (const t of textNodes) {
    const el = t.el;
    if (el.closest('[disabled], [aria-disabled="true"]')) continue;
    const f = t.box.rect;
    if (f.r < 0 || f.l > vw || f.b < 0 || f.t > vh || f.w < 1 || f.h < 1) continue;
    if (!el.closest('[data-modal]')) { // text hidden under an opaque modal is not on screen
      const top = document.elementFromPoint(Math.min(vw - 1, Math.max(0, f.l + f.w / 2)), Math.min(vh - 1, Math.max(0, f.t + f.h / 2)));
      if (top && top.closest('[data-modal]')) continue;
    }
    const cs = getComputedStyle(el);
    const svgText = el instanceof SVGElement;
    const fg = parse(svgText ? cs.fill : cs.color);
    let op = 1; for (let a = el; a && a !== document.body; a = a.parentElement) op *= parseFloat(getComputedStyle(a).opacity || '1');
    fg[3] *= op * (svgText ? parseFloat(cs.fillOpacity || '1') : 1);
    const layers = []; let opaque = null;
    for (let a = el; a && a.tagName !== 'MAIN' && a !== document.body; a = a.parentElement) {
      const bg = parse(getComputedStyle(a).backgroundColor);
      if (bg[3] <= 0) continue;
      if (bg[3] >= 0.99) { opaque = bg; break; }
      layers.push(bg);
    }
    texts.push({ text: t.text.slice(0, 60), sel: t.box.sel, size: parseFloat(cs.fontSize), weight: cs.fontWeight, fg, layers, opaque,
      rect: { x: Math.max(0, f.l), y: Math.max(0, f.t), w: Math.min(vw, f.r) - Math.max(0, f.l), h: Math.min(vh, f.b) - Math.max(0, f.t) } });
  }

  // keyboard baseline
  const sig = (el) => { const cs = getComputedStyle(el); return [cs.outlineStyle, cs.outlineWidth, cs.outlineColor, cs.boxShadow, cs.backgroundColor, cs.borderTopColor, cs.color, cs.textDecorationLine].join('|'); };
  const trio = (el) => [el, el.nextElementSibling, el.parentElement].filter(Boolean);
  window.__qa = { base: new Map(), trio, sig, scopeCss };
  focusables.forEach((el) => window.__qa.base.set(el, trio(el).map(sig)));
  return {
    vw, vh,
    counts: { panels: boxes.filter((b) => b.kind === 'panel').length, interactive: boxes.filter((b) => b.kind === 'interactive').length, text: boxes.filter((b) => b.kind === 'text').length, markers: boxes.filter((b) => b.kind === 'marker').length, labels: boxes.filter(isLabel).length, focusables: focusables.length },
    violations, allowlisted, texts,
    focusables: focusables.map((el, i) => { el.setAttribute('data-qa-i', i); return { i, sel: path(el), label: (el.getAttribute('aria-label') ?? el.textContent ?? el.tagName).trim().replace(/\s+/g, ' ').slice(0, 50) }; }),
  };
}

/** After a Tab press: which candidate has focus, does it show a visible focus style, and is it inside the scope? */
function focusProbe() {
  const el = document.activeElement;
  if (!el || el === document.body) return null;
  const q = window.__qa;
  const i = el.getAttribute('data-qa-i');
  const base = q.base.get(el);
  const outline = (e) => { const cs = getComputedStyle(e); return cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0 && !/rgba\(\d+, \d+, \d+, 0\)/.test(cs.outlineColor); };
  let visible = false;
  if (base) { const now = q.trio(el); visible = now.some(outline) || now.map(q.sig).some((s, k) => s !== base[k]); }
  const label = (el.getAttribute('aria-label') ?? el.textContent ?? el.tagName).trim().replace(/\s+/g, ' ').slice(0, 40);
  return { i: i === null ? null : Number(i), visible, tag: el.tagName.toLowerCase(), label, inScope: !!el.closest(q.scopeCss === 'body' ? 'main' : q.scopeCss) };
}

/* ------------------------------------------------------------------ node-side helpers */
const lin = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const over = (fg, bg) => { const a = fg[3]; return [fg[0] * a + bg[0] * (1 - a), fg[1] * a + bg[1] * (1 - a), fg[2] * a + bg[2] * (1 - a), 1]; };
const need = (px) => (px >= 24 ? MIN_CONTRAST_LARGE : MIN_CONTRAST);

async function samplePixels(png, rect, vw, vh) {
  const meta = await sharp(png).metadata();
  const sx = meta.width / vw, sy = meta.height / vh;
  // sample the glyph body: inset by 1 px sideways and 15% top and bottom (ascender / descender slack is not ink)
  const iy = Math.min(rect.h * 0.15, Math.max(0, rect.h / 2 - 1)), ix = Math.min(1, Math.max(0, rect.w / 2 - 1));
  const left = Math.max(0, Math.floor((rect.x + ix) * sx)), top = Math.max(0, Math.floor((rect.y + iy) * sy));
  const width = Math.max(1, Math.min(meta.width - left, Math.ceil((rect.w - 2 * ix) * sx))), height = Math.max(1, Math.min(meta.height - top, Math.ceil((rect.h - 2 * iy) * sy)));
  const { data } = await sharp(png).extract({ left, top, width, height }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const px = [];
  const stride = 3 * Math.max(1, Math.floor(data.length / 3 / 600));
  for (let i = 0; i + 2 < data.length; i += stride) px.push([data[i], data[i + 1], data[i + 2]]);
  return { px };
}

async function annotate(file, violations) {
  const rects = violations.flatMap((v) => v.rects ?? []);
  if (!rects.length) return;
  const meta = await sharp(file).metadata();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${meta.width}" height="${meta.height}">${rects.map((r) => `<rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" fill="none" stroke="#ff2bd6" stroke-width="2"/>`).join('')}</svg>`;
  await sharp(file).composite([{ input: Buffer.from(svg) }]).toFile(file.replace(/\.png$/, '.violations.png'));
}

/* ------------------------------------------------------------------ app driver */
const ask = (page, text, origin = 'tool') => page.evaluate(([t, o]) => window.__mw.ask(t, { origin: o, at: null }), [text, origin]);
const sleep = (p, ms) => p.waitForTimeout(ms);
/** Park the pointer on the top bar so no hover state (rail tooltip, map readout) is left over from a click. */
const park = (p) => p.mouse.move(640, 20);
const closeAll = async (p) => {
  await p.evaluate(() => { const m = window.__mw; m.hud.getState().patch({ popover: null }); m.hud.getState().setSheet(null); m.companion.getState().closeBubble(); m.shell.getState().setReport(false); });
  await sleep(p, 250);
};
/** Ask MarsAgent and wait until that turn has finished and every narration line has been revealed. */
async function askWait(page, text, origin = 'tool', timeout = 90_000) {
  const before = await page.evaluate(() => window.__mw.thread.getState().turns.length);
  await ask(page, text, origin);
  await waitTurn(page, before, timeout);
}
async function waitTurn(page, before, timeout = 90_000) {
  await page.waitForFunction((b) => {
    const m = window.__mw, ts = m.thread.getState().turns;
    if (ts.length <= b) return false;
    const t = ts[ts.length - 1];
    return t.status !== 'working' && (m.reveal.getState().shown[t.id] ?? 0) >= t.narration.length;
  }, before, { timeout });
  await park(page);
  await sleep(page, 600);
}
/**
 * Wait (up to 4 s) until an element has kept the same box for 400 ms. The streaming card grows as lines land; measuring
 * text while it moves samples the contrast against the wrong pixels.
 */
async function settled(page, css) {
  let last = '', same = 0;
  for (let i = 0; i < 20 && same < 2; i++) {
    const b = await page.locator(css).first().boundingBox().catch(() => null);
    const k = b ? [b.x, b.y, b.width, b.height].map(Math.round).join(',') : '';
    same = k && k === last ? same + 1 : 0; last = k;
    await sleep(page, 200);
  }
}
const turnCount = (page) => page.evaluate(() => window.__mw.thread.getState().turns.length);
const pauseAt = (page, f) => page.evaluate((fr) => { const p = window.__mw.playback; p.getState().pause(); p.getState().seek(p.getState().durationS * fr); }, f);
/** Pause the playback at an absolute time (s), clamped to its length. */
const seekAt = (page, s) => page.evaluate((t) => { const p = window.__mw.playback; p.getState().pause(); p.getState().seek(Math.min(t, p.getState().durationS)); }, s);
/**
 * The landing waits behind a veil for its terrain, captioned "Loading terrain" (centred status while loading; the phase
 * caption sits top left once it plays). A seek cancels that wait, so never seek before the caption has gone.
 */
/** After a seek the camera jumps: wait (up to `ms`) until the globe reports its tiles loaded, so the shot shows the real imagery. */
const tilesSettled = (page, ms = 25_000) => page.waitForFunction(() => window.__planet?.stats?.().tilesLoaded, null, { timeout: ms, polling: 250 }).catch(() => {});
const terrainLoaded = (page, timeout = 120_000) => page.waitForFunction(() => ![...document.querySelectorAll('[data-stage] [role="status"], [role="status"]')].some((e) => /Loading terrain/.test(e.textContent ?? '') && e.checkVisibility()), null, { timeout });
async function stageBox(page) { const b = await page.locator('[data-stage]').boundingBox(); if (!b) throw new Error('no stage'); return b; }
const baseScreen = (page) => page.evaluate("(() => { const w = window.__mw, b = w.world.getState().base; return w.projectJezero({ lon: b.lon, lat: b.lat }); })()");
const jezeroPt = (page, dx, dy) => baseScreen(page).then((b) => ({ x: b.x + dx, y: b.y + dy }));
/** Open the "How I worked it out" list of the newest turn that has one, and scroll the thread (not the page) to it. */
async function expandSteps(page) {
  await page.evaluate(() => {
    const log = document.querySelector('#marsagent-panel [role=log]');
    const d = [...log.querySelectorAll('details')].pop();
    if (!d) return;
    d.open = true;
    log.scrollTop = d.offsetTop - log.offsetTop - 8;
  });
  await sleep(page, 500);
}

/** Readiness: the planet canvas is mounted on the stage (data-ready) and the global science data has loaded. */
async function boot(page, { intro }) {
  await page.addInitScript((seen) => { try { if (seen) localStorage.setItem('marswalk-intro-seen', '1'); else localStorage.removeItem('marswalk-intro-seen'); localStorage.removeItem('heymars-panel-open'); } catch { /* ignore */ } }, !intro);
  await page.goto(`${BASE}/?qa=1`, { waitUntil: 'load', timeout: 120_000 });
  await page.waitForFunction('window.__mw && window.__mw.ready() && !!window.__planet', null, { timeout: 150_000 });
  await sleep(page, 2500);
}
async function enterJezero(page) {
  await askWait(page, 'Take me to Jezero', 'tool', 150_000);
  await page.waitForFunction("window.__mw.globe.getState().mode === 'jezero' && window.__mw.projectJezero({lon: window.__mw.world.getState().base.lon, lat: window.__mw.world.getState().base.lat}).visible", null, { timeout: 150_000 });
  await sleep(page, 3500);
}
const phone = (w) => w < 600;
/** Delta target 2.9 km ENE of the base: NO GO from the default 10 m mast (radio shadow), GO from 20 m (see route-go-card). */
const GO_TARGET = { lon: 77.49357, lat: 18.47162 };

/**
 * Each state: { name, scope, run(ctx), nofocus?, desktopOnly? }. Ctx holds { page, w, h }. States run in order on one page per
 * viewport, so later states build on earlier ones (route before walk, walk before helmet, ...). The live LLM is never called:
 * every question below is a verb or a maths follow-up that runs fixed code.
 */
const STATES = [
  { name: 'intro', scope: INTRO_SCOPE, run: async ({ page }) => {
    await page.waitForFunction(() => /Terrain ready|failed/.test(document.querySelector('#intro-title')?.closest('[role=dialog]')?.textContent ?? ''), null, { timeout: 150_000 });
    await sleep(page, 400);
  } },
  { name: 'planet-idle', run: async ({ page }) => { await page.keyboard.press('Enter'); await sleep(page, 1500); } },
  { name: 'hover-readout', nofocus: 'pointer hover state', run: async ({ page }) => {
    const b = await stageBox(page);
    await page.mouse.move(b.x + b.width * 0.5, b.y + b.height * 0.56);
    await page.mouse.move(b.x + b.width * 0.51, b.y + b.height * 0.56);
    await sleep(page, 1300);
  } },
  { name: 'map-click-card', run: async ({ page }) => {
    const b = await stageBox(page), before = await turnCount(page);
    await page.mouse.click(b.x + b.width * 0.5, b.y + b.height * 0.5);
    await waitTurn(page, before, 60_000);
  } },
  { name: 'landing-check-streaming', nofocus: 'captured mid-stream; the same controls are checked in landing-check-card', run: async ({ page }) => {
    await page.evaluate(() => window.__mw.thread.getState().setPace(4000));
    await sleep(page, 400);
    await ask(page, 'Landing check', 'map');
    await sleep(page, 1800);
    await settled(page, 'section[data-companion]');
  } },
  { name: 'landing-check-card', run: async ({ page }) => {
    await page.evaluate(() => window.__mw.thread.getState().setPace(260));
    await page.waitForFunction(() => { const m = window.__mw, t = m.thread.getState().turns.at(-1); return t.status !== 'working' && (m.reveal.getState().shown[t.id] ?? 0) >= t.narration.length; }, null, { timeout: 60_000 });
    await sleep(page, 900);
  } },
  { name: 'landing-sim-descent', run: async ({ page }) => {
    await askWait(page, 'Run landing simulation', 'tool', 120_000);
    await page.waitForFunction('window.__mw.hud.getState().landing && window.__mw.playback.getState().durationS > 0', null, { timeout: 60_000 });
    await sleep(page, 1500);
    await terrainLoaded(page);
    await sleep(page, 1000);
    await pauseAt(page, 0.55);
    await sleep(page, 1500);
    await tilesSettled(page);
    await sleep(page, 1500);
  } },
  // sky crane (20 m and below, stage, bridles and rover in one frame) and the close hold on the rover just after touchdown
  { name: 'landing-sky-crane', run: async ({ page }) => { await seekAt(page, 412); await sleep(page, 1500); await tilesSettled(page); await sleep(page, 1500); } },
  { name: 'landing-touchdown-close', run: async ({ page }) => { await seekAt(page, 425); await sleep(page, 1500); await tilesSettled(page); await sleep(page, 1500); } },
  { name: 'landing-sim-touchdown', run: async ({ page }) => { await pauseAt(page, 1); await sleep(page, 1500); await tilesSettled(page); await sleep(page, 1500); } },
  { name: 'jezero-after-fall', run: async ({ page }) => { await closeAll(page); await enterJezero(page); } },
  // a target on a 24° cell west of the base (QA round 1, P0): no route, two rows, Replan and Nearest point
  { name: 'route-nopath-card', run: async ({ page }) => {
    await closeAll(page);
    const b = await turnCount(page);
    await page.evaluate(() => window.__mw.plan({ lon: 77.41088572, lat: 18.44062715 }));
    await waitTurn(page, b, 90_000);
    await sleep(page, 1200);
  } },
  { name: 'route-nearest-card', run: async ({ page }) => {
    const b = await turnCount(page);
    await page.locator('section[data-companion] button', { hasText: 'Pick nearest reachable point' }).click();
    await waitTurn(page, b, 90_000);
    await sleep(page, 1500);
  } },
  { name: 'drag-preview', nofocus: 'pointer is held down mid-drag', run: async ({ page }) => {
    await closeAll(page);
    const base = await baseScreen(page);
    await page.mouse.move(base.x, base.y);
    await page.mouse.down();
    const to = { x: base.x - 150, y: base.y - 40 };
    for (let i = 1; i <= 10; i++) { await page.mouse.move(base.x + ((to.x - base.x) * i) / 10, base.y + ((to.y - base.y) * i) / 10); await sleep(page, 120); }
    await page.waitForFunction('window.__mw.hud.getState().preview', null, { timeout: 30_000 });
    await sleep(page, 600);
  } },
  { name: 'route-nogo-card', run: async ({ page }) => {
    const before = await turnCount(page);
    await page.mouse.up();
    await waitTurn(page, before, 90_000);
    // the drag lands wherever the camera puts the pointer; when that has no walkable path, plan the known delta target instead
    const legs = await page.evaluate(() => { const m = window.__mw, id = m.hud.getState().activeRouteId; return id ? m.world.getState().routes[id].legs.length : 0; });
    if (!legs) { const b2 = await turnCount(page); await page.evaluate(() => window.__mw.plan({ lon: 77.3867, lat: 18.4341 })); await waitTurn(page, b2, 90_000); }
    await sleep(page, 1200);
  } },
  { name: 'panel-formulas-expanded', desktopOnly: true, run: async ({ page }) => { await expandSteps(page); } },
  { name: 'maths-followup', run: async ({ page }) => {
    await askWait(page, 'Why is the comms limit 0.5 km, and what if the suit draws 300 W?', 'panel');
    await page.evaluate(() => { const log = document.querySelector('#marsagent-panel [role=log]'); const el = [...log.querySelectorAll('article')].pop(); log.scrollTop = el.offsetTop - log.offsetTop - 8; });
    await sleep(page, 400);
  } },
  // the GO path (QA round 2, P0-3): drag to a delta target 2.9 km ENE of the base, NO GO for a 2.2 km radio shadow from
  // the 10 m mast, then the card's "Raise mast to 20 m" replans to GO (EVA starts 09:00 local solar time by default)
  { name: 'route-go-card', run: async ({ page }) => {
    await closeAll(page);
    const st = await stageBox(page), base = await baseScreen(page);
    const to = await page.evaluate((t) => window.__mw.projectJezero(t), GO_TARGET);
    const b0 = await turnCount(page);
    if (to.visible && to.x > st.x + 12 && to.x < st.x + st.width - 12 && to.y > st.y + 12 && to.y < st.y + st.height - 12) {
      await page.mouse.move(base.x, base.y);
      await page.mouse.down();
      for (let i = 1; i <= 12; i++) { await page.mouse.move(base.x + ((to.x - base.x) * i) / 12, base.y + ((to.y - base.y) * i) / 12); await sleep(page, 100); }
      await sleep(page, 500);
      await page.mouse.up();
    } else await page.evaluate((t) => window.__mw.plan(t), GO_TARGET);
    await waitTurn(page, b0, 90_000);
    // a drag can drop a few hundred metres off the target (small phone stage): plan the exact target when the card has no mast action
    const mastBtn = page.locator('section[data-companion] button', { hasText: /^Raise mast to \d+ m$/ });
    if (!(await mastBtn.count())) { const bx = await turnCount(page); await page.evaluate((t) => window.__mw.plan(t), GO_TARGET); await waitTurn(page, bx, 90_000); }
    const b1 = await turnCount(page);
    await page.locator('section[data-companion] button', { hasText: /^Raise mast to \d+ m$/ }).click();
    await waitTurn(page, b1, 90_000);
    await sleep(page, 1200);
  } },
  { name: 'walk-playback', run: async ({ page }) => {
    await askWait(page, 'Walk it');
    await page.waitForFunction('window.__mw.hud.getState().walkOn', null, { timeout: 30_000 });
    await sleep(page, 2500);
    await pauseAt(page, 0.15);
    await sleep(page, 2000);
  } },
  { name: 'helmet-view', run: async ({ page }) => {
    await askWait(page, 'Helmet view');
    await sleep(page, 1200);
    await pauseAt(page, 0.3);
    await sleep(page, 2000);
  }, after: async ({ page }) => { await page.evaluate(() => window.__mw.walkUi.getState().setHelmet(false)); await sleep(page, 800); } },
  { name: 'rover-assist', run: async ({ page }) => {
    await askWait(page, 'Rover assist');
    await sleep(page, 1500);
    await pauseAt(page, 0.25);
    await sleep(page, 2000);
  } },
  { name: 'base-camp-reach', run: async ({ page }) => {
    await page.evaluate(() => { window.__mw.hud.getState().patch({ walkOn: false }); window.__mw.walkUi.getState().setRoverFraction(0); });
    await askWait(page, 'Base camp reach', 'tool', 280_000);
    await page.waitForFunction('window.__mw.hud.getState().reach && !window.__mw.hud.getState().reachProgress', null, { timeout: 280_000 });
    await sleep(page, 2500);
  } },
  { name: 'lasso', run: async ({ page }) => {
    await page.evaluate(() => window.__mw.hud.getState().patch({ reachOn: false }));
    await closeAll(page);
    await sleep(page, 600);
    const c = await jezeroPt(page, 40, 60);
    const before = await turnCount(page);
    await page.keyboard.down('Shift');
    await page.mouse.move(c.x - 90, c.y - 60);
    await page.mouse.down();
    for (const [dx, dy] of [[-90, -60], [90, -60], [110, 40], [0, 90], [-100, 50], [-90, -60]]) { await page.mouse.move(c.x + dx, c.y + dy, { steps: 6 }); await sleep(page, 60); }
    await page.mouse.up();
    await page.keyboard.up('Shift');
    await waitTurn(page, before, 60_000);
  } },
  { name: 'layers', run: async ({ page }) => { await closeAll(page); await page.locator('#rail-layers').click(); await park(page); await sleep(page, 500); }, after: ({ page }) => closeAll(page) },
  { name: 'limits', run: async ({ page }) => { await page.locator('#rail-limits').click(); await sleep(page, 400); await page.locator('summary', { hasText: 'Assumptions' }).click(); await park(page); await sleep(page, 500); }, after: ({ page }) => closeAll(page) },
  { name: 'sources', run: async ({ page }) => { await page.locator('#rail-sources').click(); await park(page); await sleep(page, 700); }, after: ({ page }) => closeAll(page) },
  { name: 'cuff-card', run: async ({ page }) => { await askWait(page, 'Cuff card'); await page.waitForFunction("window.__mw.hud.getState().sheet === 'cuff'", null, { timeout: 30_000 }); await sleep(page, 700); }, after: ({ page }) => closeAll(page) },
  { name: 'report-section-4', scope: '[data-report-root]', run: async ({ page }) => {
    await page.evaluate(() => window.__mw.shell.getState().setReport(true));
    await page.waitForSelector('[data-report-root]');
    await sleep(page, 600);
    if (await page.locator('[data-report-root] nav button', { hasText: 'Calculations' }).isVisible()) await page.locator('[data-report-root] nav button', { hasText: 'Calculations' }).click();
    else await page.evaluate(() => { const sc = document.querySelector('[data-report-scroll]'); const h = document.querySelector('#rep-calculations'); sc.scrollTop = h.offsetTop - 16; });
    await sleep(page, 1200);
  }, after: ({ page }) => closeAll(page) },
  // the stage widens when the panel closes: the canvas, the scene labels and the Base tag need a few (slow, software
  // WebGL) frames to settle on the new size before the labels are measured
  { name: 'panel-collapsed', run: async ({ page }) => { await closeAll(page); await page.evaluate(() => window.__mw.shell.getState().setPanel(false)); await sleep(page, 1800); }, after: async ({ page }) => { await page.evaluate(() => window.__mw.shell.getState().setPanel(!(window.innerWidth < 600))); await sleep(page, 400); } },
];

/* ------------------------------------------------------------------ one state */
async function checkState(page, st, vr, w, h, shotPath) {
  const scopeCss = st.scope ?? 'body';
  const data = await page.evaluate(collectInPage, { scopeCss, overlapPx: OVERLAP_PX, allow: ALLOWLIST });
  if (data.error) { vr.violations.push({ type: 'no-scope', severity: 'violation', a: data.error, b: '' }); return; }
  vr.counts = data.counts;
  vr.allowlisted = data.allowlisted;
  for (const v of data.violations) (v.severity === 'warning' ? vr.warnings : vr.violations).push(v);

  // (4) contrast: screenshot with every text colour hidden gives the true pixels behind the text
  await page.screenshot({ path: shotPath });
  const tag = await page.addStyleTag({ content: `* { color: transparent !important; text-shadow: none !important; -webkit-text-fill-color: transparent !important; caret-color: transparent !important; } svg text, svg tspan { fill: transparent !important; }` });
  const bgShot = await page.screenshot();
  await tag.evaluate((n) => n.remove());
  let worstAll = 99;
  for (const t of data.texts) {
    vr.contrast.checked++;
    let r, worst, source;
    if (t.opaque) {
      let bg = t.opaque.slice(); for (const l of t.layers.slice().reverse()) bg = over(l, bg);
      r = worst = ratio(over(t.fg, bg), bg); source = 'dom';
    } else {
      const s = await samplePixels(bgShot, t.rect, data.vw, data.vh);
      r = ratio(over(t.fg, s.px[0]), s.px[0]);
      worst = Math.min(...s.px.map((p) => ratio(over(t.fg, p), p)));
      r = worst; source = 'canvas-sample';
    }
    worstAll = Math.min(worstAll, worst);
    const rec = { text: t.text, sel: t.sel, fontPx: t.size, ratio: +worst.toFixed(2), needed: need(t.size), source };
    if (source === 'canvas-sample') vr.contrast.overCanvasText.push(rec);
    (vr.contrast.lowest ??= []).push(rec);
    if (worst < need(t.size)) vr.contrast.failures.push(rec);
  }
  vr.contrast.worst = worstAll === 99 ? null : +worstAll.toFixed(2);
  if (vr.contrast.lowest) vr.contrast.lowest = vr.contrast.lowest.sort((a, b) => a.ratio - b.ratio).slice(0, 4);
  vr.contrast.overCanvasText = vr.contrast.overCanvasText.sort((a, b) => a.ratio - b.ratio).slice(0, 4);
  for (const f of vr.contrast.failures) vr.violations.push({ type: 'low-contrast', severity: 'violation', a: `"${f.text}" ${f.ratio}:1 < ${f.needed}:1 (${f.source}, ${f.fontPx}px)`, b: '', aSel: f.sel });

  // (5) keyboard
  if (st.nofocus) { vr.focus.skipped = st.nofocus; }
  else {
    await page.evaluate(() => document.activeElement?.blur?.());
    const reached = new Map();
    vr.focus.candidates = data.focusables.length;
    let escaped = null;
    for (let i = 0; i < data.focusables.length + 10; i++) {
      await page.keyboard.press('Tab');
      const p = await page.evaluate(focusProbe);
      if (!p) continue;
      if (!p.inScope && !escaped) escaped = p.label;
      if (p.i === null) continue;
      if (!reached.has(p.i)) reached.set(p.i, p.visible); else if (p.visible) reached.set(p.i, true);
    }
    vr.focus.reached = reached.size;
    for (const f of data.focusables) {
      if (!reached.has(f.i)) vr.focus.unreached.push(f);
      else if (!reached.get(f.i)) vr.focus.noFocusStyle.push(f);
    }
    for (const f of vr.focus.unreached) vr.violations.push({ type: 'not-keyboard-reachable', severity: 'violation', a: f.label, b: '', aSel: f.sel });
    for (const f of vr.focus.noFocusStyle) vr.violations.push({ type: 'no-visible-focus', severity: 'violation', a: f.label, b: '', aSel: f.sel });
    if (escaped && st.scope) vr.violations.push({ type: 'focus-escapes-dialog', severity: 'violation', a: `Tab left the dialog for "${escaped}"`, b: '', aSel: '' });
    await page.evaluate(() => document.activeElement?.blur?.());
  }
}

/* ------------------------------------------------------------------ main */
async function waitForServer() {
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(BASE); if (r.status < 500) return true; } catch { /* retry */ }
    await new Promise((r) => setTimeout(r, 2000));
  }
  return false;
}

async function main() {
  if (!(await waitForServer())) { console.error(`qa-layout: cannot reach ${BASE}. Start the app (npx next build && npx next start -p 3950) or set E2E_BASE_URL.`); process.exit(2); }
  const only = process.env.QA_STATES ? new Set(process.env.QA_STATES.split(',')) : null;
  const states = STATES.filter((s) => !only || only.has(s.name));
  const browser = await chromium.launch({ executablePath: process.env.E2E_CHROMIUM_PATH || undefined, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--use-gl=angle', '--ignore-gpu-blocklist', '--enable-webgl'] });
  const baselineFile = `${OUT}/layout-report.baseline.json`;
  const baseline = existsSync(baselineFile) ? JSON.parse(await readFile(baselineFile, 'utf8')) : null;
  const report = { base: BASE, date: new Date().toISOString(), thresholds: { overlapPx: OVERLAP_PX, minContrast: MIN_CONTRAST, minContrastLarge: MIN_CONTRAST_LARGE }, allowlist: ALLOWLIST.map(({ id, reason }) => ({ id, reason })), states: states.map((s) => s.name), results: [] };
  let failed = false;

  for (const [w, h] of VIEWPORTS) {
    const vpName = `${w}x${h}`;
    await mkdir(`${OUT}/qa/${vpName}`, { recursive: true });
    // (?qa=1 makes Scout snap to its target, so a slow software-WebGL frame rate cannot leave it mid-flight in a screenshot)
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, hasTouch: w < 600, isMobile: w < 600 });
    const page = await ctx.newPage();
    page.setDefaultTimeout(60_000);
    const pageErrors = [];
    page.on('pageerror', (e) => pageErrors.push(e.message));
    // console errors (the quality gate wants none), tagged with the state that was running; reported as warnings
    const consoleErrors = [];
    let current = '';
    page.on('console', (m) => { if (m.type() === 'error' && !/favicon|GL Driver Message|React DevTools/i.test(m.text())) consoleErrors.push(`[${current}] ${m.text().slice(0, 300)}`); });
    let booted = false;
    for (const st of states) {
      const vr = { viewport: vpName, state: st.name, violations: [], warnings: [], contrast: { checked: 0, failures: [], overCanvasText: [] }, focus: { candidates: 0, reached: 0, unreached: [], noFocusStyle: [] }, screenshot: `${OUT}/qa/${vpName}/${st.name}.png` };
      report.results.push(vr);
      const t0 = Date.now();
      if (st.desktopOnly && phone(w)) { report.results.pop(); continue; }
      current = st.name;
      try {
        if (!booted) { await boot(page, { intro: states[0].name === 'intro' }); booted = true; }
        await st.run({ page, w, h });
        await checkState(page, st, vr, w, h, vr.screenshot);
        if (st.after) await st.after({ page, w, h });
      } catch (e) {
        vr.violations.push({ type: 'qa-driver-error', severity: 'violation', a: String(e?.message ?? e).split('\n')[0], b: '' });
        try { await page.screenshot({ path: vr.screenshot }); } catch { /* ignore */ }
      }
      if (vr.violations.length && !process.env.QA_NO_ANNOTATE) await annotate(vr.screenshot, vr.violations).catch(() => {});
      if (vr.violations.length) failed = true;
      const by = {}; for (const v of vr.violations) by[v.type] = (by[v.type] ?? 0) + 1;
      const before = baseline?.results.find((r) => r.viewport === vpName && r.state === st.name);
      vr.before = before ? before.violations.length : null;
      for (const v of vr.violations.filter((x) => x.type === 'qa-driver-error')) console.log('          driver:', v.a.slice(0, 220));
      console.log(`${vpName.padEnd(9)} ${st.name.padEnd(24)} ${vr.violations.length ? 'FAIL' : 'ok  '} v=${String(vr.violations.length).padEnd(3)} before=${vr.before ?? '-'} contrast-worst=${vr.contrast.worst ?? '-'} focus=${vr.focus.skipped ? 'skipped' : `${vr.focus.reached}/${vr.focus.candidates}`} ${((Date.now() - t0) / 1000).toFixed(0)}s${Object.keys(by).length ? '  ' + Object.entries(by).map(([k, n]) => `${k}:${n}`).join(' ') : ''}`);
    }
    if (consoleErrors.length) { report.results.push({ viewport: vpName, state: '(console errors)', violations: [], warnings: consoleErrors.slice(0, 40).map((m) => ({ type: 'console-error', a: m })), contrast: { checked: 0, failures: [], overCanvasText: [] }, focus: {} }); console.log(`${vpName.padEnd(9)} console errors: ${consoleErrors.length}`); for (const m of consoleErrors.slice(0, 8)) console.log('          console:', m.slice(0, 220)); }
    if (pageErrors.length) { report.results.push({ viewport: vpName, state: '(page errors)', violations: [], warnings: pageErrors.slice(0, 10).map((m) => ({ type: 'pageerror', a: m })), contrast: { checked: 0, failures: [], overCanvasText: [] }, focus: {} }); }
    await ctx.close().catch(() => {});
  }
  await browser.close().catch(() => {});
  report.passed = !failed;
  await mkdir(OUT, { recursive: true });
  await writeFile(`${OUT}/layout-report.json`, JSON.stringify(report, (k, v) => (v instanceof Float32Array ? undefined : v), 2));
  console.log(`report: ${OUT}/layout-report.json  ->  ${failed ? 'VIOLATIONS FOUND' : 'clean'}`);
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(2); });
