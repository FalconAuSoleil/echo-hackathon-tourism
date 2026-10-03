import { defineConfig } from "vitest/config";

// Un seul lanceur pour tout le dépôt : chaque paquet garde ses tests à côté du code.
export default defineConfig({
  test: {
    projects: ["packages/*", "apps/*", "eval"],
    passWithNoTests: true,
  },
});
