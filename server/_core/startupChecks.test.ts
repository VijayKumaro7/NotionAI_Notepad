import { describe, expect, it } from "vitest";
import { parseTrustedProxyHops } from "../demoLimit";
import {
  MIN_SECRET_LENGTH,
  appIdWeaknesses,
  assertStartupConfig,
  configProblems,
  configWarnings,
  databaseUrlProblem,
  emailFromWeaknesses,
  googleClientIdWeaknesses,
  googleClientSecretWeaknesses,
  googleWarnings,
  emailKeyWeaknesses,
  emailWarnings,
  demoSaltWarnings,
  nodeEnvWarning,
  portProblem,
  oauthServerUrlWarning,
  forgeApiKeyWarning,
  ownerOpenIdWarnings,
  forgeApiUrlWarning,
  forgeModelWarnings,
  forgeTranscriptionModelWarnings,
  viteCredentialNames,
  viteCredentialWarning,
  proxyHopsWarning,
  recaptchaSecretWeaknesses,
  recaptchaSiteKeyWeaknesses,
  recaptchaWarnings,
  s3BucketWeaknesses,
  s3Warnings,
  s3IgnoredCredentialWarnings,
  awsAccessKeyIdWeaknesses,
  awsSecretAccessKeyWeaknesses,
  awsSessionTokenWeaknesses,
  awsCredentialWarnings,
  publicOriginWarning,
  publicOriginWeaknesses,
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

describe("TRUSTED_PROXY_HOPS", () => {
  it.each(["", "0", "1", "2", "3", " 2 ", "03"])("is silent for %j", value => {
    expect(proxyHopsWarning(value, true)).toBeNull();
    expect(configWarnings(env({ proxyHops: value }))).toEqual([]);
  });

  it("says whitespace-only is read as 0, unlike an empty value", () => {
    for (const value of [" ", "   ", "\t"]) {
      expect(proxyHopsWarning(value, true)).toMatch(
        /^TRUSTED_PROXY_HOPS is only whitespace, which is read as 0/
      );
    }
  });

  it.each([
    ["abc", true, 1],
    ["abc", false, 0],
    ["-1", true, 1],
    ["1.5", true, 1],
    ["Infinity", true, 1],
    ["1.0", true, 1],
    ["0x2", true, 2],
    ["1e1", true, 10],
  ])(
    "says %j is not digits and what it is read as",
    (value, production, read) => {
      expect(proxyHopsWarning(value, production)).toMatch(
        new RegExp(
          `not a whole number written in digits, so the server reads it as ${read}\\.`
        )
      );
    }
  );

  it("warns above three, in the direction where a caller picks their own address", () => {
    expect(proxyHopsWarning("4", true)).toMatch(
      /^TRUSTED_PROXY_HOPS is 4, more proxies than most deployments have/
    );
    expect(proxyHopsWarning("4", true)).toMatch(
      /anyone can pick their own address/
    );
    expect(proxyHopsWarning("3", true)).toBeNull();
  });

  it("always says what to set it to", () => {
    for (const value of [" ", "abc", "9"]) {
      expect(proxyHopsWarning(value, true)).toMatch(
        /number of reverse proxies/
      );
    }
  });

  it("agrees with the parse the rate limits use, for any value it describes", () => {
    for (const value of ["abc", "-1", "0x2", "1e1", "1.5"]) {
      const read = parseTrustedProxyHops(value, true);
      expect(proxyHopsWarning(value, true)).toContain(`reads it as ${read}.`);
    }
  });

  it("is a warning only, with or without a database", () => {
    expect(configProblems(env({ proxyHops: "abc" }))).toEqual([]);
    expect(configWarnings(env({ proxyHops: "abc" }))).toHaveLength(1);
    expect(
      configWarnings({
        databaseUrl: "",
        appId: "",
        cookieSecret: "",
        proxyHops: "abc",
      })
    ).toHaveLength(1);
  });

  it("is not raised for a caller that does not say", () => {
    expect(configWarnings(env())).toEqual([]);
  });

  it("uses NODE_ENV only to say what an invalid value falls back to", () => {
    expect(
      configWarnings(env({ proxyHops: "abc", nodeEnv: "production" }))[0]
    ).toContain("reads it as 1.");
    expect(
      configWarnings(env({ proxyHops: "abc", nodeEnv: "development" }))[0]
    ).toContain("reads it as 0.");
  });
});

describe("PUBLIC_ORIGIN", () => {
  it.each([
    "",
    "https://notes.example.com",
    "https://notes.example.com/",
    "HTTPS://Notes.Example.com:443",
    "https://notes.example.com:8443",
    "  https://notes.example.com  ",
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://[::1]:3000",
    "http://app.localhost",
  ])("is silent for %j in production", value => {
    expect(publicOriginWarning(value, true)).toBeNull();
  });

  it("allows http:// outside production, where nothing redirects to it", () => {
    expect(publicOriginWarning("http://notes.example.com", false)).toBeNull();
  });

  it.each([
    ["notes.example.com", "not a valid absolute URL"],
    ["https://", "not a valid absolute URL"],
    ["//notes.example.com", "not a valid absolute URL"],
    ['"https://notes.example.com"', "begins or ends with a quote"],
    ["'https://notes.example.com'", "begins or ends with a quote"],
    ["localhost:3000", "does not use http or https"],
    ["ftp://notes.example.com", "does not use http or https"],
    ["https://user:pw@notes.example.com", "contains a username or password"],
    ["https://:pw@notes.example.com", "contains a username or password"],
    ["https://notes.example.com/app", "has a path, query or fragment"],
    ["https://notes.example.com?a=1", "has a path, query or fragment"],
    ["https://notes.example.com#x", "has a path, query or fragment"],
    ["http://notes.example.com", "uses http:// in production"],
  ])("flags %j", (value, reason) => {
    expect(publicOriginWeaknesses(value, true).join(" and ")).toContain(reason);
  });

  it("reports an unparseable or non-http value alone, since the rest cannot be read", () => {
    expect(publicOriginWeaknesses("notes.example.com", true)).toHaveLength(1);
    expect(publicOriginWeaknesses("localhost:3000", true)).toHaveLength(1);
  });

  it("names every problem a parseable value has", () => {
    expect(
      publicOriginWeaknesses("http://u:p@notes.example.com/app", true)
    ).toHaveLength(3);
  });

  it("is what makes a request loop: http:// in production redirects to itself", async () => {
    const { vi } = await import("vitest");
    vi.resetModules();
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("PUBLIC_ORIGIN", "http://notes.example.com");
    const fresh = await import("./securityHeaders");
    const redirects: string[] = [];
    const req = {
      method: "GET",
      originalUrl: "/login",
      headers: { host: "notes.example.com" },
      socket: { remoteAddress: "203.0.113.9" },
    };
    fresh.requireHttps(
      req as never,
      { redirect: (_: number, to: string) => redirects.push(to) } as never,
      () => undefined
    );
    vi.unstubAllEnvs();
    expect(redirects).toEqual(["http://notes.example.com/login"]);
    expect(publicOriginWarning("http://notes.example.com", true)).toMatch(
      /loop/
    );
  });

  it("is a warning only, with or without a database", () => {
    expect(configProblems(env({ publicOrigin: "nope" }))).toEqual([]);
    expect(configWarnings(env({ publicOrigin: "nope" }))).toHaveLength(1);
    expect(
      configWarnings({
        databaseUrl: "",
        appId: "",
        cookieSecret: "",
        publicOrigin: "nope",
      })
    ).toHaveLength(1);
  });

  it("uses NODE_ENV only for the http:// case", () => {
    const value = "http://notes.example.com";
    expect(
      configWarnings(env({ publicOrigin: value, nodeEnv: "production" }))
    ).toHaveLength(1);
    expect(
      configWarnings(env({ publicOrigin: value, nodeEnv: "development" }))
    ).toEqual([]);
  });

  it("is not raised for a caller that does not say", () => {
    expect(configWarnings(env())).toEqual([]);
  });

  it("never repeats any part of the value, which may hold credentials", () => {
    for (const value of [
      "https://admin:hunter2zz@notes.example.com/secretpath",
      '"hunter2zz.example.com"',
      "ftp://hunter2zz",
    ]) {
      const text = publicOriginWarning(value, true)!;
      expect(text).toBeTruthy();
      expect(text).not.toContain("hunter2zz");
      expect(text).not.toContain("admin");
      expect(text).not.toContain("secretpath");
    }
  });
});

describe("RENDER_EXTERNAL_URL", () => {
  it("is judged by the same rules as PUBLIC_ORIGIN", () => {
    for (const value of [
      "nope",
      "ftp://x.onrender.com",
      "https://u:p@x.onrender.com",
      "https://x.onrender.com/app",
      "http://x.onrender.com",
    ]) {
      expect(publicOriginWarning(value, true, "RENDER_EXTERNAL_URL")).toMatch(
        /^RENDER_EXTERNAL_URL looks wrong/
      );
    }
  });

  it("is silent for the address Render hands out", () => {
    expect(
      publicOriginWarning(
        "https://notes.onrender.com",
        true,
        "RENDER_EXTERNAL_URL"
      )
    ).toBeNull();
    expect(publicOriginWarning("", true, "RENDER_EXTERNAL_URL")).toBeNull();
  });

  it("says PUBLIC_ORIGIN takes precedence, and does not name PUBLIC_ORIGIN as the culprit", () => {
    const text = publicOriginWarning("nope", true, "RENDER_EXTERNAL_URL")!;
    expect(text).not.toMatch(/PUBLIC_ORIGIN looks wrong/);
    expect(text).toMatch(/set PUBLIC_ORIGIN, which takes precedence/);
  });

  it("keeps the PUBLIC_ORIGIN wording when that is the variable in use", () => {
    expect(publicOriginWarning("nope", true)).toMatch(
      /^PUBLIC_ORIGIN looks wrong/
    );
    expect(publicOriginWarning("nope", true, "PUBLIC_ORIGIN")).toMatch(
      /^PUBLIC_ORIGIN looks wrong/
    );
  });

  it("is raised through configWarnings under the variable's own name", () => {
    const warnings = configWarnings(
      env({ publicOrigin: "nope", publicOriginVar: "RENDER_EXTERNAL_URL" })
    );
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/^RENDER_EXTERNAL_URL looks wrong/);
    expect(
      configProblems(
        env({ publicOrigin: "nope", publicOriginVar: "RENDER_EXTERNAL_URL" })
      )
    ).toEqual([]);
  });

  it("never repeats any part of the value, which may hold credentials", () => {
    const text = publicOriginWarning(
      "https://admin:hunter2zz@x.onrender.com/secretpath",
      true,
      "RENDER_EXTERNAL_URL"
    )!;
    expect(text).not.toContain("hunter2zz");
    expect(text).not.toContain("admin");
    expect(text).not.toContain("secretpath");
  });

  describe("which variable env.ts reads", () => {
    const read = async (vars: Record<string, string | undefined>) => {
      const { vi } = await import("vitest");
      vi.resetModules();
      vi.unstubAllEnvs();
      for (const k of ["PUBLIC_ORIGIN", "RENDER_EXTERNAL_URL"]) {
        delete process.env[k];
      }
      for (const [k, v] of Object.entries(vars)) {
        if (v !== undefined) {
          vi.stubEnv(k, v);
        }
      }
      const { ENV } = await import("./env");
      const got = [ENV.publicOrigin, ENV.publicOriginVar];
      vi.unstubAllEnvs();
      return got;
    };

    it("reports RENDER_EXTERNAL_URL only when PUBLIC_ORIGIN is unset", async () => {
      expect(
        await read({ RENDER_EXTERNAL_URL: "https://a.onrender.com" })
      ).toEqual(["https://a.onrender.com", "RENDER_EXTERNAL_URL"]);
    });

    it("reports PUBLIC_ORIGIN when neither is set, so nothing is named that does not exist", async () => {
      expect(await read({})).toEqual(["", "PUBLIC_ORIGIN"]);
    });

    it("keeps PUBLIC_ORIGIN as the source when it is set, even if both are", async () => {
      expect(
        await read({
          PUBLIC_ORIGIN: "https://notes.example.com",
          RENDER_EXTERNAL_URL: "nope",
        })
      ).toEqual(["https://notes.example.com", "PUBLIC_ORIGIN"]);
    });

    it("leaves a bad RENDER_EXTERNAL_URL unwarned when PUBLIC_ORIGIN overrides it", async () => {
      const [origin, name] = await read({
        PUBLIC_ORIGIN: "https://notes.example.com",
        RENDER_EXTERNAL_URL: "nope",
      });
      expect(
        configWarnings(
          env({
            publicOrigin: origin,
            publicOriginVar: name as "PUBLIC_ORIGIN",
          })
        )
      ).toEqual([]);
    });
  });
});

