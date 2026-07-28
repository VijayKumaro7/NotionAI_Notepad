import { defineConfig } from "vitest/config";
import path from "path";

const templateRoot = path.resolve(import.meta.dirname);

export default defineConfig({
  root: templateRoot,
  resolve: {
    alias: {
      "@": path.resolve(templateRoot, "client", "src"),
      "@shared": path.resolve(templateRoot, "shared"),
      "@assets": path.resolve(templateRoot, "attached_assets"),
    },
  },
  test: {
    // Client tests are co-located with their source, per CLAUDE.md. They were
    // written but never collected — `pnpm test` reported a green two-test suite
    // while ~160 client tests sat dormant.
    include: [
      "server/**/*.test.ts",
      "server/**/*.spec.ts",
      "client/**/*.test.ts",
      "client/**/*.spec.ts",
    ],
    environment: "node",
    // The client suite exercises browser APIs — IndexedDB, KeyboardEvent,
    // DOMRect — so it needs a DOM. The server suite stays on node.
    environmentMatchGlobs: [["client/**", "jsdom"]],
    setupFiles: ["./vitest.setup.ts"],
  },
});
