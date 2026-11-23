/**
 * What the MySQL pool does with a connection nobody is using.
 *
 * Left to mysql2's defaults, nothing. Its idle reaper only runs when `maxIdle`
 * is below `connectionLimit`, and `maxIdle` defaults to the limit, so
 * `idleTimeout` never fires and a connection lives as long as the socket does.
 * TCP keep-alive is on but with no initial delay set, which means the
 * operating system's: two hours on Linux. A managed MySQL, a proxy in front of
 * it or a NAT in between commonly drops an idle connection after a few
 * minutes, so after a quiet stretch the pool still held sockets that were
 * already dead, and the first request to reach one failed.
 *
 * Reaping at a minute is under every common idle limit (a NAT gateway's, a
 * cloud load balancer's, a proxy's), so the pool drops a connection before
 * anything else can, and the next query opens a fresh one. Keep-alive probes
 * from ten seconds keep a connection that is in use but quiet, such as a long
 * transaction, from being cut the same way.
 *
 * The URL is passed as `uri`, the way drizzle does for a bare string, so
 * `ssl=` and the rest are read exactly as before.
 */
export const DB_POOL_OPTIONS = {
  maxIdle: 5,
  idleTimeout: 60_000,
  keepAliveInitialDelay: 10_000,
} as const;

export function dbConnection(url: string) {
  return { uri: url, ...DB_POOL_OPTIONS };
}
