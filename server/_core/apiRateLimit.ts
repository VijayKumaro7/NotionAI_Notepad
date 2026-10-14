import type { Request } from "express";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { clientAddress } from "../demoLimit";
import { sdk } from "./sdk";

// What body-parser itself goes by: a chunked upload, or a Content-Length that
// says there is something to read.
export const hasBody = (req: Request) =>
  req.headers["transfer-encoding"] !== undefined ||
  Number(req.headers["content-length"] ?? 0) > 0;

const isApi = (req: Request) =>
  req.path === "/api/trpc" || req.path.startsWith("/api/trpc/");

// The two procedures a sync is made of. It pushes one note per request, one
// after another, so a first sync of a large workspace is a burst that the
// general ceiling was never sized for.
export const SYNC_PROCEDURES = new Set(["notes.push", "notes.pull"]);

// True when every procedure named in the path is a sync one. A batched call
// joins its procedures with commas, and one that also names anything else is
// not a sync request.
export function isSyncPath(req: Request): boolean {
  if (!isApi(req)) return false;
  const raw = req.path.slice("/api/trpc/".length);
  if (!raw) return false;
  let names: string[];
  try {
    names = decodeURIComponent(raw).split(",");
  } catch {
    return false;
  }
  return names.every(name => SYNC_PROCEDURES.has(name));
}

type Class = "sync" | "general" | "none";
const classes = new WeakMap<Request, Promise<Class>>();

// Which bucket a request counts against, worked out once for both limiters.
//
// The sync bucket is higher, so it is only for a caller who can show a session:
// a token with a valid signature and the full scope. That is the signature
// alone and not the session store, because this runs before the body is read
// and a database call per request would be a cost of its own; a token that has
// been revoked but not expired is still refused, later, by authentication.
// Anyone else asking for a sync procedure counts against the general ceiling,
// as before.
function classify(req: Request): Promise<Class> {
  let result = classes.get(req);
  if (!result) {
    result = (async (): Promise<Class> => {
      if (isSyncPath(req)) {
        const session = await sdk.verifySession(sdk.readSessionCookie(req), {
          quiet: true,
        });
        if (session && session.scope === "full" && session.sid) return "sync";
      }
      return isApi(req) || hasBody(req) ? "general" : "none";
    })();
    classes.set(req, result);
  }
  return result;
}

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
//
// Two limiters, each a plain rateLimit() so it can be mounted directly, and
// each request is counted by exactly one of them. Both are keyed on the
// address and not the account: keying the higher one on the account would let
// one address with many accounts multiply its ceiling.
export function createApiRateLimits(
  options: { limit?: number; syncLimit?: number } = {}
) {
  const { limit = 600, syncLimit = 3000 } = options;
  const shared = {
    windowMs: 60 * 1000,
    // Not `req.ip`: this app does not set `trust proxy`, so that would be the
    // proxy's address and every visitor would share one bucket. See the note
    // on the same pair in server/googleRoutes.ts.
    keyGenerator: (req: Request) => ipKeyGenerator(clientAddress(req)),
    standardHeaders: "draft-7" as const,
    legacyHeaders: false,
    validate: { xForwardedForHeader: false },
  };

  return [
    rateLimit({
      ...shared,
      limit: syncLimit,
      skip: async req => (await classify(req)) !== "sync",
    }),
    rateLimit({
      ...shared,
      limit,
      skip: async req => (await classify(req)) !== "general",
    }),
  ];
}
