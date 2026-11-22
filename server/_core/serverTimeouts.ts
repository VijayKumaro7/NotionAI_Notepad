import type { Server } from "http";

/**
 * How long this server keeps an idle connection open, set past what a proxy in
 * front of it will keep.
 *
 * Node closes an idle keep-alive connection after 5 seconds. A reverse proxy
 * (the nginx in `deploy/nginx`, which holds up to 32 idle upstream connections
 * for about a minute; a load balancer's 60 second idle timeout is the usual
 * figure elsewhere) reuses its connection whenever it likes, so a request it
 * sends in the instant after Node closed the socket meets a reset and the
 * caller gets a 502. Having the server outlast the proxy means the proxy is
 * always the one to close, and that race cannot happen.
 */
export const KEEP_ALIVE_TIMEOUT_MS = 65_000;

/**
 * Node's own guidance is that this must exceed `keepAliveTimeout`: the headers
 * timer can otherwise cut a connection that is idle by design.
 */
export const HEADERS_TIMEOUT_MS = KEEP_ALIVE_TIMEOUT_MS + 1_000;

export function applyServerTimeouts(
  server: Pick<Server, "keepAliveTimeout" | "headersTimeout">
): void {
  server.keepAliveTimeout = KEEP_ALIVE_TIMEOUT_MS;
  server.headersTimeout = HEADERS_TIMEOUT_MS;
}
