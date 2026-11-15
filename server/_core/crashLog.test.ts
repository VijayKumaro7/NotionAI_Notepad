import { afterEach, describe, expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  crashLine,
  describeCrash,
  installCrashLogging,
  type CrashKind,
} from "./crashLog";

type Listener = (arg: unknown) => void;

function fakeProcess() {
  const listeners = new Map<string, Listener[]>();
  const written: string[] = [];
  const exits: number[] = [];
  let flush: (() => void) | undefined;
  const proc = {
    on(event: string, listener: Listener) {
      listeners.set(event, [...(listeners.get(event) ?? []), listener]);
      return proc;
    },
    exit(code?: number) {
      exits.push(code ?? 0);
      return undefined as never;
    },
    stderr: {
      write(chunk: string, cb?: () => void) {
        written.push(chunk);
        flush = cb;
        return true;
      },
    },
  };
  return {
    proc: proc as unknown as Parameters<typeof installCrashLogging>[0],
    emit(event: string, arg: unknown) {
      for (const l of listeners.get(event) ?? []) l(arg);
    },
    count(event: string) {
      return (listeners.get(event) ?? []).length;
    },
    written,
    exits,
    finishWrite() {
      flush?.();
    },
  };
}

describe("describeCrash", () => {
  it("records an Error's name, message, code and stack, and marks it fatal", () => {
    const error = Object.assign(new TypeError("bad thing"), { code: "E_BAD" });
    const record = describeCrash("unhandledRejection", error);
    expect(record).toMatchObject({
      event: "fatal",
      kind: "unhandledRejection",
      name: "TypeError",
      message: "bad thing",
      code: "E_BAD",
    });
    expect(record.stack).toContain("TypeError: bad thing");
    expect(record.hint).toBeUndefined();
  });

  it("leaves code out when the error has none, or has a non-string one", () => {
    expect("code" in describeCrash("uncaughtException", new Error("x"))).toBe(
      false
    );
    const numeric = Object.assign(new Error("x"), { code: 42 });
    expect("code" in describeCrash("uncaughtException", numeric)).toBe(false);
  });

  it.each([
    ["a string", "plain string", "plain string"],
    ["undefined", undefined, "undefined"],
    ["null", null, "null"],
    ["a number", 7, "7"],
    ["an object with a message", { message: "from object" }, "from object"],
    ["an object without one", { a: 1 }, '{"a":1}'],
  ])("describes a non-Error rejection: %s", (_label, reason, message) => {
    const record = describeCrash("unhandledRejection", reason);
    expect(record.name).toBe("NonErrorThrown");
    expect(record.message).toBe(message);
    expect(record.stack).toBeUndefined();
  });

  it("never throws, whatever it is handed", () => {
    const hostile = new Proxy(
      {},
      {
        get() {
          throw new Error("no");
        },
        ownKeys() {
          throw new Error("no");
        },
      }
    );
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    for (const reason of [hostile, circular, Symbol("s"), BigInt(5)]) {
      expect(() => describeCrash("unhandledRejection", reason)).not.toThrow();
      expect(() => crashLine("uncaughtException", reason)).not.toThrow();
    }
  });

  it("names AWS_DEFAULTS_MODE for the SDK's defaultsMode error, without repeating the value", () => {
    const sdk = new Error(
      'Invalid parameter for "defaultsMode", expect in-region, cross-region, mobile, standard, legacy, got secret-junk-mode'
    );
    const record = describeCrash("unhandledRejection", sdk);
    expect(record.hint).toContain("AWS_DEFAULTS_MODE");
    expect(record.hint).toContain("defaults_mode in the shared AWS config");
    expect(record.hint).not.toContain("secret-junk");
  });

  it("names the setting for the SDK's true-or-false error, in either source", () => {
    for (const source of ["ENV", "CONFIG"]) {
      const sdk = new Error(
        `Cannot load ${source} "AWS_DISABLE_CLOCK_SKEW_CORRECTION". Expected "true" or "false", got yes.`
      );
      const record = describeCrash("unhandledRejection", sdk);
      expect(record.hint).toContain("AWS_DISABLE_CLOCK_SKEW_CORRECTION");
      expect(record.hint).toContain("exactly true or false");
      expect(record.hint).not.toContain("got yes");
    }
  });

  it("matches the true-or-false error whatever its letter case", () => {
    const sdk = new Error(
      'cannot load env "AWS_X_Y". expected "true" or "false", got 1'
    );
    expect(describeCrash("unhandledRejection", sdk).hint).toContain("AWS_X_Y");
  });

  it("adds no hint to an error it does not recognise", () => {
    expect(
      describeCrash("unhandledRejection", new Error("Invalid parameter")).hint
    ).toBeUndefined();
  });
});

