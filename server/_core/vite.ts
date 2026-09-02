import express, { type Express, type Request } from "express";
import fs from "fs";
import { type Server } from "http";
import { nanoid } from "nanoid";
import path from "path";
import { createServer as createViteServer } from "vite";
import viteConfig from "../../vite.config";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { clientAddress } from "../demoLimit";

export async function setupVite(app: Express, server: Server) {
  const serverOptions = {
    middlewareMode: true,
    hmr: { server },
    allowedHosts: true as const,
  };

  const vite = await createViteServer({
    ...viteConfig,
    configFile: false,
    server: serverOptions,
    appType: "custom",
  });

  app.use(vite.middlewares);
  // No path argument. A bare "*" was valid in express 4 but express 5 parses
  // routes with path-to-regexp v8, which rejects it outright — the server threw
  // `Missing parameter name` at startup and never listened. `app.use(handler)`
  // already matches every request, and this handler reads req.originalUrl, so
  // nothing about its behaviour changes.
  // This handler re-reads index.html from disk every time, on purpose, so an
  // edit shows up without a restart — which makes it a filesystem read driven
  // by whoever asks. Bounded rather than removed, because removing the read is
  // removing the hot reload.
  //
  // Six hundred a minute is far more than reloading, HMR and a dozen tabs
  // produce, and it only ever guards a developer's own machine: production goes
  // through serveStatic, which reads the shell once at startup.
  //
  // Mounted after vite.middlewares, so assets vite serves never reach it — the
  // same set of requests the old in-handler check saw. It is middleware rather
  // than a conditional inside the handler because that is what makes the limit
  // visible, to a reader and to CodeQL's js/missing-rate-limiting alike.
  const devShellRateLimit = rateLimit({
    windowMs: 60 * 1000,
    limit: 600,
    // Not the default `req.ip`, and not a raw address either: see the note
    // on the same pair in server/googleRoutes.ts.
    keyGenerator: (req: Request) => ipKeyGenerator(clientAddress(req)),
    standardHeaders: "draft-7",
    legacyHeaders: false,
    validate: { xForwardedForHeader: false },
  });

  app.use(devShellRateLimit, async (req, res, next) => {
    const url = req.originalUrl;

    try {
      const clientTemplate = path.resolve(
        import.meta.dirname,
        "../..",
        "client",
        "index.html"
      );

      // always reload the index.html file from disk incase it changes
      let template = await fs.promises.readFile(clientTemplate, "utf-8");
      template = template.replace(
        `src="/src/main.tsx"`,
        `src="/src/main.tsx?v=${nanoid()}"`
      );
      const page = await vite.transformIndexHtml(url, template);
      res.status(200).set({ "Content-Type": "text/html" }).end(page);
    } catch (e) {
      vite.ssrFixStacktrace(e as Error);
      next(e);
    }
  });
}

export function serveStatic(app: Express) {
  const distPath =
    process.env.NODE_ENV === "development"
      ? path.resolve(import.meta.dirname, "../..", "dist", "public")
      : path.resolve(import.meta.dirname, "public");
  if (!fs.existsSync(distPath)) {
    console.error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`
    );
  }

  app.use(express.static(distPath));

  // Read once, at startup, rather than on every request.
  //
  // sendFile went to disk for each client-side route a visitor opened, for a
  // file that cannot change while the process runs — the bundle is built before
  // `pnpm start`. That is an unbounded filesystem read driven by anonymous
  // traffic, which is what CodeQL's js/missing-rate-limiting reported here.
  // Caching removes the read instead of capping it, which is the better answer:
  // a rate limit on this path would mean 429s on ordinary page loads.
  //
  // null when the client was never built. The error above has already said so;
  // falling through to a 404 beats failing to boot.
  let indexHtml: string | null = null;
  try {
    indexHtml = fs.readFileSync(path.resolve(distPath, "index.html"), "utf-8");
  } catch {
    indexHtml = null;
  }

  // Fall through to index.html — but only for something that is actually a
  // page request.
  //
  // A blanket fallback answers *every* unmatched path with HTML, including a
  // missing asset, and the browser then tries to parse index.html as
  // JavaScript: "Unexpected token '<'". That is how a 404 turns into a
  // confusing syntax error with no hint of which file is missing. Requiring
  // the request to accept HTML keeps client-side routes working and lets a
  // genuinely missing asset return a genuine 404.
  app.use((req, res, next) => {
    if (req.method !== "GET" && req.method !== "HEAD") return next();

    // Deliberately not req.accepts("html"): a browser asks for a script with
    // `Accept: */*`, which matches text/html and would sail straight through.
    // Only a navigation names text/html explicitly.
    if (!req.headers.accept?.includes("text/html")) return next();
    if (indexHtml === null) return next();

    // send() sets the content type and an ETag, so conditional requests behave
    // as they did under sendFile.
    res.type("html").send(indexHtml);
  });
}