describe("DEMO_LIMIT_SALT", () => {
  const GOOD_SALT = random(64, 21);

  it("is silent when unset, which is how the server-side limit is turned off", () => {
    expect(demoSaltWarnings("", true)).toEqual([]);
    expect(demoSaltWarnings("", false)).toEqual([]);
  });

  it("is silent for a long random salt with a database", () => {
    expect(demoSaltWarnings(GOOD_SALT, true)).toEqual([]);
    expect(configWarnings(env({ demoLimitSalt: GOOD_SALT }))).toEqual([]);
  });

  it("accepts what Render generates and what openssl gives", () => {
    const rand = seeded(5);
    for (let i = 0; i < 500; i++) {
      expect(demoSaltWarnings(pick(rand, BASE64, 44), true)).toEqual([]);
      expect(demoSaltWarnings(pick(rand, HEX, 64), true)).toEqual([]);
    }
  });

  it("says a short salt is short, with its length and why it matters", () => {
    const [text] = demoSaltWarnings("changeme", true);
    expect(text).toMatch(/^DEMO_LIMIT_SALT is only 8 characters long/);
    expect(text).toMatch(/four billion IPv4 addresses/);
    expect(text).toMatch(/demoSessions/);
    expect(text).toMatch(/openssl rand -hex 32/);
  });

  it("says a long guessable salt is guessable, and gives only that one warning", () => {
    const weak = "changeme-changeme-changeme-changeme";
    const warnings = demoSaltWarnings(weak, true);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/^DEMO_LIMIT_SALT looks guessable: it /);
  });

  it("states the real cost of changing it, which is not a sign-out", () => {
    const [text] = demoSaltWarnings("short", true);
    expect(text).toMatch(/forget every recorded demo deadline/);
    expect(text).toMatch(/nothing else is affected/);
    expect(text).not.toMatch(/signs everyone out/);
  });

  it("warns that a salt with no database does nothing", () => {
    const warnings = demoSaltWarnings(GOOD_SALT, false);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/set but DATABASE_URL is not/);
    expect(warnings[0]).toMatch(/browser-only/);
  });

  it("reports both a weak salt and a missing database", () => {
    expect(demoSaltWarnings("short", false)).toHaveLength(2);
  });

  it("takes the database from the same place the sign-in checks do", () => {
    expect(
      configWarnings(env({ demoLimitSalt: GOOD_SALT, databaseUrl: "" }))
    ).toHaveLength(1);
    expect(
      configWarnings(env({ demoLimitSalt: GOOD_SALT, databaseUrl: "  " }))
    ).toHaveLength(1);
  });

  it("is a warning only, and not raised for a caller that does not say", () => {
    expect(configProblems(env({ demoLimitSalt: "short" }))).toEqual([]);
    expect(configWarnings(env())).toEqual([]);
  });

  it("never repeats the salt", () => {
    for (const salt of ["zzq-short-salt", `${"zzq".repeat(14)}-x`]) {
      const text = JSON.stringify(demoSaltWarnings(salt, false));
      expect(text).not.toContain("zzq");
    }
  });
});

