import "dotenv/config";
import express, { type Request } from "express";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { createServer } from "http";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { registerGoogleRoutes } from "../googleRoutes";
import { registerCollaborationServer } from "./collaboration";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { clientAddress } from "../demoLimit";
import { requireHttps, securityHeaders } from "./securityHeaders";
import { serveStatic, setupVite } from "./vite";

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}

async function findAvailablePort(startPort: number = 3000): Promise<number> {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting from ${startPort}`);
}

async function resolvePort(): Promise<number> {
  const preferredPort = parseInt(process.env.PORT || "3000");

  // A managed host assigns PORT and routes to exactly that port, so scanning
  // past a busy one there just makes the deploy fail its health check with no
  // obvious cause. Only hunt for a free port in local development.
  if (process.env.NODE_ENV === "production") {
    return preferredPort;
  }

  const port = await findAvailablePort(preferredPort);
  if (port !== preferredPort) {
    console.log(`Port ${preferredPort} is busy, using port ${port} instead`);
  }
  return port;
}

async function startServer() {
  const app = express();
  const server = createServer(app);
  // Before anything that answers: a redirect must not be served over the plain
  // connection it is telling the browser to stop using, and the headers have to
  // be on every response, including the error ones.
  app.use(requireHttps);
  app.use(securityHeaders);
  // Express advertises itself in a header otherwise, which tells an attacker
  // which CVEs to try first and tells nobody else anything.
  app.disable("x-powered-by");
  // Big enough for the largest thing the app legitimately sends — a voice memo
  // is capped at 16MB of audio, and base64 adds a third, so ~22MB — and no
  // bigger. The old 50mb was twice what anything could use, and a body limit is
  // the ceiling on what one anonymous request can make this process allocate:
  // the body is parsed before any procedure decides whether the caller is
  // signed in.
  app.use(express.json({ limit: "25mb" }));
  // Nothing here posts a form. urlencoded stays mounted because express's
  // parsers are cheap to keep and expensive to discover missing, but it gets
  // the small limit that matches what a form would carry.
  app.use(express.urlencoded({ limit: "100kb", extended: true }));
  // OAuth callback under /api/oauth/callback
  registerOAuthRoutes(app);
  // Google sign-in redirect endpoints under /api/auth/google/*
  registerGoogleRoutes(app);
  // Real-time collaboration WebSocket under /api/collaborate
  registerCollaborationServer(server);
  // A ceiling on how hard one address can hammer the API.
  //
  // The per-user limits elsewhere (rateLimit.ts) are the ones that matter for
  // anything that spends money, and they are keyed on an account. This is the
  // other half: an anonymous flood of sign-in attempts, share-link lookups or
  // demo starts never reaches a procedure that knows who is calling. Six
  // hundred a minute is far above what the app generates in normal use — the
  // editor syncs over the WebSocket, not through here.
  const apiRateLimit = rateLimit({
    windowMs: 60 * 1000,
    limit: 600,
    // Not `req.ip`: this app does not set `trust proxy`, so that would be the
    // proxy's address and every visitor would share one bucket. See the note
    // on the same pair in server/googleRoutes.ts.
    keyGenerator: (req: Request) => ipKeyGenerator(clientAddress(req)),
    standardHeaders: "draft-7",
    legacyHeaders: false,
    validate: { xForwardedForHeader: false },
  });

  // tRPC API
  app.use(
    "/api/trpc",
    apiRateLimit,
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );
  // development mode uses Vite, production mode uses static files
  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const port = await resolvePort();

  server.on("error", (error: NodeJS.ErrnoException) => {
    if (error.code === "EADDRINUSE") {
      console.error(`[Server] Port ${port} is already in use.`);
    } else {
      console.error("[Server] Failed to start", error);
    }
    process.exit(1);
  });

  server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}/`);
  });
}

// Exit non-zero, not just loudly. `.catch(console.error)` alone logged the
// failure and then let node exit 0 with nothing listening, so a process manager
// saw a clean shutdown and a health check was the only thing left to notice.
startServer().catch(error => {
  console.error("[Server] Failed to start", error);
  process.exit(1);
});
