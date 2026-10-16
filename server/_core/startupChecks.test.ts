import { describe, expect, it } from "vitest";
import {
  MIN_SECRET_LENGTH,
  appIdWeaknesses,
  assertStartupConfig,
  configProblems,
  configWarnings,
  databaseUrlProblem,
  nodeEnvWarning,
  portProblem,
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

describe("VITE_APP_ID shape", () => {
  const BASE62 =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const uuid = (seed: number) => {
    const h = random(32, seed);
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  };

  const REASONS: Record<string, string> = {
    " my-app": "contains whitespace",
    "my-app\n": "contains whitespace",
    "my app": "contains whitespace",
    '"my-app"': "is wrapped in quotes",
    "'my-app'": "is wrapped in quotes",
    "https://portal.example.com": "looks like a URL",
    "<your-app-id>": "is a template placeholder in angle brackets",
    "your-app-id": "is a placeholder name",
    YOUR_APP_ID: "is a placeholder name",
    "Change.Me": "is a placeholder name",
    undefined: "is a placeholder name",
    null: "is a placeholder name",
    APP_ID: "is a placeholder name",
    VITE_APP_ID: "is a placeholder name",
  };

  it.each(Object.entries(REASONS))("flags %j", (value, reason) => {
    expect(appIdWeaknesses(value).join(" and ")).toContain(reason);
  });

  it("names every reason when there are several", () => {
    expect(appIdWeaknesses('"your app id"')).toEqual([
      "contains whitespace",
      "is wrapped in quotes",
      "is a placeholder name, not an id",
    ]);
  });

  it("does not flag ids of the shapes a portal might hand out", () => {
    const rand = seeded(11);
    const ids: string[] = [];
    for (let i = 0; i < 2000; i++) {
      ids.push(
        uuid(i + 1),
        random(32, i + 1),
        pick(rand, BASE62, 22),
        `app_${pick(rand, BASE62, 12)}`,
        `proj-${pick(rand, HEX, 8)}`,
        String(1000000 + i)
      );
    }
    ids.push("my-app", "test-app", "smoke-app", "notes");
    expect(ids.filter(id => appIdWeaknesses(id).length > 0)).toEqual([]);
  });

  it("does not match a placeholder word that is only part of a longer id", () => {
    expect(appIdWeaknesses("nullable-app")).toEqual([]);
    expect(appIdWeaknesses("app-id-42")).toEqual([]);
  });

  describe("as a startup warning", () => {
    it("is raised, naming VITE_APP_ID, without refusing to start", () => {
      const warnings = configWarnings(env({ appId: "your-app-id" }));
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toMatch(/^VITE_APP_ID looks wrong/);
      expect(warnings[0]).toMatch(/rebuild/);
      expect(configProblems(env({ appId: "your-app-id" }))).toEqual([]);
    });

    it("says what is and is not affected, so nobody signs everyone out over it", () => {
      const text = configWarnings(env({ appId: "undefined" }))[0];
      expect(text).toMatch(/portal sign-in would fail/);
      expect(text).toMatch(/already issued are unaffected/);
    });

    it("is silent for a good id, and when there is no database to sign in to", () => {
      expect(configWarnings(env())).toEqual([]);
      expect(
        configWarnings(env({ databaseUrl: "", appId: "your-app-id" }))
      ).toEqual([]);
    });

    it("leaves an empty or whitespace-only id to the refusal, not a second message", () => {
      expect(configWarnings(env({ appId: "   " }))).toEqual([]);
      expect(configWarnings(env({ appId: "" }))).toEqual([]);
    });

    it("never repeats the value", () => {
      const secretish = "zz-not-an-id https://leak.example.com/zzq";
      const text = JSON.stringify(configWarnings(env({ appId: secretish })));
      expect(text).toContain("looks wrong");
      expect(text).not.toContain("zzq");
      expect(text).not.toContain("leak.example.com");
    });
  });
});

describe("PORT", () => {
  it.each([
    "abc",
    "5000abc",
    "1e3",
    "80.5",
    "0x1F90",
    "0",
    "-1",
    "65536",
    "70000",
    "+80",
    "  ",
    "５０００",
  ])("refuses %j", value => {
    const problems = configProblems(env({ port: value }));
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/^PORT is set but/);
    expect(portProblem(value)).not.toBeNull();
  });

  it.each(["", "1", "80", "3000", "5000", " 5000 ", "08080", "65535"])(
    "accepts %j",
    value => {
      expect(configProblems(env({ port: value }))).toEqual([]);
      expect(portProblem(value)).toBeNull();
    }
  );

  it("treats unset as fine, since the default is 3000", () => {
    expect(configProblems(env())).toEqual([]);
    expect(configProblems(env({ port: undefined }))).toEqual([]);
  });

  it("is checked with no database too, unlike the sign-in settings", () => {
    const problems = configProblems({
      databaseUrl: "",
      appId: "",
      cookieSecret: "",
      port: "abc",
    });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/^PORT/);
  });

  it("agrees with parseInt on everything it accepts, so what is checked is what is bound", () => {
    for (let n = 1; n <= 65535; n += 7) {
      expect(parseInt(String(n))).toBe(n);
      expect(portProblem(String(n))).toBeNull();
    }
    expect(parseInt(" 5000 ")).toBe(5000);
    expect(parseInt("08080")).toBe(8080);
  });

  it("is reported alongside the other problems and stops the server", () => {
    expect(
      configProblems(env({ port: "abc", appId: "", cookieSecret: "" }))
    ).toHaveLength(3);
    expect(() => assertStartupConfig(env({ port: "abc" }))).toThrow(/PORT/);
  });
});