describe("S3_BUCKET and the settings that go with it", () => {
  it.each([
    ["", "", ""],
    ["my-notes-backups", "", ""],
    ["my-notes-backups", "eu-west-1", ""],
    ["my.notes.backups", "us-east-1", "https://minio.example.com:9000"],
    ["my-bucket", "auto", "https://acct.r2.cloudflarestorage.com"],
    ["my-bucket", "", "http://127.0.0.1:9000"],
    ["arn:aws:s3:us-west-2:123456789012:accesspoint/backups", "", ""],
  ])("is silent for %j / %j / %j", (bucket, region, endpoint) => {
    expect(s3Warnings(bucket, region, endpoint)).toEqual([]);
  });

  it.each([
    ["my-bucket ", "contains whitespace"],
    [" my-bucket", "contains whitespace"],
    ["my bucket", "contains whitespace"],
    ["s3://my-bucket", "looks like a URL or s3:// path"],
    ["https://my-bucket.s3.amazonaws.com", "looks like a URL or s3:// path"],
    ["my-bucket/backups", "contains a slash"],
    ["arn:aws:s3:::my-bucket", "is a bucket ARN"],
  ])("flags the bucket %j", (bucket, reason) => {
    expect(s3BucketWeaknesses(bucket).join(" and ")).toContain(reason);
    const [text] = s3Warnings(bucket, "", "");
    expect(text).toMatch(/^S3_BUCKET looks wrong/);
    expect(text).toMatch(/first backup attempt/);
  });

  it("reports one reason for a URL rather than also calling it a slash", () => {
    expect(s3BucketWeaknesses("s3://my-bucket")).toHaveLength(1);
  });

  it.each([
    "minio:9000",
    "127.0.0.1:9000",
    "ftp://minio.example.com",
    "minio",
    "https://",
  ])("flags the endpoint %j", endpoint => {
    const warnings = s3Warnings("my-bucket", "", endpoint);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(
      /^S3_ENDPOINT is not an absolute http\(s\) URL/
    );
  });

  it.each(["us-east-1 ", "https://s3.amazonaws.com", "eu/west", "us east 1"])(
    "flags the region %j",
    region => {
      const warnings = s3Warnings("my-bucket", region, "");
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toMatch(/^S3_REGION contains characters/);
    }
  );

  it("says what is set without a bucket, since backup silently stays off", () => {
    expect(s3Warnings("", "eu-west-1", "")[0]).toMatch(
      /^S3_REGION is set but S3_BUCKET is not, so cloud backup stays off/
    );
    expect(s3Warnings("", "", "https://minio.example.com")[0]).toMatch(
      /^S3_ENDPOINT is set but S3_BUCKET is not/
    );
    const both = s3Warnings("", "eu-west-1", "https://minio.example.com");
    expect(both).toHaveLength(1);
    expect(both[0]).toMatch(
      /^S3_REGION and S3_ENDPOINT are set but S3_BUCKET is not/
    );
  });

  it("does not judge an endpoint or region when there is no bucket to use them", () => {
    expect(s3Warnings("", "us east 1", "minio:9000")).toHaveLength(1);
  });

  it("reports each bad setting separately", () => {
    expect(s3Warnings("a/b", "x y", "minio:9000")).toHaveLength(3);
  });

  it("is silent about credentials, which the SDK finds through a chain", () => {
    expect(s3Warnings("my-bucket", "eu-west-1", "")).toEqual([]);
  });

  describe("S3 credential names nothing reads", () => {
    it("is silent when neither is set", () => {
      expect(s3IgnoredCredentialWarnings("", "")).toEqual([]);
    });

    it("names S3_ACCESS_KEY_ID and points at the AWS_ name", () => {
      const [text, ...rest] = s3IgnoredCredentialWarnings("AKIAEXAMPLE", "");
      expect(rest).toEqual([]);
      expect(text).toMatch(/^S3_ACCESS_KEY_ID is set, but nothing reads it/);
      expect(text).toContain("AWS_ACCESS_KEY_ID");
      expect(text).not.toContain("S3_SECRET_ACCESS_KEY");
    });

    it("names the secret on its own, and both in one warning", () => {
      expect(s3IgnoredCredentialWarnings("", "x")[0]).toMatch(
        /^S3_SECRET_ACCESS_KEY is set, but nothing reads it/
      );
      const both = s3IgnoredCredentialWarnings("a", "b");
      expect(both).toHaveLength(1);
      expect(both[0]).toMatch(
        /^S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY are set, but nothing reads them/
      );
    });

    it("warns with or without a bucket, and never echoes a value", () => {
      const secret = "do-not-print-me";
      for (const s3Bucket of ["", "my-bucket"]) {
        const warnings = configWarnings(
          env({ s3Bucket, s3AccessKeyId: secret, s3SecretAccessKey: secret })
        );
        expect(warnings).toHaveLength(1);
        expect(warnings.join("")).not.toContain(secret);
      }
    });

    it("is silent through configWarnings when they are empty", () => {
      expect(
        configWarnings(env({ s3AccessKeyId: "", s3SecretAccessKey: "" }))
      ).toEqual([]);
    });
  });

  describe("AWS_ACCESS_KEY_ID, which the SDK does read", () => {
    it.each(["AKIAIOSFODNN7EXAMPLE", "minioadmin", "odd/id+chars=ok"])(
      "is silent about the ordinary id %j",
      id => {
        expect(awsAccessKeyIdWeaknesses(id)).toEqual([]);
        expect(awsCredentialWarnings("my-bucket", id, "secret")).toEqual([]);
      }
    );

    it.each([
      ["AKIAEXAMPLE\n", "contains whitespace"],
      [" AKIAEXAMPLE", "contains whitespace"],
      ["AKIA EXAMPLE", "contains whitespace"],
      ['"AKIAEXAMPLE"', "is wrapped in quotes"],
      ["'AKIAEXAMPLE'", "is wrapped in quotes"],
    ])("flags the id %j", (id, reason) => {
      expect(awsAccessKeyIdWeaknesses(id).join(" and ")).toContain(reason);
      const [text, ...rest] = awsCredentialWarnings("my-bucket", id, "secret");
      expect(rest).toEqual([]);
      expect(text).toMatch(/^AWS_ACCESS_KEY_ID looks wrong/);
      expect(text).toMatch(/first backup attempt/);
    });

    it.each(["wJalrXUtnFEMI/K7MDENG/bPxRfiCY+EXAMPLEKEY", "minioadmin"])(
      "is silent about the ordinary secret %j, including one equal to the id",
      secret => {
        expect(awsSecretAccessKeyWeaknesses(secret)).toEqual([]);
        expect(awsCredentialWarnings("my-bucket", secret, secret)).toEqual([]);
      }
    );

    it.each([
      ["wJalrXUtnFEMI\n", "contains whitespace"],
      ["wJalr XUtn", "contains whitespace"],
      ['"wJalrXUtnFEMI"', "is wrapped in quotes"],
      ["'wJalrXUtnFEMI'", "is wrapped in quotes"],
    ])("flags the secret %j", (secret, reason) => {
      expect(awsSecretAccessKeyWeaknesses(secret).join(" and ")).toContain(
        reason
      );
      const [text, ...rest] = awsCredentialWarnings(
        "my-bucket",
        "AKIAEXAMPLE",
        secret
      );
      expect(rest).toEqual([]);
      expect(text).toMatch(/^AWS_SECRET_ACCESS_KEY looks wrong/);
      expect(text).toMatch(/signed wrongly/);
    });

    it("reports a mangled id and a mangled secret as two warnings", () => {
      const warnings = awsCredentialWarnings("my-bucket", '"id"', '"secret"');
      expect(warnings).toHaveLength(2);
      expect(warnings[0]).toMatch(/^AWS_ACCESS_KEY_ID/);
      expect(warnings[1]).toMatch(/^AWS_SECRET_ACCESS_KEY/);
    });

    it("judges a mangled secret alone, without calling the pair half-set", () => {
      const warnings = awsCredentialWarnings("my-bucket", "", '"secret"');
      expect(warnings).toHaveLength(2);
      expect(warnings[0]).toMatch(/^AWS_SECRET_ACCESS_KEY looks wrong/);
      expect(warnings[1]).toMatch(/^AWS_SECRET_ACCESS_KEY is set but/);
    });

    describe("AWS_SESSION_TOKEN", () => {
      const ID = "ASIAEXAMPLE";
      const PAIR = [ID, "secret"] as const;

      it("is silent about an ordinary token with its pair", () => {
        expect(
          awsSessionTokenWeaknesses("IQoJb3JpZ2luX2VjEXAMPLE//+==")
        ).toEqual([]);
        expect(
          awsCredentialWarnings("my-bucket", ...PAIR, "IQoJb3JpZ2luX2Vj")
        ).toEqual([]);
      });

      it.each([
        ["IQoJb3Jp\n", "contains whitespace"],
        ["IQoJ b3Jp", "contains whitespace"],
        ['"IQoJb3Jp"', "is wrapped in quotes"],
        ["'IQoJb3Jp'", "is wrapped in quotes"],
      ])("flags the token %j", (token, reason) => {
        expect(awsSessionTokenWeaknesses(token).join(" and ")).toContain(
          reason
        );
        const [text, ...rest] = awsCredentialWarnings(
          "my-bucket",
          ...PAIR,
          token
        );
        expect(rest).toEqual([]);
        expect(text).toMatch(/^AWS_SESSION_TOKEN looks wrong/);
      });

      it("says a token on its own is ignored", () => {
        const warnings = awsCredentialWarnings("my-bucket", "", "", "tok");
        expect(warnings).toHaveLength(1);
        expect(warnings[0]).toMatch(
          /^AWS_SESSION_TOKEN is set but neither AWS_ACCESS_KEY_ID nor AWS_SECRET_ACCESS_KEY is/
        );
      });

      it("leaves a token with half a pair to the half-pair warning", () => {
        const warnings = awsCredentialWarnings(
          "my-bucket",
          "AKIAEXAMPLE",
          "",
          "tok"
        );
        expect(warnings).toHaveLength(1);
        expect(warnings[0]).toMatch(/^AWS_ACCESS_KEY_ID is set but/);
      });

      it("warns about an ASIA id with no token, and not about one with it", () => {
        const [text, ...rest] = awsCredentialWarnings("my-bucket", ...PAIR);
        expect(rest).toEqual([]);
        expect(text).toMatch(/^AWS_ACCESS_KEY_ID begins with ASIA/);
        expect(text).toMatch(/temporary credentials/);
        expect(awsCredentialWarnings("my-bucket", ...PAIR, "tok")).toEqual([]);
      });

      it("does not call a long-lived AKIA key temporary", () => {
        expect(
          awsCredentialWarnings("my-bucket", "AKIAEXAMPLE", "secret")
        ).toEqual([]);
        expect(
          awsCredentialWarnings("my-bucket", "xASIAnot-a-prefix", "secret")
        ).toEqual([]);
      });

      it("judges nothing without a bucket, and never echoes the token", () => {
        expect(awsCredentialWarnings("", ...PAIR, '"tok"')).toEqual([]);
        const text = awsCredentialWarnings(
          "my-bucket",
          ...PAIR,
          'do-not-print-token\n"'
        ).join(" ");
        expect(text).toContain("AWS_SESSION_TOKEN looks wrong");
        expect(text).not.toContain("do-not-print");
      });

      it("is carried through configWarnings", () => {
        expect(
          configWarnings(
            env({
              s3Bucket: "my-bucket",
              awsAccessKeyId: ID,
              awsSecretAccessKey: "secret",
              awsSessionToken: "tok\n",
            })
          )
        ).toHaveLength(1);
        expect(
          configWarnings(env({ s3Bucket: "my-bucket", awsSessionToken: "tok" }))
        ).toHaveLength(1);
      });
    });

    it("says each mangling once, even when there are two", () => {
      expect(awsAccessKeyIdWeaknesses('"AKIA\n')).toHaveLength(2);
      expect(awsCredentialWarnings("my-bucket", '"AKIA\n', "s")).toHaveLength(
        1
      );
    });

    it("warns about half a pair, in the direction it is half", () => {
      const noSecret = awsCredentialWarnings("my-bucket", "AKIAEXAMPLE", "");
      expect(noSecret).toHaveLength(1);
      expect(noSecret[0]).toMatch(
        /^AWS_ACCESS_KEY_ID is set but AWS_SECRET_ACCESS_KEY is not/
      );
      const noId = awsCredentialWarnings("my-bucket", "", "secret");
      expect(noId).toHaveLength(1);
      expect(noId[0]).toMatch(
        /^AWS_SECRET_ACCESS_KEY is set but AWS_ACCESS_KEY_ID is not/
      );
      expect(noId[0]).toMatch(/profile or role/);
    });

    it("is silent when neither is set, since a profile or role may supply them", () => {
      expect(awsCredentialWarnings("my-bucket", "", "")).toEqual([]);
    });

    it("judges nothing without a bucket, where backup is off", () => {
      expect(awsCredentialWarnings("", '"x"', "")).toEqual([]);
    });

    it("is carried through configWarnings only when the bucket is known", () => {
      expect(
        configWarnings(
          env({
            s3Bucket: "my-bucket",
            awsAccessKeyId: "AKIAEXAMPLE\n",
            awsSecretAccessKey: "secret",
          })
        )
      ).toHaveLength(1);
      expect(configWarnings(env({ awsAccessKeyId: "AKIAEXAMPLE\n" }))).toEqual(
        []
      );
    });

    it("never echoes either value", () => {
      const id = 'do-not-print-id\n"';
      const secret = 'do-not-print-secret\n"';
      const text = awsCredentialWarnings("my-bucket", id, secret)
        .concat(awsCredentialWarnings("my-bucket", "do-not-print-id", ""))
        .join(" ");
      expect(text).not.toContain("do-not-print");
    });
  });

  it("hands the region and the endpoint to the right checks", () => {
    const warnings = configWarnings(
      env({
        s3Bucket: "my-bucket",
        s3Region: "us east 1",
        s3Endpoint: "minio:9000",
      })
    );
    expect(warnings).toHaveLength(2);
    expect(warnings[0]).toMatch(/^S3_ENDPOINT/);
    expect(warnings[1]).toMatch(/^S3_REGION/);
    expect(
      configWarnings(env({ s3Bucket: "my-bucket", s3Region: "eu-west-1" }))
    ).toEqual([]);
  });

  it("is a warning only, and not raised for a caller that does not say", () => {
    expect(configProblems(env({ s3Bucket: "s3://x" }))).toEqual([]);
    expect(configWarnings(env({ s3Bucket: "s3://x" }))).toHaveLength(1);
    expect(configWarnings(env())).toEqual([]);
  });

  it("applies with no database, since backups need one only for the account", () => {
    expect(
      configWarnings({
        databaseUrl: "",
        appId: "",
        cookieSecret: "",
        s3Bucket: "s3://x",
      })
    ).toHaveLength(1);
  });

  it("never repeats a value, since an ARN holds an account id and an endpoint may hold credentials", () => {
    const text = JSON.stringify(
      s3Warnings(
        "arn:aws:s3:::acct123456789012-bucket",
        "zz/region/leak",
        "user:hunter2zz@host"
      )
    );
    for (const leak of ["acct123456789012", "region/leak", "hunter2zz"]) {
      expect(text).not.toContain(leak);
    }
  });
});