describe("crashLine", () => {
  it("is a human line, then one JSON line, ending in a newline", () => {
    const line = crashLine(
      "unhandledRejection",
      new Error("multi\nline message")
    );
    expect(line.endsWith("\n")).toBe(true);
    const lines = line.trimEnd().split("\n");
    const json = lines[lines.length - 1];
    const parsed = JSON.parse(json);
    expect(parsed.event).toBe("fatal");
    expect(parsed.message).toBe("multi\nline message");
    expect(parsed.stack).toContain("multi");
    expect(json).not.toContain("\n");
    expect(lines[0]).toBe("[Fatal] Unhandled rejection: Error: multi");
  });

  it("labels the two kinds differently, and puts the hint on its own line", () => {
    expect(crashLine("uncaughtException", new Error("x"))).toContain(
      "[Fatal] Uncaught exception: Error: x"
    );
    const sdk = new Error('Invalid parameter for "defaultsMode", got x');
    const lines = crashLine("unhandledRejection", sdk).split("\n");
    expect(lines[1]).toMatch(
      /^\[Fatal\] The AWS SDK rejected AWS_DEFAULTS_MODE/
    );
  });
});

describe("installCrashLogging", () => {
  it.each<[CrashKind]>([["unhandledRejection"], ["uncaughtException"]])(
    "writes the line for %s and exits 1 once the write has finished",
    kind => {
      const fake = fakeProcess();
      installCrashLogging(fake.proc);
      fake.emit(kind, new Error("boom"));
      expect(fake.written).toHaveLength(1);
      expect(fake.written[0]).toContain('"event":"fatal"');
      expect(fake.written[0]).toContain(`"kind":"${kind}"`);
      expect(fake.exits).toEqual([]);
      fake.finishWrite();
      expect(fake.exits).toEqual([1]);
    }
  );

  it("listens for exactly those two events, once each", () => {
    const fake = fakeProcess();
    installCrashLogging(fake.proc);
    expect(fake.count("unhandledRejection")).toBe(1);
    expect(fake.count("uncaughtException")).toBe(1);
  });

  it("does nothing the second time on the same process", () => {
    const fake = fakeProcess();
    installCrashLogging(fake.proc);
    installCrashLogging(fake.proc);
    expect(fake.count("unhandledRejection")).toBe(1);
    expect(fake.count("uncaughtException")).toBe(1);
    fake.emit("unhandledRejection", new Error("once"));
    expect(fake.written).toHaveLength(1);
  });

  describe("with stderr that never finishes writing", () => {
    afterEach(() => vi.useRealTimers());

    it("exits 1 after a second rather than waiting forever", () => {
      vi.useFakeTimers();
      const fake = fakeProcess();
      installCrashLogging(fake.proc);
      fake.emit("unhandledRejection", new Error("boom"));
      vi.advanceTimersByTime(999);
      expect(fake.exits).toEqual([]);
      vi.advanceTimersByTime(1);
      expect(fake.exits).toEqual([1]);
    });
  });

  it("still exits 1 when writing to stderr throws", () => {
    const fake = fakeProcess();
    fake.proc.stderr.write = () => {
      throw new Error("stderr closed");
    };
    installCrashLogging(fake.proc);
    fake.emit("unhandledRejection", new Error("boom"));
    expect(fake.exits).toEqual([1]);
  });

  it("still exits 1 when the reason cannot be described", () => {
    const fake = fakeProcess();
    installCrashLogging(fake.proc);
    const hostile = new Proxy(
      {},
      {
        get() {
          throw new Error("no");
        },
      }
    );
    fake.emit("unhandledRejection", hostile);
    fake.finishWrite();
    expect(fake.exits).toEqual([1]);
    expect(fake.written[0]).toContain("[Fatal]");
  });
});

