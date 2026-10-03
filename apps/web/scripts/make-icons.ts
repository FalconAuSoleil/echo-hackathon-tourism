// Rend public/icons/icon.svg en PNG 192 et 512 (icônes du manifeste PWA) avec Chromium headless.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "icons");
const svg = readFileSync(join(dir, "icon.svg"), "utf8");
const browser = await chromium.launch({ args: ["--disable-gpu"] });
for (const size of [192, 512]) {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  await page.setContent(`<html><body style="margin:0">${svg.replace("<svg ", `<svg width="${size}" height="${size}" `)}</body></html>`);
  await page.screenshot({ path: join(dir, `icon-${size}.png`), omitBackground: true });
  await page.close();
}
await browser.close();
console.log("icons written");