describe("EMAIL_API_URL and the settings email needs", () => {
  const URL_OK = "https://api.resend.com/emails";
  const KEY = "not-a-real-key-zz";
  const FROM = "Notes <notes@mail.acmenotes.dev>";
  const ORIGIN = "https://notes.example.com";

  it("is silent when nothing is set, which is how email is turned off", () => {
    expect(emailWarnings("", "", "", "")).toEqual([]);
    expect(emailWarnings("", "", "", undefined)).toEqual([]);
  });

  it("is silent for a complete, sane configuration", () => {
    expect(emailWarnings(URL_OK, KEY, FROM, ORIGIN)).toEqual([]);
    expect(
      emailWarnings("http://127.0.0.1:8025/send", KEY, FROM, ORIGIN)
    ).toEqual([]);
    expect(
      emailWarnings("http://localhost:8025/send", KEY, FROM, ORIGIN)
    ).toEqual([]);
  });

  it.each([
    [
      [URL_OK, "", ""],
      "EMAIL_API_URL is set but EMAIL_API_KEY and EMAIL_FROM are not",
    ],
    [
      ["", KEY, ""],
      "EMAIL_API_KEY is set but EMAIL_API_URL and EMAIL_FROM are not",
    ],
    [
      ["", "", FROM],
      "EMAIL_FROM is set but EMAIL_API_URL and EMAIL_API_KEY are not",
    ],
    [
      [URL_OK, KEY, ""],
      "EMAIL_API_URL and EMAIL_API_KEY are set but EMAIL_FROM is not",
    ],
  ])(
    "names what is set and what is missing for %j",
    ([url, key, from], text) => {
      const warnings = emailWarnings(url, key, from, ORIGIN);
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain(text);
      expect(warnings[0]).toMatch(/email stays off/);
      expect(warnings[0]).toMatch(/password reset sends nothing/);
    }
  );

  it("says a value of only whitespace counts as set and fails every send", () => {
    const warnings = emailWarnings(URL_OK, "   ", FROM, ORIGIN);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/^EMAIL_API_KEY is only whitespace/);
    expect(warnings[0]).toMatch(/counts as set/);
  });

  it.each([
    "resend",
    "api.resend.com/emails",
    "https://",
    "ftp://api.example.com/send",
    "mailto:me@example.com",
  ])("flags the URL %j as not an absolute http(s) URL", url => {
    const warnings = emailWarnings(url, KEY, FROM, ORIGIN);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(
      /^EMAIL_API_URL is not an absolute http\(s\) URL/
    );
    expect(warnings[0]).toMatch(/reported as sent and not be/);
  });

  it("flags credentials in the URL, which fetch refuses", () => {
    const warnings = emailWarnings(
      "https://user:pw@api.example.com/x",
      KEY,
      FROM,
      ORIGIN
    );
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(
      /^EMAIL_API_URL contains a username or password/
    );
    expect(warnings[0]).toMatch(/EMAIL_API_KEY/);
  });

  it("flags http:// to a real host, where the key travels in clear text", () => {
    const warnings = emailWarnings(
      "http://api.example.com/send",
      KEY,
      FROM,
      ORIGIN
    );
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/^EMAIL_API_URL uses http:\/\//);
    expect(warnings[0]).toMatch(/clear text/);
  });

  it.each([
    "https://api.resend.com",
    "https://api.resend.com/",
    "https://api.resend.com:8443",
    "  https://api.resend.com\n",
  ])("flags %j as a bare origin with no path", url => {
    const warnings = emailWarnings(url, KEY, FROM, ORIGIN);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/^EMAIL_API_URL has no path/);
    expect(warnings[0]).toMatch(/posted to the root of the host/);
    expect(warnings[0]).toMatch(
      /unless your provider really takes sends at its root/
    );
  });

  it.each([
    "https://api.resend.com/emails",
    "https://api.postmarkapp.com/email",
    "https://api.sendgrid.com/v3/mail/send",
    "https://relay.example.com/send/",
    "https://relay.example.com/?action=send",
    "https://relay.example.com/#send",
    "https://api.resend.com/emails?key=abc",
  ])("does not flag %j, which has a path, a query or a fragment", url => {
    expect(emailWarnings(url, KEY, FROM, ORIGIN)).toEqual([]);
  });

  it("does not flag a bare loopback origin, where a local sink may take sends at its root", () => {
    expect(emailWarnings("http://127.0.0.1:8025", KEY, FROM, ORIGIN)).toEqual(
      []
    );
    expect(emailWarnings("http://localhost:8025/", KEY, FROM, ORIGIN)).toEqual(
      []
    );
  });

  it("reports a bare http:// origin as both clear text and no path", () => {
    const warnings = emailWarnings("http://api.example.com", KEY, FROM, ORIGIN);
    expect(warnings).toHaveLength(2);
    expect(warnings[0]).toMatch(/clear text/);
    expect(warnings[1]).toMatch(/no path/);
  });

  it("does not add the bare-origin warning to a URL that is already not an http(s) URL", () => {
    expect(emailWarnings("api.resend.com", KEY, FROM, ORIGIN)).toHaveLength(1);
  });

  it("tolerates whitespace around an otherwise good URL, as fetch does", () => {
    expect(emailWarnings(`  ${URL_OK}  `, KEY, FROM, ORIGIN)).toEqual([]);
  });

  it("warns that email without PUBLIC_ORIGIN breaks registration after the account exists", () => {
    const warnings = emailWarnings(URL_OK, KEY, FROM, "");
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(
      /^Email is configured but PUBLIC_ORIGIN is not set/
    );
    expect(warnings[0]).toMatch(/create the account and then fail to send/);
  });

  it("does not raise the origin warning when email is off or the caller does not say", () => {
    expect(emailWarnings(URL_OK, KEY, "", "")).toHaveLength(1);
    expect(emailWarnings(URL_OK, KEY, FROM, undefined)).toEqual([]);
  });

  it("reports every problem it finds", () => {
    expect(
      emailWarnings("http://user:pw@api.example.com/x", KEY, FROM, "")
    ).toHaveLength(3);
  });

  it("is a warning only, with or without a database, and quiet for a caller that does not say", () => {
    expect(configProblems(env({ emailApiUrl: "resend" }))).toEqual([]);
    expect(configWarnings(env({ emailApiUrl: "resend" }))).toHaveLength(2);
    expect(configWarnings(env())).toEqual([]);
    expect(
      configWarnings({
        databaseUrl: "",
        appId: "",
        cookieSecret: "",
        emailApiUrl: URL_OK,
        emailApiKey: KEY,
        emailFrom: FROM,
        publicOrigin: ORIGIN,
      })
    ).toEqual([]);
  });

  it("hands the key, the sender and the origin to the right checks", () => {
    const warnings = configWarnings(
      env({
        emailApiUrl: URL_OK,
        emailApiKey: "  ",
        emailFrom: FROM,
        publicOrigin: "",
      })
    );
    expect(warnings).toHaveLength(2);
    expect(warnings[0]).toMatch(/^EMAIL_API_KEY is only whitespace/);
    expect(warnings[1]).toMatch(/PUBLIC_ORIGIN is not set/);
  });

  describe("EMAIL_FROM itself", () => {
    const warn = (from: string, url = URL_OK) =>
      emailWarnings(url, KEY, from, ORIGIN);

    it.each([
      "notes@mail.acmenotes.dev",
      "Notes <notes@mail.acmenotes.dev>",
      "  Notes <notes@mail.acmenotes.dev>  ",
      '"Acme, Inc." <notes@acme.io>',
      "Acme Notes<notes@acme.io>",
      "no-reply+app@sub.acme.io",
      "<notes@acme.io>",
    ])("is silent for %j", from => {
      expect(emailFromWeaknesses(from, false)).toEqual([]);
      expect(warn(from)).toEqual([]);
    });

    it.each([
      ["Notes", "contains no @"],
      ["notes.acme.io", "contains no @"],
      ["Notes <>", "nothing like an address between its angle brackets"],
      [
        "Notes <notes.acme.io>",
        "nothing like an address between its angle brackets",
      ],
      ["Notes notes@acme.io", "not a single address"],
      ["a@acme.io, b@acme.io", "not a single address"],
      ["a@acme.io;b@acme.io", "not a single address"],
      ["a@b@acme.io", "not a single address"],
      ["Notes <a@acme.io, b@acme.io>", "something other than a single address"],
      ["Notes <a@acme.io\nBcc: x@evil.io>", "newline or control character"],
      ["notes@acme.io\r\nBcc: x@evil.io", "newline or control character"],
      ["notes@acme.io\u0000", "newline or control character"],
      ["notes@acme.io\n", "newline or control character"],
      ["\tnotes@acme.io", "newline or control character"],
      ['"Notes <notes@acme.io>"', "is wrapped in quotes"],
      ["'notes@acme.io'", "is wrapped in quotes"],
      ["notes@example.com", "placeholder or reserved domain"],
      ["Notes <you@example.org>", "placeholder or reserved domain"],
      ["notes@EXAMPLE.NET", "placeholder or reserved domain"],
      ["me@yourdomain.com", "placeholder or reserved domain"],
      ["me@domain.com", "placeholder or reserved domain"],
      ["me@mail.test", "placeholder or reserved domain"],
      ["me@acme.invalid", "placeholder or reserved domain"],
    ])("flags %j", (from, reason) => {
      expect(emailFromWeaknesses(from, false).join(" and ")).toContain(reason);
      const warnings = warn(from);
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toMatch(/^EMAIL_FROM looks wrong/);
    });

    it("does not treat a real domain that merely contains a placeholder as one", () => {
      expect(emailFromWeaknesses("a@example.com.acme.io", false)).toEqual([]);
      expect(emailFromWeaknesses("a@myexample.com", false)).toEqual([]);
      expect(emailFromWeaknesses("a@testing.io", false)).toEqual([]);
    });

    it("lets a placeholder domain through when the provider is a sink on this machine", () => {
      expect(warn("notes@example.com", "http://127.0.0.1:8025/send")).toEqual(
        []
      );
      expect(warn("notes@example.com", "http://localhost:8025/send")).toEqual(
        []
      );
      expect(
        warn("notes@example.com", "https://api.example.com/send")
      ).toHaveLength(1);
    });

    it("still flags a malformed sender when the sink is local", () => {
      expect(warn("Notes", "http://127.0.0.1:8025/send")).toHaveLength(1);
    });

    it("says the provider would reject the send and the reset would be reported as sent", () => {
      const [text] = warn("Notes");
      expect(text).toMatch(/reject every send/);
      expect(text).toMatch(/reported as sent and not be/);
      expect(text).toMatch(/Name <address>/);
    });

    it("leaves a whitespace-only sender to the whitespace warning, not a second one", () => {
      const warnings = emailWarnings(URL_OK, KEY, "   ", ORIGIN);
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toMatch(/only whitespace/);
    });

    it("applies with a partial configuration too", () => {
      const warnings = emailWarnings("", "", "Notes", ORIGIN);
      expect(warnings).toHaveLength(2);
      expect(warnings[1]).toMatch(/^EMAIL_FROM looks wrong/);
    });

    it("never repeats the sender", () => {
      const text = JSON.stringify(warn("zzsender <zzperson@example.com>"));
      expect(text).toContain("looks wrong");
      expect(text).not.toContain("zzsender");
      expect(text).not.toContain("zzperson");
    });
  });

  describe("EMAIL_API_KEY itself", () => {
    const warn = (key: string) => emailWarnings(URL_OK, key, FROM, ORIGIN);

    it.each([
      "re_abc123",
      "SG.abcDEF-ghi_JKL.mno",
      "key-3a4b5c6d7e8f",
      "re_abc123\n",
      "  re_abc123  ",
      "re_abc\t123",
      "re_abc\u00e9123",
      "x".repeat(200),
    ])("is silent for %j, which fetch sends as it is", key => {
      expect(emailKeyWeaknesses(key)).toEqual([]);
      expect(warn(key)).toEqual([]);
    });

    it.each([
      ["re_abc\n123", "cannot be sent in a header"],
      ["re_abc\r123", "cannot be sent in a header"],
      ["re_abc\u0000123", "cannot be sent in a header"],
      ["re_abc\u2019123", "cannot be sent in a header"],
      ["re_abc\u201c", "cannot be sent in a header"],
      ['"re_abc123"', "is wrapped in quotes"],
      ["'re_abc123'", "is wrapped in quotes"],
      ["`re_abc123`", "is wrapped in quotes"],
      ["Bearer re_abc123", "sent twice"],
      ["bearer\tre_abc123", "sent twice"],
      ["changeme", "is a placeholder name"],
      ["your-api-key", "is a placeholder name"],
      ["YOUR_KEY", "is a placeholder name"],
      ["undefined", "is a placeholder name"],
      ["null", "is a placeholder name"],
    ])("flags %j", (key, reason) => {
      expect(emailKeyWeaknesses(key).join(" and ")).toContain(reason);
      const warnings = warn(key);
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toMatch(/^EMAIL_API_KEY looks wrong/);
    });

    it("does not call a key a placeholder because it contains one of the words", () => {
      expect(emailKeyWeaknesses("re_nullable_abc")).toEqual([]);
      expect(emailKeyWeaknesses("apikey_9f8e7d6c")).toEqual([]);
    });

    it("agrees with fetch about what cannot be sent", async () => {
      for (const key of ["re_abc\n123", "re_abc\u2019123"]) {
        await expect(
          fetch("http://127.0.0.1:9/x", {
            method: "POST",
            headers: { authorization: `Bearer ${key}` },
          })
        ).rejects.toThrow(/invalid|ByteString/i);
        expect(emailKeyWeaknesses(key)).not.toEqual([]);
      }
      for (const key of ["re_abc123\n", "  re_abc123", "re_abc\u00e9123"]) {
        await expect(
          fetch("http://127.0.0.1:9/x", {
            method: "POST",
            headers: { authorization: `Bearer ${key}` },
          })
        ).rejects.not.toThrow(/invalid|ByteString/i);
        expect(emailKeyWeaknesses(key)).toEqual([]);
      }
    });

    it("leaves a whitespace-only key to the whitespace warning, not a second one", () => {
      const warnings = warn("   ");
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toMatch(/only whitespace/);
    });

    it("applies with a partial configuration too, and says email stays on", () => {
      const warnings = emailWarnings("", '"abc"', "", ORIGIN);
      expect(warnings).toHaveLength(2);
      expect(warnings[1]).toMatch(/Email stays on/);
    });

    it("never repeats the key", () => {
      const text = JSON.stringify(warn('"zzsecretkey99\u2019x"'));
      expect(text).toContain("looks wrong");
      expect(text).not.toContain("zzsecretkey99");
    });
  });

  it("never repeats a value, since the URL can carry a key", () => {
    const text = JSON.stringify(
      emailWarnings(
        "https://user:hunter2zz@api.example.com/zzpath",
        "keyzz99",
        "zzfrom",
        ""
      )
    );
    for (const leak of [
      "hunter2zz",
      "zzpath",
      "keyzz99",
      "zzfrom",
      "api.example.com",
    ]) {
      expect(text).not.toContain(leak);
    }
  });
});

