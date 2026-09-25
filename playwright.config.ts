/**
 * A real browser, running the real build, and nothing else — the one thing
 * nothing else in this repo does.
 *
 * `pnpm test` is jsdom plus `fake-indexeddb`: fast, and enough to reproduce
 * the bugs this project has spent whole sessions chasing, because those bugs
 * were in application logic that jsdom's polyfills faithfully carry through.
 * What jsdom cannot exercise is the app running in an actual browser engine —
 * a real `<textarea>`, real debounced input events, real IndexedDB and real
 * `crypto.subtle`, wired up exactly as `dist/public` ships it. `pnpm smoke`
 * covers the server the same way, at the HTTP layer, for the same reason:
 * type-clean and unit-tested is not the same claim as "starts and serves."
 * This is that check for the client.
 *
 * Local mode only — no server route needs a database or a signed-in session,
 * so this cannot flake on infrastructure this repo does not have in CI. See
 * `lib/localMode.ts`; the suite forces it on with `addInitScript` rather than
 * going through the login page's own "server unreachable" detection, since a
 * server that runs but has no database is reachable, not absent.
 *
 * Not run in `pnpm test` or wired into `ci.yml`: a browser-level suite needs a
 * built app on disk (`pnpm build` first) and, in a CI runner that is not this
 * sandbox, an actual `playwright install chromium` before it can launch
 * anything — a real cost in time and bytes that is a call for whoever owns
 * the CI budget, not one to make silently from inside a test file. Run it by
 * hand with `pnpm test:e2e`.
 */
import { defineConfig } from "@playwright/test";

const PORT = 5199;

// This sandbox has Chromium pre-installed outside Playwright's own managed
// browser cache; the docs for both live in the same place, so the path can be
// overridden without touching this file. Elsewhere — a machine that ran
// `playwright install chromium` normally — leave it unset and Playwright finds
// its own.
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH;

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: "list",
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: "retain-on-failure",
    launchOptions: {
      executablePath,
      // Quiets background requests Chromium makes on its own (Safe Browsing,
      // the component updater, sync) that this sandbox's network policy
      // rejects and that have nothing to do with the app under test.
      args: [
        "--disable-background-networking",
        "--disable-component-update",
        "--disable-client-side-phishing-detection",
        "--disable-sync",
      ],
    },
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
  webServer: {
    // Mirrors scripts/smoke.sh deliberately: the built server, a throwaway
    // JWT_SECRET (the only variable read at import time), no database. If
    // `dist/index.js` is stale or missing, run `pnpm build` first — this
    // config does not build for you, the same way `pnpm smoke` does not.
    command: `node dist/index.js`,
    // "/" rather than "/login" or "/app": the server's SPA fallback only
    // serves either of those to a request that says it accepts HTML, and
    // Playwright's own readiness probe sends a plain GET with no such header
    // — it would read the resulting 404 as "not ready yet" and time out on a
    // server that was, in fact, up the whole time. "/" is a real static file
    // (index.html) and answers any GET.
    url: `http://127.0.0.1:${PORT}/`,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
    env: {
      NODE_ENV: "production",
      PORT: String(PORT),
      JWT_SECRET: "e2e-test-secret-not-used-for-anything",
    },
  },
});
