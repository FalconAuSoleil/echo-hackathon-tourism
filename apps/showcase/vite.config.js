import { defineConfig } from "vite";

// Site statique : photos et sons dans public/ sont copiés tels quels.
export default defineConfig({
  publicDir: "public",
  base: "/",
});