describe("GOOGLE_CLIENT_ID and the settings Google sign-in needs", () => {
  // Built at run time, so that no complete client ID or client secret sits in
  // the repo as a literal: GitHub's push protection matches the shape, not the
  // value, and these are fixtures.
  const HOST = [".apps", "googleusercontent", "com"].join(".");
  const idOf = (head: string) => `${head}${HOST}`;
  const secretOf = (tail: string) => ["GOCSPX", tail].join("-");
  const ID = idOf("123456789012-abcdefghijklmnopqrstuvwxyz012345");
  const SECRET = secretOf("notarealsecretzz");
  const ORIGIN = "https://notes.example.com";

  it("is silent when nothing is set, which is how Google sign-in is turned off", () => {
    expect(googleWarnings("", "", "")).toEqual([]);
    expect(googleWarnings("", "", ORIGIN)).toEqual([]);
    expect(googleWarnings("", "", undefined)).toEqual([]);
  });

  it("is silent for a complete, sane configuration", () => {
    expect(googleWarnings(ID, SECRET, ORIGIN)).toEqual([]);
  });

  it.each([
    idOf("123456789012-abc"),
    idOf("123456789012-ABCdef").toUpperCase(),
    idOf("1-a"),
  ])("accepts the ID %j", id => {
    expect(googleClientIdWeaknesses(id)).toEqual([]);
  });

  it.each([
    [
      [ID, "", ORIGIN],
      "GOOGLE_CLIENT_ID is set but GOOGLE_CLIENT_SECRET is not",
    ],
    [
      ["", SECRET, ORIGIN],
      "GOOGLE_CLIENT_SECRET is set but GOOGLE_CLIENT_ID is not",
    ],
    [
      [ID, SECRET, ""],
      "GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are set but PUBLIC_ORIGIN is not",
    ],
    [
      [ID, "", ""],
      "GOOGLE_CLIENT_ID is set but GOOGLE_CLIENT_SECRET and PUBLIC_ORIGIN are not",
    ],
  ])(
    "names what is set and what is missing for %j",
    ([id, secret, origin], text) => {
      const warnings = googleWarnings(id, secret, origin);
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain(text);
      expect(warnings[0]).toMatch(/Google sign-in stays off/);
    }
  );

  it("does not count a missing PUBLIC_ORIGIN against a caller that does not say", () => {
    expect(googleWarnings(ID, SECRET, undefined)).toEqual([]);
  });

  it.each([
    [`${ID}\n`, "contains whitespace"],
    [` ${ID}`, "contains whitespace"],
    [idOf("1234 5678"), "contains whitespace"],
    [`"${ID}"`, "is wrapped in quotes"],
    [`'${ID}'`, "is wrapped in quotes"],
    ["GOCSPX-abcdefghijklmnop", "looks like a client secret"],
    ["your-client-id", "does not end in .apps.googleusercontent.com"],
    ["123456789012-abc", "does not end in .apps.googleusercontent.com"],
    [
      "123456789012-abc.googleusercontent.com",
      "does not end in .apps.googleusercontent.com",
    ],
    [
      `${idOf("123456789012-abc")}.evil.io`,
      "does not end in .apps.googleusercontent.com",
    ],
    ["   ", "contains whitespace"],
  ])("flags the ID %j", (id, reason) => {
    expect(googleClientIdWeaknesses(id).join(" and ")).toContain(reason);
    const warnings = googleWarnings(id, SECRET, ORIGIN);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/^GOOGLE_CLIENT_ID looks wrong/);
  });

  it("agrees with the audience check about stray whitespace and quotes", async () => {
    const { SignJWT, jwtVerify } = await import("jose");
    const key = new TextEncoder().encode("k".repeat(32));
    const token = await new SignJWT({})
      .setProtectedHeader({ alg: "HS256" })
      .setAudience(ID)
      .setExpirationTime("5m")
      .sign(key);
    await expect(jwtVerify(token, key, { audience: ID })).resolves.toBeTruthy();
    for (const bad of [`${ID}\n`, ` ${ID}`, `"${ID}"`]) {
      await expect(jwtVerify(token, key, { audience: bad })).rejects.toThrow(
        /aud/
      );
      expect(googleClientIdWeaknesses(bad)).not.toEqual([]);
    }
  });

  it("notices an ID and a secret pasted the wrong way round, in both fields", () => {
    const warnings = googleWarnings(SECRET, ID, ORIGIN);
    expect(warnings).toHaveLength(2);
    expect(warnings[0]).toMatch(/^GOOGLE_CLIENT_ID looks wrong/);
    expect(warnings[1]).toMatch(
      /^GOOGLE_CLIENT_SECRET ends in \.apps\.googleusercontent\.com/
    );
  });

  describe("GOOGLE_CLIENT_SECRET itself", () => {
    const warn = (secret: string) => googleWarnings(ID, secret, ORIGIN);

    it.each([
      secretOf("AbCdEfGhIjKlMnOpQrStUvWxYz12"),
      secretOf("a_b-C_d-E_f-G_h-I_j-K_l-M_n-"),
      "AbCdEfGhIjKlMnOpQrStUvWx",
      "a1B2c3D4e5F6g7H8i9J0kLmN",
      "x".repeat(60),
    ])("is silent for %j, whichever format Google issued", secret => {
      expect(googleClientSecretWeaknesses(secret)).toEqual([]);
      expect(warn(secret)).toEqual([]);
    });

    it("does not require the GOCSPX- prefix, which older secrets never had", () => {
      expect(warn("AbCdEfGhIjKlMnOpQrStUvWx")).toEqual([]);
    });

    it.each([
      ["GOCSPX-abc\n", "contains whitespace"],
      [" GOCSPX-abc", "contains whitespace"],
      ["GOCSPX abc", "contains whitespace"],
      ['"GOCSPX-abcdef"', "is wrapped in quotes"],
      ["'GOCSPX-abcdef'", "is wrapped in quotes"],
      [
        '{"web":{"client_id":"x","client_secret":"y"}}',
        "looks like the downloaded JSON file",
      ],
      ['"client_secret":"GOCSPX-abc"', "looks like the downloaded JSON file"],
      [
        "GOCSPX-abc\u2019def",
        "contains characters a Google client secret does not have",
      ],
      [
        "GOCSPX-abc.def",
        "contains characters a Google client secret does not have",
      ],
      [
        "GOCSPX-abc/def+ghi=",
        "contains characters a Google client secret does not have",
      ],
      ["changeme", "is a placeholder name"],
      ["your-client-secret", "is a placeholder name"],
      ["CLIENT_SECRET", "is a placeholder name"],
      ["undefined", "is a placeholder name"],
      ["null", "is a placeholder name"],
    ])("flags %j", (secret, reason) => {
      expect(googleClientSecretWeaknesses(secret).join(" and ")).toContain(
        reason
      );
      const warnings = warn(secret);
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toMatch(/^GOOGLE_CLIENT_SECRET looks wrong/);
    });

    it("gives one specific reason rather than the general one on top of it", () => {
      expect(googleClientSecretWeaknesses("GOCSPX-abc\n")).toHaveLength(1);
      expect(googleClientSecretWeaknesses('"GOCSPX-abc"')).toHaveLength(1);
    });

    it("does not call a secret a placeholder because it contains a word", () => {
      expect(
        googleClientSecretWeaknesses("GOCSPX-nullable_clientsecret")
      ).toEqual([]);
    });

    it("says it fails at the last step, after the person has approved", () => {
      const [text] = warn("changeme");
      expect(text).toMatch(
        /fails every Google sign-in after the person has already approved it/
      );
    });

    it("leaves the swapped-over ID to its own warning, not a second one", () => {
      const warnings = warn(idOf("123456789012-abc"));
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toMatch(/pasted the wrong way round/);
    });

    it("checks the value as it is sent, since a form body encodes a newline and does not trim it", () => {
      const body = new URLSearchParams({
        client_secret: "GOCSPX-abc\n",
      }).toString();
      expect(body).toContain("%0A");
      expect(googleClientSecretWeaknesses("GOCSPX-abc\n")).not.toEqual([]);
    });

    it("applies even when the ID is missing", () => {
      const warnings = googleWarnings("", "changeme", ORIGIN);
      expect(warnings).toHaveLength(2);
      expect(warnings[1]).toMatch(/^GOOGLE_CLIENT_SECRET looks wrong/);
    });

    it("never repeats the secret", () => {
      const text = JSON.stringify(warn('"zzsecretvalue77\u2019x"'));
      expect(text).toContain("looks wrong");
      expect(text).not.toContain("zzsecretvalue77");
    });
  });

  it("reports a bad ID alongside a missing setting", () => {
    expect(googleWarnings("nope", "", ORIGIN)).toHaveLength(2);
  });

  it("is a warning only, with or without a database, and quiet for a caller that does not say", () => {
    expect(configProblems(env({ googleClientId: "nope" }))).toEqual([]);
    expect(
      configWarnings(env({ googleClientId: "nope", publicOrigin: ORIGIN }))
    ).toHaveLength(2);
    expect(configWarnings(env())).toEqual([]);
    expect(
      configWarnings({
        databaseUrl: "",
        appId: "",
        cookieSecret: "",
        googleClientId: ID,
        googleClientSecret: SECRET,
        publicOrigin: ORIGIN,
      })
    ).toEqual([]);
  });

  it("hands the secret and the origin to the right checks", () => {
    const warnings = configWarnings(
      env({ googleClientId: ID, googleClientSecret: "", publicOrigin: "" })
    );
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain(
      "GOOGLE_CLIENT_SECRET and PUBLIC_ORIGIN are not"
    );
  });

  it("never repeats the ID or the secret", () => {
    const text = JSON.stringify(
      googleWarnings("zzclientid77 ", idOf("zzsecret88"), "")
    );
    expect(text).toContain("looks wrong");
    expect(text).not.toContain("zzclientid77");
    expect(text).not.toContain("zzsecret88");
  });
});

