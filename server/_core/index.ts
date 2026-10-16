import "dotenv/config";
import express from "express";
import { createServer } from "http";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { registerGoogleRoutes } from "../googleRoutes";
import { registerCollaborationServer } from "./collaboration";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { assertStartupConfig } from "./startupChecks";
import { registerBodyParsing } from "./bodyParsing";
import { requireSameOrigin } from "./csrf";
import { publicErrors } from "./publicErrors";
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
  // Before anything is created or bound: a server that cannot work should not
  // get as far as accepting a connection.
  assertStartupConfig();
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
  registerBodyParsing(app);
  // OAuth callback under /api/oauth/callback
  registerOAuthRoutes(app);
  // Google sign-in redirect endpoints under /api/auth/google/*
  registerGoogleRoutes(app);
  // Real-time collaboration WebSocket under /api/collaborate
  registerCollaborationServer(server);
  // tRPC API
  //
  // requireSameOrigin before the router, not inside a procedure: a mutation
  // that another site provoked should be refused before it reaches anything
  // that could act on it, and putting the check at the mount point means a
  // procedure added later is covered without anyone remembering to cover it.
  app.use(
    "/api/trpc",
    requireSameOrigin,
    createExpressMiddleware({
      router: appRouter,
      createContext,
      onError({ error, path }) {
        // What the browser is no longer told still has to be somewhere.
        if (error.code === "INTERNAL_SERVER_ERROR") {
          console.error(
            "[tRPC] %s:",
            path ?? "<no path>",
            error.cause ?? error
          );
        }
      },
    })
  );
  // development mode uses Vite, production mode uses static files
  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
    // Last, because Express runs an error handler only for what comes before
    // it. Not in development, where the stack trace is what Vite's overlay and
    // the person at the keyboard want.
    app.use(publicErrors);
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