describe("the entry point installs it before anything can fail", () => {
  const source = readFileSync(resolve(__dirname, "index.ts"), "utf8");

  it("imports it and calls it at the top level, ahead of startServer", () => {
    expect(source).toContain(
      'import { installCrashLogging } from "./crashLog";'
    );
    const call = source.indexOf("\ninstallCrashLogging();");
    expect(call).toBeGreaterThan(-1);
    expect(call).toBeLessThan(source.indexOf("async function startServer"));
    expect(call).toBeLessThan(source.indexOf("startServer().catch"));
  });
});

describe("what a real process does", () => {
  // A child process under tsx, so the real `process` is the one handed in.
  const MODULE = pathToFileURL(resolve(__dirname, "crashLog.ts")).href;
  const run = (
    body: string,
    install: boolean,
    env: Record<string, string> = {}
  ) =>
    spawnSync(
      process.execPath,
      [
        "--import",
        "tsx",
        "-e",
        `(async () => {
          ${install ? `const { installCrashLogging } = await import(${JSON.stringify(MODULE)}); installCrashLogging();` : ""}
          ${body}
        })();`,
      ],
      {
        cwd: resolve(__dirname, "../.."),
        env: {
          PATH: process.env.PATH ?? "",
          AWS_CONFIG_FILE: "/nonexistent/aws/config",
          AWS_SHARED_CREDENTIALS_FILE: "/nonexistent/aws/credentials",
          AWS_EC2_METADATA_DISABLED: "true",
          ...env,
        },
        encoding: "utf8",
      }
    );

  const REJECT = `Promise.reject(new Error("boom")); setTimeout(() => process.exit(0), 800);`;
  const THROW = `setTimeout(() => { throw new Error("late"); }, 20); setTimeout(() => process.exit(0), 800);`;

  it("exits 1 with the line on stderr for an unhandled rejection, as Node does without it", () => {
    const withIt = run(REJECT, true);
    const without = run(REJECT, false);
    expect(without.status).toBe(1);
    expect(withIt.status).toBe(without.status);
    expect(withIt.stderr).toContain("[Fatal] Unhandled rejection: Error: boom");
    expect(withIt.stderr).toContain('"event":"fatal"');
    expect(withIt.stderr).toContain('"kind":"unhandledRejection"');
  });

  it("exits 1 with the line on stderr for an uncaught exception, as Node does without it", () => {
    const withIt = run(THROW, true);
    const without = run(THROW, false);
    expect(without.status).toBe(1);
    expect(withIt.status).toBe(without.status);
    expect(withIt.stderr).toContain("[Fatal] Uncaught exception: Error: late");
    expect(withIt.stderr).toContain('"kind":"uncaughtException"');
  });

  it("does nothing for a rejection that is handled", () => {
    const result = run(
      `Promise.reject(new Error("handled")).catch(() => {}); setTimeout(() => process.exit(0), 300);`,
      true
    );
    expect(result.status).toBe(0);
    expect(result.stderr).not.toContain("[Fatal]");
  });

  describe("with the installed AWS SDK", () => {
    // The failure that motivated this: an invalid AWS_DEFAULTS_MODE throws in a
    // promise the client starts itself, so it is an unhandled rejection even with
    // the send inside a catch.
    const SDK = `
      const s3 = require("@aws-sdk/client-s3");
      const c = new s3.S3Client({ region: "us-east-1", credentials: { accessKeyId: "a", secretAccessKey: "b" } });
      c.middlewareStack.add(next => async () => { throw new Error("stop"); }, { step: "finalizeRequest", name: "p", priority: "low" });
      c.send(new s3.HeadBucketCommand({ Bucket: "b" })).catch(() => {});
      setTimeout(() => process.exit(0), 900);
    `;

    it("names AWS_DEFAULTS_MODE when it is invalid, and still exits 1", () => {
      for (const value of ["bogus", ""]) {
        const result = run(SDK, true, { AWS_DEFAULTS_MODE: value });
        expect([value, result.status]).toEqual([value, 1]);
        expect(result.stderr).toContain(
          "The AWS SDK rejected AWS_DEFAULTS_MODE"
        );
        expect(result.stderr).toContain('"event":"fatal"');
      }
    });

    it("leaves a valid value, and no value, alone", () => {
      for (const env of [{ AWS_DEFAULTS_MODE: "standard" }, {}]) {
        const result = run(SDK, true, env);
        expect([env, result.status]).toEqual([env, 0]);
        expect(result.stderr).not.toContain("[Fatal]");
      }
    });
  });
});