describe("OAUTH_SERVER_URL", () => {
  it.each([
    "",
    "https://oauth.example.com",
    "https://oauth.example.com/",
    "https://oauth.example.com:8443",
    "https://oauth.example.com/api",
    "  https://oauth.example.com\n",
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://[::1]:3000",
    "http://auth.localhost",
  ])("is silent for %j", url => {
    expect(oauthServerUrlWarning(url)).toBeNull();
  });

  it.each([
    "oauth.example.com",
    "oauth.example.com:8443",
    "127.0.0.1:3000",
    "https://",
    "ftp://oauth.example.com",
    "mailto:me@example.com",
    "//oauth.example.com",
  ])("flags %j as not an absolute http(s) URL", url => {
    expect(oauthServerUrlWarning(url)).toMatch(
      /^OAUTH_SERVER_URL looks wrong: it is not an absolute http\(s\) URL/
    );
    expect(oauthServerUrlWarning(url)).toMatch(/token exchange/);
  });

  it("says quotes were probably pasted in", () => {
    expect(oauthServerUrlWarning('"https://oauth.example.com"')).toMatch(
      /begins or ends with a quote/
    );
    expect(oauthServerUrlWarning("oauth.example.com")).not.toMatch(/quote/);
  });

  it("flags credentials, which are sent as Basic auth and printed at startup", () => {
    const text = oauthServerUrlWarning("https://user:pw@oauth.example.com")!;
    expect(text).toMatch(/contains a username or password/);
    expect(text).toMatch(/printed in the startup log line/);
    expect(oauthServerUrlWarning("https://:pw@oauth.example.com")).toMatch(
      /username or password/
    );
  });

  it("flags http:// to a real host, where the code and token cross in clear text", () => {
    expect(oauthServerUrlWarning("http://oauth.example.com")).toMatch(
      /clear text/
    );
  });

  it("reports both problems in one warning when both are present", () => {
    const text = oauthServerUrlWarning("http://user:pw@oauth.example.com")!;
    expect(text).toMatch(/username or password/);
    expect(text).toMatch(/uses http:\/\/ to a real host/);
  });

  it("agrees with axios about what works and what does not", async () => {
    const { default: axios } = await import("axios");
    for (const bad of [
      "oauth.example.invalid",
      "127.0.0.1:3000",
      '"https://x.invalid"',
    ]) {
      await expect(
        axios.create({ baseURL: bad }).post("/x", {})
      ).rejects.toMatchObject({ code: "ERR_INVALID_URL" });
      expect(oauthServerUrlWarning(bad)).not.toBeNull();
    }
    await expect(
      axios.create({ baseURL: "ftp://127.0.0.1:9" }).post("/x", {})
    ).rejects.toThrow(/Unsupported protocol/);
  });

  it("is a warning only, with or without a database, and quiet for a caller that does not say", () => {
    expect(configProblems(env({ oAuthServerUrl: "nope" }))).toEqual([]);
    expect(configWarnings(env({ oAuthServerUrl: "nope" }))).toHaveLength(1);
    expect(configWarnings(env())).toEqual([]);
    expect(
      configWarnings({
        databaseUrl: "",
        appId: "",
        cookieSecret: "",
        oAuthServerUrl: "nope",
      })
    ).toHaveLength(1);
  });

  it("never repeats any part of the value, since it may hold credentials", () => {
    for (const url of [
      "https://admin:hunter2zz@oauth.example.com/zzpath",
      '"zzhost.example.com"',
      "ftp://hunter2zz",
      "http://hunter2zz:pw@zzhost.example.com",
    ]) {
      const text = oauthServerUrlWarning(url)!;
      expect(text).toBeTruthy();
      for (const leak of ["hunter2zz", "zzpath", "zzhost", "admin"]) {
        expect(text).not.toContain(leak);
      }
    }
  });
});

describe("RECAPTCHA_SECRET_KEY and the site key it pairs with", () => {
  // Built at run time so no key-shaped literal sits in the repo.
  const key = (seed: number) => random(40, seed, BASE64.replace(/[+/]/g, "_"));
  const SITE = key(31);
  const SECRET = key(32);
  const TEST_SECRET = ["6LeIxAcT", "AAAAAGG-vFI1TnRWxMZNFuojJ4WifJWe"].join("");

  it("is silent when neither is set, which is how reCAPTCHA is turned off", () => {
    expect(recaptchaWarnings("", "")).toEqual([]);
  });

  it("is silent for a pair of ordinary keys", () => {
    expect(recaptchaWarnings(SITE, SECRET)).toEqual([]);
  });

  it("accepts every key shape Google issues, across many random ones", () => {
    for (let i = 0; i < 500; i++) {
      expect(recaptchaWarnings(key(100 + i), key(900 + i))).toEqual([]);
    }
  });

  it("says one key without the other leaves the check off, in both directions", () => {
    for (const [site, secret, set, missing] of [
      [SITE, "", "RECAPTCHA_SITE_KEY", "RECAPTCHA_SECRET_KEY"],
      ["", SECRET, "RECAPTCHA_SECRET_KEY", "RECAPTCHA_SITE_KEY"],
    ]) {
      const warnings = recaptchaWarnings(site, secret);
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain(`${set} is set but ${missing} is not`);
      expect(warnings[0]).toMatch(/reCAPTCHA is off/);
      expect(warnings[0]).toMatch(/no robot check at all/);
    }
  });

  it.each([
    [`${SECRET}\n`, "contains whitespace"],
    [` ${SECRET}`, "contains whitespace"],
    [`6Lxxxx 6Lxxxx`, "contains whitespace"],
    [`"${SECRET}"`, "is wrapped in quotes"],
    [`'${SECRET}'`, "is wrapped in quotes"],
    [`${SECRET}\u2019`, "contains characters a reCAPTCHA key does not have"],
    [`${SECRET}.`, "contains characters a reCAPTCHA key does not have"],
    ["changeme", "is a placeholder name"],
    ["your-secret-key", "is a placeholder name"],
    ["SECRET_KEY", "is a placeholder name"],
    ["undefined", "is a placeholder name"],
  ])("flags the secret %j", (secret, reason) => {
    expect(recaptchaSecretWeaknesses(secret, SITE).join(" and ")).toContain(
      reason
    );
    const warnings = recaptchaWarnings(SITE, secret);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/^RECAPTCHA_SECRET_KEY looks wrong/);
  });

  it("says a wrong secret locks everyone out, since a rejected check refuses the request", () => {
    const [text] = recaptchaWarnings(SITE, "changeme");
    expect(text).toMatch(/fails the check closed/);
    expect(text).toMatch(
      /every email sign-in, registration and password reset would be refused/
    );
    expect(text).toMatch(/invalid-input-secret/);
  });

  it("flags a secret that is the site key pasted twice", () => {
    const warnings = recaptchaWarnings(SITE, SITE);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/same value as RECAPTCHA_SITE_KEY/);
    expect(recaptchaSecretWeaknesses(SITE, "")).toEqual([]);
  });

  it("flags Google's published test secret as the opposite failure: nothing is protected", () => {
    const warnings = recaptchaWarnings(SITE, TEST_SECRET);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(
      /published test secret, which passes every verification/
    );
    expect(warnings[0]).not.toMatch(/locks|refused/);
    expect(recaptchaWarnings(SITE, ` ${TEST_SECRET}\n`)).toHaveLength(1);
  });

  it("does not call a secret a placeholder because it contains a word", () => {
    expect(recaptchaSecretWeaknesses("6L_nullable_secretkey_ab", SITE)).toEqual(
      []
    );
  });

  it("flags a whitespace-only secret, which the server counts as set, so reCAPTCHA is on and nothing passes", () => {
    const warnings = recaptchaWarnings(SITE, "   ");
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/contains whitespace/);
    expect(warnings[0]).toMatch(/fails the check closed/);
  });

  it("reports a bad secret alongside a missing site key", () => {
    expect(recaptchaWarnings("", "changeme")).toHaveLength(2);
  });

  it("is a warning only, with or without a database, and quiet for a caller that does not say", () => {
    expect(configProblems(env({ recaptchaSecretKey: "changeme" }))).toEqual([]);
    expect(
      configWarnings(env({ recaptchaSecretKey: "changeme" }))
    ).toHaveLength(2);
    expect(configWarnings(env())).toEqual([]);
    expect(
      configWarnings({
        databaseUrl: "",
        appId: "",
        cookieSecret: "",
        recaptchaSiteKey: SITE,
        recaptchaSecretKey: SECRET,
      })
    ).toEqual([]);
  });

  describe("RECAPTCHA_SITE_KEY itself", () => {
    const TEST_SITE = ["6LeIxAcT", "AAAAAJcZVRqyHh71UMIEGNQ_MXjiZKhI"].join("");
    const warn = (site: string) => recaptchaWarnings(site, SECRET);

    it("is silent for ordinary keys", () => {
      expect(warn(SITE)).toEqual([]);
      expect(recaptchaSiteKeyWeaknesses(SITE)).toEqual([]);
    });

    it.each([
      [`${SITE}\n`, "contains whitespace"],
      [` ${SITE}`, "contains whitespace"],
      ["   ", "contains whitespace"],
      [`"${SITE}"`, "is wrapped in quotes"],
      [`'${SITE}'`, "is wrapped in quotes"],
      [`${SITE}\u2019`, "contains characters a reCAPTCHA key does not have"],
      [`${SITE}/`, "contains characters a reCAPTCHA key does not have"],
      ["changeme", "is a placeholder name"],
      ["your-site-key", "is a placeholder name"],
      ["SITE_KEY", "is a placeholder name"],
      ["undefined", "is a placeholder name"],
    ])("flags the site key %j", (site, reason) => {
      expect(recaptchaSiteKeyWeaknesses(site).join(" and ")).toContain(reason);
      const warnings = warn(site);
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toMatch(/^RECAPTCHA_SITE_KEY looks wrong/);
    });

    it("says a bad site key locks everyone out from the browser's side", () => {
      const [text] = warn("changeme");
      expect(text).toMatch(/nobody able to tick the box/);
      expect(text).toMatch(/Confirm you are not a robot first/);
      expect(text).toMatch(/email sign-in, registration and password reset/);
    });

    it("flags Google's published test site key as for testing, not as a lock-out", () => {
      const warnings = warn(TEST_SITE);
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toMatch(/published test site key/);
      expect(warnings[0]).toMatch(/testing banner/);
      expect(warnings[0]).not.toMatch(/Confirm you are not a robot first/);
      expect(warn(` ${TEST_SITE}\n`)).toHaveLength(1);
    });

    it("reports a pair of Google's test keys once for each", () => {
      const both = recaptchaWarnings(
        TEST_SITE,
        ["6LeIxAcT", "AAAAAGG-vFI1TnRWxMZNFuojJ4WifJWe"].join("")
      );
      expect(both).toHaveLength(2);
      expect(both[0]).toMatch(
        /^RECAPTCHA_SITE_KEY is Google's published test site key/
      );
      expect(both[1]).toMatch(
        /^RECAPTCHA_SECRET_KEY is Google's published test secret/
      );
    });

    it("reports a key pasted into both fields once, against the secret", () => {
      const warnings = recaptchaWarnings(SITE, SITE);
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toMatch(/^RECAPTCHA_SECRET_KEY/);
    });

    it("reports a bad value pasted into both fields once, not once per field", () => {
      const warnings = recaptchaWarnings("changeme", "changeme");
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toMatch(/^RECAPTCHA_SECRET_KEY looks wrong/);
      expect(warnings[0]).toMatch(/same value as RECAPTCHA_SITE_KEY/);
    });

    it("does not call a key a placeholder because it contains a word", () => {
      expect(recaptchaSiteKeyWeaknesses("6L_nullable_sitekey_ab")).toEqual([]);
    });

    it("applies with no secret too, alongside the lone-key message", () => {
      const warnings = recaptchaWarnings("changeme", "");
      expect(warnings).toHaveLength(2);
      expect(warnings[0]).toMatch(/reCAPTCHA is off/);
      expect(warnings[1]).toMatch(/^RECAPTCHA_SITE_KEY looks wrong/);
    });

    it("reports a bad site key and a bad secret separately", () => {
      expect(recaptchaWarnings("changeme", "your-secret-key")).toHaveLength(2);
    });

    it("is carried through the startup warnings", () => {
      const warnings = configWarnings(
        env({ recaptchaSiteKey: "changeme", recaptchaSecretKey: SECRET })
      );
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toMatch(/^RECAPTCHA_SITE_KEY looks wrong/);
    });

    it("never repeats the key, even though it is public", () => {
      const text = JSON.stringify([
        ...warn('"zzsitekey555\u2019"'),
        ...warn(TEST_SITE),
      ]);
      expect(text).toContain("looks wrong");
      for (const leak of ["zzsitekey555", TEST_SITE, "6LeIxAcT"]) {
        expect(text).not.toContain(leak);
      }
    });
  });

  it("hands the site key to the right check", () => {
    const warnings = configWarnings(
      env({ recaptchaSiteKey: SITE, recaptchaSecretKey: SITE })
    );
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/same value as RECAPTCHA_SITE_KEY/);
  });

  it("never repeats either key", () => {
    const text = JSON.stringify([
      ...recaptchaWarnings("zzsite999", '"zzsecret777\u2019"'),
      ...recaptchaWarnings("zzsite999", TEST_SECRET),
    ]);
    expect(text).toContain("looks wrong");
    for (const leak of ["zzsite999", "zzsecret777", TEST_SECRET, "6LeIxAcT"]) {
      expect(text).not.toContain(leak);
    }
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

describe("BUILT_IN_FORGE_API_URL", () => {
  it.each([
    "",
    "   ",
    "https://api.example.com",
    "https://api.example.com/",
    "https://api.example.com///",
    "https://api.example.com:8443/proxy",
    "  https://api.example.com\n",
    "http://localhost:8080",
    "http://127.0.0.1:8080",
    "http://[::1]:8080",
    "http://llm.localhost",
  ])("is silent for %j", url => {
    expect(forgeApiUrlWarning(url)).toBeNull();
  });

  it.each([
    "api.example.com",
    "api.example.com:8443",
    "https://",
    "ftp://api.example.com",
    "//api.example.com",
    '"https://api.example.com"',
    "'https://api.example.com'",
  ])("flags %j as not an absolute http(s) URL", url => {
    expect(forgeApiUrlWarning(url)).toMatch(
      /^BUILT_IN_FORGE_API_URL is not an absolute http\(s\) URL/
    );
  });

  it("says when a quote is the reason", () => {
    expect(forgeApiUrlWarning('"https://api.example.com"')).toContain(
      "begins or ends with a quote"
    );
    expect(forgeApiUrlWarning("api.example.com")).not.toContain("quote");
  });

  it.each([
    ["https://user:pw@api.example.com", "contains a username or password"],
    ["https://api.example.com/?a=b", "has a query or fragment"],
    ["https://api.example.com/#x", "has a query or fragment"],
    ["https://api.example.com/v1", "already ends in /v1"],
    ["https://api.example.com/v1/", "already ends in /v1"],
    ["https://api.example.com/api/v1", "already ends in /v1"],
    ["http://api.example.com", "uses http://"],
  ])("flags %j", (url, reason) => {
    const text = forgeApiUrlWarning(url);
    expect(text).toMatch(/^BUILT_IN_FORGE_API_URL looks wrong/);
    expect(text).toContain(reason);
  });

  it("does not call a path that merely contains v1 doubled", () => {
    expect(forgeApiUrlWarning("https://api.example.com/v1beta")).toBeNull();
    expect(forgeApiUrlWarning("https://api.example.com/v1/proxy")).toBeNull();
  });

  it("reports several problems in one warning", () => {
    const text = forgeApiUrlWarning("http://u:p@api.example.com/v1?x=1")!;
    expect(text).toContain("username or password");
    expect(text).toContain("query or fragment");
    expect(text).toContain("/v1");
    expect(text).toContain("clear text");
    expect(text.match(/looks wrong/g)).toHaveLength(1);
  });

  it("never repeats the value, which can hold credentials", () => {
    const text = forgeApiUrlWarning("https://user:hunter2@api.example.com/v1")!;
    expect(text).not.toContain("hunter2");
    expect(text).not.toContain("user:");
  });

  it("is carried through configWarnings, and silent when unset", () => {
    const warnings = configWarnings(env({ forgeApiUrl: "api.example.com" }));
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/^BUILT_IN_FORGE_API_URL/);
    expect(configWarnings(env({ forgeApiUrl: "" }))).toEqual([]);
    expect(configWarnings(env({}))).toEqual([]);
  });
});

describe("BUILT_IN_FORGE_MODEL", () => {
  const OTHER = "https://api.example.com";

  it.each([
    "gemini-2.5-flash",
    "gpt-4o",
    "anthropic/claude-3.5-sonnet",
    "llama3.2:3b",
    "  gemini-2.5-pro\n",
    "mistral-large@latest",
  ])("is silent for the model %j", model => {
    expect(forgeModelWarnings(model, "")).toEqual([]);
    expect(forgeModelWarnings(model, OTHER)).toEqual([]);
  });

  it.each([
    ["gemini 2.5 flash", "contains whitespace"],
    ['"gpt-4o"', "is wrapped in quotes"],
    ["'gpt-4o", "is wrapped in quotes"],
    ["gpt-4o'", "is wrapped in quotes"],
    ["https://api.example.com/gpt-4o", "looks like a URL"],
    ["<model-name>", "angle brackets"],
    ["changeme", "is a placeholder name"],
    ["Your-Model", "is a placeholder name"],
    ["model", "is a placeholder name"],
    ["undefined", "is a placeholder name"],
  ])("flags the model %j", (model, reason) => {
    const [text, ...rest] = forgeModelWarnings(model, "");
    expect(rest).toEqual([]);
    expect(text).toMatch(/^BUILT_IN_FORGE_MODEL looks wrong/);
    expect(text).toContain(reason);
    expect(text).toContain("most likely");
  });

  it("does not call a model that merely contains the word model a placeholder", () => {
    expect(forgeModelWarnings("my-model-v2", "")).toEqual([]);
    expect(forgeModelWarnings("gpt-4o-model", "")).toEqual([]);
  });

  it("reports several problems in one warning, and says nothing about the URL then", () => {
    const warnings = forgeModelWarnings('"<changeme>"', OTHER);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].match(/looks wrong/g)).toHaveLength(1);
  });

  it("warns when the URL points elsewhere and no model is set", () => {
    for (const url of [
      OTHER,
      " https://api.example.com/v1 ",
      "http://localhost:11434",
    ]) {
      const warnings = forgeModelWarnings("", url);
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toMatch(
        /^BUILT_IN_FORGE_API_URL points away from the built-in provider but BUILT_IN_FORGE_MODEL is not set/
      );
      expect(warnings[0]).toContain("gemini-2.5-flash");
    }
    expect(forgeModelWarnings("   ", OTHER)).toHaveLength(1);
  });

  it("is silent when no URL is set, or it is the built-in provider's", () => {
    expect(forgeModelWarnings("", "")).toEqual([]);
    expect(forgeModelWarnings("", "   ")).toEqual([]);
    expect(forgeModelWarnings("", "https://forge.manus.im")).toEqual([]);
    expect(forgeModelWarnings("", "https://forge.manus.im/")).toEqual([]);
  });

  it("leaves a URL it cannot read to the URL's own check", () => {
    expect(forgeModelWarnings("", "api.example.com")).toEqual([]);
    expect(forgeModelWarnings("", '"https://api.example.com"')).toEqual([]);
  });

  it("never repeats the value", () => {
    const secret = "do-not-print-this-model";
    const text = forgeModelWarnings(`"${secret} x"`, "").join(" ");
    expect(text).toContain("BUILT_IN_FORGE_MODEL");
    expect(text).not.toContain(secret);
  });

  it("is carried through configWarnings, and silent when unset", () => {
    expect(configWarnings(env({ forgeModel: "gpt 4o" }))).toHaveLength(1);
    expect(
      configWarnings(env({ forgeModel: "", forgeApiUrl: OTHER }))
    ).toHaveLength(1);
    expect(
      configWarnings(env({ forgeModel: "gpt-4o", forgeApiUrl: OTHER }))
    ).toEqual([]);
    expect(configWarnings(env({ forgeModel: "", forgeApiUrl: "" }))).toEqual(
      []
    );
    expect(configWarnings(env({}))).toEqual([]);
  });
});