describe("NODE_ENV", () => {
  it.each(["production", "development"])("is silent for %j", value => {
    expect(nodeEnvWarning(value)).toBeNull();
    expect(configWarnings(env({ nodeEnv: value }))).toEqual([]);
  });

  it("says it is not set when it is empty", () => {
    expect(nodeEnvWarning("")).toMatch(/^NODE_ENV is not set/);
  });

  it.each(["prod", "Production", "PRODUCTION", " production ", "production\n"])(
    "says %j looks like production but is not recognised",
    value => {
      expect(nodeEnvWarning(value)).toMatch(/looks like production/);
      expect(nodeEnvWarning(value)).toMatch(/exactly `production`/);
    }
  );

  it.each(["staging", "test", "dev", "local", "undefined"])(
    "says %j is neither production nor development",
    value => {
      expect(nodeEnvWarning(value)).toMatch(/neither `production` nor/);
    }
  );

  it("names what the non-production mode gives up, so the cost is not a guess", () => {
    const text = nodeEnvWarning("")!;
    for (const effect of [
      /Secure only when the request itself arrived over https/,
      /not redirected/,
      /Content-Security-Policy/,
      /X-Forwarded-For is not trusted/,
      /reCAPTCHA hostname/,
    ]) {
      expect(text).toMatch(effect);
    }
  });

  it("is a warning, never a refusal", () => {
    expect(configProblems(env({ nodeEnv: "" }))).toEqual([]);
    expect(configProblems(env({ nodeEnv: "prod" }))).toEqual([]);
    expect(configWarnings(env({ nodeEnv: "" }))).toHaveLength(1);
  });

  it("applies with no database too, since the headers and proxy handling do not need one", () => {
    expect(
      configWarnings({
        databaseUrl: "",
        appId: "",
        cookieSecret: "",
        nodeEnv: "",
      })
    ).toHaveLength(1);
  });

  it("is not raised for a caller that does not say, so other checks stay exact", () => {
    expect(configWarnings(env())).toEqual([]);
  });

  it("never repeats the value", () => {
    expect(nodeEnvWarning("zz-odd-env-zq")).not.toContain("zq");
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
