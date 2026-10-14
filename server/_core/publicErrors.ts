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

  if (code >= 500) {
    console.error("[Express] %s %s:", req.method, req.path, err);
  } else {
    // A 4xx is the caller's mistake, so what it says goes no further than the
    // kind: body-parser's own `type` where it set one, the class name where it
    // did not. Never the message, which can quote the request body, and a body
    // is where a password would be.
    const kind = typeof err?.type === "string" ? err.type : err?.name;
    console.warn(
      "[Express] %s %s -> %d (%s)",
      req.method,
      req.path,
      code,
      typeof kind === "string" ? kind : "Error"
    );
  }

  res
    .status(code)
    .type("text/plain")
    .send(STATUS_CODES[code] ?? "Error");
};