describe("OWNER_OPEN_ID", () => {
  const UUID = "3f2b8c1e-9a4d-4e6b-8c7a-1d2e3f4a5b6c";

  it.each([
    "",
    `email:${UUID}`,
    "google:113822991204518327310",
    "portal-open-id-abc123",
    "a".repeat(64),
  ])("is silent for %j", id => {
    expect(ownerOpenIdWarnings(id, true)).toEqual([]);
  });

  it.each([
    [`email:${UUID}\n`, "contains whitespace"],
    [` email:${UUID}`, "contains whitespace"],
    [`"email:${UUID}"`, "is wrapped in quotes"],
    [`'google:113822991204518327310'`, "is wrapped in quotes"],
    ["a".repeat(65), "is longer than 64 characters"],
  ])("flags %j", (id, reason) => {
    const [text, ...rest] = ownerOpenIdWarnings(id, true);
    expect(rest).toEqual([]);
    expect(text).toMatch(/^OWNER_OPEN_ID looks wrong/);
    expect(text).toContain(reason);
    expect(text).toMatch(/nobody would be made an admin/);
  });

  it("flags an email: id that is not the generated UUID", () => {
    for (const id of [
      "email:me@example.com",
      "email:not-a-uuid",
      `email:${UUID.slice(0, -1)}`,
      "email:",
    ]) {
      expect(ownerOpenIdWarnings(id, true)[0]).toContain(
        "not followed by the UUID the server generates"
      );
    }
  });

  it("names uppercase as the reason when only the case is off", () => {
    const text = ownerOpenIdWarnings(`email:${UUID.toUpperCase()}`, true)[0];
    expect(text).toContain("uppercase letters after email:");
    expect(text).not.toContain("not followed by the UUID");
  });

  it("flags an address, and an address after google:", () => {
    expect(ownerOpenIdWarnings("me@example.com", true)[0]).toContain(
      "looks like an email address"
    );
    expect(ownerOpenIdWarnings("google:me@example.com", true)[0]).toContain(
      "@ after google:"
    );
  });

  it("does not call an email: id's own UUID an address", () => {
    expect(ownerOpenIdWarnings(`email:${UUID}`, true)).toEqual([]);
  });

  it("reports several problems in one warning", () => {
    const [text, ...rest] = ownerOpenIdWarnings('"me@example.com"\n', true);
    expect(rest).toEqual([]);
    expect(text).toContain("whitespace");
    expect(text).toContain("quotes");
    expect(text).toContain("email address");
    expect(text.match(/looks wrong/g)).toHaveLength(1);
  });

  it("says a value with no database has no effect, alongside any other problem", () => {
    const alone = ownerOpenIdWarnings(`email:${UUID}`, false);
    expect(alone).toHaveLength(1);
    expect(alone[0]).toMatch(/^OWNER_OPEN_ID is set but DATABASE_URL is not/);
    expect(ownerOpenIdWarnings('"x"', false)).toHaveLength(2);
    expect(ownerOpenIdWarnings("", false)).toEqual([]);
  });

  it("never repeats the value", () => {
    const secret = "do-not-print-this-id";
    const text = ownerOpenIdWarnings(`${secret}@x\n`, false).join(" ");
    expect(text).toContain("OWNER_OPEN_ID");
    expect(text).not.toContain(secret);
  });

  it("is carried through configWarnings, and silent when unset", () => {
    const withDb = { databaseUrl: "mysql://u:p@h:3306/db" };
    expect(
      configWarnings(env({ ...withDb, ownerOpenId: "me@example.com" }))
    ).toHaveLength(1);
    expect(configWarnings(env({ ...withDb, ownerOpenId: "" }))).toEqual([]);
    expect(configWarnings(env(withDb))).toEqual([]);
    expect(
      configWarnings(env({ databaseUrl: "", ownerOpenId: `email:${UUID}` }))
    ).toHaveLength(1);
  });
});

