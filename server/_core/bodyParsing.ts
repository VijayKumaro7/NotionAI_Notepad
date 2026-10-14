import express, { type Express } from "express";
import { createApiRateLimits } from "./apiRateLimit";

// The rate limit and the body parsers, in the one order that works: the parsers
// read and parse a body before anything else sees the request, so a limit
// mounted after them counts a request only once its body, up to 25MB of it, has
// already been paid for. See apiRateLimit.ts.
export function registerBodyParsing(
  app: Express,
  options: { rateLimit?: number; syncRateLimit?: number } = {}
) {
  app.use(
    createApiRateLimits({
      limit: options.rateLimit,
      syncLimit: options.syncRateLimit,
    })
  );

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
}
