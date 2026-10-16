import { describe, expect, it } from "vitest";
import {
  MIN_SECRET_LENGTH,
  assertStartupConfig,
  configProblems,
  configWarnings,
  databaseUrlProblem,
  secretWeaknesses,
} from "./startupChecks";

const DB = "mysql://user:pass@db.example.com:3306/notes";
// Seeded, so a result is a fact about the rule and not about luck, and so no
// secret-shaped literal sits in the repo for a scanner to trip on.
function seeded(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const HEX = "0123456789abcdef";
const BASE64 =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const pick = (rand: () => number, alphabet: string, length: number) =>
  Array.from(
    { length },
    () => alphabet[Math.floor(rand() * alphabet.length)]
  ).join("");
const random = (length: number, seed = 1, alphabet = HEX) =>
  pick(seeded(seed), alphabet, length);
const GOOD = random(64);

const env = (
  overrides: Partial<Parameters<typeof configProblems>[0]> = {}
) => ({
  databaseUrl: DB,
  appId: "my-app",
  cookieSecret: GOOD,
  ...overrides,
});

describe("configProblems", () => {
  it("has nothing to say about a server with no database, which cannot sign anyone in", () => {
    // How smoke, the e2e suite and a static deploy run.
    expect(
      configProblems({ databaseUrl: "", appId: "", cookieSecret: "" })
    ).toEqual([]);
  });

  it("has nothing to say when there is a database, an app id and a secret", () => {
    expect(configProblems(env())).toEqual([]);
  });

  it("has nothing to say about an app id or a secret with no database", () => {
    expect(configProblems(env({ databaseUrl: "" }))).toEqual([]);
    expect(
      configProblems({ databaseUrl: "", appId: "", cookieSecret: GOOD })
    ).toEqual([]);
  });

  describe("VITE_APP_ID", () => {
    it("is named when there is a database and no app id", () => {
      const problems = configProblems(env({ appId: "" }));
      expect(problems).toHaveLength(1);
      expect(problems[0]).toMatch(/VITE_APP_ID/);
      expect(problems[0]).toMatch(/DATABASE_URL/);
    });

    it("counts as missing when it is only whitespace", () => {
      expect(configProblems(env({ appId: "   " }))).toHaveLength(1);
    });
  });

  describe("JWT_SECRET", () => {
    it("is named when there is a database and no secret", () => {
      const problems = configProblems(env({ cookieSecret: "" }));
      expect(problems).toHaveLength(1);
      expect(problems[0]).toMatch(/JWT_SECRET/);
      expect(problems[0]).toMatch(/DATABASE_URL/);
    });

    it("counts as missing when it is only whitespace, which the signer would otherwise accept as a one-byte key", () => {
      expect(configProblems(env({ cookieSecret: " \t " }))).toHaveLength(1);
    });

    it("says what changing it costs, so nobody is surprised by the advice", () => {
      expect(configProblems(env({ cookieSecret: "" }))[0]).toMatch(
        /signs everyone out/
      );
    });
  });

  it("reports both when both are missing", () => {
    const problems = configProblems(env({ appId: "", cookieSecret: "" }));
    expect(problems).toHaveLength(2);
    expect(problems.join(" ")).toMatch(/JWT_SECRET/);
    expect(problems.join(" ")).toMatch(/VITE_APP_ID/);
  });

  it("treats a database URL that is only whitespace as no database", () => {
    expect(
      configProblems({ databaseUrl: "  ", appId: "", cookieSecret: "" })
    ).toEqual([]);
  });

  it("never repeats the database URL or the secret, which are credentials", () => {
    const text = JSON.stringify(
      configProblems(env({ appId: "", cookieSecret: " " }))
    );
    expect(text).not.toContain("pass");
    expect(text).not.toContain("db.example.com");
    expect(text).not.toContain(GOOD);
  });
});

describe("DATABASE_URL", () => {
  const PW = "hunter2-not-a-real-password";
  const REASONS: Record<string, string> = {
    "not a url": "not a valid URL",
    localhost: "not a valid URL",
    "mysql://u:p@h:abc/db": "not a valid URL",
    [`"mysql://u:${PW}@h/db"`]: "begins or ends with a quote",
    [`postgres://u:${PW}@h:5432/db`]: "mysql:// scheme",
    [`root:${PW}@h/db`]: "mysql:// scheme",
    [`mysql://u:${PW}@h:3306`]: "does not name a database",
    [`mysql://u:${PW}@h:3306/`]: "does not name a database",
  };

  it.each(Object.entries(REASONS))("refuses %s", (url, reason) => {
    const problems = configProblems(env({ databaseUrl: url }));
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/DATABASE_URL/);
    expect(problems[0]).toContain(reason);
  });

  it.each([
    "mysql://u:p@localhost:3306/db",
    "mysql://localhost/db",
    "mysql2://u:p@h/db",
    "mysql://u:p%40x@h:3306/db",
    "mysql://u:p@h:3306/db?connectionLimit=5",
    " mysql://u:p@h:3306/db ",
    "MYSQL://u:p@h/db",
  ])("accepts %s", url => {
    expect(configProblems(env({ databaseUrl: url }))).toEqual([]);
    expect(databaseUrlProblem(url)).toBeNull();
  });

  it("is not checked when there is no database, which is a supported way to run", () => {
    expect(
      configProblems({ databaseUrl: "", appId: "", cookieSecret: "" })
    ).toEqual([]);
    expect(
      configProblems({ databaseUrl: "   ", appId: "", cookieSecret: "" })
    ).toEqual([]);
  });

  it("never repeats any part of the value, which holds the password and the host", () => {
    for (const url of Object.keys(REASONS)) {
      const text = JSON.stringify(configProblems(env({ databaseUrl: url })));
      expect(text).not.toContain(PW);
      expect(text).not.toContain("hunter2");
      expect(text).not.toContain("root:");
      expect(text).not.toContain("postgres");
    }
  });

  it("is reported alongside the other problems, not instead of them", () => {
    const problems = configProblems(
      env({ databaseUrl: "not a url", appId: "", cookieSecret: "" })
    );
    expect(problems).toHaveLength(3);
  });

  it("stops the server when it is malformed", () => {
    expect(() => assertStartupConfig(env({ databaseUrl: "nope" }))).toThrow(
      /DATABASE_URL/
    );
  });
});

