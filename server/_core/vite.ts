import express, { type Express } from "express";
import fs from "fs";
import { type Server } from "http";
import { nanoid } from "nanoid";
import path from "path";
import { createServer as createViteServer } from "vite";
import viteConfig from "../../vite.config";

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
  app.use(async (req, res, next) => {
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

    res.sendFile(path.resolve(distPath, "index.html"));
  });
}