describe("BUILT_IN_FORGE_API_KEY", () => {
  it.each([
    "",
    "sk-proj-AbC123_xyz",
    "  sk-abc123\n",
    "AIzaSyExample-Key_123",
    "key with an inner space",
  ])("is silent for %j", key => {
    expect(forgeApiKeyWarning(key)).toBeNull();
  });

  it.each([" ", "   ", "\n", "\t \r\n"])("says %j is set but empty", key => {
    expect(forgeApiKeyWarning(key)).toMatch(
      /^BUILT_IN_FORGE_API_KEY is only whitespace/
    );
  });

  it.each([
    ["sk-ab\nc123", "contains a newline"],
    ["sk-ab\u0000c", "contains a newline"],
    ["sk-abc\u2019123", "outside Latin-1"],
    ['"sk-abc123"', "is wrapped in quotes"],
    ["'sk-abc123'", "is wrapped in quotes"],
    ['"sk-abc123', "is wrapped in quotes"],
    ['sk-abc123"', "is wrapped in quotes"],
    ["Bearer sk-abc123", "starts with `Bearer `"],
    ["bearer sk-abc123", "starts with `Bearer `"],
    ["changeme", "is a placeholder name"],
    ["Your-API-Key", "is a placeholder name"],
    ["undefined", "is a placeholder name"],
  ])("flags %j", (key, reason) => {
    const text = forgeApiKeyWarning(key);
    expect(text).toMatch(/^BUILT_IN_FORGE_API_KEY looks wrong/);
    expect(text).toContain(reason);
  });

  it("judges what is sent, not the padding around it", () => {
    expect(forgeApiKeyWarning('\n"sk-abc123"\n')).toContain("quotes");
    expect(forgeApiKeyWarning("\n changeme \n")).toContain("placeholder");
    expect(forgeApiKeyWarning("\nsk-ab\nc\n")).toContain("newline");
  });

  it("reports several problems in one warning", () => {
    const text = forgeApiKeyWarning('"Bearer changeme"')!;
    expect(text).toContain("quotes");
    expect(text.match(/looks wrong/g)).toHaveLength(1);
  });

  it("never repeats the value", () => {
    const secret = "do-not-print-this-key";
    for (const key of [
      `"${secret}"`,
      `Bearer ${secret}`,
      `${secret}\n${secret}`,
    ]) {
      expect(forgeApiKeyWarning(key)!).not.toContain(secret);
    }
  });

  it("is carried through configWarnings, and silent when unset", () => {
    const warnings = configWarnings(env({ forgeApiKey: '"sk-abc123"' }));
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/^BUILT_IN_FORGE_API_KEY/);
    expect(configWarnings(env({ forgeApiKey: "" }))).toEqual([]);
    expect(configWarnings(env({}))).toEqual([]);
  });
});

describe("BUILT_IN_FORGE_TRANSCRIPTION_MODEL", () => {
  it.each([
    "",
    "   ",
    "whisper-1",
    "whisper-large-v3",
    "openai/whisper-large-v3-turbo",
    "  whisper-1\n",
    "gpt-4o-transcribe",
  ])("is silent for %j", model => {
    expect(forgeTranscriptionModelWarnings(model)).toEqual([]);
  });

  it.each([
    ["whisper 1", "contains whitespace"],
    ['"whisper-1"', "is wrapped in quotes"],
    ["'whisper-1", "is wrapped in quotes"],
    ["whisper-1'", "is wrapped in quotes"],
    ["https://api.example.com/whisper", "looks like a URL"],
    ["<whisper-model>", "angle brackets"],
    ["changeme", "is a placeholder name"],
    ["Model-Name", "is a placeholder name"],
    ["undefined", "is a placeholder name"],
  ])("flags %j", (model, reason) => {
    const [text, ...rest] = forgeTranscriptionModelWarnings(model);
    expect(rest).toEqual([]);
    expect(text).toMatch(/^BUILT_IN_FORGE_TRANSCRIPTION_MODEL looks wrong/);
    expect(text).toContain(reason);
    expect(text).toContain("voice transcription");
    expect(text).toContain("whisper-1");
  });

  it("is a different warning from the chat model's, with its own wording", () => {
    const chat = forgeModelWarnings("bad model", "")[0];
    const voice = forgeTranscriptionModelWarnings("bad model")[0];
    expect(chat).toMatch(/^BUILT_IN_FORGE_MODEL looks wrong/);
    expect(chat).toContain("assistant, chat and drafting");
    expect(voice).toMatch(/^BUILT_IN_FORGE_TRANSCRIPTION_MODEL looks wrong/);
    expect(voice).not.toContain("assistant, chat");
  });

  it("does not warn about another provider's URL, which is the chat model's to say", () => {
    expect(
      configWarnings(
        env({
          forgeTranscriptionModel: "",
          forgeApiUrl: "https://api.example.com",
        })
      )
    ).toEqual([]);
  });

  it("reports several problems in one warning", () => {
    const [text, ...rest] = forgeTranscriptionModelWarnings('"<changeme x>"');
    expect(rest).toEqual([]);
    expect(text.match(/looks wrong/g)).toHaveLength(1);
  });

  it("never repeats the value", () => {
    const secret = "do-not-print-this-model";
    const text = forgeTranscriptionModelWarnings(`"${secret} x"`).join(" ");
    expect(text).toContain("BUILT_IN_FORGE_TRANSCRIPTION_MODEL");
    expect(text).not.toContain(secret);
  });

  it("is carried through configWarnings, and silent when unset", () => {
    const warnings = configWarnings(
      env({ forgeTranscriptionModel: "whisper 1" })
    );
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/^BUILT_IN_FORGE_TRANSCRIPTION_MODEL/);
    expect(configWarnings(env({ forgeTranscriptionModel: "" }))).toEqual([]);
    expect(configWarnings(env({}))).toEqual([]);
  });
});

describe("VITE_ variables that look like credentials", () => {
  it.each([
    "VITE_FRONTEND_FORGE_API_KEY",
    "VITE_BUILT_IN_FORGE_API_KEY",
    "VITE_OPENAI_API_KEY",
    "VITE_OPENAI_APIKEY",
    "VITE_STRIPE_SECRET_KEY",
    "VITE_AUTH_TOKEN",
    "VITE_DB_PASSWORD",
    "VITE_PASSWD",
    "VITE_SERVICE_CREDENTIALS",
    "VITE_PRIVATE_KEY",
    "VITE_api_key",
    "VITE_KEY",
  ])("flags %s", name => {
    expect(viteCredentialNames([name])).toEqual([name]);
  });

  it.each([
    "VITE_APP_ID",
    "VITE_OAUTH_PORTAL_URL",
    "VITE_RECAPTCHA_SITE_KEY",
    "VITE_STRIPE_PUBLISHABLE_KEY",
    "VITE_MAPS_PUBLIC_KEY",
    "VITE_KEYBOARD_LAYOUT",
    "VITE_MONKEY_PATCH",
    "VITE_TOKENIZER_URL",
    "VITE_SECRETARY",
    "VITE_ANALYTICS_ID",
    "VITE_SITE_KEY_PUBLIC_KEY",
    "VITE_PRIVATE_MODE",
  ])("is silent for %s", name => {
    expect(viteCredentialNames([name])).toEqual([]);
  });

  it("only judges the part after the prefix", () => {
    expect(viteCredentialNames(["VITE_"])).toEqual([]);
  });

  it("still flags a secret whose name also contains a public-key word", () => {
    expect(viteCredentialNames(["VITE_PUBLIC_API_SECRET"])).toHaveLength(1);
    expect(viteCredentialNames(["VITE_SITE_TOKEN"])).toHaveLength(1);
    expect(viteCredentialNames(["VITE_SITE_KEY_SECRET"])).toHaveLength(1);
  });

  it("returns names sorted, so the warning does not depend on environment order", () => {
    expect(viteCredentialNames(["VITE_B_KEY", "VITE_A_KEY"])).toEqual([
      "VITE_A_KEY",
      "VITE_B_KEY",
    ]);
  });

  it("is silent for no variables or only harmless ones", () => {
    expect(viteCredentialWarning([])).toBeNull();
    expect(
      viteCredentialWarning(["VITE_APP_ID", "VITE_OAUTH_PORTAL_URL"])
    ).toBeNull();
  });

  it("names the variable and sends the key to the server side", () => {
    const text = viteCredentialWarning(["VITE_FRONTEND_FORGE_API_KEY"])!;
    expect(text).toContain("VITE_FRONTEND_FORGE_API_KEY");
    expect(text).toContain("BUILT_IN_FORGE_API_KEY");
    expect(text).toMatch(/^A VITE_-prefixed variable looks like a credential/);
  });

  it("is worded for several names, and shortens a long list", () => {
    const some = viteCredentialWarning(["VITE_A_KEY", "VITE_B_KEY"])!;
    expect(some).toMatch(/^VITE_-prefixed variables look like/);
    expect(some).toContain("VITE_A_KEY, VITE_B_KEY");
    const names = Array.from({ length: 8 }, (_, i) => `VITE_K${i}_KEY`);
    const many = viteCredentialWarning(names)!;
    expect(many).toContain("and 3 more");
    expect(many).not.toContain("VITE_K7_KEY");
  });

  it("is a warning only, raised through configWarnings, and silent when the caller does not say", () => {
    const viteVariableNames = ["VITE_OPENAI_API_KEY"];
    expect(configProblems(env({ viteVariableNames }))).toEqual([]);
    expect(configWarnings(env({ viteVariableNames }))).toHaveLength(1);
    expect(configWarnings(env())).toEqual([]);
    expect(
      configWarnings({
        databaseUrl: "",
        appId: "",
        cookieSecret: "",
        viteVariableNames,
      })
    ).toHaveLength(1);
  });

  it("never needs a value: the check takes names only", () => {
    expect(viteCredentialWarning.length).toBe(1);
    expect(viteCredentialWarning(["VITE_X_KEY"])).not.toMatch(/=/);
  });

  describe("which variables env.ts hands over", () => {
    it("lists names starting with exactly VITE_, and no values", async () => {
      const { vi } = await import("vitest");
      vi.resetModules();
      vi.stubEnv("VITE_ZZ_SECRET", "hunter2zz");
      vi.stubEnv("vite_lower_key", "x");
      vi.stubEnv("NOT_VITE_KEY", "x");
      const { ENV } = await import("./env");
      vi.unstubAllEnvs();
      expect(ENV.viteVariableNames).toContain("VITE_ZZ_SECRET");
      expect(ENV.viteVariableNames).not.toContain("vite_lower_key");
      expect(ENV.viteVariableNames).not.toContain("NOT_VITE_KEY");
      expect(JSON.stringify(ENV.viteVariableNames)).not.toContain("hunter2zz");
    });
  });
});
