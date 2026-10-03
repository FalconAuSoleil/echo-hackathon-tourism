import { defineConfig } from "vite";
import preact from "@preact/preset-vite";
import { VitePWA } from "vite-plugin-pwa";

// Isolation cross-origin : permet à onnxruntime-web d'utiliser plusieurs threads WASM (SharedArrayBuffer).
// Sans ces en-têtes (hébergeur qui ne les envoie pas), tout marche quand même sur un seul thread.
const isolation = { "Cross-Origin-Opener-Policy": "same-origin", "Cross-Origin-Embedder-Policy": "require-corp" };

export default defineConfig({
  // "mpa" : pas de repli SPA vers index.html pour un fichier absent (un fichier de modèle manquant doit
  // donner 404, pas du HTML). Les routes de l'app sont dans le hash (#/host…).
  appType: "mpa",
  plugins: [
    preact(),
    VitePWA({
      strategies: "injectManifest",
      srcDir: "src",
      filename: "sw.ts",
      injectRegister: false,
      manifest: {
        name: "Echo: visit feedback logbook",
        short_name: "Echo",
        description: "Offline visit feedback for small rural tourism hosts. Everything runs on the phone.",
        start_url: "/#/host",
        scope: "/",
        display: "standalone",
        background_color: "#f6f7f4",
        theme_color: "#1f6f43",
        icons: [
          { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "/icons/icon.svg", sizes: "any", type: "image/svg+xml" },
        ],
        share_target: {
          action: "/share-target",
          method: "POST",
          enctype: "multipart/form-data",
          params: {
            title: "title",
            text: "text",
            files: [{ name: "audio", accept: ["audio/*", ".opus", ".ogg", ".m4a", ".mp3", ".aac", ".amr"] }],
          },
        },
      } as Record<string, unknown>,
      injectManifest: {
        // Tout sauf les modèles (200 Mo, téléchargés une fois avec progression par le worker d'analyse).
        globPatterns: ["**/*.{html,js,css,svg,png,json,webmanifest,mp3,wav,mjs,wasm,bin}"],
        globIgnores: ["models/**", "assets/*.wasm"],
        maximumFileSizeToCacheInBytes: 40 * 1024 * 1024,
      },
      devOptions: { enabled: false },
    }),
  ],
  worker: { format: "es" },
  optimizeDeps: { exclude: ["@huggingface/transformers"] },
  server: { host: true, port: 5173, headers: isolation },
  preview: { host: true, port: 4173, headers: isolation },
  build: { target: "es2022", chunkSizeWarningLimit: 2000 },
});
