// Icônes et écran de démarrage Android depuis apps/web/public/icons/icon.svg (mêmes formes que la PWA),
// rendus avec le Chromium de Playwright (déjà utilisé par apps/web). Usage : node tools/android/make-icons.mjs
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const RES = join(ROOT, "apps/android/android/app/src/main/res");
const { chromium } = createRequire(join(ROOT, "apps/web/package.json"))("playwright");

const GREEN = "#1f6f43";
const PAPER = "#f6f7f4";
const svg = readFileSync(join(ROOT, "apps/web/public/icons/icon.svg"), "utf8");
// Le pictogramme seul (sans le carré vert), pour l'avant-plan des icônes adaptatives.
const glyph = svg.replace(/<rect width="512" height="512"[^>]*\/>/, "");
const inner = (s) => s.replace(/^[\s\S]*?<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "");

const densities = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };

function legacy(size, round) {
  const bg = round ? `<circle cx="256" cy="256" r="256" fill="${GREEN}"/>` : `<rect width="512" height="512" rx="96" fill="${GREEN}"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="${size}" height="${size}">${bg}${inner(glyph)}</svg>`;
}
// Avant-plan 108 dp : zone sûre de 66 dp au centre ; le pictogramme (≈272 px de large sur 512) y tient.
function foreground(size) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-64 -64 640 640" width="${size}" height="${size}">${inner(glyph)}</svg>`;
}
function splash(w, h) {
  const s = Math.round(Math.min(w, h) * 0.35);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="100%" height="100%" fill="${PAPER}"/>`
    + `<svg x="${(w - s) / 2}" y="${(h - s) / 2}" width="${s}" height="${s}" viewBox="0 0 512 512">${inner(svg)}</svg></svg>`;
}

const browser = await chromium.launch({ args: ["--disable-gpu"] });
async function render(markup, w, h, out) {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  await page.setContent(`<html><body style="margin:0;background:transparent">${markup}</body></html>`);
  mkdirSync(dirname(out), { recursive: true });
  await page.screenshot({ path: out, omitBackground: true });
  await page.close();
}
for (const [d, k] of Object.entries(densities)) {
  await render(legacy(48 * k, false), 48 * k, 48 * k, join(RES, `mipmap-${d}/ic_launcher.png`));
  await render(legacy(48 * k, true), 48 * k, 48 * k, join(RES, `mipmap-${d}/ic_launcher_round.png`));
  await render(foreground(108 * k), 108 * k, 108 * k, join(RES, `mipmap-${d}/ic_launcher_foreground.png`));
  const pw = 320 * k, ph = 480 * k;
  await render(splash(pw, ph), pw, ph, join(RES, `drawable-port-${d}/splash.png`));
  await render(splash(ph, pw), ph, pw, join(RES, `drawable-land-${d}/splash.png`));
}
await render(splash(480, 320), 480, 320, join(RES, "drawable/splash.png"));
await browser.close();
writeFileSync(join(RES, "values/ic_launcher_background.xml"),
  `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">${GREEN}</color>\n</resources>\n`);
console.log("android icons and splash written");
