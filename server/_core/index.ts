import "dotenv/config";
import express from "express";
import { createServer } from "http";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { registerCollaborationServer } from "./collaboration";
import { appRouter } from "../routers";
import { createContext } from "./context";
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
  // Configure body parser with larger size limit for file uploads
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));
  // OAuth callback under /api/oauth/callback
  registerOAuthRoutes(app);
  // Real-time collaboration WebSocket under /api/collaborate
  registerCollaborationServer(server);
  // tRPC API
  app.use(
    "/api/trpc",
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