describe("assertStartupConfig", () => {
  it("returns quietly when the configuration can work", () => {
    expect(() =>
      assertStartupConfig({ databaseUrl: "", appId: "", cookieSecret: "" })
    ).not.toThrow();
    expect(() => assertStartupConfig(env())).not.toThrow();
  });

  it("throws an error that lists every problem", () => {
    expect(() =>
      assertStartupConfig(env({ appId: "", cookieSecret: "" }))
    ).toThrow(/Invalid configuration:[\s\S]*JWT_SECRET[\s\S]*VITE_APP_ID/);
  });
});

describe("configWarnings", () => {
  const of = (length: number) => random(length, 7);

  it("has nothing to say about a server with no database, whatever the secret", () => {
    expect(
      configWarnings({ databaseUrl: "", appId: "", cookieSecret: "short" })
    ).toEqual([]);
  });

  it("has nothing to say about a secret that is long enough", () => {
    expect(configWarnings(env())).toEqual([]);
  });

  it("draws the line at exactly the minimum length", () => {
    expect(MIN_SECRET_LENGTH).toBe(32);
    expect(
      configWarnings(env({ cookieSecret: of(MIN_SECRET_LENGTH) }))
    ).toEqual([]);
    expect(
      configWarnings(env({ cookieSecret: of(MIN_SECRET_LENGTH - 1) }))
    ).toHaveLength(1);
  });

  it("warns about a short secret, naming the variable and how long it is", () => {
    const [warning] = configWarnings(env({ cookieSecret: of(8) }));
    expect(warning).toMatch(/JWT_SECRET/);
    expect(warning).toMatch(/only 8 characters/);
    expect(warning).toMatch(/at least 32/);
    expect(warning).toMatch(/openssl rand -hex 32/);
  });

  it("says what changing the secret costs, so the advice can be weighed", () => {
    const [warning] = configWarnings(env({ cookieSecret: of(8) }));
    expect(warning).toMatch(/signs everyone out/);
    expect(warning).toMatch(/two-step enrolment/);
    expect(warning).toMatch(/runs as it is/);
  });

  it("leaves an empty or whitespace-only secret to configProblems", () => {
    expect(configWarnings(env({ cookieSecret: "" }))).toEqual([]);
    expect(configWarnings(env({ cookieSecret: "   " }))).toEqual([]);
  });

  it("never repeats the secret, or the database URL", () => {
    const secret = "test-secret-short";
    const text = JSON.stringify(configWarnings(env({ cookieSecret: secret })));
    expect(text).not.toContain(secret);
    expect(text).not.toContain("db.example.com");
    expect(text).not.toContain("pass");
  });

  it("is a warning and not a problem: a short secret does not stop the server", () => {
    const short = env({ cookieSecret: "short" });
    expect(configProblems(short)).toEqual([]);
    expect(() => assertStartupConfig(short)).not.toThrow();
  });
});

