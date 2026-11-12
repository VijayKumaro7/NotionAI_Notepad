import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";
import path from "path";

const templateRoot = path.resolve(import.meta.dirname);

export default defineConfig({
  root: templateRoot,
  // `tsconfig.json` sets `jsx: "preserve"` and leaves the actual JSX ->
  // JS transform to this plugin, the same as `vite.config.ts` does for the
  // real app. Every test here so far only used `renderHook` — no JSX of its
  // own — so this was missing without anything failing: a `.test.tsx` that
  // calls `render(<Component />)` needs it and fails to parse without it.
  plugins: [react()],
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
          // Some server tests launch real child processes and exercise Node's
          // proxy-aware fetch. DNS/network setup can exceed Vitest's 5s default
          // even though the child request has its own abort timeout.
          testTimeout: 30_000,
          // drizzle/ is included here rather than as a third project: its one
          // test reads generated SQL off disk and wants the same node
          // environment as the server suite.
          //
          // shared/ likewise: its code is imported by both sides and touches no
          // browser API, so node is the cheaper place to run. It has to be
          // named explicitly — neither project's globs reach outside its own
          // directory, so a test added under shared/ is collected by nothing.
          include: [
            "server/**/*.test.ts",
            "server/**/*.spec.ts",
            "shared/**/*.test.ts",
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
          // `.tsx` as well as `.ts`. A component test is written in `.tsx`,
          // and with only the `.ts` globs here it would be collected by
          // nothing — the same silent-dormancy this comment already records
          // happening once, arriving by a different door.
          include: [
            "client/**/*.test.ts",
            "client/**/*.test.tsx",
            "client/**/*.spec.ts",
            "client/**/*.spec.tsx",
          ],
          environment: "jsdom",
          // Both, and in this order: the shared file installs fake-indexeddb
          // and resets it per test, the client one unmounts what Testing
          // Library rendered. Naming them here rather than at the root is
          // deliberate — the second imports @testing-library/react, which the
          // server project, running on node, cannot load at all.
          setupFiles: ["./vitest.setup.ts", "./vitest.setup.client.ts"],
        },
      },
    ],
  },
});
