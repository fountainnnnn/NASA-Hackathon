#!/usr/bin/env node
// Writes assets/icons.json: Lucide icon SVG markup (ISC licence, from the repo's lucide-react) for the diagram scenes.
//   node tools/lucide.mjs sun mountain radio-tower ...
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LR = path.resolve(ROOT, "../../node_modules/lucide-react/dist/esm/icons");
const out = path.join(ROOT, "assets/icons.json");
const icons = fs.existsSync(out) ? JSON.parse(fs.readFileSync(out, "utf8")) : {};
for (const n of process.argv.slice(2)) {
  const f = path.join(LR, `${n}.mjs`);
  if (!fs.existsSync(f)) { console.error(`missing ${n}`); continue; }
  const { __iconData } = await import(pathToFileURL(f).href);
  const node = __iconData.node;
  const inner = node.map(([tag, a]) => `<${tag} ${Object.entries(a).filter(([k]) => k !== "key").map(([k, v]) => `${k}="${v}"`).join(" ")}/>`).join("");
  icons[n] = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;
}
fs.writeFileSync(out, JSON.stringify(icons, null, 1) + "\n");
console.log(Object.keys(icons).join(" "));