describe("secretWeaknesses", () => {
  const SAMPLES = 2000;
  const formats: Record<string, (seed: number) => string> = {
    "openssl rand -hex 16": seed => random(32, seed),
    "openssl rand -hex 32": seed => random(64, seed),
    "openssl rand -base64 32": seed => pick(seeded(seed), BASE64, 43) + "=",
    "32 alphanumeric characters": seed =>
      pick(seeded(seed), BASE64.slice(0, 62), 32),
    "a uuid": seed => {
      const h = random(32, seed);
      return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20)}`;
    },
  };

  describe.each(Object.entries(formats))("a secret from %s", (_name, make) => {
    it(`is never flagged, across ${SAMPLES} samples`, () => {
      const flagged = [];
      for (let seed = 1; seed <= SAMPLES; seed++) {
        const secret = make(seed);
        if (secretWeaknesses(secret).length > 0) flagged.push(seed);
      }
      expect(flagged).toEqual([]);
    });
  });

  it("flags a placeholder word, whatever the case or separators", () => {
    for (const secret of [
      `${GOOD}changeme`,
      `${GOOD.slice(0, 20)}-Change_Me-${GOOD.slice(20)}`,
      "your-secret-here-please-change-it-now",
      `${GOOD.slice(0, 30)}PASSWORD${GOOD.slice(30)}`,
    ]) {
      expect(secretWeaknesses(secret), secret).toContain(
        "contains a common placeholder word"
      );
    }
  });

  it("flags a secret made of very few different characters", () => {
    expect(secretWeaknesses("aaaaaaaabbbbbbbbccccccccdddddddd")).toContain(
      "uses very few different characters"
    );
  });

  it("draws the line on distinct characters at 8: seven is flagged, eight is not", () => {
    const seven = random(40, 3, "abcdefg");
    const eight = random(40, 3, "abcdefgh");
    // The samples are checked, so the test cannot pass by accident of a seed.
    expect(new Set(seven).size).toBe(7);
    expect(new Set(eight).size).toBe(8);

    expect(secretWeaknesses(seven)).toContain(
      "uses very few different characters"
    );
    expect(secretWeaknesses(eight)).not.toContain(
      "uses very few different characters"
    );
  });

  it("flags a short pattern repeated, however long", () => {
    for (const secret of [
      "a".repeat(40),
      "ab".repeat(20),
      "changeme-".repeat(5),
    ]) {
      expect(secretWeaknesses(secret), secret).toContain(
        "is a short pattern repeated"
      );
    }
  });

  it("does not call a secret a repetition just because part of it repeats", () => {
    const unit = random(12, 5);
    const nearly =
      unit.repeat(3).slice(0, -1) + (unit.endsWith("0") ? "1" : "0");
    expect(secretWeaknesses(nearly)).not.toContain(
      "is a short pattern repeated"
    );
  });

  it("flags a long run of consecutive characters, ascending or descending", () => {
    for (const secret of [
      "abcdefghijklmnopqrstuvwxyz012345",
      "12345678901234567890123456789012",
      "zyxwvutsrqponmlkjihgfedcba987654",
    ]) {
      expect(secretWeaknesses(secret), secret).toContain(
        "contains a long run of consecutive characters"
      );
    }
  });

  it("draws the line on a run at 8: seven is quiet, eight is flagged", () => {
    expect(
      secretWeaknesses(`${GOOD.slice(0, 30)}-abcdefg-${GOOD.slice(30)}`)
    ).not.toContain("contains a long run of consecutive characters");
    expect(
      secretWeaknesses(`${GOOD.slice(0, 30)}-abcdefgh-${GOOD.slice(30)}`)
    ).toContain("contains a long run of consecutive characters");
  });

  it("reports every weakness it finds", () => {
    expect(secretWeaknesses("a".repeat(40))).toEqual([
      "uses very few different characters",
      "is a short pattern repeated",
    ]);
  });

  it("never names the word or the characters it found", () => {
    const text = secretWeaknesses(`${GOOD}changeme`).join(" ");
    expect(text).not.toMatch(/changeme/i);
    expect(text).not.toContain(GOOD.slice(0, 8));
  });

  it("cannot tell a long guessable passphrase from a good key, and says so by passing it", () => {
    // A stated limit, held here so nobody believes the check is more than it is.
    expect(
      secretWeaknesses("correct-horse-battery-staple-orchid-lantern")
    ).toEqual([]);
  });
});

describe("configWarnings about a guessable secret", () => {
  const WEAK = "changeme-changeme-changeme-changeme";

  it("warns about a long secret that is plainly guessable", () => {
    const warnings = configWarnings(env({ cookieSecret: WEAK }));
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(
      /JWT_SECRET is long enough but looks guessable/
    );
    expect(warnings[0]).toMatch(/placeholder word/);
    expect(warnings[0]).toMatch(/short pattern repeated/);
    expect(warnings[0]).toMatch(/openssl rand -hex 32/);
  });

  it("says what changing it costs, like the length warning", () => {
    const [warning] = configWarnings(env({ cookieSecret: WEAK }));
    expect(warning).toMatch(/signs everyone out/);
    expect(warning).toMatch(/runs as it is/);
  });

  it("says nothing about a good secret", () => {
    expect(configWarnings(env({ cookieSecret: GOOD }))).toEqual([]);
  });

  it("does not repeat itself for a secret that is too short: the length warning is enough", () => {
    const warnings = configWarnings(env({ cookieSecret: "changeme" }));
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/only 8 characters/);
    expect(warnings[0]).not.toMatch(/guessable/);
  });

  it("says nothing when there is no database", () => {
    expect(
      configWarnings({ databaseUrl: "", appId: "", cookieSecret: WEAK })
    ).toEqual([]);
  });

  it("never repeats the secret", () => {
    const text = JSON.stringify(configWarnings(env({ cookieSecret: WEAK })));
    expect(text).not.toContain("changeme-");
    expect(text).not.toContain(WEAK);
  });

  it("is a warning and not a problem: a guessable secret does not stop the server", () => {
    const weak = env({ cookieSecret: WEAK });
    expect(configProblems(weak)).toEqual([]);
    expect(() => assertStartupConfig(weak)).not.toThrow();
  });
});
