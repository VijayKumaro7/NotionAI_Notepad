import { STATUS_CODES } from "node:http";
import type { ErrorRequestHandler } from "express";

// Express's own handler decides what to say by NODE_ENV: "Bad Request" under
// production, the whole stack trace (with file paths) under anything else. A
// body-parser failure or an uncaught throw should look the same wherever the
// server happens to be running, so this answers with the status and its
// standard text and nothing the error said.
export const publicErrors: ErrorRequestHandler = (err, req, res, next) => {
  // Once a response has started there is no status left to choose; Express's
  // handler knows how to close the connection.
  if (res.headersSent) {
    next(err);
    return;
  }

  const status = [err?.status, err?.statusCode].find(
    (code): code is number =>
      typeof code === "number" && code >= 400 && code <= 599
  );
  const code = status ?? 500;

  // A 4xx is the caller's mistake and says nothing about this server. A 5xx is
  // ours, and without this line nothing would record it.
  if (code >= 500) {
    console.error("[Express] %s %s:", req.method, req.path, err);
  }

  res
    .status(code)
    .type("text/plain")
    .send(STATUS_CODES[code] ?? "Error");
};
