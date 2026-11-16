/**
 * Leave on SIGTERM the way a deploy needs: stop taking connections, finish what
 * is in flight, write what is waiting, then exit 0.
 *
 * Without a handler Node dies on the signal at once. A restart then cut off
 * requests mid-answer, and, worse, dropped a collaborative edit that had been
 * shown to the other people in the room but was still inside its save debounce.
 *
 * A deadline keeps a stuck connection from holding the deploy: past it the
 * remaining connections are destroyed and the exit is non-zero, so a supervisor
 * can tell the drain did not finish. A second signal exits at once.
 */

import type { Server } from "http";

export const SHUTDOWN_GRACE_MS = 10_000;

type Signals = "SIGTERM" | "SIGINT";

export function installGracefulShutdown(
  server: Pick<
    Server,
    "close" | "closeIdleConnections" | "closeAllConnections"
  >,
  options: {
    /** Runs once the server stops listening; flush and close what it does not own. */
    drain: () => Promise<void>;
    graceMs?: number;
    proc?: Pick<NodeJS.Process, "on" | "exit">;
  }
): void {
  const proc = options.proc ?? process;
  const graceMs = options.graceMs ?? SHUTDOWN_GRACE_MS;
  let started = false;

  const begin = (signal: Signals) => {
    if (started) {
      console.error("[Shutdown] %s again, exiting now", signal);
      proc.exit(1);
      return;
    }
    started = true;
    console.log("[Shutdown] %s, draining", signal);

    const deadline = setTimeout(() => {
      console.error("[Shutdown] Not finished in %dms, forcing", graceMs);
      server.closeAllConnections();
      proc.exit(1);
    }, graceMs);

    let failed = false;
    const stopped = new Promise<void>(resolve => {
      server.close(error => {
        if (error) failed = true;
        resolve();
      });
      server.closeIdleConnections();
    });
    const drained = options.drain().catch(error => {
      failed = true;
      console.error("[Shutdown] Drain failed", error);
    });

    void Promise.all([stopped, drained]).then(() => {
      clearTimeout(deadline);
      console.log("[Shutdown] Done");
      proc.exit(failed ? 1 : 0);
    });
  };

  proc.on("SIGTERM", () => begin("SIGTERM"));
  proc.on("SIGINT", () => begin("SIGINT"));
}
