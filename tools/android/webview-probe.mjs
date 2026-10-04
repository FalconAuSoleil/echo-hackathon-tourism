// Inspecte la WebView de l'APK sur un émulateur ou un téléphone, par le protocole DevTools (APK de debug).
//   adb forward tcp:9222 localabstract:webview_devtools_remote_$(adb shell pidof org.echo.feedback)
//   node tools/android/webview-probe.mjs ["expression JS"] [--shot fichier.png]
import { writeFileSync } from "node:fs";
const args = process.argv.slice(2);
const shotIdx = args.indexOf("--shot");
const shot = shotIdx >= 0 ? args.splice(shotIdx, 2)[1] : null;
const expr = args[0] ?? `({ href: location.href, sw: !!(navigator.serviceWorker && navigator.serviceWorker.controller),
  isolated: self.crossOriginIsolated, online: navigator.onLine, text: document.body.innerText.slice(0, 1500) })`;
const targets = await (await fetch("http://127.0.0.1:9222/json")).json();
const target = targets.find((t) => t.type === "page");
if (!target) throw new Error("no page target: " + JSON.stringify(targets));
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
let id = 0;
const pending = new Map();
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } };
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const res = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
console.log(JSON.stringify(res.result?.result?.value ?? res.result ?? res, null, 2));
if (shot) {
  const s = await send("Page.captureScreenshot", { format: "png" });
  writeFileSync(shot, Buffer.from(s.result.data, "base64"));
}
ws.close();
