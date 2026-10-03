/// <reference lib="webworker" />
// Service worker d'Echo :
//  - précache l'app (HTML, JS, CSS), le catalogue, ses clips audio, les échantillons de démo, les mots-clés,
//    les embeddings pré-calculés et le runtime onnxruntime-web (WASM) : tout vient de cette origine ;
//  - sert les fichiers de modèles depuis le cache "transformers-cache" (rempli une fois par le worker
//    d'analyse avec une barre de progression ; transformers.js y lit aussi directement) ;
//  - reçoit les partages Android (Web Share Target, POST /share-target) et les met dans la file IndexedDB.
import { precacheAndRoute, cleanupOutdatedCaches, createHandlerBoundToURL } from "workbox-precaching";
import { registerRoute, NavigationRoute } from "workbox-routing";
import { enqueue, openEchoDB } from "./lib/db.ts";

declare const self: ServiceWorkerGlobalScope & { __WB_MANIFEST: (string | { url: string; revision: string | null })[] };

const MODEL_CACHE = "transformers-cache";

self.skipWaiting();
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST, { ignoreURLParametersMatching: [/.*/] });
registerRoute(new NavigationRoute(createHandlerBoundToURL("/index.html"), { denylist: [/^\/share-target/, /^\/models\//] }));

// Modèles : cache d'abord (mode avion), réseau sinon. La mise en cache est faite par le worker d'analyse
// (téléchargement avec progression) et par transformers.js, pas ici, pour ne pas écrire deux fois 200 Mo.
registerRoute(
  ({ url, request }) => url.origin === self.location.origin && url.pathname.startsWith("/models/") && request.method === "GET",
  async ({ request }) => {
    const cache = await caches.open(MODEL_CACHE);
    const hit = await cache.match(request.url);
    if (hit) return hit;
    return fetch(request);
  },
);

// Web Share Target : WhatsApp → Partager → Echo. Les fichiers vont dans la file, rien n'est analysé ici.
async function handleShare(request: Request): Promise<Response> {
  let count = 0;
  try {
    const form = await request.formData();
    const db = await openEchoDB();
    const now = new Date().toISOString();
    for (const entry of form.getAll("audio")) {
      if (entry instanceof File && entry.size > 0) {
        await enqueue(db, { kind: "audio", blob: entry, mime: entry.type, name: entry.name, receivedAt: now, via: "share" });
        count++;
      }
    }
    const text = [form.get("text"), form.get("title")].filter((x): x is string => typeof x === "string" && x.trim().length > 0).join("\n").trim();
    // Un lien seul (sans texte de visiteur) n'est pas un retour.
    if (text && !/^https?:\/\/\S+$/.test(text)) {
      await enqueue(db, { kind: "text", text, receivedAt: now, via: "share" });
      count++;
    }
  } catch {
    /* formulaire illisible : rien n'est mis en file */
  }
  return Response.redirect(`/#/host?shared=${count}`, 303);
}

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method === "POST" && url.pathname === "/share-target") {
    event.respondWith(handleShare(event.request));
  }
});
