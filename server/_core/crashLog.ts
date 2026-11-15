/**
 * Say why the process is dying, then die exactly as Node would have.
 *
 * Node's default for an unhandled rejection or an uncaught exception is to print
 * the error and exit with code 1. This module keeps that outcome and changes
 * only what is written on the way out: one JSON line (`"event":"fatal"`) a log
 * drain can match, and, for the few failures this app has run into, a hint
 * naming the setting that caused it.
 *
 * It deliberately does not keep the process alive. After an error nobody
 * expected, the server's state is unknown, and carrying on is how a half-broken
 * server keeps answering requests. Restarting is the supervisor's job (Render
 * restarts a process that exits non-zero).
 *
 * The line carries what Node would have printed, the error's name, code,
 * message and stack, and nothing else: no environment, no request, no
 * configuration. A message can repeat a value the operator typed (the AWS SDK's
 * says `got <value>`), exactly as Node's own output does, so this adds no
 * exposure, but it is why the hint names a setting and never repeats a value.
 */

export type CrashKind = "unhandledRejection" | "uncaughtException";

export interface CrashRecord {
  event: "fatal";
  kind: CrashKind;
  name: string;
  code?: string;
  message: string;
  hint?: string;
  stack?: string;
}

// Failures this app has hit, matched on the message the library throws, which is
// all there is to go on: both come out of a promise the AWS client starts for
// itself, with nothing in the stack that points at the setting.
const HINTS: { match: RegExp; hint: (m: RegExpMatchArray) => string }[] = [
  {
    match: /Invalid parameter for "defaultsMode"/,
    hint: () =>
      "The AWS SDK rejected AWS_DEFAULTS_MODE (or defaults_mode in the shared AWS config): it takes auto, standard, in-region, cross-region, mobile or legacy, and an empty value is invalid. Fix or remove it; the startup warning for AWS_DEFAULTS_MODE says the same.",
  },
  {
    match:
      /Cannot load (?:ENV|CONFIG) "([A-Za-z0-9_]+)"\. Expected "true" or "false"/i,
    hint: m =>
      `The AWS SDK needs ${m[1]} to be exactly true or false (lower case) and it is something else. Fix or remove it.`,
  },
];

function asText(value: unknown): string {
  try {
    return typeof value === "string" ? value : String(value);
  } catch {
    return "(unprintable)";
  }
}

export function describeCrash(kind: CrashKind, reason: unknown): CrashRecord {
  let name = "NonErrorThrown";
  let message = "";
  let code: string | undefined;
  let stack: string | undefined;
  try {
    if (reason instanceof Error) {
      name = reason.name;
      message = reason.message;
      stack = reason.stack;
      const c = (reason as { code?: unknown }).code;
      if (typeof c === "string") {
        code = c;
      }
    } else if (reason !== null && typeof reason === "object") {
      message = asText(
        (reason as { message?: unknown }).message ?? JSON.stringify(reason)
      );
    } else {
      message = asText(reason);
    }
  } catch {
    message = "(the error could not be read)";
  }
  const record: CrashRecord = { event: "fatal", kind, name, message };
  if (code !== undefined) {
    record.code = code;
  }
  for (const { match, hint } of HINTS) {
    const found = message.match(match);
    if (found) {
      record.hint = hint(found);
      break;
    }
  }
  if (stack !== undefined) {
    record.stack = stack;
  }
  return record;
}

/** A human line first, then the JSON, so both a person and a log drain can read it. */
export function crashLine(kind: CrashKind, reason: unknown): string {
  const record = describeCrash(kind, reason);
  const human = `[Fatal] ${kind === "unhandledRejection" ? "Unhandled rejection" : "Uncaught exception"}: ${record.name}: ${record.message}${record.hint ? `\n[Fatal] ${record.hint}` : ""}`;
  return `${human}\n${JSON.stringify(record)}\n`;
}

const INSTALLED = Symbol.for("notionai.crashLogging");

/**
 * Takes the process as an argument so a test can hand it a stand-in. Installing
 * twice on the same process does nothing the second time.
 */
export function installCrashLogging(
  proc: Pick<NodeJS.Process, "on" | "exit"> & {
    stderr: { write: (chunk: string, cb?: () => void) => unknown };
  } = process
): void {
  const marked = proc as unknown as Record<symbol, boolean>;
  if (marked[INSTALLED]) {
    return;
  }
  marked[INSTALLED] = true;

  const die = (kind: CrashKind, reason: unknown) => {
    let line: string;
    try {
      line = crashLine(kind, reason);
    } catch {
      line = `[Fatal] ${kind}\n`;
    }
    // Exit once the line is out, but never wait forever on a blocked stderr.
    const timer = setTimeout(() => proc.exit(1), 1000);
    timer.unref?.();
    try {
      proc.stderr.write(line, () => proc.exit(1));
    } catch {
      proc.exit(1);
    }
  };

  proc.on("unhandledRejection", reason => die("unhandledRejection", reason));
  proc.on("uncaughtException", error => die("uncaughtException", error));
}
