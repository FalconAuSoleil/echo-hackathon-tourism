import { defineConfig } from "vite";
import preact from "@preact/preset-vite";

// Squelette : le service worker (vite-plugin-pwa, précache app + modèles), le Web Share Target
// et le service de models/ depuis la même origine sont ajoutés par l'agent web (voir docs/ARCHITECTURE.md).
export default defineConfig({
  plugins: [preact()],
  worker: { format: "es" },
  server: { host: true, port: 5173 },
});
