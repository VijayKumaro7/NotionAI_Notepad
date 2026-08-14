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
    setupFiles: ["./vitest.setup.ts"],
    // Two projects rather than one suite with environmentMatchGlobs, which
    // vitest 3 deprecated. Same split as before: the client tests exercise
    // browser APIs — IndexedDB, KeyboardEvent, DOMRect — so they need a DOM,
    // and the server tests stay on node where they belong.
    //
    // `extends: true` pulls in the root resolve aliases above; without it each
    // project would resolve @/… and @shared/… on its own and find nothing.
    projects: [
      {
        extends: true,
        test: {
          name: "server",
          // drizzle/ is included here rather than as a third project: its one
          // test reads generated SQL off disk and wants the same node
          // environment as the server suite.
          include: [
            "server/**/*.test.ts",
            "server/**/*.spec.ts",
            "drizzle/**/*.test.ts",
          ],
          environment: "node",
        },
      },
      {
        extends: true,
        test: {
          name: "client",
          // Co-located with their source, per CLAUDE.md. These were written but
          // never collected for a while — `pnpm test` reported a green two-test
          // suite while ~160 client tests sat dormant — so the include patterns
          // are worth keeping honest.
          include: ["client/**/*.test.ts", "client/**/*.spec.ts"],
          environment: "jsdom",
        },
      },
    ],
  },
});
