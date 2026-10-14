import type { Request } from "express";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { clientAddress } from "../demoLimit";

// What body-parser itself goes by: a chunked upload, or a Content-Length that
// says there is something to read.
export const hasBody = (req: Request) =>
  req.headers["transfer-encoding"] !== undefined ||
  Number(req.headers["content-length"] ?? 0) > 0;

const isApi = (req: Request) =>
  req.path === "/api/trpc" || req.path.startsWith("/api/trpc/");

// A ceiling on how hard one address can hammer the API.
//
// The per-user limits elsewhere (rateLimit.ts) are the ones that matter for
// anything that spends money, and they are keyed on an account. This is the
// other half: an anonymous flood of sign-in attempts, share-link lookups or
// demo starts never reaches a procedure that knows who is calling. Six
// hundred a minute is far above what the app generates in normal use — the
// editor syncs over the WebSocket, not through here.
//
// It has to sit in front of the body parsers. Mounted after them, a request is
// read and parsed, up to 25MB of it, before anything counts it, so the limit
// does nothing about the part that costs the most. It also counts any request
// that carries a body, whatever the path: the parsers run on every route, and
// a large POST to a path that does not exist is buffered and then answered
// with a 404.
export function createApiRateLimit(limit = 600) {
  return rateLimit({
    windowMs: 60 * 1000,
    limit,
    skip: req => !(isApi(req) || hasBody(req)),
    // Not `req.ip`: this app does not set `trust proxy`, so that would be the
    // proxy's address and every visitor would share one bucket. See the note
    // on the same pair in server/googleRoutes.ts.
    keyGenerator: (req: Request) => ipKeyGenerator(clientAddress(req)),
    standardHeaders: "draft-7",
    legacyHeaders: false,
    validate: { xForwardedForHeader: false },
  });
}
