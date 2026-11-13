import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
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
  oauthPortalUrlWarning,
  forgeApiKeyWarning,
  ownerOpenIdWarnings,
  forgeApiUrlWarning,
  forgeModelWarnings,
  forgeTranscriptionModelWarnings,
  awsRegionWarning,
  awsDefaultRegionWarning,
  awsWebIdentityWarnings,
  awsContainerCredentialsWarnings,
  containerHostAccepted,
  awsProfileWarnings,
  awsFipsEndpointWarnings,
  awsChecksumWarnings,
  awsRetryWarnings,
  awsEc2MetadataDisabledWarning,
  awsConfigFileWarning,
  awsCredentialsFileWarning,
  isReadableFile,
  awsDualstackEndpointWarnings,
  awsS3UsEast1RegionalEndpointWarning,
  awsEndpointUrlWarnings,
  S3_DEFAULT_REGION,
  viteCredentialNames,
  viteCredentialWarning,
  proxyHopsWarning,
  outboundProxyWarnings,
  noProxyWarnings,
  noProxyExempts,
  noProxyEntries,
  recaptchaSecretWeaknesses,
  recaptchaSiteKeyWeaknesses,
  previousSecretWarnings,
  recaptchaOffWarnings,
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
  instanceWarnings,
  databaseDriverProblem,
  databaseTlsWarnings,
} from "./startupChecks";

// TLS with certificate checking (ssl={}), because this stands for a deployment
// with nothing wrong with it: a production config that asked for no TLS now has
// something to say, and the "this is silent" tests below mean a good one.
const DB = "mysql://user:pass@db.example.com:3306/notes?ssl=%7B%7D";
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

// A production config with nothing wrong has reCAPTCHA keys too: with neither
// set, a production server with a database now says registration has no robot
// check. The recaptcha tests below that want it off say so in their own env.
const FIXTURE_RECAPTCHA_SITE = random(40, 71, BASE64.replace(/[+/]/g, "_"));
const FIXTURE_RECAPTCHA_SECRET = random(40, 72, BASE64.replace(/[+/]/g, "_"));

const env = (
  overrides: Partial<Parameters<typeof configProblems>[0]> = {}
) => ({
  databaseUrl: DB,
  appId: "my-app",
  cookieSecret: GOOD,
  recaptchaSiteKey: FIXTURE_RECAPTCHA_SITE,
  recaptchaSecretKey: FIXTURE_RECAPTCHA_SECRET,
  ...overrides,
});

// The real-SDK probes below run a child process with a minimal environment, but
// the SDK still reads ~/.aws/config and ~/.aws/credentials from whatever home
// the machine has, and a runner that ships a region or a default profile there
// changes what a probe resolves. Point both at nowhere unless a probe supplies
// its own files (a probe's own `set` comes last and wins).
const NO_AWS_FILES = {
  AWS_CONFIG_FILE: "/nonexistent/aws/config",
  AWS_SHARED_CREDENTIALS_FILE: "/nonexistent/aws/credentials",
};

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

describe("recaptchaOffWarnings", () => {
  it("says so for a production server with a database and no keys", () => {
    const warnings = recaptchaOffWarnings("", "", true, true);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/no robot check/);
  });

  it("treats whitespace-only keys as unset", () => {
    expect(recaptchaOffWarnings("  ", "", true, true)).toHaveLength(1);
  });

  it.each([
    ["no database", false, true],
    ["not production", true, false],
  ])("is silent with %s", (_name, canSignIn, production) => {
    expect(recaptchaOffWarnings("", "", canSignIn, production)).toEqual([]);
  });

  it("is silent when either key is set, since the half-set case has its own warning", () => {
    expect(recaptchaOffWarnings("site", "", true, true)).toEqual([]);
    expect(recaptchaOffWarnings("", "secret", true, true)).toEqual([]);
  });

  it("reaches configWarnings, in production only", () => {
    const bare = { recaptchaSiteKey: "", recaptchaSecretKey: "" };
    expect(
      configWarnings(env({ ...bare, nodeEnv: "production" })).join("\n")
    ).toMatch(/no robot check/);
    expect(configWarnings(env({ ...bare, nodeEnv: "development" }))).toEqual(
      []
    );
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
      configWarnings(
        env({ recaptchaSiteKey: "", recaptchaSecretKey: "changeme" })
      )
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

describe("AWS_REGION", () => {
  const BUCKET = "my-bucket";

  it("explains that the client ignores it when S3_REGION is unset", () => {
    const text = awsRegionWarning(BUCKET, "", "eu-west-1")!;
    expect(text).toMatch(
      /^AWS_REGION is set, but cloud backup does not read it/
    );
    expect(text).toContain(S3_DEFAULT_REGION);
    expect(text).toContain("Set S3_REGION");
  });

  it("explains that S3_REGION wins when the two differ", () => {
    const text = awsRegionWarning(BUCKET, "eu-west-1", "us-west-2")!;
    expect(text).toMatch(/different region than S3_REGION/);
    expect(text).not.toContain(S3_DEFAULT_REGION);
  });

  it("is silent when the client would use the same region anyway", () => {
    expect(awsRegionWarning(BUCKET, "eu-west-1", "eu-west-1")).toBeNull();
    expect(awsRegionWarning(BUCKET, "", S3_DEFAULT_REGION)).toBeNull();
    expect(awsRegionWarning(BUCKET, "  eu-west-1 ", " eu-west-1")).toBeNull();
  });

  it("is silent with backup off, since a host may set AWS_REGION for its own reasons", () => {
    expect(awsRegionWarning("", "", "eu-west-1")).toBeNull();
  });

  it("is silent when AWS_REGION is unset or only whitespace", () => {
    expect(awsRegionWarning(BUCKET, "", "")).toBeNull();
    expect(awsRegionWarning(BUCKET, "eu-west-1", "   ")).toBeNull();
  });

  it("reads a whitespace-only S3_REGION as unset, which the S3_REGION check flags on its own", () => {
    expect(awsRegionWarning(BUCKET, "   ", "eu-west-1")).toMatch(
      /with S3_REGION unset/
    );
  });

  it("never repeats either region", () => {
    for (const text of [
      awsRegionWarning(BUCKET, "", "zz-secret-9"),
      awsRegionWarning(BUCKET, "yy-other-1", "zz-secret-9"),
    ]) {
      expect(text).not.toContain("zz-secret-9");
      expect(text).not.toContain("yy-other-1");
    }
  });

  it("is a warning only, raised through configWarnings, and silent when the caller does not say", () => {
    const awsRegion = "eu-west-1";
    const cfg = { s3Bucket: BUCKET, s3Region: "", awsRegion };
    expect(configProblems(env(cfg))).toEqual([]);
    expect(configWarnings(env(cfg))).toHaveLength(1);
    expect(configWarnings(env({ s3Bucket: BUCKET, s3Region: "" }))).toEqual([]);
    expect(configWarnings(env({ awsRegion }))).toEqual([]);
  });

  it("hands configWarnings' S3_REGION to the comparison", () => {
    const base = { s3Bucket: BUCKET, s3Region: "eu-west-1" };
    expect(configWarnings(env({ ...base, awsRegion: "eu-west-1" }))).toEqual(
      []
    );
    expect(configWarnings(env({ ...base, awsRegion: "us-west-2" }))[0]).toMatch(
      /different region than S3_REGION/
    );
  });

  it("uses the same default region as the client it describes", () => {
    const source = readFileSync(
      resolve(process.cwd(), "server", "storage.ts"),
      "utf8"
    );
    expect(source).toContain(`region: ENV.s3Region || "${S3_DEFAULT_REGION}"`);
  });

  it("is what the SDK does: an explicit region beats AWS_REGION", async () => {
    const { S3Client } = await import("@aws-sdk/client-s3");
    const before = process.env.AWS_REGION;
    process.env.AWS_REGION = "eu-west-1";
    try {
      const credentials = { accessKeyId: "a", secretAccessKey: "b" };
      const explicit = new S3Client({ region: S3_DEFAULT_REGION, credentials });
      const implicit = new S3Client({ credentials });
      expect(await explicit.config.region()).toBe(S3_DEFAULT_REGION);
      expect(await implicit.config.region()).toBe("eu-west-1");
    } finally {
      if (before === undefined) {
        delete process.env.AWS_REGION;
      } else {
        process.env.AWS_REGION = before;
      }
    }
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

describe("VITE_OAUTH_PORTAL_URL", () => {
  it.each([
    "",
    "https://portal.example.com",
    "https://portal.example.com:8443",
    "https://portal.example.com/portal",
    "  https://portal.example.com",
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://[::1]:3000",
    "http://app.localhost",
  ])("is silent for %j", value => {
    expect(oauthPortalUrlWarning(value)).toBeNull();
  });

  it.each([
    ["portal.example.com", "not an absolute http(s) URL"],
    ["//portal.example.com", "not an absolute http(s) URL"],
    ["https://", "not an absolute http(s) URL"],
    ["https:", "not an absolute http(s) URL"],
    ["https://portal.example.com ", "trailing whitespace"],
    ['"https://portal.example.com"', "begins or ends with a quote"],
    ["'https://portal.example.com'", "begins or ends with a quote"],
    ["`https://portal.example.com`", "begins or ends with a quote"],
  ])("says the sign-in link cannot be built for %j", (value, reason) => {
    const text = oauthPortalUrlWarning(value)!;
    expect(text).toMatch(/^VITE_OAUTH_PORTAL_URL looks wrong/);
    expect(text).toContain(reason);
    expect(text).toContain("cannot be built");
  });

  it.each([
    ["ftp://portal.example.com", "does not use http or https"],
    ["https://u:p@portal.example.com", "contains a username or password"],
    ["https://:pw@portal.example.com", "contains a username or password"],
    ["https://admin@portal.example.com", "contains a username or password"],
    ["https://portal.example.com?x=1", "has a query or fragment"],
    ["https://portal.example.com/#top", "has a query or fragment"],
    ["https://portal.example.com/", "ends with a slash"],
    ["https://portal.example.com/portal/", "ends with a slash"],
    ["https://portal.example.com/ ", "ends with a slash"],
    ["http://portal.example.com", "uses http:// to a real host"],
  ])("flags %j", (value, reason) => {
    expect(oauthPortalUrlWarning(value)).toContain(reason);
  });

  it("does not call a query's trailing slash a trailing-slash problem as well", () => {
    const text = oauthPortalUrlWarning("https://portal.example.com/?x=1/")!;
    expect(text).toContain("has a query or fragment");
    expect(text).not.toContain("ends with a slash");
  });

  it("names every problem a parseable value has", () => {
    const text = oauthPortalUrlWarning("http://u:p@portal.example.com/")!;
    expect(text).toContain("contains a username or password");
    expect(text).toContain("ends with a slash");
    expect(text).toContain("uses http:// to a real host");
  });

  it("tells the operator that a fix needs a rebuild", () => {
    expect(oauthPortalUrlWarning("nope")).toContain("needs a rebuild");
    expect(oauthPortalUrlWarning("https://portal.example.com/")).toContain(
      "needs a rebuild"
    );
  });

  it("never repeats any part of the value, which may hold credentials", () => {
    for (const value of [
      "https://admin:hunter2zz@portal.example.com/secretpath/",
      '"hunter2zz.example.com"',
      "ftp://hunter2zz",
      "https://portal.example.com?token=hunter2zz",
    ]) {
      const text = oauthPortalUrlWarning(value)!;
      expect(text).toBeTruthy();
      expect(text).not.toContain("hunter2zz");
      expect(text).not.toContain("admin");
      expect(text).not.toContain("secretpath");
    }
  });

  it("is a warning only, with or without a database, and silent when the caller does not say", () => {
    const oauthPortalUrl = "nope";
    expect(configProblems(env({ oauthPortalUrl }))).toEqual([]);
    expect(configWarnings(env({ oauthPortalUrl }))).toHaveLength(1);
    expect(
      configWarnings({
        databaseUrl: "",
        appId: "",
        cookieSecret: "",
        oauthPortalUrl,
      })
    ).toHaveLength(1);
    expect(configWarnings(env())).toEqual([]);
  });

  describe("what the sign-in route does with the value", () => {
    const link = (value: string) => new URL(`${value}/app-auth`);

    it("builds the link the way the check judges it", () => {
      const source = readFileSync(
        resolve(process.cwd(), "server", "_core", "oauth.ts"),
        "utf8"
      );
      expect(source).toContain("new URL(`${ENV.oauthPortalUrl}/app-auth`)");
    });

    it("throws for the values the check calls unbuildable", () => {
      for (const value of [
        "portal.example.com",
        '"https://portal.example.com"',
        "https://portal.example.com ",
      ]) {
        expect(() => link(value)).toThrow();
      }
      expect(() => link("  https://portal.example.com")).not.toThrow();
      expect(link("https://").hostname).toBe("app-auth");
    });

    it("doubles the slash, and swallows the path into a query or fragment", () => {
      expect(link("https://portal.example.com/").pathname).toBe("//app-auth");
      expect(link("https://portal.example.com?x=1").search).toBe(
        "?x=1/app-auth"
      );
      expect(link("https://portal.example.com/#top").hash).toBe(
        "#top/app-auth"
      );
    });
  });

  describe("which variable env.ts hands over", () => {
    it("reads VITE_OAUTH_PORTAL_URL, and an unset one is empty", async () => {
      const { vi } = await import("vitest");
      vi.resetModules();
      delete process.env.VITE_OAUTH_PORTAL_URL;
      const unset = (await import("./env")).ENV.oauthPortalUrl;
      vi.resetModules();
      vi.stubEnv("VITE_OAUTH_PORTAL_URL", "https://portal.example.com");
      const set = (await import("./env")).ENV.oauthPortalUrl;
      vi.unstubAllEnvs();
      expect(unset).toBe("");
      expect(set).toBe("https://portal.example.com");
    });
  });
});

describe("AWS_PROFILE", () => {
  const BUCKET = "my-bucket";
  const ID = "AKIAEXAMPLEEXAMPLE0";
  const SECRET = "exampleSecretExampleSecretExample0";

  it("explains that the key pair is skipped when both are set with a profile", () => {
    const [text] = awsProfileWarnings(BUCKET, "prod", ID, SECRET);
    expect(text).toMatch(/^AWS_PROFILE is set together with AWS_ACCESS_KEY_ID/);
    expect(text).toContain("the pair does nothing");
    expect(text).toContain("no credentials at all");
  });

  it("is silent for a profile on its own, or a pair on its own", () => {
    expect(awsProfileWarnings(BUCKET, "prod", "", "")).toEqual([]);
    expect(awsProfileWarnings(BUCKET, "", ID, SECRET)).toEqual([]);
    expect(awsProfileWarnings(BUCKET, "", "", "")).toEqual([]);
  });

  it("is silent for a profile with only half the pair, which awsCredentialWarnings already covers", () => {
    expect(awsProfileWarnings(BUCKET, "prod", ID, "")).toEqual([]);
    expect(awsProfileWarnings(BUCKET, "prod", "", SECRET)).toEqual([]);
  });

  it("is silent with backup off, since a developer machine sets AWS_PROFILE for other tools", () => {
    expect(awsProfileWarnings("", "prod", ID, SECRET)).toEqual([]);
    expect(awsProfileWarnings("", " prod", "", "")).toEqual([]);
  });

  it.each([
    [" prod", "whitespace around it"],
    ["prod ", "whitespace around it"],
    ["  ", "whitespace around it"],
    ["prod\n", "whitespace around it"],
    ['"prod"', "wrapping quotes"],
    ["'prod'", "wrapping quotes"],
    ["`prod`", "wrapping quotes"],
    ['"prod', "wrapping quotes"],
    ['prod"', "wrapping quotes"],
  ])("flags the name %j", (profile, reason) => {
    const [text] = awsProfileWarnings(BUCKET, profile, "", "");
    expect(text).toContain(reason);
    expect(text).toContain("does not fall back");
  });

  it("does not flag a plain profile name, with dashes, dots, slashes or inner spaces", () => {
    for (const profile of [
      "prod",
      "my-profile",
      "team.dev",
      "a/b",
      "my profile",
    ]) {
      expect(awsProfileWarnings(BUCKET, profile, "", "")).toEqual([]);
    }
  });

  it("reports a bad name and the ignored pair as two warnings", () => {
    const found = awsProfileWarnings(BUCKET, '"prod"', ID, SECRET);
    expect(found).toHaveLength(2);
    expect(found[0]).toContain("wrapping quotes");
    expect(found[1]).toContain("the pair does nothing");
  });

  it("never repeats the profile name or either half of the pair", () => {
    for (const found of [
      awsProfileWarnings(BUCKET, " zz-profile-9 ", ID, SECRET),
      awsProfileWarnings(BUCKET, '"zz-profile-9"', ID, SECRET),
      awsProfileWarnings(BUCKET, "zz-profile-9", ID, SECRET),
    ]) {
      for (const text of found) {
        expect(text).not.toContain("zz-profile-9");
        expect(text).not.toContain(ID);
        expect(text).not.toContain(SECRET);
      }
    }
  });

  it("is a warning only, raised through configWarnings, and silent when the caller does not say", () => {
    const cfg = {
      s3Bucket: BUCKET,
      awsProfile: "prod",
      awsAccessKeyId: ID,
      awsSecretAccessKey: SECRET,
    };
    expect(configProblems(env(cfg))).toEqual([]);
    expect(configWarnings(env(cfg))).toHaveLength(1);
    expect(configWarnings(env({ s3Bucket: BUCKET }))).toEqual([]);
    expect(configWarnings(env({ awsProfile: "prod" }))).toEqual([]);
  });

  it("hands configWarnings' bucket and key pair to the check", () => {
    const cfg = { awsProfile: "prod", awsAccessKeyId: ID };
    expect(
      configWarnings(
        env({ ...cfg, s3Bucket: BUCKET, awsSecretAccessKey: SECRET })
      )
    ).toHaveLength(1);
    expect(
      configWarnings(env({ ...cfg, s3Bucket: "", awsSecretAccessKey: SECRET }))
    ).toEqual([]);
    expect(
      configWarnings(env({ ...cfg, s3Bucket: BUCKET, awsSecretAccessKey: "" }))
    ).toHaveLength(1);
  });

  it("reads AWS_PROFILE in env.ts, and an unset one is empty", async () => {
    const { vi } = await import("vitest");
    vi.resetModules();
    delete process.env.AWS_PROFILE;
    const unset = (await import("./env")).ENV.awsProfile;
    vi.resetModules();
    vi.stubEnv("AWS_PROFILE", "prod");
    const set = (await import("./env")).ENV.awsProfile;
    vi.unstubAllEnvs();
    expect(unset).toBe("");
    expect(set).toBe("prod");
  });

  describe("what the installed SDK does with the same environment", () => {
    // Runs the SDK's real default credential chain against a throwaway shared
    // credentials file, so the claims above are the SDK's and not a reading of it.
    const KEYS = [
      "AWS_PROFILE",
      "AWS_ACCESS_KEY_ID",
      "AWS_SECRET_ACCESS_KEY",
      "AWS_SESSION_TOKEN",
      "AWS_SHARED_CREDENTIALS_FILE",
      "AWS_CONFIG_FILE",
      "AWS_EC2_METADATA_DISABLED",
      "AWS_CONTAINER_CREDENTIALS_RELATIVE_URI",
      "AWS_CONTAINER_CREDENTIALS_FULL_URI",
      "AWS_WEB_IDENTITY_TOKEN_FILE",
    ];

    const resolve_ = async (set: Record<string, string>) => {
      const dir = mkdtempSync(join(tmpdir(), "aws-profile-"));
      const saved = Object.fromEntries(KEYS.map(k => [k, process.env[k]]));
      const warn = console.warn;
      try {
        writeFileSync(
          join(dir, "credentials"),
          "[prod]\naws_access_key_id = PROFILEKEYID\naws_secret_access_key = profilesecret\n"
        );
        writeFileSync(join(dir, "config"), "");
        for (const k of KEYS) {
          delete process.env[k];
        }
        process.env.AWS_SHARED_CREDENTIALS_FILE = join(dir, "credentials");
        process.env.AWS_CONFIG_FILE = join(dir, "config");
        process.env.AWS_EC2_METADATA_DISABLED = "true";
        Object.assign(process.env, set);
        console.warn = () => undefined;
        const { S3Client } = await import("@aws-sdk/client-s3");
        const client = new S3Client({ region: "us-east-1" });
        const credentials = client.config.credentials as () => Promise<{
          accessKeyId: string;
        }>;
        return await credentials().then(
          found => found.accessKeyId,
          () => "NONE"
        );
      } finally {
        console.warn = warn;
        for (const k of KEYS) {
          if (saved[k] === undefined) {
            delete process.env[k];
          } else {
            process.env[k] = saved[k];
          }
        }
        rmSync(dir, { recursive: true, force: true });
      }
    };
    const pair = {
      AWS_ACCESS_KEY_ID: "ENVKEYID",
      AWS_SECRET_ACCESS_KEY: "envsecret",
    };

    it("uses the pair when no profile is set, and when the profile is empty", async () => {
      expect(await resolve_(pair)).toBe("ENVKEYID");
      expect(await resolve_({ ...pair, AWS_PROFILE: "" })).toBe("ENVKEYID");
    });

    it("uses the profile's keys, not the pair, when both are set", async () => {
      expect(await resolve_({ ...pair, AWS_PROFILE: "prod" })).toBe(
        "PROFILEKEYID"
      );
    });

    it("finds no credentials, and does not fall back to the pair, for a profile that is not there", async () => {
      expect(await resolve_({ ...pair, AWS_PROFILE: "missing" })).toBe("NONE");
    });

    it("takes the name as written: padding, quotes and whitespace find nothing", async () => {
      for (const profile of [" prod", "prod ", '"prod"', "  "]) {
        expect(await resolve_({ ...pair, AWS_PROFILE: profile })).toBe("NONE");
      }
    });
  });
});

describe("HTTP_PROXY and HTTPS_PROXY", () => {
  const PROXY = "http://proxy.example.com:3128";

  it("is silent with no proxy variables, whatever NODE_USE_ENV_PROXY says", () => {
    for (const flag of ["", "1", "true", "0", "yes"]) {
      expect(outboundProxyWarnings("", "", flag)).toEqual([]);
    }
  });

  it("is silent when a valid proxy is paired with NODE_USE_ENV_PROXY=1", () => {
    expect(outboundProxyWarnings("", PROXY, "1")).toEqual([]);
    expect(outboundProxyWarnings(PROXY, PROXY, "1")).toEqual([]);
    expect(
      outboundProxyWarnings("", "https://proxy.example.com:443", "1")
    ).toEqual([]);
    expect(
      outboundProxyWarnings("", "http://u:p@proxy.example.com:3128", "1")
    ).toEqual([]);
  });

  it("says only part of the traffic follows the proxy when the flag is off", () => {
    for (const flag of ["", "0", "false", "False", "FALSE"]) {
      const found = outboundProxyWarnings("", PROXY, flag);
      expect(found).toHaveLength(1);
      expect(found[0]).toMatch(/^HTTPS_PROXY is set, but only part of/);
      expect(found[0]).toContain("NODE_USE_ENV_PROXY=1");
      expect(found[0]).toContain("S3 backup client does not read it");
    }
  });

  it("names every proxy variable that is set", () => {
    expect(outboundProxyWarnings(PROXY, PROXY, "")[0]).toMatch(
      /^HTTP_PROXY \/ HTTPS_PROXY is set, but only part of/
    );
  });

  it("says that only the exact value 1 turns the flag on", () => {
    for (const flag of [
      "true",
      "TRUE",
      "yes",
      "on",
      "2",
      " 1",
      "1 ",
      "01",
      "1\n",
    ]) {
      const found = outboundProxyWarnings("", PROXY, flag);
      expect(found).toHaveLength(1);
      expect(found[0]).toMatch(
        /^NODE_USE_ENV_PROXY is set to a value Node ignores/
      );
      expect(found[0]).toContain("only the exact value 1");
      expect(found[0]).not.toMatch(/only part of/);
    }
  });

  it("names every proxy variable that is set when the flag is ineffective too", () => {
    expect(outboundProxyWarnings(PROXY, PROXY, "true")[0]).toContain(
      "With HTTP_PROXY / HTTPS_PROXY set,"
    );
    expect(outboundProxyWarnings("", PROXY, "true")[0]).toContain(
      "With HTTPS_PROXY set,"
    );
  });

  it("says HTTP_PROXY alone leaves axios and fetch disagreeing about https addresses", () => {
    const withFlag = outboundProxyWarnings(PROXY, "", "1");
    expect(withFlag).toHaveLength(1);
    expect(withFlag[0]).toMatch(/^HTTP_PROXY is set without HTTPS_PROXY/);
    expect(withFlag[0]).toContain(
      "axios (the portal sign-in) uses HTTP_PROXY only for http://"
    );
    expect(withFlag[0]).toContain(
      "does fall back to HTTP_PROXY for https:// addresses"
    );
    expect(withFlag[0]).not.toContain("proxies almost nothing");
    const without = outboundProxyWarnings(PROXY, "", "");
    expect(without).toHaveLength(2);
    expect(without[0]).toMatch(/^HTTP_PROXY is set without HTTPS_PROXY/);
    expect(without[1]).toMatch(/only part of/);
  });

  it.each([
    "proxy.example.com:3128",
    "127.0.0.1:3128",
    "not a url",
    "socks5://proxy.example.com:1080",
    "ftp://proxy.example.com",
    "http://",
    "proxy.example.com",
  ])("flags the value %j as not an http(s) URL", value => {
    const found = outboundProxyWarnings("", value, "1");
    expect(found).toHaveLength(1);
    expect(found[0]).toMatch(
      /^HTTPS_PROXY is not an http:\/\/ or https:\/\/ URL/
    );
    expect(found[0]).toContain("ERR_INVALID_URL");
    expect(found[0]).toContain("refuses to start");
    const http = outboundProxyWarnings(value, PROXY, "1");
    expect(http).toHaveLength(1);
    expect(http[0]).toMatch(/^HTTP_PROXY is not an http/);
  });

  it("reports a bad value and the routing problem as separate warnings", () => {
    const found = outboundProxyWarnings("", "proxy.example.com:3128", "");
    expect(found).toHaveLength(2);
    expect(found[0]).toMatch(/not an http/);
    expect(found[1]).toMatch(/only part of/);
  });

  it("never repeats any part of either value, which may hold proxy credentials", () => {
    for (const [http, https] of [
      ["http://admin:hunter2zz@proxy.example.com:3128", ""],
      ["", "http://admin:hunter2zz@proxy.example.com:3128"],
      ["hunter2zz.example.com:3128", "hunter2zz.example.com:3128"],
      ["http://admin:hunter2zz@proxy.example.com:3128", "not a hunter2zz url"],
    ] as const) {
      for (const flag of ["", "1", "true"]) {
        for (const text of outboundProxyWarnings(http, https, flag)) {
          expect(text).not.toContain("hunter2zz");
          expect(text).not.toContain("admin");
        }
      }
    }
  });

  it("is a warning only, raised through configWarnings, and silent when the caller does not say", () => {
    const httpsProxy = PROXY;
    expect(configProblems(env({ httpsProxy }))).toEqual([]);
    expect(
      configWarnings(env({ httpsProxy, nodeUseEnvProxy: "" }))
    ).toHaveLength(1);
    expect(configWarnings(env({ httpsProxy, nodeUseEnvProxy: "1" }))).toEqual(
      []
    );
    expect(configWarnings(env())).toEqual([]);
    expect(
      configWarnings({
        databaseUrl: "",
        appId: "",
        cookieSecret: "",
        httpsProxy,
      })
    ).toHaveLength(1);
  });

  it("raises the warnings for HTTP_PROXY alone, with the other two not given", () => {
    expect(configWarnings(env({ httpProxy: PROXY }))).toHaveLength(2);
  });

  it("hands all three values from configWarnings to the check", () => {
    expect(
      configWarnings(env({ httpProxy: PROXY, nodeUseEnvProxy: "1" }))
    ).toHaveLength(1);
    expect(
      configWarnings(env({ httpsProxy: PROXY, nodeUseEnvProxy: "true" }))[0]
    ).toMatch(/^NODE_USE_ENV_PROXY is set to a value/);
    expect(
      configWarnings(env({ httpsProxy: "nope", nodeUseEnvProxy: "1" }))[0]
    ).toMatch(/^HTTPS_PROXY is not an http/);
  });

  describe("what env.ts hands over", () => {
    const NAMES = [
      "http_proxy",
      "HTTP_PROXY",
      "https_proxy",
      "HTTPS_PROXY",
      "NODE_USE_ENV_PROXY",
    ];
    const read = async (set: Record<string, string>) => {
      const { vi } = await import("vitest");
      const saved = Object.fromEntries(NAMES.map(n => [n, process.env[n]]));
      try {
        for (const n of NAMES) {
          delete process.env[n];
        }
        Object.assign(process.env, set);
        vi.resetModules();
        const { ENV } = await import("./env");
        return [ENV.httpProxy, ENV.httpsProxy, ENV.nodeUseEnvProxy];
      } finally {
        for (const n of NAMES) {
          if (saved[n] === undefined) {
            delete process.env[n];
          } else {
            process.env[n] = saved[n];
          }
        }
      }
    };

    it("is empty when nothing is set", async () => {
      expect(await read({})).toEqual(["", "", ""]);
    });

    it("reads either case, and the lower-case name wins as it does for axios", async () => {
      expect(
        await read({
          HTTP_PROXY: "http://upper:1",
          http_proxy: "http://lower:1",
        })
      ).toEqual(["http://lower:1", "", ""]);
      expect(await read({ HTTP_PROXY: "http://upper:1" })).toEqual([
        "http://upper:1",
        "",
        "",
      ]);
      expect(await read({ http_proxy: "http://lower:1" })).toEqual([
        "http://lower:1",
        "",
        "",
      ]);
      expect(
        await read({
          HTTPS_PROXY: "http://upper:1",
          https_proxy: "http://lower:1",
        })
      ).toEqual(["", "http://lower:1", ""]);
    });

    it("reads NODE_USE_ENV_PROXY as written", async () => {
      expect(await read({ NODE_USE_ENV_PROXY: "1" })).toEqual(["", "", "1"]);
      expect(await read({ NODE_USE_ENV_PROXY: "true" })).toEqual([
        "",
        "",
        "true",
      ]);
    });
  });

  describe("what the installed Node and axios do with the same variables", () => {
    // Runs real child processes against a local proxy, so the claims in the
    // warnings are the runtime's and not a reading of its docs.
    type Seen = string[];
    const state: {
      seen: Seen;
      port: number;
      close: () => void;
      flagWorks: boolean;
    } = {
      seen: [],
      port: 0,
      close: () => undefined,
      flagWorks: false,
    };

    const run = async (
      client: "fetch" | "axios" | "start",
      url: string,
      env: Record<string, string>
    ) => {
      const { spawn } = await import("node:child_process");
      const { createRequire } = await import("node:module");
      const axiosPath = createRequire(import.meta.url).resolve("axios");
      state.seen.length = 0;
      const code =
        client === "start"
          ? 'console.log("STARTED")'
          : client === "fetch"
            ? `fetch(process.argv[1], { signal: AbortSignal.timeout(3000) }).then(() => {}, () => {})`
            : `require(${JSON.stringify(axiosPath)}).get(process.argv[1], { timeout: 3000, validateStatus: () => true }).then(() => console.log("OK"), e => console.log("ERR " + (e.code || e.message)))`;
      const child = spawn(process.execPath, ["-e", code, url], {
        env: { PATH: process.env.PATH ?? "", ...env },
      });
      let stderr = "";
      let stdout = "";
      child.stderr.on("data", d => (stderr += d));
      child.stdout.on("data", d => (stdout += d));
      const exit = await new Promise<number | null>(done =>
        child.on("close", done)
      );
      return { seen: [...state.seen], exit, stderr, stdout };
    };

    beforeAll(async () => {
      const { createServer } = await import("node:http");
      const server = createServer((req, res) => {
        state.seen.push(`${req.method} ${req.url}`);
        res.end("proxied");
      });
      server.on("connect", (req, socket) => {
        state.seen.push(`CONNECT ${req.url}`);
        socket.end("HTTP/1.1 502 Bad Gateway\r\n\r\n");
      });
      await new Promise<void>(done => server.listen(0, "127.0.0.1", done));
      state.port = (server.address() as { port: number }).port;
      state.close = () => server.close();
      const probe = await run("fetch", "http://target.invalid/x", {
        HTTP_PROXY: `http://127.0.0.1:${state.port}`,
        NODE_USE_ENV_PROXY: "1",
      });
      state.flagWorks = probe.seen.length > 0;
    });

    afterAll(() => state.close());

    const proxy = () => `http://127.0.0.1:${state.port}`;
    const HTTP_TARGET = "http://target.invalid/x";
    const HTTPS_TARGET = "https://target.invalid/x";

    it("fetch ignores the proxy variables unless the flag is exactly 1", async ctx => {
      if (!state.flagWorks) {
        ctx.skip();
      }
      for (const flag of [
        undefined,
        "true",
        "TRUE",
        "yes",
        "0",
        "false",
        " 1",
        "1 ",
        "01",
      ]) {
        const env: Record<string, string> = { HTTP_PROXY: proxy() };
        if (flag !== undefined) {
          env.NODE_USE_ENV_PROXY = flag;
        }
        expect((await run("fetch", HTTP_TARGET, env)).seen).toEqual([]);
      }
      expect(
        (
          await run("fetch", HTTP_TARGET, {
            HTTP_PROXY: proxy(),
            NODE_USE_ENV_PROXY: "1",
          })
        ).seen
      ).toEqual(["CONNECT target.invalid:80"]);
    });

    it("axios follows HTTP_PROXY for http targets and HTTPS_PROXY for https ones", async () => {
      expect(
        (await run("axios", HTTP_TARGET, { HTTP_PROXY: proxy() })).seen
      ).toEqual(["GET http://target.invalid/x"]);
      expect(
        (await run("axios", HTTP_TARGET, { http_proxy: proxy() })).seen
      ).toEqual(["GET http://target.invalid/x"]);
      expect(
        (await run("axios", HTTPS_TARGET, { HTTPS_PROXY: proxy() })).seen
      ).toEqual(["CONNECT target.invalid:443"]);
    });

    it("axios does not use HTTP_PROXY for an https target", async () => {
      expect(
        (await run("axios", HTTPS_TARGET, { HTTP_PROXY: proxy() })).seen
      ).toEqual([]);
    });

    it("axios takes ALL_PROXY as the fallback for http and https addresses, either case", async () => {
      expect(
        (await run("axios", HTTP_TARGET, { ALL_PROXY: proxy() })).seen
      ).toEqual(["GET http://target.invalid/x"]);
      expect(
        (await run("axios", HTTP_TARGET, { all_proxy: proxy() })).seen
      ).toEqual(["GET http://target.invalid/x"]);
      expect(
        (await run("axios", HTTPS_TARGET, { ALL_PROXY: proxy() })).seen
      ).toEqual(["CONNECT target.invalid:443"]);
    });

    it("axios prefers HTTP_PROXY to ALL_PROXY, and honours NO_PROXY with it", async () => {
      expect(
        (
          await run("axios", HTTP_TARGET, {
            ALL_PROXY: proxy(),
            HTTP_PROXY: "http://127.0.0.1:1",
          })
        ).seen
      ).toEqual([]);
      expect(
        (
          await run("axios", HTTP_TARGET, {
            ALL_PROXY: proxy(),
            NO_PROXY: "target.invalid",
          })
        ).seen
      ).toEqual([]);
    });

    it("axios cannot use an ALL_PROXY that is not an http(s) address", async () => {
      const cases: Record<string, string> = {
        "socks5://127.0.0.1:1080": "ERR ERR_ASSERTION",
        "socks5h://127.0.0.1:1080": "ERR ERR_ASSERTION",
        "socks4://127.0.0.1:1080": "ERR ERR_ASSERTION",
        "ftp://127.0.0.1:21": "ERR ERR_ASSERTION",
        "not a url": "ERR ERR_INVALID_URL",
      };
      for (const [value, expected] of Object.entries(cases)) {
        const result = await run("axios", HTTP_TARGET, { ALL_PROXY: value });
        expect(result.seen).toEqual([]);
        expect(result.stdout).toContain(expected);
      }
    });

    it("axios accepts a bare host:port ALL_PROXY, taking the scheme of the address it calls", async () => {
      const result = await run("axios", HTTP_TARGET, {
        ALL_PROXY: `127.0.0.1:${state.port}`,
      });
      expect(result.seen).toEqual(["GET http://target.invalid/x"]);
    });

    it("fetch never reads ALL_PROXY, even with the flag, and does not crash on a bad one", async ctx => {
      if (!state.flagWorks) {
        ctx.skip();
      }
      for (const flag of [undefined, "1"]) {
        for (const name of ["ALL_PROXY", "all_proxy"]) {
          const env: Record<string, string> = { [name]: proxy() };
          if (flag) {
            env.NODE_USE_ENV_PROXY = flag;
          }
          expect((await run("fetch", HTTP_TARGET, env)).seen).toEqual([]);
          expect((await run("fetch", HTTPS_TARGET, env)).seen).toEqual([]);
        }
      }
      for (const value of ["socks5://127.0.0.1:1080", "not a url"]) {
        const started = await run("start", "", {
          ALL_PROXY: value,
          NODE_USE_ENV_PROXY: "1",
        });
        expect(started.exit).toBe(0);
        expect(started.stdout).toContain("STARTED");
      }
    });

    it("noProxyExempts agrees with what axios and fetch really do with NO_PROXY", async ctx => {
      const cases: Array<[string, string]> = [
        ["", "http://target.invalid/x"],
        ["*", "http://target.invalid/x"],
        ["target.invalid", "http://target.invalid/x"],
        ["TARGET.INVALID", "http://target.invalid/x"],
        ["target.invalid", "http://a.target.invalid/x"],
        ["invalid", "http://a.target.invalid/x"],
        [".invalid", "http://a.target.invalid/x"],
        ["*.invalid", "http://a.target.invalid/x"],
        ["a.invalid,target.invalid", "http://target.invalid/x"],
        ["a.invalid, target.invalid", "http://target.invalid/x"],
        ["a.invalid target.invalid", "http://target.invalid/x"],
        ["a.invalid\ttarget.invalid", "http://target.invalid/x"],
        ["a.invalid;target.invalid", "http://target.invalid/x"],
        ["target.invalid;", "http://target.invalid/x"],
        ["http://target.invalid", "http://target.invalid/x"],
        ["target.invalid/", "http://target.invalid/x"],
        ["target.invalid:80", "http://target.invalid/x"],
        ["target.invalid:8080", "http://target.invalid/x"],
        ["target.invalid", "http://target.invalid:8080/x"],
        ["target.invalid:8080", "http://target.invalid:8080/x"],
        ["", "http://localhost:59999/x"],
        ["localhost", "http://localhost:59999/x"],
        ["localhost", "http://127.0.0.2:59999/x"],
        ["127.0.0.1", "http://127.0.0.2:59999/x"],
        ["127.0.0.2", "http://localhost:59999/x"],
        ["localhost", "http://foo.localhost:59999/x"],
        [".localhost", "http://foo.localhost:59999/x"],
        ["127.0.0.0/8", "http://127.0.0.2:59999/x"],
        ["10.0.0.0/8", "http://10.255.255.1:59999/x"],
        ["10.255.255.0/24", "http://10.255.255.1:59999/x"],
        ["10.0.0.0/8", "http://127.0.0.2:59999/x"],
        ["10.", "http://10.255.255.1:59999/x"],
        ["10.*", "http://10.255.255.1:59999/x"],
        ["10.255.255.1", "http://10.255.255.1:59999/x"],
        ["0.0.0.0/0", "http://10.255.255.1:59999/x"],
        ["0.0.0.0/0", "http://target.invalid/x"],
        ["0.0.0.0/8", "http://target.invalid/x"],
        ["10.0.0.0/33", "http://10.255.255.1:59999/x"],
        ["10.0.0.0/32", "http://10.255.255.1:59999/x"],
        ["10.255.255.1/32", "http://10.255.255.1:59999/x"],
        ["10.0.0.5/8", "http://10.255.255.1:59999/x"],
        ["300.1.1.1/8", "http://10.255.255.1:59999/x"],
        ["localhost", "http://10.255.255.1:59999/x"],
        ["127.0.0.1", "http://10.255.255.1:59999/x"],
        ["127.0.0.1", "http://12.0.0.1:59999/x"],
        [".invalid", "http://x.invalid.test/x"],
        ["*.invalid", "http://x.invalid.test/x"],
        ["invalid", "http://x.invalid.test/x"],
        ["a.invalid", "http://x.a.invalid.test/x"],
        ["127.0.0.1", "http://127.example.test/x"],
        ["localhost", "http://127.example.test/x"],
      ];
      const stacks: Array<"axios" | "fetch"> = state.flagWorks
        ? ["axios", "fetch"]
        : ["axios"];
      if (!state.flagWorks) {
        ctx.skip();
      }
      for (const stack of stacks) {
        for (const [noProxy, target] of cases) {
          const url = new URL(target);
          const env: Record<string, string> = {
            HTTP_PROXY: proxy(),
            NO_PROXY: noProxy,
          };
          if (stack === "fetch") {
            env.NODE_USE_ENV_PROXY = "1";
          }
          const real = (await run(stack, target, env)).seen.length === 0;
          const modelled = noProxyExempts(
            noProxyEntries(noProxy),
            stack,
            url.hostname,
            url.port || "80"
          );
          expect({ stack, noProxy, target, exempt: modelled }).toEqual({
            stack,
            noProxy,
            target,
            exempt: real,
          });
        }
      }
    }, 180_000);

    it("with the flag, fetch uses HTTPS_PROXY for https addresses and falls back to HTTP_PROXY; axios never falls back", async ctx => {
      if (!state.flagWorks) {
        ctx.skip();
      }
      const flag = { NODE_USE_ENV_PROXY: "1" };
      const dead = "http://127.0.0.1:1";
      expect(
        (await run("fetch", HTTPS_TARGET, { ...flag, HTTP_PROXY: proxy() }))
          .seen
      ).toEqual(["CONNECT target.invalid:443"]);
      expect(
        (
          await run("fetch", HTTPS_TARGET, {
            ...flag,
            HTTPS_PROXY: proxy(),
            HTTP_PROXY: dead,
          })
        ).seen
      ).toEqual(["CONNECT target.invalid:443"]);
      expect(
        (
          await run("fetch", HTTPS_TARGET, {
            ...flag,
            HTTPS_PROXY: dead,
            HTTP_PROXY: proxy(),
          })
        ).seen
      ).toEqual([]);
      expect(
        (await run("fetch", HTTP_TARGET, { ...flag, HTTPS_PROXY: proxy() }))
          .seen
      ).toEqual([]);
      expect(
        (await run("axios", HTTP_TARGET, { HTTPS_PROXY: proxy() })).seen
      ).toEqual([]);
      expect(
        (
          await run("axios", HTTPS_TARGET, {
            HTTPS_PROXY: dead,
            HTTP_PROXY: proxy(),
          })
        ).seen
      ).toEqual([]);
    });

    it("axios honours NO_PROXY", async () => {
      expect(
        (
          await run("axios", HTTP_TARGET, {
            HTTP_PROXY: proxy(),
            NO_PROXY: "target.invalid",
          })
        ).seen
      ).toEqual([]);
    });

    it("axios rejects a proxy value that is not a URL", async () => {
      const result = await run("axios", HTTP_TARGET, {
        HTTP_PROXY: "not a url",
      });
      expect(result.seen).toEqual([]);
      expect(result.stdout).toContain("ERR ERR_INVALID_URL");
    });

    it("with the flag, Node refuses to start on a value that is not an http(s) URL", async ctx => {
      if (!state.flagWorks) {
        ctx.skip();
      }
      for (const value of ["not a url", "127.0.0.1:3128"]) {
        const result = await run("start", "", {
          HTTP_PROXY: value,
          NODE_USE_ENV_PROXY: "1",
        });
        expect(result.exit).not.toBe(0);
        expect(result.stdout).not.toContain("STARTED");
        expect(result.stderr).toContain("Invalid URL");
      }
      const ok = await run("start", "", {
        HTTP_PROXY: proxy(),
        NODE_USE_ENV_PROXY: "1",
      });
      expect(ok.stdout).toContain("STARTED");
    });
  });
});

describe("ALL_PROXY", () => {
  const PROXY = "http://proxy.example.com:3128";
  const mine = (found: string[]) =>
    found.filter(text => text.startsWith("ALL_PROXY"));

  it("is silent when unset, and the old signature still works", () => {
    expect(outboundProxyWarnings("", "", "", "")).toEqual([]);
    expect(outboundProxyWarnings("", PROXY, "1")).toEqual([]);
  });

  it("says it proxies only the portal sign-in, however the flag is set", () => {
    for (const flag of ["", "1", "true", "0"]) {
      const found = outboundProxyWarnings("", "", flag, PROXY);
      expect(found).toHaveLength(1);
      expect(found[0]).toMatch(/^ALL_PROXY is read only by axios/);
      expect(found[0]).toContain("even with NODE_USE_ENV_PROXY=1");
      expect(found[0]).toContain(
        "HTTPS_PROXY together with NODE_USE_ENV_PROXY=1"
      );
      expect(found[0]).toContain("S3 backup client");
    }
  });

  it("is quiet once HTTPS_PROXY and the flag are both there, since fetch then follows that", () => {
    expect(outboundProxyWarnings("", PROXY, "1", PROXY)).toEqual([]);
    expect(outboundProxyWarnings(PROXY, PROXY, "1", PROXY)).toEqual([]);
  });

  it("still says it when HTTPS_PROXY is set but the flag is not 1, or the flag is set but HTTPS_PROXY is not", () => {
    expect(mine(outboundProxyWarnings("", PROXY, "", PROXY))).toHaveLength(1);
    expect(mine(outboundProxyWarnings("", PROXY, "true", PROXY))).toHaveLength(
      1
    );
    expect(mine(outboundProxyWarnings(PROXY, "", "1", PROXY))).toHaveLength(1);
  });

  it("keeps the warnings about HTTP_PROXY and HTTPS_PROXY first and unchanged", () => {
    const found = outboundProxyWarnings("", PROXY, "", PROXY);
    expect(found).toHaveLength(2);
    expect(found[0]).toMatch(/^HTTPS_PROXY is set, but only part of/);
    expect(found[1]).toMatch(/^ALL_PROXY is read only by axios/);
  });

  it.each([
    "socks5://proxy.example.com:1080",
    "socks5h://proxy.example.com:1080",
    "socks4://proxy.example.com:1080",
    "ftp://proxy.example.com",
    "not a url",
    "http://",
    "https://",
    "://proxy.example.com",
    ":3128",
    "proxy example.com:3128",
  ])(
    "calls %j a value axios cannot use, and says the server still starts",
    value => {
      for (const flag of ["", "1"]) {
        const found = outboundProxyWarnings("", "", flag, value);
        expect(found).toHaveLength(1);
        expect(found[0]).toMatch(
          /^ALL_PROXY is not an http:\/\/ or https:\/\/ proxy address/
        );
        expect(found[0]).toContain("ERR_ASSERTION");
        expect(found[0]).toContain("ERR_INVALID_URL");
        expect(found[0]).toContain("the server still starts");
      }
      expect(outboundProxyWarnings("", PROXY, "1", value)).toHaveLength(1);
    }
  );

  it.each([
    PROXY,
    "https://proxy.example.com:3128",
    "http://u:p@proxy.example.com:3128",
    "proxy.example.com:3128",
    "127.0.0.1:3128",
    "proxy.example.com",
  ])("accepts %j as a usable address", value => {
    const found = outboundProxyWarnings("", "", "1", value);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatch(/^ALL_PROXY is read only by axios/);
  });

  it("never repeats any part of the value, which may hold proxy credentials", () => {
    for (const value of [
      "http://admin:hunter2zz@proxy.example.com:3128",
      "socks5://admin:hunter2zz@proxy.example.com:1080",
      "hunter2zz.example.com:3128",
      "not a hunter2zz url",
    ]) {
      for (const flag of ["", "1"]) {
        for (const text of outboundProxyWarnings("", "", flag, value)) {
          expect(text).not.toContain("hunter2zz");
          expect(text).not.toContain("admin");
        }
      }
    }
  });

  it("is a warning only, raised through configWarnings, and silent when the caller does not say", () => {
    expect(configProblems(env({ allProxy: PROXY }))).toEqual([]);
    expect(configWarnings(env({ allProxy: PROXY }))).toHaveLength(1);
    expect(configWarnings(env())).toEqual([]);
    expect(
      configWarnings({
        databaseUrl: "",
        appId: "",
        cookieSecret: "",
        allProxy: PROXY,
      })
    ).toHaveLength(1);
  });

  it("hands all four values from configWarnings to the check", () => {
    expect(
      configWarnings(
        env({ allProxy: PROXY, httpsProxy: PROXY, nodeUseEnvProxy: "1" })
      )
    ).toEqual([]);
    expect(
      configWarnings(
        env({ allProxy: PROXY, httpsProxy: PROXY, nodeUseEnvProxy: "" })
      )
    ).toHaveLength(2);
    expect(configWarnings(env({ allProxy: "socks5://p:1" }))[0]).toMatch(
      /^ALL_PROXY is not an http/
    );
  });

  describe("what env.ts hands over", () => {
    const NAMES = ["all_proxy", "ALL_PROXY"];
    const read = async (set: Record<string, string>) => {
      const { vi } = await import("vitest");
      const saved = Object.fromEntries(NAMES.map(n => [n, process.env[n]]));
      try {
        for (const n of NAMES) {
          delete process.env[n];
        }
        Object.assign(process.env, set);
        vi.resetModules();
        return (await import("./env")).ENV.allProxy;
      } finally {
        for (const n of NAMES) {
          if (saved[n] === undefined) {
            delete process.env[n];
          } else {
            process.env[n] = saved[n];
          }
        }
      }
    };

    it("is empty when unset, reads either case, and the lower-case name wins as it does for axios", async () => {
      expect(await read({})).toBe("");
      expect(await read({ ALL_PROXY: "http://upper:1" })).toBe(
        "http://upper:1"
      );
      expect(await read({ all_proxy: "http://lower:1" })).toBe(
        "http://lower:1"
      );
      expect(
        await read({ ALL_PROXY: "http://upper:1", all_proxy: "http://lower:1" })
      ).toBe("http://lower:1");
    });
  });
});

describe("instanceWarnings", () => {
  it("is silent for a single process", () => {
    expect(instanceWarnings("", "")).toEqual([]);
    expect(instanceWarnings("1", "")).toEqual([]);
  });

  it("warns when a process manager runs several", () => {
    expect(instanceWarnings("4", "")).toHaveLength(1);
    expect(instanceWarnings("", "0")).toHaveLength(1);
    expect(instanceWarnings("4", "")[0]).toMatch(/multiplied/);
  });

  it("ignores a value that is not a number", () => {
    expect(instanceWarnings("many", "")).toEqual([]);
  });

  it("reaches the startup warnings", () => {
    expect(
      configWarnings({
        databaseUrl: "",
        appId: "",
        cookieSecret: "",
        webConcurrency: "3",
      }).some(w => w.includes("more than one server process"))
    ).toBe(true);
  });
});

describe("AWS_ENDPOINT_URL", () => {
  const BUCKET = "my-bucket";
  const MINIO = "http://minio.example.test:9000";

  it("says that S3_ENDPOINT wins when both are set, for either variable", () => {
    const [general] = awsEndpointUrlWarnings(BUCKET, MINIO, MINIO, "", "");
    expect(general).toMatch(/^AWS_ENDPOINT_URL is set, but so is S3_ENDPOINT/);
    const [s3] = awsEndpointUrlWarnings(BUCKET, MINIO, "", MINIO, "");
    expect(s3).toMatch(/^AWS_ENDPOINT_URL_S3 is set, but so is S3_ENDPOINT/);
  });

  it("names AWS_ENDPOINT_URL_S3 when both variables are set, as the SDK prefers it", () => {
    const [text] = awsEndpointUrlWarnings(BUCKET, MINIO, MINIO, MINIO, "");
    expect(text).toMatch(/^AWS_ENDPOINT_URL_S3 /);
  });

  it("does not judge the value of an ignored variable", () => {
    const found = awsEndpointUrlWarnings(BUCKET, MINIO, "junk", "", "");
    expect(found).toHaveLength(1);
    expect(found[0]).toContain("does nothing");
  });

  it("warns that backups go to the variable's address, with the bucket in the hostname", () => {
    const [text] = awsEndpointUrlWarnings(BUCKET, "", MINIO, "", "");
    expect(text).toMatch(/^AWS_ENDPOINT_URL is set and S3_ENDPOINT is not/);
    expect(text).toContain("bucket name in the hostname");
    expect(text).toContain("Set S3_ENDPOINT");
  });

  it("judges the variable the SDK would use: _S3 over the general one, and empty counts as unset", () => {
    const [s3] = awsEndpointUrlWarnings(BUCKET, "", "junk", MINIO, "");
    expect(s3).toMatch(/^AWS_ENDPOINT_URL_S3 is set and S3_ENDPOINT is not/);
    const [general] = awsEndpointUrlWarnings(BUCKET, "", MINIO, "  ", "");
    expect(general).toMatch(/^AWS_ENDPOINT_URL is set and/);
  });

  it.each([
    "minio.example.test:9000",
    "not-a-url",
    '"http://minio.example.test:9000"',
    "ftp://minio.example.test",
    "http://",
  ])("flags the value %j as one the SDK refuses", value => {
    const found = awsEndpointUrlWarnings(BUCKET, "", value, "", "");
    expect(found).toHaveLength(1);
    expect(found[0]).toContain("not an absolute http(s) URL");
  });

  it("flags a bad _S3 value even when the general one is fine, since _S3 is the one used", () => {
    const [text] = awsEndpointUrlWarnings(BUCKET, "", MINIO, "junk", "");
    expect(text).toMatch(/^AWS_ENDPOINT_URL_S3 is not an absolute/);
  });

  it("stays silent for a real AWS host, which takes the bucket in the hostname", () => {
    for (const host of [
      "https://s3-fips.us-east-1.amazonaws.com",
      "https://bucket.vpce-0abc.s3.us-east-1.vpce.amazonaws.com",
    ]) {
      expect(awsEndpointUrlWarnings(BUCKET, "", host, "", "")).toEqual([]);
    }
    expect(
      awsEndpointUrlWarnings(BUCKET, "", "https://evilamazonaws.com", "", "")
    ).toHaveLength(1);
  });

  it("is silent when the SDK is told to ignore the variables, and only exactly true does", () => {
    expect(awsEndpointUrlWarnings(BUCKET, "", MINIO, "", "true")).toEqual([]);
    expect(awsEndpointUrlWarnings(BUCKET, MINIO, MINIO, "", "true")).toEqual(
      []
    );
    for (const value of ["TRUE", "1", "yes", " true"]) {
      const found = awsEndpointUrlWarnings(BUCKET, "", MINIO, "", value);
      expect(found).toHaveLength(2);
      expect(found[0]).toContain("exactly true");
    }
  });

  it("is silent with backup off, with no variable, and with empty ones", () => {
    expect(awsEndpointUrlWarnings("", "", MINIO, "", "")).toEqual([]);
    expect(awsEndpointUrlWarnings(BUCKET, "", "", "", "")).toEqual([]);
    expect(awsEndpointUrlWarnings(BUCKET, "", " ", " ", "")).toEqual([]);
    expect(awsEndpointUrlWarnings(BUCKET, "", "", "", "TRUE")).toEqual([]);
  });

  it("never repeats a value", () => {
    for (const found of [
      awsEndpointUrlWarnings(BUCKET, "", "http://zz-host-9.test:9", "", ""),
      awsEndpointUrlWarnings(BUCKET, "http://zz-host-9.test", "", "zz-9", ""),
      awsEndpointUrlWarnings(BUCKET, "", "zz-host-9.test:9", "", "zz-flag-9"),
    ]) {
      for (const text of found) {
        expect(text).not.toContain("zz-host-9");
        expect(text).not.toContain("zz-flag-9");
        expect(text).not.toContain("zz-9");
      }
    }
  });

  it("is a warning only, raised through configWarnings", () => {
    const cfg = { s3Bucket: BUCKET, awsEndpointUrl: MINIO };
    expect(configProblems(env(cfg))).toEqual([]);
    expect(configWarnings(env(cfg))).toHaveLength(1);
    expect(configWarnings(env({ awsEndpointUrl: MINIO }))).toEqual([]);
    expect(configWarnings(env({ s3Bucket: BUCKET }))).toEqual([]);
  });

  it("hands configWarnings every input to the check", () => {
    const base = { s3Bucket: BUCKET, awsEndpointUrl: MINIO };
    expect(configWarnings(env({ ...base, s3Endpoint: MINIO }))[0]).toContain(
      "which wins"
    );
    expect(
      configWarnings(env({ ...base, awsIgnoreEndpointUrls: "true" }))
    ).toEqual([]);
    expect(
      configWarnings(env({ s3Bucket: BUCKET, awsEndpointUrlS3: "junk" }))[0]
    ).toMatch(/^AWS_ENDPOINT_URL_S3 is not an absolute/);
    expect(
      configWarnings(env({ ...base, awsEndpointUrlS3: "junk" }))[0]
    ).toMatch(/^AWS_ENDPOINT_URL_S3 is not an absolute/);
  });

  it("reads all three variables in env.ts, and unset ones are empty", async () => {
    const { vi } = await import("vitest");
    const names = {
      AWS_ENDPOINT_URL: "awsEndpointUrl",
      AWS_ENDPOINT_URL_S3: "awsEndpointUrlS3",
      AWS_IGNORE_CONFIGURED_ENDPOINT_URLS: "awsIgnoreEndpointUrls",
    } as const;
    vi.resetModules();
    for (const name of Object.keys(names)) delete process.env[name];
    const unset = (await import("./env")).ENV;
    vi.resetModules();
    for (const name of Object.keys(names)) vi.stubEnv(name, `v-${name}`);
    const set = (await import("./env")).ENV;
    vi.unstubAllEnvs();
    for (const [name, key] of Object.entries(names)) {
      expect(unset[key]).toBe("");
      expect(set[key]).toBe(`v-${name}`);
    }
  });

  describe("what the installed SDK does with the same environment", () => {
    // Builds the S3 client the way storage.ts does and reads the request it
    // would send, in a child process with a minimal environment so nothing of
    // this machine's AWS settings leaks in.
    const PROBE = `
      const { S3Client, HeadBucketCommand } = require(${JSON.stringify(
        resolve(process.cwd(), "node_modules/@aws-sdk/client-s3")
      )});
      const cfg = JSON.parse(process.argv[1]);
      const c = new S3Client({ region: "us-east-1", credentials: { accessKeyId: "a", secretAccessKey: "b" }, maxAttempts: 1, ...cfg });
      c.middlewareStack.add(next => async args => { console.log("URL " + args.request.protocol + "//" + args.request.hostname + (args.request.port ? ":" + args.request.port : "") + args.request.path); throw new Error("stop"); }, { step: "finalizeRequest", name: "probe", priority: "low" });
      c.send(new HeadBucketCommand({ Bucket: "mybucket" })).catch(e => { if (e.message !== "stop") console.log("ERR " + e.name); });
    `;
    const EXPLICIT = {
      endpoint: "http://explicit.example.test:9000",
      forcePathStyle: true,
    };
    const AWS = "https://mybucket.s3.us-east-1.amazonaws.com/";
    const probe = (set: Record<string, string>, cfg: object = {}) =>
      execFileSync(process.execPath, ["-e", PROBE, JSON.stringify(cfg)], {
        env: { PATH: process.env.PATH ?? "", ...NO_AWS_FILES, ...set },
        encoding: "utf8",
      }).trim();

    it("sends to AWS with nothing set, and an empty variable counts as unset", () => {
      expect(probe({})).toBe(`URL ${AWS}`);
      expect(probe({ AWS_ENDPOINT_URL: "", AWS_ENDPOINT_URL_S3: "" })).toBe(
        `URL ${AWS}`
      );
    });

    it("follows the variable, with the bucket in the hostname, when no endpoint is given", () => {
      expect(probe({ AWS_ENDPOINT_URL: "http://g.example.test:9000" })).toBe(
        "URL http://mybucket.g.example.test:9000/"
      );
    });

    it("prefers AWS_ENDPOINT_URL_S3, and ignores an empty one", () => {
      const both = {
        AWS_ENDPOINT_URL: "http://g.example.test:9000",
        AWS_ENDPOINT_URL_S3: "http://s3.example.test:9000",
      };
      expect(probe(both)).toBe("URL http://mybucket.s3.example.test:9000/");
      expect(probe({ ...both, AWS_ENDPOINT_URL_S3: "" })).toBe(
        "URL http://mybucket.g.example.test:9000/"
      );
    });

    it("lets an explicit endpoint win over both, even over a broken value", () => {
      const expected = "URL http://explicit.example.test:9000/mybucket/";
      expect(
        probe({ AWS_ENDPOINT_URL: "http://g.example.test:9000" }, EXPLICIT)
      ).toBe(expected);
      expect(probe({ AWS_ENDPOINT_URL: "not-a-url" }, EXPLICIT)).toBe(expected);
      expect(probe({ AWS_ENDPOINT_URL_S3: '"x"' }, EXPLICIT)).toBe(expected);
    });

    it.each([
      ["minio.example.test:9000", "ERR EndpointError"],
      ["not-a-url", "ERR TypeError"],
      ['"http://q.example.test:9000"', "ERR TypeError"],
      ["ftp://x.example.test", "ERR EndpointError"],
    ])("refuses %j at the first request", (value, expected) => {
      expect(probe({ AWS_ENDPOINT_URL: value })).toBe(expected);
    });

    it("honours the ignore flag only when it is exactly true", () => {
      const set = { AWS_ENDPOINT_URL: "http://m.example.test:9000" };
      expect(
        probe({ ...set, AWS_IGNORE_CONFIGURED_ENDPOINT_URLS: "true" })
      ).toBe(`URL ${AWS}`);
      for (const value of ["TRUE", "1", "yes", " true"]) {
        expect(
          probe({ ...set, AWS_IGNORE_CONFIGURED_ENDPOINT_URLS: value })
        ).toBe("URL http://mybucket.m.example.test:9000/");
      }
    });
  });
});

describe("NO_PROXY", () => {
  const PROXY = "http://proxy.example.com:3128";
  const none: Array<{ name: string; url: string; stack: "axios" | "fetch" }> =
    [];
  const warn = (
    noProxy: string,
    proxies: { http?: string; https?: string; all?: string; flag?: string },
    targets = none
  ) =>
    noProxyWarnings(
      noProxy,
      proxies.http ?? "",
      proxies.https ?? "",
      proxies.all ?? "",
      proxies.flag ?? "",
      targets
    );
  const portal = (url: string) => ({
    name: "OAUTH_SERVER_URL",
    url,
    stack: "axios" as const,
  });
  const llm = (url: string) => ({
    name: "BUILT_IN_FORGE_API_URL",
    url,
    stack: "fetch" as const,
  });
  const mail = (url: string) => ({
    name: "EMAIL_API_URL",
    url,
    stack: "fetch" as const,
  });

  it("is silent when no proxy variable is set, whatever NO_PROXY and the targets say", () => {
    expect(
      warn("a;b http://x 10. 10.0.0.0/8", {}, [portal("http://localhost:3000")])
    ).toEqual([]);
  });

  it("is silent with a clean NO_PROXY and no targets", () => {
    expect(warn("", { https: PROXY, flag: "1" })).toEqual([]);
    expect(
      warn("localhost,.example.com, 10.0.0.0/8", { https: PROXY })
    ).toEqual([]);
  });

  describe("entries nothing can match", () => {
    it.each([
      ["a.invalid;b.invalid", "joined with ;"],
      ["target.invalid;", "joined with ;"],
      ["http://target.invalid", "a scheme such as http://"],
      ["https://target.invalid", "a scheme such as http://"],
      ["target.invalid/", "ending in /"],
      ["10.", "IP prefixes"],
      ["10.0.", "IP prefixes"],
      ["10.*", "IP prefixes"],
    ])("flags %j", (noProxy, reason) => {
      const found = warn(noProxy, { https: PROXY });
      expect(found).toHaveLength(1);
      expect(found[0]).toMatch(/^NO_PROXY has /);
      expect(found[0]).toContain(reason);
      expect(found[0]).toContain("neither axios nor Node's fetch can match");
    });

    it.each([
      "localhost",
      ".example.com",
      "*.example.com",
      "*",
      "example.com:8080",
      "10.0.0.0/8",
      "10.0.0.1",
      "a.invalid, b.invalid\tc.invalid",
    ])("does not flag %j", noProxy => {
      expect(warn(noProxy, { https: PROXY })).toEqual([]);
    });

    it("names every kind found in one warning", () => {
      const found = warn("a;b http://c d/ 10.*", { https: PROXY });
      expect(found).toHaveLength(1);
      for (const part of [
        "joined with ;",
        "a scheme",
        "ending in /",
        "IP prefixes",
      ]) {
        expect(found[0]).toContain(part);
      }
    });
  });

  describe("CIDR ranges", () => {
    it("warns that fetch ignores them, only when fetch follows the proxy", () => {
      const found = warn("10.0.0.0/8", { https: PROXY, flag: "1" });
      expect(found).toHaveLength(1);
      expect(found[0]).toMatch(/axios honours it but Node's fetch does not/);
      expect(warn("10.0.0.0/8", { https: PROXY, flag: "" })).toEqual([]);
      expect(warn("10.0.0.0/8", { https: PROXY, flag: "true" })).toEqual([]);
    });
  });

  describe("a local address that would go to the proxy", () => {
    it("warns for the portal when NO_PROXY does not exempt it", () => {
      const found = warn("", { http: PROXY }, [
        portal("http://localhost:3000"),
      ]);
      expect(found).toHaveLength(1);
      expect(found[0]).toMatch(/^OAUTH_SERVER_URL points at this machine/);
      expect(found[0]).toContain("axios");
      expect(found[0]).toContain("cannot reach this machine's localhost");
    });

    it("is silent once NO_PROXY exempts it, and axios counts any loopback entry as all of them", () => {
      for (const noProxy of ["localhost", "127.0.0.1", "*"]) {
        expect(
          warn(noProxy, { http: PROXY }, [portal("http://localhost:3000")])
        ).toEqual([]);
        expect(
          warn(noProxy, { http: PROXY }, [portal("http://127.0.0.2:3000")])
        ).toEqual([]);
      }
      // A CIDR range matches an IP literal, never the name localhost (tested).
      expect(
        warn("127.0.0.0/8", { http: PROXY }, [portal("http://127.0.0.2:3000")])
      ).toEqual([]);
      expect(
        warn("127.0.0.0/8", { http: PROXY }, [portal("http://localhost:3000")])
      ).toHaveLength(1);
    });

    it("needs the exact host for fetch: localhost does not cover 127.0.0.1, and CIDR covers nothing", () => {
      const target = [llm("http://127.0.0.1:11434")];
      const base = { http: PROXY, flag: "1" };
      expect(warn("localhost", base, target)).toHaveLength(1);
      expect(
        warn("127.0.0.0/8", base, target).some(t =>
          t.includes("points at this machine")
        )
      ).toBe(true);
      expect(warn("127.0.0.1", base, target)).toEqual([]);
      expect(warn("127.0.0.1:11434", base, target)).toEqual([]);
      expect(warn("127.0.0.1:1234", base, target)).toHaveLength(1);
      expect(warn("localhost", base, [llm("http://localhost:11434")])).toEqual(
        []
      );
      const found = warn("", base, target);
      expect(found[0]).toMatch(
        /^BUILT_IN_FORGE_API_URL points at this machine/
      );
      expect(found[0]).toContain("Node's fetch");
    });

    it("leaves fetch targets alone unless fetch follows the proxy", () => {
      expect(
        warn("", { http: PROXY }, [llm("http://localhost:11434")])
      ).toEqual([]);
      expect(
        warn("", { http: PROXY, flag: "true" }, [llm("http://localhost:11434")])
      ).toEqual([]);
    });

    it("matches the proxy variable to the scheme of the address, the way each stack does", () => {
      // fetch: https takes HTTPS_PROXY and falls back to HTTP_PROXY; http takes HTTP_PROXY only.
      expect(
        warn("", { http: PROXY, flag: "1" }, [llm("https://localhost:8443")])
      ).toHaveLength(1);
      expect(
        warn("", { https: PROXY, flag: "1" }, [llm("https://localhost:8443")])
      ).toHaveLength(1);
      expect(
        warn("", { https: PROXY, flag: "1" }, [llm("http://localhost:11434")])
      ).toEqual([]);
      expect(
        warn("", { http: PROXY, flag: "1" }, [llm("http://localhost:11434")])
      ).toHaveLength(1);
      // axios: http takes HTTP_PROXY, https takes HTTPS_PROXY, no fall-back either way.
      expect(
        warn("", { https: PROXY }, [portal("http://localhost:3000")])
      ).toEqual([]);
      expect(
        warn("", { http: PROXY }, [portal("https://localhost:3000")])
      ).toEqual([]);
      expect(
        warn("", { http: PROXY }, [portal("http://localhost:3000")])
      ).toHaveLength(1);
      expect(
        warn("", { https: PROXY }, [portal("https://localhost:3000")])
      ).toHaveLength(1);
    });

    it("counts ALL_PROXY for axios, and not for fetch", () => {
      expect(
        warn("", { all: PROXY }, [portal("http://localhost:3000")])
      ).toHaveLength(1);
      expect(
        warn("", { all: PROXY }, [portal("https://localhost:3000")])
      ).toHaveLength(1);
      expect(
        warn("", { all: PROXY, flag: "1" }, [llm("http://localhost:11434")])
      ).toEqual([]);
    });

    it("does not call a private or public address 'this machine'", () => {
      for (const url of [
        "http://10.255.255.1:3000",
        "http://192.168.1.1",
        "http://8.8.8.8",
        "http://12.0.0.1",
      ]) {
        expect(warn("", { http: PROXY }, [portal(url)])).toEqual([]);
      }
    });

    it("takes the default port of the scheme when the URL names none", () => {
      expect(
        warn("localhost:80", { http: PROXY }, [portal("http://localhost")])
      ).toEqual([]);
      expect(
        warn("localhost:443", { https: PROXY }, [portal("https://localhost")])
      ).toEqual([]);
      expect(
        warn("localhost:8080", { http: PROXY }, [portal("http://localhost")])
      ).toHaveLength(1);
      expect(
        warn("localhost:80", { https: PROXY }, [portal("https://localhost")])
      ).toHaveLength(1);
      expect(
        warn("localhost:3000", { http: PROXY }, [
          portal("http://localhost:3000"),
        ])
      ).toEqual([]);
    });

    it("does not take a hostname that merely starts with 127. for this machine", () => {
      expect(
        warn("", { http: PROXY }, [portal("http://127.example.test:3000")])
      ).toEqual([]);
      expect(
        warn("localhost", { http: PROXY }, [
          portal("http://127.example.test:3000"),
        ])
      ).toEqual([]);
    });

    it("skips an unset or unreadable target", () => {
      expect(
        warn("", { http: PROXY, flag: "1" }, [
          portal(""),
          llm("not a url"),
          mail("ftp://localhost"),
        ])
      ).toEqual([]);
    });
  });

  describe("a parent domain that does not cover subdomains", () => {
    const base = { https: PROXY, flag: "1" };
    const target = [mail("https://api.example.com/send")];

    it("warns when only the bare domain is listed", () => {
      for (const noProxy of [
        "example.com",
        "example.com:443",
        "other.org,example.com",
      ]) {
        const found = warn(noProxy, base, target);
        expect(found).toHaveLength(1);
        expect(found[0]).toMatch(
          /^NO_PROXY has an entry for a parent domain of the host in EMAIL_API_URL/
        );
        expect(found[0]).toContain("Write it as .example.com");
      }
    });

    it("is silent once a suffix entry, the exact host or * covers it", () => {
      for (const noProxy of [
        ".example.com",
        "*.example.com",
        "example.com,.example.com",
        "api.example.com",
        "*",
      ]) {
        expect(warn(noProxy, base, target)).toEqual([]);
      }
    });

    it("is silent when no entry is a parent of the host", () => {
      expect(warn("other.org", base, target)).toEqual([]);
      expect(warn("", base, target)).toEqual([]);
    });
  });

  it("never repeats an entry, a host or a URL, which may hold credentials", () => {
    const secrets = "hunter2zz";
    const found = [
      ...warn(`${secrets};b http://${secrets}.example.com ${secrets}/`, {
        https: PROXY,
        flag: "1",
      }),
      ...warn(`${secrets}.example.com`, { https: PROXY, flag: "1" }, [
        mail(`https://admin:${secrets}@api.${secrets}.example.com/send`),
      ]),
      ...warn("", { http: PROXY }, [
        portal(`http://admin:${secrets}@localhost:3000`),
      ]),
    ];
    expect(found.length).toBeGreaterThan(2);
    for (const text of found) {
      expect(text).not.toContain(secrets);
      expect(text).not.toContain("admin");
    }
  });

  it("is a warning only, raised through configWarnings, and silent when the caller does not say", () => {
    const cfg = { httpProxy: PROXY, noProxy: "a;b" };
    expect(configProblems(env(cfg))).toEqual([]);
    expect(
      configWarnings(
        env({ ...cfg, nodeUseEnvProxy: "1", httpsProxy: PROXY })
      )[0]
    ).toMatch(/NO_PROXY has/);
    expect(configWarnings(env({ httpProxy: PROXY }))).toHaveLength(2);
    expect(configWarnings(env({ noProxy: "a;b" }))).toEqual([]);
  });

  it("hands ALL_PROXY and the flag from configWarnings to the check, and gives each address the right stack", () => {
    const local = (extra: Record<string, string>) =>
      configWarnings(env({ noProxy: "other.org", ...extra })).filter(text =>
        text.includes("points at this machine")
      );
    // ALL_PROXY alone is enough for the portal (axios).
    expect(
      local({ allProxy: PROXY, oAuthServerUrl: "http://localhost:3000" })
    ).toHaveLength(1);
    // The portal is axios: it needs no flag. The AI provider and email are fetch: they do.
    expect(
      local({ httpProxy: PROXY, oAuthServerUrl: "http://localhost:3000" })
    ).toHaveLength(1);
    expect(
      local({ httpProxy: PROXY, forgeApiUrl: "http://localhost:11434" })
    ).toEqual([]);
    expect(
      local({ httpProxy: PROXY, emailApiUrl: "http://localhost:8025/send" })
    ).toEqual([]);
    expect(
      local({
        httpProxy: PROXY,
        nodeUseEnvProxy: "1",
        forgeApiUrl: "http://localhost:11434",
      })
    ).toHaveLength(1);
  });

  it("hands the three configured addresses from configWarnings to the check", () => {
    const base = {
      httpProxy: PROXY,
      httpsProxy: PROXY,
      nodeUseEnvProxy: "1",
      noProxy: "other.org",
    };
    const local = (extra: Record<string, string>) =>
      configWarnings(env({ ...base, ...extra })).filter(text =>
        text.includes("points at this machine")
      );
    expect(local({ oAuthServerUrl: "http://localhost:3000" })).toHaveLength(1);
    expect(local({ forgeApiUrl: "http://localhost:11434" })).toHaveLength(1);
    expect(local({ emailApiUrl: "http://localhost:8025/send" })).toHaveLength(
      1
    );
    expect(local({})).toEqual([]);
    expect(configWarnings(env({ ...base }))).toEqual([]);
  });

  describe("what env.ts hands over", () => {
    const NAMES = ["no_proxy", "NO_PROXY"];
    const read = async (set: Record<string, string>) => {
      const { vi } = await import("vitest");
      const saved = Object.fromEntries(NAMES.map(n => [n, process.env[n]]));
      try {
        for (const n of NAMES) {
          delete process.env[n];
        }
        Object.assign(process.env, set);
        vi.resetModules();
        return (await import("./env")).ENV.noProxy;
      } finally {
        for (const n of NAMES) {
          if (saved[n] === undefined) {
            delete process.env[n];
          } else {
            process.env[n] = saved[n];
          }
        }
      }
    };

    it("is empty when unset, reads either case, and the lower-case name wins as it does for axios", async () => {
      expect(await read({})).toBe("");
      expect(await read({ NO_PROXY: "upper" })).toBe("upper");
      expect(await read({ no_proxy: "lower" })).toBe("lower");
      expect(await read({ NO_PROXY: "upper", no_proxy: "lower" })).toBe(
        "lower"
      );
    });
  });
});

// These run the installed mysql2 over a real-looking URL (building a pool opens
// no connection), so they pin what the driver does with `ssl` rather than what
// this file believes it does.
describe("DATABASE_URL and TLS", () => {
  const HOST = "mysql://app:s3cret-pw@db.example.com:3306/notes";
  const withSsl = (value: string) => `${HOST}?ssl=${encodeURIComponent(value)}`;

  describe("databaseTlsWarnings", () => {
    it("warns in production when TLS is not asked for", () => {
      const warnings = databaseTlsWarnings(HOST, true);

      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toMatch(/does not ask for TLS/);
    });

    it("treats ssl=false the same as leaving it out", () => {
      expect(databaseTlsWarnings(`${HOST}?ssl=false`, true)).toHaveLength(1);
    });

    it.each([
      ["an empty object", "{}"],
      ["rejectUnauthorized true", '{"rejectUnauthorized":true}'],
      ["a named profile", "Amazon RDS"],
    ])("is silent when TLS is on and verified (%s)", (_label, value) => {
      expect(databaseTlsWarnings(withSsl(value), true)).toEqual([]);
    });

    it("warns when TLS is on but the certificate is not checked", () => {
      const warnings = databaseTlsWarnings(
        withSsl('{"rejectUnauthorized":false}'),
        true
      );

      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toMatch(/never checked/);
    });

    it("says nothing outside production, where a local database is normal", () => {
      expect(databaseTlsWarnings(HOST, false)).toEqual([]);
    });

    it.each(["localhost", "127.0.0.1", "[::1]"])(
      "says nothing for a database on %s",
      host => {
        expect(
          databaseTlsWarnings(`mysql://app:pw@${host}:3306/notes`, true)
        ).toEqual([]);
      }
    );

    it("never repeats the credentials in the URL", () => {
      for (const url of [HOST, withSsl('{"rejectUnauthorized":false}')]) {
        const text = databaseTlsWarnings(url, true).join(" ");
        expect(text).not.toContain("s3cret-pw");
        expect(text).not.toContain("db.example.com");
      }
    });

    it("leaves a URL that is not a URL to the existing check", () => {
      expect(databaseTlsWarnings("not a url", true)).toEqual([]);
    });

    it("is part of the startup warnings when there is a database", () => {
      const env = {
        databaseUrl: HOST,
        appId: "",
        cookieSecret: "",
        nodeEnv: "production",
      };

      expect(
        configWarnings(env).some(w => w.includes("does not ask for TLS"))
      ).toBe(true);
      expect(
        configWarnings({ ...env, nodeEnv: "development" }).some(w =>
          w.includes("does not ask for TLS")
        )
      ).toBe(false);
    });

    it("is not raised when there is no database", () => {
      expect(
        configWarnings({
          databaseUrl: "",
          appId: "",
          cookieSecret: "",
          nodeEnv: "production",
        }).some(w => w.includes("TLS"))
      ).toBe(false);
    });
  });

  describe("databaseDriverProblem", () => {
    // `ssl=true` reads as "turn TLS on". The driver throws, getDb swallows it,
    // and the server runs with no database and nobody able to sign in.
    it("refuses ssl=true, which the driver rejects", () => {
      const problem = databaseDriverProblem(`${HOST}?ssl=true`);

      expect(problem).toMatch(/driver refuses/);
      expect(problem).toMatch(/ssl=%7B%7D/);
    });

    it("refuses a profile the driver does not know", () => {
      expect(databaseDriverProblem(`${HOST}?ssl=garbage`)).not.toBeNull();
    });

    it.each([
      ["no ssl at all", HOST],
      ["ssl=false", `${HOST}?ssl=false`],
      ["an empty object", withSsl("{}")],
      ["a named profile", withSsl("Amazon RDS")],
      ["certificate checking off", withSsl('{"rejectUnauthorized":false}')],
    ])("accepts %s", (_label, url) => {
      expect(databaseDriverProblem(url)).toBeNull();
    });

    it("leaves a URL that is not a URL to the existing check", () => {
      expect(databaseDriverProblem("not a url")).toBeNull();
    });

    it("never repeats the credentials in the URL", () => {
      expect(databaseDriverProblem(`${HOST}?ssl=true`)).not.toContain(
        "s3cret-pw"
      );
    });

    it("stops the server from starting", () => {
      const problems = configProblems({
        databaseUrl: `${HOST}?ssl=true`,
        appId: "app",
        cookieSecret: "x".repeat(40),
      });

      expect(problems.some(p => p.includes("driver refuses"))).toBe(true);
    });
  });
});

describe("AWS_USE_FIPS_ENDPOINT", () => {
  const BUCKET = "my-bucket";
  const MINIO = "http://minio.example.test:9000";
  const check = (
    fips: string,
    more: Partial<{
      bucket: string;
      region: string;
      endpoint: string;
      url: string;
      urlS3: string;
      ignore: string;
    }> = {}
  ) =>
    awsFipsEndpointWarnings(
      more.bucket ?? BUCKET,
      more.region ?? "",
      more.endpoint ?? "",
      fips,
      more.url ?? "",
      more.urlS3 ?? "",
      more.ignore ?? ""
    );

  it.each(["TRUE", "True", "1", "yes", " true", '"true"', "junk"])(
    "says that %j does not turn FIPS on",
    value => {
      const [text] = check(value);
      expect(text).toContain(
        "only turns FIPS on for the exact lower-case true"
      );
      expect(check(value)).toHaveLength(1);
    }
  );

  it("is silent for true and false with nothing in the way, and for an empty value", () => {
    expect(check("true")).toEqual([]);
    expect(check("false")).toEqual([]);
    expect(check("")).toEqual([]);
  });

  it("refuses true with S3_ENDPOINT, AWS_ENDPOINT_URL or AWS_ENDPOINT_URL_S3", () => {
    for (const more of [
      { endpoint: MINIO },
      { url: MINIO },
      { urlS3: MINIO },
    ]) {
      const found = check("true", more);
      expect(found).toHaveLength(1);
      expect(found[0]).toContain("refuses to combine");
    }
  });

  it("does not count an empty or blank endpoint variable, or one the SDK is told to ignore", () => {
    expect(check("true", { url: "", urlS3: " " })).toEqual([]);
    expect(check("true", { url: " ", urlS3: "" })).toEqual([]);
    expect(check("true", { url: MINIO, ignore: "true" })).toEqual([]);
    expect(check("true", { url: MINIO, ignore: "TRUE" })).toHaveLength(1);
  });

  it("does not let the ignore flag cancel S3_ENDPOINT, which is passed explicitly", () => {
    expect(check("true", { endpoint: MINIO, ignore: "true" })).toHaveLength(1);
  });

  it.each(["cn-north-1", "cn-northwest-1"])(
    "refuses true in the China region %s",
    region => {
      const [text] = check("true", { region });
      expect(text).toContain("region is in China");
    }
  );

  it("judges the region the client really uses: S3_REGION, else us-east-1", () => {
    expect(check("true", { region: "eu-west-1" })).toEqual([]);
    expect(check("true", { region: "us-gov-west-1" })).toEqual([]);
    expect(check("true", { region: " cn-north-1 " })).toHaveLength(1);
    expect(check("true", { region: "" })).toEqual([]);
    expect(check("true", { region: "cnx-test-1" })).toEqual([]);
  });

  it("reports one warning when both a custom endpoint and a China region are in the way", () => {
    expect(
      check("true", { endpoint: MINIO, region: "cn-north-1" })
    ).toHaveLength(1);
  });

  it("is silent with backup off", () => {
    expect(check("true", { bucket: "", endpoint: MINIO })).toEqual([]);
    expect(check("TRUE", { bucket: "" })).toEqual([]);
  });

  it("never repeats a value", () => {
    for (const found of [
      check("zz-flag-9"),
      check("true", { url: "http://zz-host-9.test" }),
      check("true", { region: "cn-zz-9" }),
    ]) {
      for (const text of found) {
        expect(text).not.toContain("zz-flag-9");
        expect(text).not.toContain("zz-host-9");
        expect(text).not.toContain("cn-zz-9");
      }
    }
  });

  it("is a warning only, raised through configWarnings", () => {
    const cfg = { s3Bucket: BUCKET, awsUseFipsEndpoint: "TRUE" };
    expect(configProblems(env(cfg))).toEqual([]);
    expect(configWarnings(env(cfg))).toHaveLength(1);
    expect(configWarnings(env({ awsUseFipsEndpoint: "TRUE" }))).toEqual([]);
    expect(configWarnings(env({ s3Bucket: BUCKET }))).toEqual([]);
  });

  it("hands configWarnings every input to the check", () => {
    // AWS_ENDPOINT_URL* have a check of their own; only this one's warnings count here.
    const fipsOnly = (cfg: Parameters<typeof env>[0]) =>
      configWarnings(env(cfg)).filter(w =>
        w.startsWith("AWS_USE_FIPS_ENDPOINT")
      );
    const base = { s3Bucket: BUCKET, awsUseFipsEndpoint: "true" };
    expect(fipsOnly({ ...base, s3Endpoint: MINIO })).toHaveLength(1);
    expect(fipsOnly({ ...base, awsEndpointUrl: MINIO })).toHaveLength(1);
    expect(fipsOnly({ ...base, awsEndpointUrlS3: MINIO })).toHaveLength(1);
    expect(
      fipsOnly({
        ...base,
        awsEndpointUrl: MINIO,
        awsIgnoreEndpointUrls: "true",
      })
    ).toEqual([]);
    expect(fipsOnly({ ...base, s3Region: "cn-north-1" })).toHaveLength(1);
    expect(fipsOnly({ ...base, s3Region: "eu-west-1" })).toEqual([]);
  });

  it("reads the variable in env.ts, and an unset one is empty", async () => {
    const { vi } = await import("vitest");
    vi.resetModules();
    delete process.env.AWS_USE_FIPS_ENDPOINT;
    const unset = (await import("./env")).ENV.awsUseFipsEndpoint;
    vi.resetModules();
    vi.stubEnv("AWS_USE_FIPS_ENDPOINT", "true");
    const set = (await import("./env")).ENV.awsUseFipsEndpoint;
    vi.unstubAllEnvs();
    expect(unset).toBe("");
    expect(set).toBe("true");
  });

  describe("what the installed SDK does with the same environment", () => {
    // Builds the S3 client the way storage.ts does and reads the request it
    // would send, in a child process with a minimal environment so nothing of
    // this machine's AWS settings leaks in.
    const PROBE = `
      const { S3Client, HeadBucketCommand } = require(${JSON.stringify(
        resolve(process.cwd(), "node_modules/@aws-sdk/client-s3")
      )});
      const cfg = JSON.parse(process.argv[1]);
      const c = new S3Client({ region: "us-east-1", credentials: { accessKeyId: "a", secretAccessKey: "b" }, maxAttempts: 1, ...cfg });
      c.middlewareStack.add(next => async args => { console.log("URL " + args.request.hostname); throw new Error("stop"); }, { step: "finalizeRequest", name: "probe", priority: "low" });
      c.send(new HeadBucketCommand({ Bucket: "mybucket" })).catch(e => { if (e.message !== "stop") console.log("ERR " + e.message); });
    `;
    const probe = (set: Record<string, string>, cfg: object = {}) =>
      execFileSync(process.execPath, ["-e", PROBE, JSON.stringify(cfg)], {
        env: { PATH: process.env.PATH ?? "", ...NO_AWS_FILES, ...set },
        encoding: "utf8",
      }).trim();
    const PLAIN = "URL mybucket.s3.us-east-1.amazonaws.com";
    const FIPS = "URL mybucket.s3-fips.us-east-1.amazonaws.com";
    const EXPLICIT = {
      endpoint: "http://explicit.example.test:9000",
      forcePathStyle: true,
    };

    it("goes to the ordinary endpoint with nothing set, and for every value but true", () => {
      expect(probe({})).toBe(PLAIN);
      for (const value of [
        "TRUE",
        "True",
        "1",
        "yes",
        "false",
        "0",
        "",
        " true",
        '"true"',
        "junk",
      ]) {
        expect(probe({ AWS_USE_FIPS_ENDPOINT: value })).toBe(PLAIN);
      }
    });

    it("goes to the FIPS endpoint for exactly true, in the region the client uses", () => {
      expect(probe({ AWS_USE_FIPS_ENDPOINT: "true" })).toBe(FIPS);
      expect(
        probe({ AWS_USE_FIPS_ENDPOINT: "true" }, { region: "eu-west-1" })
      ).toBe("URL mybucket.s3-fips.eu-west-1.amazonaws.com");
      expect(
        probe({ AWS_USE_FIPS_ENDPOINT: "true" }, { region: "us-gov-west-1" })
      ).toBe("URL mybucket.s3-fips.us-gov-west-1.amazonaws.com");
    });

    it("refuses a custom endpoint, explicit or from the environment", () => {
      const refused = "ERR A custom endpoint cannot be combined with FIPS";
      const on = { AWS_USE_FIPS_ENDPOINT: "true" };
      expect(probe(on, EXPLICIT)).toBe(refused);
      expect(
        probe({ ...on, AWS_ENDPOINT_URL: "http://m.example.test:9000" })
      ).toBe(refused);
      expect(
        probe({ ...on, AWS_ENDPOINT_URL_S3: "http://m.example.test:9000" })
      ).toBe(refused);
    });

    it("does not refuse when the environment endpoint is empty or ignored", () => {
      const on = { AWS_USE_FIPS_ENDPOINT: "true" };
      expect(probe({ ...on, AWS_ENDPOINT_URL: "" })).toBe(FIPS);
      expect(
        probe({
          ...on,
          AWS_ENDPOINT_URL: "http://m.example.test:9000",
          AWS_IGNORE_CONFIGURED_ENDPOINT_URLS: "true",
        })
      ).toBe(FIPS);
    });

    it("ignores the flag when the endpoint is explicit and the flag is not true", () => {
      expect(probe({ AWS_USE_FIPS_ENDPOINT: "junk" }, EXPLICIT)).toBe(
        "URL explicit.example.test"
      );
    });

    it.each(["cn-north-1", "cn-northwest-1"])(
      "refuses FIPS in %s, and serves it without FIPS",
      region => {
        expect(probe({ AWS_USE_FIPS_ENDPOINT: "true" }, { region })).toBe(
          "ERR Partition does not support FIPS"
        );
        expect(probe({}, { region })).toBe(
          `URL mybucket.s3.${region}.amazonaws.com.cn`
        );
      }
    );
  });
});

describe("NO_PROXY", () => {
  const PROXY = "http://proxy.example.com:3128";
  const none: Array<{ name: string; url: string; stack: "axios" | "fetch" }> =
    [];
  const warn = (
    noProxy: string,
    proxies: { http?: string; https?: string; all?: string; flag?: string },
    targets = none
  ) =>
    noProxyWarnings(
      noProxy,
      proxies.http ?? "",
      proxies.https ?? "",
      proxies.all ?? "",
      proxies.flag ?? "",
      targets
    );
  const portal = (url: string) => ({
    name: "OAUTH_SERVER_URL",
    url,
    stack: "axios" as const,
  });
  const llm = (url: string) => ({
    name: "BUILT_IN_FORGE_API_URL",
    url,
    stack: "fetch" as const,
  });
  const mail = (url: string) => ({
    name: "EMAIL_API_URL",
    url,
    stack: "fetch" as const,
  });

  it("is silent when no proxy variable is set, whatever NO_PROXY and the targets say", () => {
    expect(
      warn("a;b http://x 10. 10.0.0.0/8", {}, [portal("http://localhost:3000")])
    ).toEqual([]);
  });

  it("is silent with a clean NO_PROXY and no targets", () => {
    expect(warn("", { https: PROXY, flag: "1" })).toEqual([]);
    expect(
      warn("localhost,.example.com, 10.0.0.0/8", { https: PROXY })
    ).toEqual([]);
  });

  describe("entries nothing can match", () => {
    it.each([
      ["a.invalid;b.invalid", "joined with ;"],
      ["target.invalid;", "joined with ;"],
      ["http://target.invalid", "a scheme such as http://"],
      ["https://target.invalid", "a scheme such as http://"],
      ["target.invalid/", "ending in /"],
      ["10.", "IP prefixes"],
      ["10.0.", "IP prefixes"],
      ["10.*", "IP prefixes"],
    ])("flags %j", (noProxy, reason) => {
      const found = warn(noProxy, { https: PROXY });
      expect(found).toHaveLength(1);
      expect(found[0]).toMatch(/^NO_PROXY has /);
      expect(found[0]).toContain(reason);
      expect(found[0]).toContain("neither axios nor Node's fetch can match");
    });

    it.each([
      "localhost",
      ".example.com",
      "*.example.com",
      "*",
      "example.com:8080",
      "10.0.0.0/8",
      "10.0.0.1",
      "a.invalid, b.invalid\tc.invalid",
    ])("does not flag %j", noProxy => {
      expect(warn(noProxy, { https: PROXY })).toEqual([]);
    });

    it("names every kind found in one warning", () => {
      const found = warn("a;b http://c d/ 10.*", { https: PROXY });
      expect(found).toHaveLength(1);
      for (const part of [
        "joined with ;",
        "a scheme",
        "ending in /",
        "IP prefixes",
      ]) {
        expect(found[0]).toContain(part);
      }
    });
  });

  describe("CIDR ranges", () => {
    it("warns that fetch ignores them, only when fetch follows the proxy", () => {
      const found = warn("10.0.0.0/8", { https: PROXY, flag: "1" });
      expect(found).toHaveLength(1);
      expect(found[0]).toMatch(/axios honours it but Node's fetch does not/);
      expect(warn("10.0.0.0/8", { https: PROXY, flag: "" })).toEqual([]);
      expect(warn("10.0.0.0/8", { https: PROXY, flag: "true" })).toEqual([]);
    });
  });

  describe("a local address that would go to the proxy", () => {
    it("warns for the portal when NO_PROXY does not exempt it", () => {
      const found = warn("", { http: PROXY }, [
        portal("http://localhost:3000"),
      ]);
      expect(found).toHaveLength(1);
      expect(found[0]).toMatch(/^OAUTH_SERVER_URL points at this machine/);
      expect(found[0]).toContain("axios");
      expect(found[0]).toContain("cannot reach this machine's localhost");
    });

    it("is silent once NO_PROXY exempts it, and axios counts any loopback entry as all of them", () => {
      for (const noProxy of ["localhost", "127.0.0.1", "*"]) {
        expect(
          warn(noProxy, { http: PROXY }, [portal("http://localhost:3000")])
        ).toEqual([]);
        expect(
          warn(noProxy, { http: PROXY }, [portal("http://127.0.0.2:3000")])
        ).toEqual([]);
      }
      // A CIDR range matches an IP literal, never the name localhost (tested).
      expect(
        warn("127.0.0.0/8", { http: PROXY }, [portal("http://127.0.0.2:3000")])
      ).toEqual([]);
      expect(
        warn("127.0.0.0/8", { http: PROXY }, [portal("http://localhost:3000")])
      ).toHaveLength(1);
    });

    it("needs the exact host for fetch: localhost does not cover 127.0.0.1, and CIDR covers nothing", () => {
      const target = [llm("http://127.0.0.1:11434")];
      const base = { http: PROXY, flag: "1" };
      expect(warn("localhost", base, target)).toHaveLength(1);
      expect(
        warn("127.0.0.0/8", base, target).some(t =>
          t.includes("points at this machine")
        )
      ).toBe(true);
      expect(warn("127.0.0.1", base, target)).toEqual([]);
      expect(warn("127.0.0.1:11434", base, target)).toEqual([]);
      expect(warn("127.0.0.1:1234", base, target)).toHaveLength(1);
      expect(warn("localhost", base, [llm("http://localhost:11434")])).toEqual(
        []
      );
      const found = warn("", base, target);
      expect(found[0]).toMatch(
        /^BUILT_IN_FORGE_API_URL points at this machine/
      );
      expect(found[0]).toContain("Node's fetch");
    });

    it("leaves fetch targets alone unless fetch follows the proxy", () => {
      expect(
        warn("", { http: PROXY }, [llm("http://localhost:11434")])
      ).toEqual([]);
      expect(
        warn("", { http: PROXY, flag: "true" }, [llm("http://localhost:11434")])
      ).toEqual([]);
    });

    it("matches the proxy variable to the scheme of the address, the way each stack does", () => {
      // fetch: https takes HTTPS_PROXY and falls back to HTTP_PROXY; http takes HTTP_PROXY only.
      expect(
        warn("", { http: PROXY, flag: "1" }, [llm("https://localhost:8443")])
      ).toHaveLength(1);
      expect(
        warn("", { https: PROXY, flag: "1" }, [llm("https://localhost:8443")])
      ).toHaveLength(1);
      expect(
        warn("", { https: PROXY, flag: "1" }, [llm("http://localhost:11434")])
      ).toEqual([]);
      expect(
        warn("", { http: PROXY, flag: "1" }, [llm("http://localhost:11434")])
      ).toHaveLength(1);
      // axios: http takes HTTP_PROXY, https takes HTTPS_PROXY, no fall-back either way.
      expect(
        warn("", { https: PROXY }, [portal("http://localhost:3000")])
      ).toEqual([]);
      expect(
        warn("", { http: PROXY }, [portal("https://localhost:3000")])
      ).toEqual([]);
      expect(
        warn("", { http: PROXY }, [portal("http://localhost:3000")])
      ).toHaveLength(1);
      expect(
        warn("", { https: PROXY }, [portal("https://localhost:3000")])
      ).toHaveLength(1);
    });

    it("counts ALL_PROXY for axios, and not for fetch", () => {
      expect(
        warn("", { all: PROXY }, [portal("http://localhost:3000")])
      ).toHaveLength(1);
      expect(
        warn("", { all: PROXY }, [portal("https://localhost:3000")])
      ).toHaveLength(1);
      expect(
        warn("", { all: PROXY, flag: "1" }, [llm("http://localhost:11434")])
      ).toEqual([]);
    });

    it("does not call a private or public address 'this machine'", () => {
      for (const url of [
        "http://10.255.255.1:3000",
        "http://192.168.1.1",
        "http://8.8.8.8",
        "http://12.0.0.1",
      ]) {
        expect(warn("", { http: PROXY }, [portal(url)])).toEqual([]);
      }
    });

    it("takes the default port of the scheme when the URL names none", () => {
      expect(
        warn("localhost:80", { http: PROXY }, [portal("http://localhost")])
      ).toEqual([]);
      expect(
        warn("localhost:443", { https: PROXY }, [portal("https://localhost")])
      ).toEqual([]);
      expect(
        warn("localhost:8080", { http: PROXY }, [portal("http://localhost")])
      ).toHaveLength(1);
      expect(
        warn("localhost:80", { https: PROXY }, [portal("https://localhost")])
      ).toHaveLength(1);
      expect(
        warn("localhost:3000", { http: PROXY }, [
          portal("http://localhost:3000"),
        ])
      ).toEqual([]);
    });

    it("does not take a hostname that merely starts with 127. for this machine", () => {
      expect(
        warn("", { http: PROXY }, [portal("http://127.example.test:3000")])
      ).toEqual([]);
      expect(
        warn("localhost", { http: PROXY }, [
          portal("http://127.example.test:3000"),
        ])
      ).toEqual([]);
    });

    it("skips an unset or unreadable target", () => {
      expect(
        warn("", { http: PROXY, flag: "1" }, [
          portal(""),
          llm("not a url"),
          mail("ftp://localhost"),
        ])
      ).toEqual([]);
    });
  });

  describe("a parent domain that does not cover subdomains", () => {
    const base = { https: PROXY, flag: "1" };
    const target = [mail("https://api.example.com/send")];

    it("warns when only the bare domain is listed", () => {
      for (const noProxy of [
        "example.com",
        "example.com:443",
        "other.org,example.com",
      ]) {
        const found = warn(noProxy, base, target);
        expect(found).toHaveLength(1);
        expect(found[0]).toMatch(
          /^NO_PROXY has an entry for a parent domain of the host in EMAIL_API_URL/
        );
        expect(found[0]).toContain("Write it as .example.com");
      }
    });

    it("is silent once a suffix entry, the exact host or * covers it", () => {
      for (const noProxy of [
        ".example.com",
        "*.example.com",
        "example.com,.example.com",
        "api.example.com",
        "*",
      ]) {
        expect(warn(noProxy, base, target)).toEqual([]);
      }
    });

    it("is silent when no entry is a parent of the host", () => {
      expect(warn("other.org", base, target)).toEqual([]);
      expect(warn("", base, target)).toEqual([]);
    });
  });

  it("never repeats an entry, a host or a URL, which may hold credentials", () => {
    const secrets = "hunter2zz";
    const found = [
      ...warn(`${secrets};b http://${secrets}.example.com ${secrets}/`, {
        https: PROXY,
        flag: "1",
      }),
      ...warn(`${secrets}.example.com`, { https: PROXY, flag: "1" }, [
        mail(`https://admin:${secrets}@api.${secrets}.example.com/send`),
      ]),
      ...warn("", { http: PROXY }, [
        portal(`http://admin:${secrets}@localhost:3000`),
      ]),
    ];
    expect(found.length).toBeGreaterThan(2);
    for (const text of found) {
      expect(text).not.toContain(secrets);
      expect(text).not.toContain("admin");
    }
  });

  it("is a warning only, raised through configWarnings, and silent when the caller does not say", () => {
    const cfg = { httpProxy: PROXY, noProxy: "a;b" };
    expect(configProblems(env(cfg))).toEqual([]);
    expect(
      configWarnings(
        env({ ...cfg, nodeUseEnvProxy: "1", httpsProxy: PROXY })
      )[0]
    ).toMatch(/NO_PROXY has/);
    expect(configWarnings(env({ httpProxy: PROXY }))).toHaveLength(2);
    expect(configWarnings(env({ noProxy: "a;b" }))).toEqual([]);
  });

  it("hands ALL_PROXY and the flag from configWarnings to the check, and gives each address the right stack", () => {
    const local = (extra: Record<string, string>) =>
      configWarnings(env({ noProxy: "other.org", ...extra })).filter(text =>
        text.includes("points at this machine")
      );
    // ALL_PROXY alone is enough for the portal (axios).
    expect(
      local({ allProxy: PROXY, oAuthServerUrl: "http://localhost:3000" })
    ).toHaveLength(1);
    // The portal is axios: it needs no flag. The AI provider and email are fetch: they do.
    expect(
      local({ httpProxy: PROXY, oAuthServerUrl: "http://localhost:3000" })
    ).toHaveLength(1);
    expect(
      local({ httpProxy: PROXY, forgeApiUrl: "http://localhost:11434" })
    ).toEqual([]);
    expect(
      local({ httpProxy: PROXY, emailApiUrl: "http://localhost:8025/send" })
    ).toEqual([]);
    expect(
      local({
        httpProxy: PROXY,
        nodeUseEnvProxy: "1",
        forgeApiUrl: "http://localhost:11434",
      })
    ).toHaveLength(1);
  });

  it("hands the three configured addresses from configWarnings to the check", () => {
    const base = {
      httpProxy: PROXY,
      httpsProxy: PROXY,
      nodeUseEnvProxy: "1",
      noProxy: "other.org",
    };
    const local = (extra: Record<string, string>) =>
      configWarnings(env({ ...base, ...extra })).filter(text =>
        text.includes("points at this machine")
      );
    expect(local({ oAuthServerUrl: "http://localhost:3000" })).toHaveLength(1);
    expect(local({ forgeApiUrl: "http://localhost:11434" })).toHaveLength(1);
    expect(local({ emailApiUrl: "http://localhost:8025/send" })).toHaveLength(
      1
    );
    expect(local({})).toEqual([]);
    expect(configWarnings(env({ ...base }))).toEqual([]);
  });

  describe("what env.ts hands over", () => {
    const NAMES = ["no_proxy", "NO_PROXY"];
    const read = async (set: Record<string, string>) => {
      const { vi } = await import("vitest");
      const saved = Object.fromEntries(NAMES.map(n => [n, process.env[n]]));
      try {
        for (const n of NAMES) {
          delete process.env[n];
        }
        Object.assign(process.env, set);
        vi.resetModules();
        return (await import("./env")).ENV.noProxy;
      } finally {
        for (const n of NAMES) {
          if (saved[n] === undefined) {
            delete process.env[n];
          } else {
            process.env[n] = saved[n];
          }
        }
      }
    };

    it("is empty when unset, reads either case, and the lower-case name wins as it does for axios", async () => {
      expect(await read({})).toBe("");
      expect(await read({ NO_PROXY: "upper" })).toBe("upper");
      expect(await read({ no_proxy: "lower" })).toBe("lower");
      expect(await read({ NO_PROXY: "upper", no_proxy: "lower" })).toBe(
        "lower"
      );
    });
  });
});

describe("AWS_USE_DUALSTACK_ENDPOINT", () => {
  const BUCKET = "my-bucket";
  const MINIO = "http://minio.example.test:9000";
  const check = (
    dualstack: string,
    more: Partial<{
      bucket: string;
      endpoint: string;
      url: string;
      urlS3: string;
      ignore: string;
    }> = {}
  ) =>
    awsDualstackEndpointWarnings(
      more.bucket ?? BUCKET,
      more.endpoint ?? "",
      dualstack,
      more.url ?? "",
      more.urlS3 ?? "",
      more.ignore ?? ""
    );

  it.each(["TRUE", "True", "1", "yes", " true", '"true"', "junk"])(
    "says that %j does not turn dual-stack on",
    value => {
      const found = check(value);
      expect(found).toHaveLength(1);
      expect(found[0]).toContain("only turns dual-stack on for the exact");
    }
  );

  it("is silent for true and false with nothing in the way, and for an empty value", () => {
    expect(check("true")).toEqual([]);
    expect(check("false")).toEqual([]);
    expect(check("")).toEqual([]);
  });

  it("refuses true with S3_ENDPOINT, AWS_ENDPOINT_URL or AWS_ENDPOINT_URL_S3", () => {
    for (const more of [
      { endpoint: MINIO },
      { url: MINIO },
      { urlS3: MINIO },
    ]) {
      const found = check("true", more);
      expect(found).toHaveLength(1);
      expect(found[0]).toContain("refuses to combine");
    }
  });

  it("does not count an empty or blank endpoint variable, or one the SDK is told to ignore", () => {
    expect(check("true", { url: "", urlS3: " " })).toEqual([]);
    expect(check("true", { url: " ", urlS3: "" })).toEqual([]);
    expect(check("true", { url: MINIO, ignore: "true" })).toEqual([]);
    expect(check("true", { url: MINIO, ignore: "TRUE" })).toHaveLength(1);
  });

  it("does not let the ignore flag cancel S3_ENDPOINT, which is passed explicitly", () => {
    expect(check("true", { endpoint: MINIO, ignore: "true" })).toHaveLength(1);
  });

  it("does not judge a custom endpoint when dual-stack is off or unrecognised", () => {
    expect(check("false", { endpoint: MINIO })).toEqual([]);
    expect(check("TRUE", { endpoint: MINIO })).toHaveLength(1);
    expect(check("TRUE", { endpoint: MINIO })[0]).toContain("exact lower-case");
  });

  it("is silent with backup off", () => {
    expect(check("true", { bucket: "", endpoint: MINIO })).toEqual([]);
    expect(check("TRUE", { bucket: "" })).toEqual([]);
  });

  it("never repeats a value", () => {
    for (const found of [
      check("zz-flag-9"),
      check("true", { url: "http://zz-host-9.test" }),
    ]) {
      for (const text of found) {
        expect(text).not.toContain("zz-flag-9");
        expect(text).not.toContain("zz-host-9");
      }
    }
  });

  it("is a warning only, raised through configWarnings", () => {
    const cfg = { s3Bucket: BUCKET, awsUseDualstackEndpoint: "TRUE" };
    expect(configProblems(env(cfg))).toEqual([]);
    expect(configWarnings(env(cfg))).toHaveLength(1);
    expect(configWarnings(env({ awsUseDualstackEndpoint: "TRUE" }))).toEqual(
      []
    );
    expect(configWarnings(env({ s3Bucket: BUCKET }))).toEqual([]);
  });

  it("hands configWarnings every input to the check", () => {
    // AWS_ENDPOINT_URL* have a check of their own; only this one's warnings count here.
    const mine = (cfg: Parameters<typeof env>[0]) =>
      configWarnings(env(cfg)).filter(w =>
        w.startsWith("AWS_USE_DUALSTACK_ENDPOINT")
      );
    const base = { s3Bucket: BUCKET, awsUseDualstackEndpoint: "true" };
    expect(mine({ ...base, s3Endpoint: MINIO })).toHaveLength(1);
    expect(mine({ ...base, awsEndpointUrl: MINIO })).toHaveLength(1);
    expect(mine({ ...base, awsEndpointUrlS3: MINIO })).toHaveLength(1);
    expect(
      mine({ ...base, awsEndpointUrl: MINIO, awsIgnoreEndpointUrls: "true" })
    ).toEqual([]);
    expect(mine(base)).toEqual([]);
  });

  it("reads the variable in env.ts, and an unset one is empty", async () => {
    const { vi } = await import("vitest");
    vi.resetModules();
    delete process.env.AWS_USE_DUALSTACK_ENDPOINT;
    const unset = (await import("./env")).ENV.awsUseDualstackEndpoint;
    vi.resetModules();
    vi.stubEnv("AWS_USE_DUALSTACK_ENDPOINT", "true");
    const set = (await import("./env")).ENV.awsUseDualstackEndpoint;
    vi.unstubAllEnvs();
    expect(unset).toBe("");
    expect(set).toBe("true");
  });

  describe("what the installed SDK does with the same environment", () => {
    // Builds the S3 client the way storage.ts does and reads the request it
    // would send, in a child process with a minimal environment so nothing of
    // this machine's AWS settings leaks in.
    const PROBE = `
      const { S3Client, HeadBucketCommand } = require(${JSON.stringify(
        resolve(process.cwd(), "node_modules/@aws-sdk/client-s3")
      )});
      const cfg = JSON.parse(process.argv[1]);
      const c = new S3Client({ region: "us-east-1", credentials: { accessKeyId: "a", secretAccessKey: "b" }, maxAttempts: 1, ...cfg });
      c.middlewareStack.add(next => async args => { console.log("URL " + args.request.hostname); throw new Error("stop"); }, { step: "finalizeRequest", name: "probe", priority: "low" });
      c.send(new HeadBucketCommand({ Bucket: "mybucket" })).catch(e => { if (e.message !== "stop") console.log("ERR " + e.message); });
    `;
    const probe = (set: Record<string, string>, cfg: object = {}) =>
      execFileSync(process.execPath, ["-e", PROBE, JSON.stringify(cfg)], {
        env: { PATH: process.env.PATH ?? "", ...NO_AWS_FILES, ...set },
        encoding: "utf8",
      }).trim();
    const PLAIN = "URL mybucket.s3.us-east-1.amazonaws.com";
    const DUAL = "URL mybucket.s3.dualstack.us-east-1.amazonaws.com";
    const REFUSED =
      "ERR Cannot set dual-stack in combination with a custom endpoint.";
    const EXPLICIT = {
      endpoint: "http://explicit.example.test:9000",
      forcePathStyle: true,
    };
    const on = { AWS_USE_DUALSTACK_ENDPOINT: "true" };

    it("goes to the ordinary endpoint with nothing set, and for every value but true", () => {
      expect(probe({})).toBe(PLAIN);
      for (const value of [
        "TRUE",
        "True",
        "1",
        "yes",
        "false",
        "0",
        "",
        " true",
        '"true"',
        "junk",
      ]) {
        expect(probe({ AWS_USE_DUALSTACK_ENDPOINT: value })).toBe(PLAIN);
      }
    });

    it("goes to the dual-stack endpoint for exactly true", () => {
      expect(probe(on)).toBe(DUAL);
    });

    it("refuses a custom endpoint, explicit or from the environment", () => {
      expect(probe(on, EXPLICIT)).toBe(REFUSED);
      expect(
        probe({ ...on, AWS_ENDPOINT_URL: "http://m.example.test:9000" })
      ).toBe(REFUSED);
      expect(
        probe({ ...on, AWS_ENDPOINT_URL_S3: "http://m.example.test:9000" })
      ).toBe(REFUSED);
    });

    it("does not refuse when the environment endpoint is empty or ignored", () => {
      expect(probe({ ...on, AWS_ENDPOINT_URL: "" })).toBe(DUAL);
      expect(
        probe({
          ...on,
          AWS_ENDPOINT_URL: "http://m.example.test:9000",
          AWS_IGNORE_CONFIGURED_ENDPOINT_URLS: "true",
        })
      ).toBe(DUAL);
    });

    it("ignores the flag when the endpoint is explicit and the flag is not true", () => {
      expect(probe({ AWS_USE_DUALSTACK_ENDPOINT: "junk" }, EXPLICIT)).toBe(
        "URL explicit.example.test"
      );
    });

    it("works in a China region and together with FIPS, so neither is flagged", () => {
      expect(probe(on, { region: "cn-north-1" })).toBe(
        "URL mybucket.s3.dualstack.cn-north-1.amazonaws.com.cn"
      );
      expect(probe({ ...on, AWS_USE_FIPS_ENDPOINT: "true" })).toBe(
        "URL mybucket.s3-fips.dualstack.us-east-1.amazonaws.com"
      );
    });
  });
});

describe("AWS_EC2_METADATA_DISABLED", () => {
  const BUCKET = "my-bucket";
  const check = (
    value: string,
    more: Partial<{
      bucket: string;
      id: string;
      secret: string;
      profile: string;
      container: string;
    }> = {}
  ) =>
    awsEc2MetadataDisabledWarning(
      more.bucket ?? BUCKET,
      value,
      more.id ?? "",
      more.secret ?? "",
      more.profile ?? "",
      more.container ?? ""
    );

  it.each([
    "0",
    "FALSE",
    "False",
    "no",
    "No",
    "off",
    "OFF",
    "n",
    " false",
    "false ",
    '"false"',
    "'false'",
    "`0`",
  ])("says that %j still turns the instance role lookup off", value => {
    expect(check(value)).toContain(
      "only leaves the instance metadata service on for exactly false"
    );
  });

  it.each(["", "false", "true", "TRUE", "1", "yes", "junk", "enabled"])(
    "is silent for %j, which is either the on state or reads as a deliberate off",
    value => {
      expect(check(value)).toBeNull();
    }
  );

  it("is silent with backup off", () => {
    expect(check("0", { bucket: "" })).toBeNull();
  });

  it("is silent when something else finds the credentials", () => {
    expect(check("0", { id: "AKIAEXAMPLE", secret: "s" })).toBeNull();
    expect(check("0", { profile: "work" })).toBeNull();
    expect(check("0", { container: "/v2/credentials/x" })).toBeNull();
  });

  it("still warns with only half a key pair", () => {
    expect(check("0", { id: "AKIAEXAMPLE" })).not.toBeNull();
    expect(check("0", { secret: "s" })).not.toBeNull();
  });

  it("never repeats the value", () => {
    expect(check("  OFF ")).not.toContain("OFF");
  });

  it("is a warning only, raised through configWarnings", () => {
    const cfg = { s3Bucket: BUCKET, awsEc2MetadataDisabled: "0" };
    expect(configProblems(env(cfg))).toEqual([]);
    expect(configWarnings(env(cfg))).toHaveLength(1);
    expect(configWarnings(env({ awsEc2MetadataDisabled: "0" }))).toEqual([]);
    expect(configWarnings(env({ s3Bucket: BUCKET }))).toEqual([]);
  });

  it("hands configWarnings every input to the check", () => {
    const base = { s3Bucket: BUCKET, awsEc2MetadataDisabled: "0" };
    const mine = (cfg: Parameters<typeof env>[0]) =>
      configWarnings(env(cfg)).filter(w =>
        w.startsWith("AWS_EC2_METADATA_DISABLED")
      );
    expect(mine(base)).toHaveLength(1);
    expect(
      mine({ ...base, awsAccessKeyId: "AKIAEXAMPLE", awsSecretAccessKey: "s" })
    ).toEqual([]);
    expect(mine({ ...base, awsProfile: "work" })).toEqual([]);
    expect(mine({ ...base, awsContainerCredentialsUri: "/x" })).toEqual([]);
  });

  it("reads the variables in env.ts, and unset ones are empty", async () => {
    const { vi } = await import("vitest");
    const names = [
      "AWS_EC2_METADATA_DISABLED",
      "AWS_CONTAINER_CREDENTIALS_RELATIVE_URI",
      "AWS_CONTAINER_CREDENTIALS_FULL_URI",
    ];
    vi.resetModules();
    for (const n of names) delete process.env[n];
    const unset = (await import("./env")).ENV;
    vi.resetModules();
    vi.stubEnv("AWS_EC2_METADATA_DISABLED", "0");
    vi.stubEnv(
      "AWS_CONTAINER_CREDENTIALS_FULL_URI",
      "http://full.example.test/x"
    );
    const full = (await import("./env")).ENV;
    vi.resetModules();
    vi.stubEnv("AWS_CONTAINER_CREDENTIALS_RELATIVE_URI", "/rel");
    vi.stubEnv(
      "AWS_CONTAINER_CREDENTIALS_FULL_URI",
      "http://full.example.test/x"
    );
    const both = (await import("./env")).ENV;
    vi.unstubAllEnvs();
    expect(unset.awsEc2MetadataDisabled).toBe("");
    expect(unset.awsContainerCredentialsUri).toBe("");
    expect(full.awsEc2MetadataDisabled).toBe("0");
    expect(full.awsContainerCredentialsUri).toBe("http://full.example.test/x");
    expect(both.awsContainerCredentialsUri).toBe("/rel");
  });

  describe("what the installed SDK does with the same environment", () => {
    // A local stand-in for the instance metadata service counts the requests
    // the credential chain makes, in a child process with a minimal environment.
    const PROBE = `
      const http = require("http");
      const { S3Client } = require(${JSON.stringify(
        resolve(process.cwd(), "node_modules/@aws-sdk/client-s3")
      )});
      let hits = 0;
      const srv = http.createServer((req, res) => {
        hits++;
        if (req.method === "PUT") return res.end("tok");
        if (req.url.endsWith("security-credentials/")) return res.end("role");
        res.end(JSON.stringify({ AccessKeyId: "A", SecretAccessKey: "S", Token: "T", Expiration: new Date(Date.now() + 36e5).toISOString() }));
      });
      srv.listen(0, "127.0.0.1", async () => {
        process.env.AWS_EC2_METADATA_SERVICE_ENDPOINT = "http://127.0.0.1:" + srv.address().port;
        const c = new S3Client({ region: "us-east-1", maxAttempts: 1 });
        let r; try { await c.config.credentials(); r = "creds"; } catch (e) { r = "none"; }
        console.log(r + " " + hits); srv.close();
      });
    `;
    const probe = (set: Record<string, string>) =>
      execFileSync(process.execPath, ["-e", PROBE], {
        env: { PATH: process.env.PATH ?? "", ...NO_AWS_FILES, ...set },
        encoding: "utf8",
      }).trim();

    it("asks the service with nothing set, and for empty and exactly false", () => {
      expect(probe({})).toBe("creds 3");
      expect(probe({ AWS_EC2_METADATA_DISABLED: "" })).toBe("creds 3");
      expect(probe({ AWS_EC2_METADATA_DISABLED: "false" })).toBe("creds 3");
    });

    it.each([
      "true",
      "TRUE",
      "1",
      "0",
      "FALSE",
      "False",
      "no",
      "off",
      " false",
      '"false"',
    ])("does not ask the service for %j, and finds no credentials", value => {
      expect(probe({ AWS_EC2_METADATA_DISABLED: value })).toBe("none 0");
    });

    it("takes a key pair before the service either way", () => {
      const pair = { AWS_ACCESS_KEY_ID: "a", AWS_SECRET_ACCESS_KEY: "b" };
      expect(probe({ ...pair, AWS_EC2_METADATA_DISABLED: "0" })).toBe(
        "creds 0"
      );
      expect(probe(pair)).toBe("creds 0");
    });
  });
});

describe("AWS_S3_US_EAST_1_REGIONAL_ENDPOINT", () => {
  const BUCKET = "my-bucket";

  it("says that legacy does not give the global address, and that the SDK does not read it", () => {
    const text = awsS3UsEast1RegionalEndpointWarning(BUCKET, "legacy");
    expect(text).toMatch(
      /^AWS_S3_US_EAST_1_REGIONAL_ENDPOINT is set to legacy/
    );
    expect(text).toContain("does not read it");
    expect(text).toContain("s3.us-east-1.amazonaws.com");
    expect(text).toContain("s3.amazonaws.com");
  });

  it.each(["legacy", " Legacy ", "LEGACY"])(
    "treats %j as legacy, whatever its case or padding",
    value => {
      expect(awsS3UsEast1RegionalEndpointWarning(BUCKET, value)).toMatch(
        /set to legacy/
      );
    }
  );

  it.each(["regional", "Regional", "junk", "1", " "])(
    "says that %j does nothing",
    value => {
      const text = awsS3UsEast1RegionalEndpointWarning(BUCKET, value);
      expect(text).toMatch(/^AWS_S3_US_EAST_1_REGIONAL_ENDPOINT is set, but/);
      expect(text).toContain("so it does nothing");
      expect(text).not.toMatch(/set to legacy/);
    }
  );

  it("is silent when unset or empty, and with backup off", () => {
    expect(awsS3UsEast1RegionalEndpointWarning(BUCKET, "")).toBeNull();
    expect(awsS3UsEast1RegionalEndpointWarning("", "legacy")).toBeNull();
    expect(awsS3UsEast1RegionalEndpointWarning("", "")).toBeNull();
  });

  it("never repeats the value", () => {
    const text = awsS3UsEast1RegionalEndpointWarning(BUCKET, "zz-value-9");
    expect(text).not.toContain("zz-value-9");
  });

  it("is a warning only, raised through configWarnings", () => {
    const cfg = { s3Bucket: BUCKET, awsS3UsEast1RegionalEndpoint: "legacy" };
    expect(configProblems(env(cfg))).toEqual([]);
    expect(configWarnings(env(cfg))).toHaveLength(1);
    expect(
      configWarnings(env({ awsS3UsEast1RegionalEndpoint: "legacy" }))
    ).toEqual([]);
    expect(configWarnings(env({ s3Bucket: BUCKET }))).toEqual([]);
  });

  it("reads the variable in env.ts, and an unset one is empty", async () => {
    const { vi } = await import("vitest");
    vi.resetModules();
    delete process.env.AWS_S3_US_EAST_1_REGIONAL_ENDPOINT;
    const unset = (await import("./env")).ENV.awsS3UsEast1RegionalEndpoint;
    vi.resetModules();
    vi.stubEnv("AWS_S3_US_EAST_1_REGIONAL_ENDPOINT", "legacy");
    const set = (await import("./env")).ENV.awsS3UsEast1RegionalEndpoint;
    vi.unstubAllEnvs();
    expect(unset).toBe("");
    expect(set).toBe("legacy");
  });

  describe("what the installed SDK does with the same environment", () => {
    // Builds the S3 client the way storage.ts does and reads the request it
    // would send, in a child process with a minimal environment so nothing of
    // this machine's AWS settings leaks in.
    const PROBE = `
      const { S3Client, HeadBucketCommand } = require(${JSON.stringify(
        resolve(process.cwd(), "node_modules/@aws-sdk/client-s3")
      )});
      const cfg = JSON.parse(process.argv[1]);
      const c = new S3Client({ region: "us-east-1", credentials: { accessKeyId: "a", secretAccessKey: "b" }, maxAttempts: 1, ...cfg });
      c.middlewareStack.add(next => async args => { console.log("URL " + args.request.hostname); throw new Error("stop"); }, { step: "finalizeRequest", name: "probe", priority: "low" });
      c.send(new HeadBucketCommand({ Bucket: "mybucket" })).catch(e => { if (e.message !== "stop") console.log("ERR " + e.message); });
    `;
    const probe = (set: Record<string, string>, cfg: object = {}) =>
      execFileSync(process.execPath, ["-e", PROBE, JSON.stringify(cfg)], {
        env: { PATH: process.env.PATH ?? "", ...NO_AWS_FILES, ...set },
        encoding: "utf8",
      }).trim();
    const REGIONAL = "URL mybucket.s3.us-east-1.amazonaws.com";

    it("sends us-east-1 to the regional address for every value, legacy included", () => {
      expect(probe({})).toBe(REGIONAL);
      for (const value of ["legacy", "LEGACY", "regional", "junk", "1", ""]) {
        expect(probe({ AWS_S3_US_EAST_1_REGIONAL_ENDPOINT: value })).toBe(
          REGIONAL
        );
      }
    });

    it("does not change any other region either", () => {
      expect(
        probe(
          { AWS_S3_US_EAST_1_REGIONAL_ENDPOINT: "legacy" },
          { region: "eu-west-1" }
        )
      ).toBe("URL mybucket.s3.eu-west-1.amazonaws.com");
    });
  });
});

describe("AWS_CONFIG_FILE", () => {
  const BUCKET = "my-bucket";
  const yes = () => true;
  const no = () => false;
  const check = (
    value: string,
    more: Partial<{
      bucket: string;
      id: string;
      secret: string;
      profile: string;
      readable: (path: string) => boolean;
      home: string;
    }> = {}
  ) =>
    awsConfigFileWarning(
      more.bucket ?? BUCKET,
      value,
      more.id ?? "",
      more.secret ?? "",
      more.profile ?? "",
      more.readable ?? no,
      () => more.home ?? "/home/app"
    );

  it("is silent with backup off and for an empty value", () => {
    expect(check("/x/config", { bucket: "" })).toBeNull();
    expect(check("")).toBeNull();
  });

  it("is silent when the file the SDK would open can be read", () => {
    expect(check("/x/config", { readable: yes })).toBeNull();
  });

  it("is silent with a complete key pair and no profile, but not once a profile is set", () => {
    const pair = { id: "AKIAEXAMPLE", secret: "s" };
    expect(check("/x/config", pair)).toBeNull();
    expect(check("/x/config", { ...pair, profile: "work" })).not.toBeNull();
    expect(check("/x/config", { id: "AKIAEXAMPLE" })).not.toBeNull();
    expect(check("/x/config", { secret: "s" })).not.toBeNull();
  });

  it("asks about the path the SDK would open: ~/ is expanded, nothing else is", () => {
    const seen: string[] = [];
    const record = (path: string) => {
      seen.push(path);
      return true;
    };
    check("~/cfg/config", { readable: record, home: "/home/app" });
    check("/abs/config", { readable: record });
    check("relative/config", { readable: record });
    check("~", { readable: record });
    check("~bob/config", { readable: record });
    check(" ~/x", { readable: record });
    expect(seen).toEqual([
      "/home/app/cfg/config",
      "/abs/config",
      "relative/config",
      "~",
      "~bob/config",
      " ~/x",
    ]);
  });

  it.each([
    [" /x/config", "whitespace around it"],
    ["/x/config ", "whitespace around it"],
    ['"/x/config"', "wrapping quotes"],
    ["'/x/config'", "wrapping quotes"],
    ["$HOME/.aws/config", "variable reference"],
    ["${HOME}/.aws/config", "variable reference"],
    ["%USERPROFILE%\\.aws\\config", "variable reference"],
    ["~", "leading ~/"],
    ["~bob/.aws/config", "leading ~/"],
    ["/x/missing", "no readable file at that path"],
  ])("says why %j cannot be read", (value, why) => {
    expect(check(value)).toContain(why);
  });

  it("words the consequence by whether a profile is set, and never repeats the path", () => {
    const withProfile = check("/secret/path/config", { profile: "work" });
    const without = check("/secret/path/config");
    expect(withProfile).toContain("no credentials at the first backup");
    expect(withProfile).toContain(
      "unless that profile is in the credentials file"
    );
    expect(without).not.toContain("no credentials at the first backup");
    expect(without).toContain("as empty, without an error");
    expect(withProfile).not.toContain("secret/path");
    expect(without).not.toContain("secret/path");
  });

  describe("reading real files", () => {
    let dir = "";
    beforeAll(() => {
      dir = mkdtempSync(join(tmpdir(), "awscfg-"));
      writeFileSync(join(dir, "config"), "[default]\n");
    });
    afterAll(() => rmSync(dir, { recursive: true, force: true }));

    it("accepts a file, and refuses a directory and a missing path", () => {
      expect(isReadableFile(join(dir, "config"))).toBe(true);
      expect(isReadableFile(dir)).toBe(false);
      expect(isReadableFile(join(dir, "nope"))).toBe(false);
    });

    it.skipIf(process.getuid?.() === 0)(
      "refuses a file the process may not read",
      () => {
        const locked = join(dir, "locked");
        writeFileSync(locked, "[default]\n", { mode: 0o000 });
        expect(isReadableFile(locked)).toBe(false);
      }
    );

    it("is a warning only, raised through configWarnings, which reads the real file", () => {
      const cfg = {
        s3Bucket: BUCKET,
        awsConfigFile: join(dir, "missing"),
      };
      expect(configProblems(env(cfg))).toEqual([]);
      expect(configWarnings(env(cfg))).toHaveLength(1);
      expect(
        configWarnings(env({ ...cfg, awsConfigFile: join(dir, "config") }))
      ).toEqual([]);
      expect(
        configWarnings(env({ awsConfigFile: join(dir, "missing") }))
      ).toEqual([]);
      expect(configWarnings(env({ s3Bucket: BUCKET }))).toEqual([]);
    });

    it("hands configWarnings the key pair and the profile", () => {
      const base = { s3Bucket: BUCKET, awsConfigFile: join(dir, "missing") };
      const mine = (cfg: Parameters<typeof env>[0]) =>
        configWarnings(env(cfg)).filter(w => w.startsWith("AWS_CONFIG_FILE"));
      expect(mine(base)).toHaveLength(1);
      const pair = { awsAccessKeyId: "AKIAEXAMPLE", awsSecretAccessKey: "s" };
      expect(mine({ ...base, ...pair })).toEqual([]);
      expect(mine({ ...base, ...pair, awsProfile: "p" })).toHaveLength(1);
    });
  });

  it("reads the variable in env.ts, and an unset one is empty", async () => {
    const { vi } = await import("vitest");
    vi.resetModules();
    delete process.env.AWS_CONFIG_FILE;
    const unset = (await import("./env")).ENV.awsConfigFile;
    vi.resetModules();
    vi.stubEnv("AWS_CONFIG_FILE", "/x/config");
    const set = (await import("./env")).ENV.awsConfigFile;
    vi.unstubAllEnvs();
    expect(unset).toBe("");
    expect(set).toBe("/x/config");
  });

  describe("what the installed SDK does with the same environment", () => {
    // The credential chain is run in a child process with a minimal environment,
    // a throwaway HOME and working directory, and a profile that exists only in
    // the config file. The check must be silent exactly when the SDK finds it.
    let dir = "";
    let home = "";
    const PROBE = `
      const { S3Client } = require(${JSON.stringify(
        resolve(process.cwd(), "node_modules/@aws-sdk/client-s3")
      )});
      new S3Client({ region: "us-east-1", maxAttempts: 1 }).config.credentials()
        .then(k => console.log("creds " + k.accessKeyId), () => console.log("none"));
    `;
    beforeAll(() => {
      dir = mkdtempSync(join(tmpdir(), "awscfg-sdk-"));
      home = join(dir, "home");
      mkdirSync(home);
      mkdirSync(join(dir, "adir"));
      const body =
        "[profile p]\naws_access_key_id=AKIAEXAMPLE\naws_secret_access_key=secretexample\n";
      writeFileSync(join(dir, "config"), body);
      writeFileSync(join(home, "cfg"), body);
    });
    afterAll(() => rmSync(dir, { recursive: true, force: true }));

    const sdk = (value: string) =>
      execFileSync(process.execPath, ["-e", PROBE], {
        cwd: dir,
        env: {
          PATH: process.env.PATH ?? "",
          HOME: home,
          AWS_EC2_METADATA_DISABLED: "true",
          AWS_PROFILE: "p",
          AWS_CONFIG_FILE: value,
        },
        encoding: "utf8",
      }).trim();

    const values = () => [
      join(dir, "config"),
      "~/cfg",
      "config",
      "./config",
      join(dir, "missing"),
      `"${join(dir, "config")}"`,
      ` ${join(dir, "config")}`,
      `${join(dir, "config")} `,
      "~",
      "~/missing",
      "$HOME/cfg",
      join(dir, "adir"),
    ];

    it("finds the profile exactly where the check stays silent", () => {
      for (const value of values()) {
        const warned =
          awsConfigFileWarning(
            BUCKET,
            value,
            "",
            "",
            "p",
            path => isReadableFile(resolve(dir, path)),
            () => home
          ) !== null;
        expect([value, sdk(value)]).toEqual([
          value,
          warned ? "none" : "creds AKIAEXAMPLE",
        ]);
      }
    });

    it("reads a ~/ path from HOME and a relative path from the working directory", () => {
      expect(sdk("~/cfg")).toBe("creds AKIAEXAMPLE");
      expect(sdk("config")).toBe("creds AKIAEXAMPLE");
      expect(sdk("~")).toBe("none");
    });
  });
});

describe("AWS_SHARED_CREDENTIALS_FILE", () => {
  const BUCKET = "my-bucket";
  const check = (
    value: string,
    more: Partial<{
      bucket: string;
      id: string;
      secret: string;
      profile: string;
      readable: (path: string) => boolean;
    }> = {}
  ) =>
    awsCredentialsFileWarning(
      more.bucket ?? BUCKET,
      value,
      more.id ?? "",
      more.secret ?? "",
      more.profile ?? "",
      more.readable ?? (() => false),
      () => "/home/app"
    );

  it("is silent with backup off, for an empty value, and for a readable file", () => {
    expect(check("/x/credentials", { bucket: "" })).toBeNull();
    expect(check("")).toBeNull();
    expect(check("/x/credentials", { readable: () => true })).toBeNull();
  });

  it("is silent with a complete key pair and no profile, but not once a profile is set", () => {
    const pair = { id: "AKIAEXAMPLE", secret: "s" };
    expect(check("/x/credentials", pair)).toBeNull();
    expect(
      check("/x/credentials", { ...pair, profile: "work" })
    ).not.toBeNull();
    expect(check("/x/credentials", { id: "AKIAEXAMPLE" })).not.toBeNull();
  });

  it("names its own variable and what it holds, not AWS_CONFIG_FILE's", () => {
    const w = check("/x/credentials") ?? "";
    expect(w.startsWith("AWS_SHARED_CREDENTIALS_FILE names a file")).toBe(true);
    expect(w).toContain("the profiles and keys");
    expect(w).toContain("Fix the path, or unset AWS_SHARED_CREDENTIALS_FILE.");
    expect(w).not.toContain("AWS_CONFIG_FILE");
    expect(check("/x/config") ?? "").not.toContain("secret/path");
  });

  it("warns without AWS_PROFILE too, because the default profile's keys live here", () => {
    const w = check("/x/credentials") ?? "";
    expect(w).toContain("no credentials from that file");
    expect(w).toContain("an instance role or the environment");
    expect(check("/x/credentials", { profile: "work" })).toContain(
      "no credentials from that file"
    );
  });

  it("uses the same path rules as AWS_CONFIG_FILE", () => {
    const seen: string[] = [];
    const record = (path: string) => {
      seen.push(path);
      return true;
    };
    check("~/c/credentials", { readable: record });
    check("/abs", { readable: record });
    check("~", { readable: record });
    expect(seen).toEqual(["/home/app/c/credentials", "/abs", "~"]);
    for (const [value, why] of [
      [" /x", "whitespace around it"],
      ['"/x"', "wrapping quotes"],
      ["$HOME/x", "variable reference"],
      ["~bob/x", "leading ~/"],
      ["/x/missing", "no readable file at that path"],
    ] as const) {
      expect(check(value)).toContain(why);
    }
  });

  describe("reading real files", () => {
    let dir = "";
    beforeAll(() => {
      dir = mkdtempSync(join(tmpdir(), "awscred-"));
      writeFileSync(join(dir, "credentials"), "[default]\n");
    });
    afterAll(() => rmSync(dir, { recursive: true, force: true }));

    it("is raised through configWarnings and reads the real file", () => {
      const cfg = {
        s3Bucket: BUCKET,
        awsCredentialsFile: join(dir, "missing"),
      };
      expect(configProblems(env(cfg))).toEqual([]);
      expect(configWarnings(env(cfg))).toHaveLength(1);
      expect(
        configWarnings(
          env({ ...cfg, awsCredentialsFile: join(dir, "credentials") })
        )
      ).toEqual([]);
      expect(
        configWarnings(env({ awsCredentialsFile: join(dir, "missing") }))
      ).toEqual([]);
    });

    it("hands configWarnings the key pair and the profile, separately from AWS_CONFIG_FILE", () => {
      const base = {
        s3Bucket: BUCKET,
        awsCredentialsFile: join(dir, "missing"),
      };
      const mine = (cfg: Parameters<typeof env>[0]) =>
        configWarnings(env(cfg)).filter(w =>
          w.startsWith("AWS_SHARED_CREDENTIALS_FILE")
        );
      expect(mine(base)).toHaveLength(1);
      const pair = { awsAccessKeyId: "AKIAEXAMPLE", awsSecretAccessKey: "s" };
      expect(mine({ ...base, ...pair })).toEqual([]);
      expect(mine({ ...base, ...pair, awsProfile: "p" })).toHaveLength(1);
      expect(
        configWarnings(env({ ...base, awsConfigFile: join(dir, "missing") }))
      ).toHaveLength(2);
    });
  });

  it("reads the variable in env.ts, and an unset one is empty", async () => {
    const { vi } = await import("vitest");
    vi.resetModules();
    delete process.env.AWS_SHARED_CREDENTIALS_FILE;
    const unset = (await import("./env")).ENV.awsCredentialsFile;
    vi.resetModules();
    vi.stubEnv("AWS_SHARED_CREDENTIALS_FILE", "/x/credentials");
    const set = (await import("./env")).ENV.awsCredentialsFile;
    vi.unstubAllEnvs();
    expect(unset).toBe("");
    expect(set).toBe("/x/credentials");
  });

  describe("what the installed SDK does with the same environment", () => {
    // Keys live only in the credentials file, in a named profile and in the
    // default one; the check must be silent exactly where the SDK finds them.
    let dir = "";
    let home = "";
    const PROBE = `
      const { S3Client } = require(${JSON.stringify(
        resolve(process.cwd(), "node_modules/@aws-sdk/client-s3")
      )});
      new S3Client({ region: "us-east-1", maxAttempts: 1 }).config.credentials()
        .then(k => console.log("creds " + k.accessKeyId), () => console.log("none"));
    `;
    beforeAll(() => {
      dir = mkdtempSync(join(tmpdir(), "awscred-sdk-"));
      home = join(dir, "home");
      mkdirSync(home);
      mkdirSync(join(dir, "adir"));
      const body =
        "[p]\naws_access_key_id=AKIANAMED\naws_secret_access_key=s\n[default]\naws_access_key_id=AKIADEFAULT\naws_secret_access_key=s\n";
      writeFileSync(join(dir, "credentials"), body);
      writeFileSync(join(home, "cr"), body);
    });
    afterAll(() => rmSync(dir, { recursive: true, force: true }));

    const sdk = (value: string, profile: string) =>
      execFileSync(process.execPath, ["-e", PROBE], {
        cwd: dir,
        env: {
          PATH: process.env.PATH ?? "",
          HOME: home,
          AWS_EC2_METADATA_DISABLED: "true",
          ...(profile ? { AWS_PROFILE: profile } : {}),
          AWS_SHARED_CREDENTIALS_FILE: value,
        },
        encoding: "utf8",
      }).trim();

    const values = () => [
      join(dir, "credentials"),
      "~/cr",
      "credentials",
      "./credentials",
      join(dir, "missing"),
      `"${join(dir, "credentials")}"`,
      ` ${join(dir, "credentials")}`,
      "~",
      "$HOME/cr",
      join(dir, "adir"),
    ];

    it("finds the keys exactly where the check stays silent, with and without a profile", () => {
      for (const profile of ["p", ""]) {
        for (const value of values()) {
          const warned =
            awsCredentialsFileWarning(
              BUCKET,
              value,
              "",
              "",
              profile,
              path => isReadableFile(resolve(dir, path)),
              () => home
            ) !== null;
          expect([profile, value, sdk(value, profile)]).toEqual([
            profile,
            value,
            warned
              ? "none"
              : `creds ${profile === "p" ? "AKIANAMED" : "AKIADEFAULT"}`,
          ]);
        }
      }
    });
  });
});

describe("AWS_REQUEST_CHECKSUM_CALCULATION and AWS_RESPONSE_CHECKSUM_VALIDATION", () => {
  const BUCKET = "my-bucket";
  const REQ = "AWS_REQUEST_CHECKSUM_CALCULATION";
  const RES = "AWS_RESPONSE_CHECKSUM_VALIDATION";
  const check = (req: string, res = "", bucket = BUCKET) =>
    awsChecksumWarnings(bucket, req, res);

  it.each([
    "WHEN_SUPPORTED",
    "WHEN_REQUIRED",
    "when_required",
    "When_Supported",
    "",
  ])("is silent for %j, which the SDK accepts or treats as unset", value => {
    expect(check(value, value)).toEqual([]);
  });

  it.each([
    "never",
    "false",
    "0",
    "true",
    " WHEN_REQUIRED",
    "WHEN_REQUIRED ",
    '"WHEN_REQUIRED"',
    "WHEN-REQUIRED",
    "required",
  ])("says that %j is ignored, for each variable on its own", value => {
    const req = check(value);
    const res = check("", value);
    expect(req).toHaveLength(1);
    expect(req[0]).toContain("AWS_REQUEST_CHECKSUM_CALCULATION");
    expect(req[0]).toContain("uploads still carry a CRC32 checksum header");
    expect(res).toHaveLength(1);
    expect(res[0]).toContain("AWS_RESPONSE_CHECKSUM_VALIDATION");
    expect(res[0]).toContain("downloads still ask the store for a checksum");
    expect(check(value, value)).toHaveLength(2);
  });

  it("is silent with backup off, and never repeats the value", () => {
    expect(check("never", "never", "")).toEqual([]);
    expect(
      check("secret-junk-value", "secret-junk-value").join(" ")
    ).not.toContain("secret-junk");
  });

  it("is a warning only, raised through configWarnings, and each variable alone is enough", () => {
    const only = (cfg: Parameters<typeof env>[0]) =>
      configWarnings(env(cfg)).filter(w => /CHECKSUM/.test(w));
    expect(
      configProblems(
        env({ s3Bucket: BUCKET, awsRequestChecksumCalculation: "never" })
      )
    ).toEqual([]);
    expect(
      only({ s3Bucket: BUCKET, awsRequestChecksumCalculation: "never" })
    ).toHaveLength(1);
    expect(
      only({ s3Bucket: BUCKET, awsResponseChecksumValidation: "never" })
    ).toHaveLength(1);
    expect(
      only({
        s3Bucket: BUCKET,
        awsRequestChecksumCalculation: "never",
        awsResponseChecksumValidation: "never",
      })
    ).toHaveLength(2);
    expect(only({ awsRequestChecksumCalculation: "never" })).toEqual([]);
    expect(
      only({ s3Bucket: BUCKET, awsRequestChecksumCalculation: "WHEN_REQUIRED" })
    ).toEqual([]);
    expect(only({ s3Bucket: BUCKET })).toEqual([]);
  });

  it("reads both variables in env.ts, and unset ones are empty", async () => {
    const { vi } = await import("vitest");
    vi.resetModules();
    delete process.env[REQ];
    delete process.env[RES];
    const unset = (await import("./env")).ENV;
    vi.resetModules();
    vi.stubEnv(REQ, "WHEN_REQUIRED");
    vi.stubEnv(RES, "when_supported");
    const set = (await import("./env")).ENV;
    vi.unstubAllEnvs();
    expect(unset.awsRequestChecksumCalculation).toBe("");
    expect(unset.awsResponseChecksumValidation).toBe("");
    expect(set.awsRequestChecksumCalculation).toBe("WHEN_REQUIRED");
    expect(set.awsResponseChecksumValidation).toBe("when_supported");
  });

  describe("what the installed SDK does with the same environment", () => {
    // Builds the S3 client the way storage.ts does and reads the checksum
    // headers an upload and a download would carry, in a child process with a
    // minimal environment.
    const PROBE = `
      const s3 = require(${JSON.stringify(
        resolve(process.cwd(), "node_modules/@aws-sdk/client-s3")
      )});
      const cmds = {
        put: () => new s3.PutObjectCommand({ Bucket: "b", Key: "k", Body: Buffer.from("x") }),
        get: () => new s3.GetObjectCommand({ Bucket: "b", Key: "k" }),
      };
      (async () => {
        const out = [];
        for (const [n, mk] of Object.entries(cmds)) {
          const c = new s3.S3Client({ region: "us-east-1", credentials: { accessKeyId: "a", secretAccessKey: "b" }, maxAttempts: 1 });
          c.middlewareStack.add(next => async args => { throw new Error("stop:" + Object.keys(args.request.headers).filter(k => /checksum/i.test(k)).sort().join(",")); }, { step: "finalizeRequest", name: "p", priority: "low" });
          try { await c.send(mk()); } catch (e) { out.push(n + "=" + (e.message.startsWith("stop:") ? e.message.slice(5) : "ERR " + e.message)); }
        }
        console.log(out.join(" "));
      })();
    `;
    const probe = (set: Record<string, string>) =>
      execFileSync(process.execPath, ["-e", PROBE], {
        env: { PATH: process.env.PATH ?? "", ...NO_AWS_FILES, ...set },
        encoding: "utf8",
      }).trim();
    const DEFAULT = probe({});

    it("sends the CRC32 headers by default, and drops them only for WHEN_REQUIRED in any case", () => {
      expect(DEFAULT).toContain(
        "put=x-amz-checksum-crc32,x-amz-sdk-checksum-algorithm"
      );
      expect(DEFAULT).toContain("get=x-amz-checksum-mode");
      for (const value of ["WHEN_REQUIRED", "when_required", "When_Required"]) {
        expect(probe({ [REQ]: value })).toContain("put= ");
        expect(probe({ [RES]: value })).not.toBe(DEFAULT);
      }
      expect(probe({ [REQ]: "WHEN_SUPPORTED" })).toBe(DEFAULT);
    });

    it("ignores, with no error, exactly the values the check warns about", () => {
      for (const value of [
        "never",
        "false",
        "0",
        "true",
        " WHEN_REQUIRED",
        '"WHEN_REQUIRED"',
        "WHEN-REQUIRED",
        "required",
        "",
      ]) {
        const warned = check(value, value).length > 0;
        expect([
          value,
          probe({ [REQ]: value, [RES]: value }) === DEFAULT,
        ]).toEqual([value, true]);
        expect([value, warned]).toEqual([value, value !== ""]);
      }
    });
  });
});

describe("AWS_MAX_ATTEMPTS and AWS_RETRY_MODE", () => {
  const BUCKET = "my-bucket";
  const MAX = "AWS_MAX_ATTEMPTS";
  const MODE = "AWS_RETRY_MODE";
  const check = (max: string, mode = "", bucket = BUCKET) =>
    awsRetryWarnings(bucket, max, mode);

  it.each(["", "1", "3", "10", " 4", "4 ", "+5", "0", "007"])(
    "is silent for AWS_MAX_ATTEMPTS %j, which reads as it looks",
    value => {
      expect(check(value)).toEqual([]);
    }
  );

  it.each(["abc", "unlimited", " ", "five", "-", "."])(
    "says that %j is not a number and is ignored",
    value => {
      const out = check(value);
      expect(out).toHaveLength(1);
      expect(out[0]).toContain("AWS_MAX_ATTEMPTS is not a number");
      expect(out[0]).toContain("default of 3");
    }
  );

  it.each(["-1", "-5", " -2"])(
    "says that %j is one attempt with no retry",
    value => {
      const out = check(value);
      expect(out).toHaveLength(1);
      expect(out[0]).toContain("AWS_MAX_ATTEMPTS is negative");
      expect(out[0]).toContain("never retried");
    }
  );

  it.each(["1e1", "2.9", "3x", "5 attempts", "0x10", "1,5"])(
    "says that %j is read only up to the first non-digit",
    value => {
      const out = check(value);
      expect(out).toHaveLength(1);
      expect(out[0]).toContain("more in it than a whole number");
    }
  );

  it.each(["", "standard", "adaptive"])(
    "is silent for AWS_RETRY_MODE %j",
    value => {
      expect(check("", value)).toEqual([]);
    }
  );

  it.each(["ADAPTIVE", "Adaptive", "legacy", "bogus", " adaptive", "Standard"])(
    "says that AWS_RETRY_MODE %j falls back to standard",
    value => {
      const out = check("", value);
      expect(out).toHaveLength(1);
      expect(out[0]).toContain("AWS_RETRY_MODE");
      expect(out[0]).toContain("standard strategy");
    }
  );

  it("reports each variable on its own and both together", () => {
    expect(check("abc", "bogus")).toHaveLength(2);
    expect(check("abc", "")).toHaveLength(1);
    expect(check("", "bogus")).toHaveLength(1);
  });

  it("is silent with backup off, and never repeats a value", () => {
    expect(check("abc", "bogus", "")).toEqual([]);
    const text = check("secret-junk-value", "secret-junk-mode").join(" ");
    expect(text).not.toContain("secret-junk");
  });

  it("is a warning only, raised through configWarnings, and each variable alone is enough", () => {
    const only = (cfg: Parameters<typeof env>[0]) =>
      configWarnings(env(cfg)).filter(w =>
        /AWS_MAX_ATTEMPTS|AWS_RETRY_MODE/.test(w)
      );
    expect(
      configProblems(env({ s3Bucket: BUCKET, awsMaxAttempts: "abc" }))
    ).toEqual([]);
    expect(only({ s3Bucket: BUCKET, awsMaxAttempts: "abc" })).toHaveLength(1);
    expect(only({ s3Bucket: BUCKET, awsRetryMode: "bogus" })).toHaveLength(1);
    expect(
      only({ s3Bucket: BUCKET, awsMaxAttempts: "abc", awsRetryMode: "bogus" })
    ).toHaveLength(2);
    expect(only({ awsMaxAttempts: "abc" })).toEqual([]);
    expect(only({ s3Bucket: BUCKET, awsMaxAttempts: "5" })).toEqual([]);
    expect(only({ s3Bucket: BUCKET })).toEqual([]);
  });

  it("reads both variables in env.ts, and unset ones are empty", async () => {
    const { vi } = await import("vitest");
    vi.resetModules();
    delete process.env[MAX];
    delete process.env[MODE];
    const unset = (await import("./env")).ENV;
    vi.resetModules();
    vi.stubEnv(MAX, "5");
    vi.stubEnv(MODE, "adaptive");
    const set = (await import("./env")).ENV;
    vi.unstubAllEnvs();
    expect(unset.awsMaxAttempts).toBe("");
    expect(unset.awsRetryMode).toBe("");
    expect(set.awsMaxAttempts).toBe("5");
    expect(set.awsRetryMode).toBe("adaptive");
  });

  describe("what the installed SDK does with the same environment", () => {
    // Builds the S3 client the way storage.ts does (no maxAttempts, no
    // retryMode) against a local server that answers 503 and counts requests,
    // in a child process with a minimal environment.
    const PROBE = `
      const http = require("http");
      const s3 = require(${JSON.stringify(
        resolve(process.cwd(), "node_modules/@aws-sdk/client-s3")
      )});
      (async () => {
        let n = 0;
        const srv = http.createServer((q, r) => { n++; q.resume(); r.statusCode = 503; r.end("<Error><Code>SlowDown</Code></Error>"); });
        await new Promise(r => srv.listen(0, "127.0.0.1", r));
        const c = new s3.S3Client({ region: "us-east-1", endpoint: "http://127.0.0.1:" + srv.address().port, forcePathStyle: true, credentials: { accessKeyId: "a", secretAccessKey: "b" } });
        const mode = (await c.config.retryStrategy()).constructor.name;
        try { await c.send(new s3.HeadBucketCommand({ Bucket: "b" })); } catch (e) {}
        console.log(mode + " " + n);
        srv.close();
      })();
    `;
    const probe = (set: Record<string, string>) =>
      execFileSync(process.execPath, ["-e", PROBE], {
        env: { PATH: process.env.PATH ?? "", ...NO_AWS_FILES, ...set },
        encoding: "utf8",
      }).trim();

    it("uses 3 attempts and the standard strategy by default", () => {
      expect(probe({})).toBe("StandardRetryStrategy 3");
    });

    it("reads AWS_MAX_ATTEMPTS the way the check says it does", () => {
      const cases: [string, number, boolean][] = [
        ["1", 1, false],
        ["5", 5, false],
        [" 2", 2, false],
        ["0", 1, false],
        ["abc", 3, true],
        [" ", 3, true],
        ["-1", 1, true],
        ["1e1", 1, true],
        ["2.9", 2, true],
        ["3x", 3, true],
      ];
      for (const [value, attempts, warned] of cases) {
        expect([
          value,
          probe({ [MAX]: value }),
          check(value).length > 0,
        ]).toEqual([value, `StandardRetryStrategy ${attempts}`, warned]);
      }
    });

    it("selects the adaptive strategy only for exactly adaptive, and warns exactly otherwise", () => {
      for (const [value, strategy] of [
        ["adaptive", "AdaptiveRetryStrategy"],
        ["standard", "StandardRetryStrategy"],
        ["ADAPTIVE", "StandardRetryStrategy"],
        ["Adaptive", "StandardRetryStrategy"],
        ["legacy", "StandardRetryStrategy"],
        ["bogus", "StandardRetryStrategy"],
      ] as const) {
        const [mode] = probe({ [MODE]: value, [MAX]: "1" }).split(" ");
        expect([value, mode, check("", value).length > 0]).toEqual([
          value,
          strategy,
          value !== "adaptive" && value !== "standard",
        ]);
      }
    });
  });
});

describe("previousSecretWarnings", () => {
  const A = "a".repeat(8) + "-first-secret-0123456789abcdef";
  const B = "b".repeat(8) + "-second-secret-0123456789abcdef";

  it("is silent when there is no previous secret", () => {
    expect(previousSecretWarnings(A, "")).toEqual([]);
    expect(previousSecretWarnings(A, "   ")).toEqual([]);
  });

  it("is silent for a real rotation", () => {
    expect(previousSecretWarnings(B, A)).toEqual([]);
  });

  it("says a previous secret equal to the current one does nothing", () => {
    const [warning] = previousSecretWarnings(A, A);
    expect(warning).toContain("does nothing");
  });

  it("says a previous secret with no current one cannot sign anyone in", () => {
    const [warning] = previousSecretWarnings("", A);
    expect(warning).toContain("but JWT_SECRET is not");
  });

  it("never repeats either value", () => {
    for (const w of [
      ...previousSecretWarnings(A, A),
      ...previousSecretWarnings("", A),
    ]) {
      expect(w).not.toContain(A);
    }
  });
});

describe("AWS_DEFAULT_REGION", () => {
  const BUCKET = "my-bucket";
  const check = (
    s3Region: string,
    awsRegion: string,
    def: string,
    bucket = BUCKET
  ) => awsDefaultRegionWarning(bucket, s3Region, awsRegion, def);

  it("says the SDK does not read it, and that the default region is used", () => {
    const text = check("", "", "eu-west-1")!;
    expect(text).toContain("AWS_DEFAULT_REGION is set");
    expect(text).toContain("does not read it");
    expect(text).toContain(S3_DEFAULT_REGION);
    expect(text).toContain("Set S3_REGION");
  });

  it("says it differs from S3_REGION when that is set", () => {
    const text = check("eu-west-1", "", "us-west-2")!;
    expect(text).toContain("different region than S3_REGION");
    expect(text).toContain("unset AWS_DEFAULT_REGION");
  });

  it("is silent when it matches the region the client really uses", () => {
    expect(check("eu-west-1", "", "eu-west-1")).toBeNull();
    expect(check("", "", S3_DEFAULT_REGION)).toBeNull();
    expect(check("", "", "  us-east-1 ")).toBeNull();
    expect(check(" eu-west-1 ", "", "eu-west-1")).toBeNull();
  });

  it("is silent with backup off, when unset or blank", () => {
    expect(check("", "", "eu-west-1", "")).toBeNull();
    expect(check("", "", "")).toBeNull();
    expect(check("eu-west-1", "", "   ")).toBeNull();
  });

  it("leaves it to the AWS_REGION warning when AWS_REGION is set too", () => {
    expect(check("", "eu-west-1", "ap-south-1")).toBeNull();
    expect(check("", "   ", "ap-south-1")).not.toBeNull();
  });

  it("never repeats the value", () => {
    expect(check("", "", "secret-junk-region")!).not.toContain("secret-junk");
    expect(check("eu-west-1", "", "secret-junk-region")!).not.toContain(
      "secret-junk"
    );
  });

  it("is a warning only, raised through configWarnings", () => {
    const only = (cfg: Parameters<typeof env>[0]) =>
      configWarnings(env(cfg)).filter(w => /AWS_DEFAULT_REGION/.test(w));
    expect(
      configProblems(env({ s3Bucket: BUCKET, awsDefaultRegion: "eu-west-1" }))
    ).toEqual([]);
    expect(
      only({ s3Bucket: BUCKET, awsDefaultRegion: "eu-west-1" })
    ).toHaveLength(1);
    expect(only({ awsDefaultRegion: "eu-west-1" })).toEqual([]);
    expect(
      only({
        s3Bucket: BUCKET,
        s3Region: "eu-west-1",
        awsDefaultRegion: "eu-west-1",
      })
    ).toEqual([]);
    expect(
      only({
        s3Bucket: BUCKET,
        awsRegion: "eu-west-1",
        awsDefaultRegion: "ap-south-1",
      })
    ).toEqual([]);
    expect(only({ s3Bucket: BUCKET })).toEqual([]);
  });

  it("reads the variable in env.ts, and unset is empty", async () => {
    const { vi } = await import("vitest");
    vi.resetModules();
    delete process.env.AWS_DEFAULT_REGION;
    const unset = (await import("./env")).ENV;
    vi.resetModules();
    vi.stubEnv("AWS_DEFAULT_REGION", "eu-west-1");
    const set = (await import("./env")).ENV;
    vi.unstubAllEnvs();
    expect(unset.awsDefaultRegion).toBe("");
    expect(set.awsDefaultRegion).toBe("eu-west-1");
  });

  describe("what the installed SDK does with the same environment", () => {
    // Resolves the region the S3 client would use, with and without the
    // explicit region storage.ts passes, in a child process with a minimal
    // environment.
    const PROBE = `
      const s3 = require(${JSON.stringify(
        resolve(process.cwd(), "node_modules/@aws-sdk/client-s3")
      )});
      (async () => {
        const out = [];
        for (const [label, opts] of [["none", {}], ["explicit", { region: "us-east-1" }]]) {
          const c = new s3.S3Client({ credentials: { accessKeyId: "a", secretAccessKey: "b" }, ...opts });
          try { out.push(label + "=" + await c.config.region()); } catch (e) { out.push(label + "=missing"); }
        }
        console.log(out.join(" "));
      })();
    `;
    const probe = (set: Record<string, string>) =>
      execFileSync(process.execPath, ["-e", PROBE], {
        env: { PATH: process.env.PATH ?? "", ...NO_AWS_FILES, ...set },
        encoding: "utf8",
      }).trim();

    it("never takes the region from AWS_DEFAULT_REGION, with or without an explicit one", () => {
      expect(probe({})).toBe("none=missing explicit=us-east-1");
      expect(probe({ AWS_DEFAULT_REGION: "eu-west-1" })).toBe(
        "none=missing explicit=us-east-1"
      );
    });

    it("takes it from AWS_REGION only when no region is given, which is why that one is a separate warning", () => {
      expect(probe({ AWS_REGION: "eu-west-1" })).toBe(
        "none=eu-west-1 explicit=us-east-1"
      );
      expect(
        probe({ AWS_REGION: "eu-west-1", AWS_DEFAULT_REGION: "ap-south-1" })
      ).toBe("none=eu-west-1 explicit=us-east-1");
    });
  });
});

describe("AWS_WEB_IDENTITY_TOKEN_FILE and AWS_ROLE_ARN", () => {
  const BUCKET = "my-bucket";
  const TOKEN = "AWS_WEB_IDENTITY_TOKEN_FILE";
  const ARN = "AWS_ROLE_ARN";
  const ROLE = "arn:aws:iam::123456789012:role/backup";
  const yes = () => true;
  const no = () => false;
  const check = (
    tokenFile: string,
    roleArn: string,
    more: Partial<{
      bucket: string;
      id: string;
      secret: string;
      profile: string;
      readable: (path: string) => boolean;
    }> = {}
  ) =>
    awsWebIdentityWarnings(
      more.bucket ?? BUCKET,
      tokenFile,
      roleArn,
      more.id ?? "",
      more.secret ?? "",
      more.profile ?? "",
      more.readable ?? no
    );

  it("is silent when both are set and the token file can be read", () => {
    expect(check("/var/run/token", ROLE, { readable: yes })).toEqual([]);
  });

  it("is silent when neither is set, and with backup off", () => {
    expect(check("", "")).toEqual([]);
    expect(check("/missing", ROLE, { bucket: "" })).toEqual([]);
    expect(check("/var/run/token", "", { bucket: "" })).toEqual([]);
  });

  it("says a token file without a role is skipped", () => {
    const out = check("/var/run/token", "", { readable: yes });
    expect(out).toHaveLength(1);
    expect(out[0]).toContain(
      "AWS_WEB_IDENTITY_TOKEN_FILE is set without AWS_ROLE_ARN"
    );
    expect(out[0]).toContain("skips the web identity role without an error");
    expect(out[0]).toContain("Set AWS_ROLE_ARN as well");
  });

  it("says a role without a token file is skipped", () => {
    const out = check("", ROLE);
    expect(out).toHaveLength(1);
    expect(out[0]).toContain(
      "AWS_ROLE_ARN is set without AWS_WEB_IDENTITY_TOKEN_FILE"
    );
    expect(out[0]).toContain("Set AWS_WEB_IDENTITY_TOKEN_FILE as well");
  });

  it("says a token file that cannot be read fails every backup", () => {
    const out = check("/missing/token", ROLE);
    expect(out).toHaveLength(1);
    expect(out[0]).toContain(
      "AWS_WEB_IDENTITY_TOKEN_FILE names a file the SDK cannot read"
    );
    expect(out[0]).toContain("there is no readable file at that path");
    expect(out[0]).toContain("every backup would fail with a file error");
  });

  it.each([
    [" /var/run/token", "whitespace around it"],
    ["/var/run/token ", "whitespace around it"],
    ['"/var/run/token"', "wrapping quotes"],
    ["'/var/run/token'", "wrapping quotes"],
    ['/var/run/token"', "wrapping quotes"],
    ["$HOME/token", "variable reference"],
    ["%USERPROFILE%\\token", "variable reference"],
    ["~/token", "a leading ~ is not expanded for this file"],
    ["~", "a leading ~ is not expanded for this file"],
  ])("explains why %j cannot be read", (value, reason) => {
    const out = check(value, ROLE);
    expect(out).toHaveLength(1);
    expect(out[0]).toContain(reason);
  });

  it("asks about the path exactly as written, with no ~ expansion", () => {
    const asked: string[] = [];
    check("~/token", ROLE, {
      readable: path => {
        asked.push(path);
        return false;
      },
    });
    expect(asked).toEqual(["~/token"]);
  });

  it("is silent with a complete key pair and no profile, which the chain takes first", () => {
    const pair = { id: "AKIAEXAMPLE", secret: "x" };
    expect(check("/missing", ROLE, pair)).toEqual([]);
    expect(check("/var/run/token", "", pair)).toEqual([]);
    expect(check("", ROLE, pair)).toEqual([]);
  });

  it("still warns with half a key pair, or with a profile that makes the chain skip the pair", () => {
    expect(check("/missing", ROLE, { id: "AKIAEXAMPLE" })).toHaveLength(1);
    expect(check("/missing", ROLE, { secret: "x" })).toHaveLength(1);
    const withProfile = check("/missing", ROLE, {
      id: "AKIAEXAMPLE",
      secret: "x",
      profile: "work",
    });
    expect(withProfile).toHaveLength(1);
    expect(withProfile[0]).toContain("unless the AWS_PROFILE profile exists");
    expect(check("", ROLE, { profile: "work" })[0]).toContain(
      "unless the AWS_PROFILE profile exists"
    );
    expect(check("/missing", ROLE)[0]).not.toContain("AWS_PROFILE");
    expect(check("", ROLE)[0]).not.toContain("AWS_PROFILE");
  });

  it("never repeats the path, the role or the profile", () => {
    const text = [
      ...check("/secret-junk/token", "arn:aws:iam::1:role/secret-junk-role", {
        profile: "secret-junk-profile",
      }),
      ...check("/secret-junk/token", ""),
      ...check("", "arn:aws:iam::1:role/secret-junk-role"),
    ].join(" ");
    expect(text).not.toContain("secret-junk");
  });

  it("is a warning only, raised through configWarnings, and either variable alone is enough", () => {
    const only = (cfg: Parameters<typeof env>[0]) =>
      configWarnings(env(cfg)).filter(w =>
        /AWS_WEB_IDENTITY_TOKEN_FILE|AWS_ROLE_ARN/.test(w)
      );
    expect(configProblems(env({ s3Bucket: BUCKET, awsRoleArn: ROLE }))).toEqual(
      []
    );
    expect(only({ s3Bucket: BUCKET, awsRoleArn: ROLE })).toHaveLength(1);
    expect(
      only({ s3Bucket: BUCKET, awsWebIdentityTokenFile: "/nonexistent/token" })
    ).toHaveLength(1);
    expect(
      only({
        s3Bucket: BUCKET,
        awsWebIdentityTokenFile: "/nonexistent/web-identity/token",
        awsRoleArn: ROLE,
      })
    ).toHaveLength(1);
    expect(only({ awsRoleArn: ROLE })).toEqual([]);
    expect(
      only({
        s3Bucket: BUCKET,
        awsRoleArn: ROLE,
        awsAccessKeyId: "AKIAEXAMPLE",
        awsSecretAccessKey: "x",
      })
    ).toEqual([]);
    expect(only({ s3Bucket: BUCKET })).toEqual([]);
  });

  it("reads both variables in env.ts, and unset ones are empty", async () => {
    const { vi } = await import("vitest");
    vi.resetModules();
    delete process.env[TOKEN];
    delete process.env[ARN];
    const unset = (await import("./env")).ENV;
    vi.resetModules();
    vi.stubEnv(TOKEN, "/var/run/token");
    vi.stubEnv(ARN, ROLE);
    const set = (await import("./env")).ENV;
    vi.unstubAllEnvs();
    expect(unset.awsWebIdentityTokenFile).toBe("");
    expect(unset.awsRoleArn).toBe("");
    expect(set.awsWebIdentityTokenFile).toBe("/var/run/token");
    expect(set.awsRoleArn).toBe(ROLE);
  });

  describe("what the installed SDK does with the same environment", () => {
    // Resolves credentials through the S3 client's default chain, the way
    // storage.ts leaves it, in a child process with a minimal environment, a
    // throwaway HOME and working directory, the instance metadata lookup off,
    // and a local stand-in for STS that counts the exchanges it is asked for.
    let dir: string;
    beforeAll(() => {
      dir = mkdtempSync(join(tmpdir(), "web-identity-"));
      mkdirSync(join(dir, "home"));
      mkdirSync(join(dir, "adir"));
      writeFileSync(join(dir, "token"), "tok");
      writeFileSync(join(dir, "home", "token"), "tok");
    });
    afterAll(() => {
      rmSync(dir, { recursive: true, force: true });
    });
    const PROBE = `
      const http = require("http");
      const s3 = require(${JSON.stringify(
        resolve(process.cwd(), "node_modules/@aws-sdk/client-s3")
      )});
      (async () => {
        let calls = 0;
        const srv = http.createServer((q, r) => { q.resume(); q.on("end", () => { calls++; r.setHeader("content-type", "text/xml");
          r.end('<AssumeRoleWithWebIdentityResponse xmlns="https://sts.amazonaws.com/doc/2011-06-15/"><AssumeRoleWithWebIdentityResult><Credentials><AccessKeyId>AKIAWEBID</AccessKeyId><SecretAccessKey>s</SecretAccessKey><SessionToken>t</SessionToken><Expiration>2099-01-01T00:00:00Z</Expiration></Credentials><AssumedRoleUser><Arn>arn:aws:sts::1:assumed-role/r/s</Arn><AssumedRoleId>A:s</AssumedRoleId></AssumedRoleUser></AssumeRoleWithWebIdentityResult></AssumeRoleWithWebIdentityResponse>'); }); });
        await new Promise(r => srv.listen(0, "127.0.0.1", r));
        process.env.AWS_ENDPOINT_URL_STS = "http://127.0.0.1:" + srv.address().port;
        const c = new s3.S3Client({ region: "us-east-1" });
        let out;
        try { out = "creds " + (await c.config.credentials()).accessKeyId; }
        catch (e) { out = e.name === "CredentialsProviderError" ? "none" : "error " + (e.code || e.name); }
        console.log(out + " sts=" + calls);
        srv.close();
      })();
    `;
    const sdk = (set: Record<string, string>) =>
      execFileSync(process.execPath, ["-e", PROBE], {
        cwd: dir,
        env: {
          PATH: process.env.PATH ?? "",
          HOME: join(dir, "home"),
          AWS_EC2_METADATA_DISABLED: "true",
          ...set,
        },
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();
    const warned = (set: Record<string, string>) =>
      awsWebIdentityWarnings(
        BUCKET,
        set[TOKEN] ?? "",
        set[ARN] ?? "",
        set.AWS_ACCESS_KEY_ID ?? "",
        set.AWS_SECRET_ACCESS_KEY ?? "",
        set.AWS_PROFILE ?? "",
        path => isReadableFile(resolve(dir, path))
      ).length > 0;

    it("exchanges the token for the role's credentials when both are set and the file is there", () => {
      const set = { [TOKEN]: join(dir, "token"), [ARN]: ROLE };
      expect(sdk(set)).toBe("creds AKIAWEBID sts=1");
      expect(warned(set)).toBe(false);
    });

    it("skips the role without an error or an exchange when one of the two is missing or empty", () => {
      for (const set of [
        { [TOKEN]: join(dir, "token") },
        { [ARN]: ROLE },
        { [TOKEN]: "", [ARN]: ROLE },
        { [TOKEN]: join(dir, "token"), [ARN]: "" },
      ] as Record<string, string>[]) {
        expect([set, sdk(set), warned(set)]).toEqual([set, "none sts=0", true]);
      }
    });

    it("fails with a file error, and warns, exactly where the token file cannot be read", () => {
      const cases: [string, string][] = [
        [join(dir, "token"), "creds AKIAWEBID sts=1"],
        ["token", "creds AKIAWEBID sts=1"],
        ["./token", "creds AKIAWEBID sts=1"],
        [join(dir, "missing"), "error ENOENT sts=0"],
        [join(dir, "adir"), "error EISDIR sts=0"],
        ["~/token", "error ENOENT sts=0"],
        [` ${join(dir, "token")}`, "error ENOENT sts=0"],
        [`"${join(dir, "token")}"`, "error ENOENT sts=0"],
        ["$HOME/token", "error ENOENT sts=0"],
      ];
      for (const [value, result] of cases) {
        const set = { [TOKEN]: value, [ARN]: ROLE };
        expect([value, sdk(set), warned(set)]).toEqual([
          value,
          result,
          !result.startsWith("creds"),
        ]);
      }
    });

    it("never reaches the token file with a complete key pair, unless AWS_PROFILE makes the chain skip the pair", () => {
      const pair = { AWS_ACCESS_KEY_ID: "AKIAENV", AWS_SECRET_ACCESS_KEY: "x" };
      for (const value of [join(dir, "token"), join(dir, "missing")]) {
        const set = { [TOKEN]: value, [ARN]: ROLE, ...pair };
        expect([value, sdk(set), warned(set)]).toEqual([
          value,
          "creds AKIAENV sts=0",
          false,
        ]);
      }
      const skipped = {
        [TOKEN]: join(dir, "missing"),
        [ARN]: ROLE,
        ...pair,
        AWS_PROFILE: "not-there",
      };
      expect(sdk(skipped)).toBe("error ENOENT sts=0");
      expect(warned(skipped)).toBe(true);
      const reached = {
        [TOKEN]: join(dir, "token"),
        [ARN]: ROLE,
        AWS_PROFILE: "not-there",
      };
      expect(sdk(reached)).toBe("creds AKIAWEBID sts=1");
      expect(warned(reached)).toBe(false);
    });
  });
});

describe("AWS_CONTAINER_CREDENTIALS_* and AWS_CONTAINER_AUTHORIZATION_TOKEN_FILE", () => {
  const BUCKET = "my-bucket";
  const REL = "AWS_CONTAINER_CREDENTIALS_RELATIVE_URI";
  const FULL = "AWS_CONTAINER_CREDENTIALS_FULL_URI";
  const TOKEN = "AWS_CONTAINER_AUTHORIZATION_TOKEN_FILE";
  const yes = () => true;
  const no = () => false;
  const check = (
    more: Partial<{
      bucket: string;
      rel: string;
      full: string;
      tokenFile: string;
      id: string;
      secret: string;
      profile: string;
      webIdentity: boolean;
      readable: (path: string) => boolean;
    }> = {}
  ) =>
    awsContainerCredentialsWarnings(
      more.bucket ?? BUCKET,
      more.rel ?? "",
      more.full ?? "",
      more.tokenFile ?? "",
      more.id ?? "",
      more.secret ?? "",
      more.profile ?? "",
      more.webIdentity ?? false,
      more.readable ?? yes
    );

  it("is silent for addresses the SDK accepts", () => {
    for (const full of [
      "https://example.com/creds",
      "http://127.0.0.1:8080/c",
      "http://localhost:8080/c",
      "http://127.1/c",
      "HTTP://127.0.0.1/c",
      "http://169.254.170.2/v2/credentials/x",
      "http://169.254.170.23/v1/credentials",
      "http://[fd00:ec2::23]/v1/credentials",
      "http://[::1]:8080/c",
      "  http://127.0.0.1:8080/c  ",
    ]) {
      expect([full, check({ full })]).toEqual([full, []]);
    }
    expect(check({ rel: "/v2/credentials/x" })).toEqual([]);
  });

  it.each([
    "127.0.0.1:8080/c",
    "//127.0.0.1:8080/c",
    '"http://127.0.0.1:8080/c"',
    "localhost",
    "not a url",
  ])("says an address the SDK cannot parse (%j) ends the chain", full => {
    const out = check({ full });
    expect(out).toHaveLength(1);
    expect(out[0]).toContain("is not an address the SDK can parse");
    expect(out[0]).toContain("Invalid URL");
    expect(out[0]).toContain("every backup would fail");
  });

  it.each([
    "http://example.com/c",
    "http://10.0.0.5/c",
    "http://0.0.0.0:8080/c",
    "http://128.0.0.1/c",
    "http://169.254.169.254/latest",
    "http://[fe80::1]/c",
    "ftp://example.com/c",
    "http://127.0.0.1.example.com/c",
    "http://127.0.0.x/c",
    "http://127.a.b.c/c",
    "http://127.0.0.-1/c",
  ])("says a refused address (%j) finds no credentials", full => {
    const out = check({ full });
    expect(out).toHaveLength(1);
    expect(out[0]).toContain("is refused by the SDK");
    expect(out[0]).toContain("no credentials would be found");
  });

  it("matches the SDK's host rule exactly", () => {
    const ok = (u: string) => containerHostAccepted(new URL(u));
    expect(ok("https://anything.example/")).toBe(true);
    expect(ok("http://127.255.255.255/")).toBe(true);
    expect(ok("http://127.0.0.1./")).toBe(true);
    expect(ok("http://126.0.0.1/")).toBe(false);
    expect(ok("http://localhost.example/")).toBe(false);
    expect(ok("http://[::2]/")).toBe(false);
    expect(ok("http://169.254.170.3/")).toBe(false);
    expect(ok("http://127.0.0.1.example.com/")).toBe(false);
    expect(ok("http://127.0.0.x/")).toBe(false);
    expect(ok("http://127.0.0.-1/")).toBe(false);
  });

  it("carries the earlier-source exception on a refused address and an unreadable token file too", () => {
    const refused = check({ full: "http://example.com/c", profile: "work" });
    expect(refused).toHaveLength(1);
    expect(refused[0]).toContain("unless an earlier source");
    const token = check({
      full: "https://example.com/c",
      tokenFile: "/missing",
      readable: no,
      webIdentity: true,
    });
    expect(token).toHaveLength(1);
    expect(token[0]).toContain("unless an earlier source");
    expect(check({ full: "http://example.com/c" })[0]).not.toContain("unless");
  });

  it("says the relative address wins and the full one is ignored", () => {
    const out = check({
      rel: "/v2/credentials/x",
      full: "https://example.com/c",
    });
    expect(out).toHaveLength(1);
    expect(out[0]).toContain("ignores the full one");
    expect(check({ rel: "/x", full: "garbage" })).toHaveLength(1);
    expect(check({ rel: "/x", full: "garbage" })[0]).toContain(
      "ignores the full one"
    );
  });

  it("says an unreadable token file fails every backup, with either address", () => {
    for (const more of [{ rel: "/x" }, { full: "https://example.com/c" }]) {
      const out = check({ ...more, tokenFile: "/missing/token", readable: no });
      expect(out).toHaveLength(1);
      expect(out[0]).toContain(
        "AWS_CONTAINER_AUTHORIZATION_TOKEN_FILE names a file the SDK cannot read"
      );
      expect(out[0]).toContain("no ~ expansion");
      expect(out[0]).toContain("every backup would fail");
    }
    expect(
      check({ full: "https://example.com/c", tokenFile: "/ok", readable: yes })
    ).toEqual([]);
  });

  it("asks about the token path exactly as written", () => {
    const asked: string[] = [];
    check({
      full: "https://example.com/c",
      tokenFile: "~/token",
      readable: path => {
        asked.push(path);
        return false;
      },
    });
    expect(asked).toEqual(["~/token"]);
  });

  it("reports an unusable address and an unreadable token file together", () => {
    expect(
      check({ full: "garbage", tokenFile: "/missing", readable: no })
    ).toHaveLength(2);
  });

  it("is silent with no address, and with backup off", () => {
    expect(check({ tokenFile: "/missing", readable: no })).toEqual([]);
    expect(check({ full: "garbage", bucket: "" })).toEqual([]);
    expect(check({ rel: "/x", full: "garbage", bucket: "" })).toEqual([]);
  });

  it("is silent with a complete key pair and no profile, which the chain takes first", () => {
    const pair = { id: "AKIAEXAMPLE", secret: "x" };
    expect(check({ full: "garbage", ...pair })).toEqual([]);
    expect(
      check({
        full: "https://example.com/c",
        tokenFile: "/m",
        readable: no,
        ...pair,
      })
    ).toEqual([]);
  });

  it("still warns with half a pair, or with a profile or web identity role that could come first", () => {
    expect(check({ full: "garbage", id: "AKIAEXAMPLE" })).toHaveLength(1);
    expect(check({ full: "garbage", secret: "x" })).toHaveLength(1);
    for (const more of [
      { profile: "work" },
      { webIdentity: true },
      { profile: "work", id: "AKIAEXAMPLE", secret: "x" },
    ]) {
      const out = check({ full: "garbage", ...more });
      expect(out).toHaveLength(1);
      expect(out[0]).toContain("unless an earlier source");
    }
    expect(check({ full: "garbage" })[0]).not.toContain("unless");
  });

  it("never repeats an address, a path or a profile", () => {
    const text = [
      ...check({ full: "secret-junk-address" }),
      ...check({ full: "http://secret-junk-host.example/c" }),
      ...check({ rel: "/secret-junk-rel", full: "x" }),
      ...check({
        full: "https://example.com/c",
        tokenFile: "/secret-junk/token",
        profile: "secret-junk-profile",
        readable: no,
      }),
    ].join(" ");
    expect(text).not.toContain("secret-junk");
  });

  it("is a warning only, raised through configWarnings", () => {
    const only = (cfg: Parameters<typeof env>[0]) =>
      configWarnings(env(cfg)).filter(w =>
        /AWS_CONTAINER_(CREDENTIALS_(FULL|RELATIVE)_URI|AUTHORIZATION_TOKEN_FILE)/.test(
          w
        )
      );
    expect(
      configProblems(
        env({ s3Bucket: BUCKET, awsContainerCredentialsFullUri: "garbage" })
      )
    ).toEqual([]);
    expect(
      only({ s3Bucket: BUCKET, awsContainerCredentialsFullUri: "garbage" })
    ).toHaveLength(1);
    expect(
      only({
        s3Bucket: BUCKET,
        awsContainerCredentialsRelativeUri: "/x",
        awsContainerAuthorizationTokenFile: "/nonexistent/container/token",
      })
    ).toHaveLength(1);
    expect(only({ awsContainerCredentialsFullUri: "garbage" })).toEqual([]);
    expect(
      only({
        s3Bucket: BUCKET,
        awsContainerCredentialsFullUri: "https://example.com/c",
      })
    ).toEqual([]);
    expect(only({ s3Bucket: BUCKET })).toEqual([]);
  });

  it("reads the three variables in env.ts, and the combined one still prefers the relative address", async () => {
    const { vi } = await import("vitest");
    vi.resetModules();
    for (const k of [REL, FULL, TOKEN]) delete process.env[k];
    const unset = (await import("./env")).ENV;
    vi.resetModules();
    vi.stubEnv(REL, "/v2/x");
    vi.stubEnv(FULL, "https://example.com/c");
    vi.stubEnv(TOKEN, "/var/run/token");
    const set = (await import("./env")).ENV;
    vi.unstubAllEnvs();
    expect(unset.awsContainerCredentialsRelativeUri).toBe("");
    expect(unset.awsContainerCredentialsFullUri).toBe("");
    expect(unset.awsContainerAuthorizationTokenFile).toBe("");
    expect(unset.awsContainerCredentialsUri).toBe("");
    expect(set.awsContainerCredentialsRelativeUri).toBe("/v2/x");
    expect(set.awsContainerCredentialsFullUri).toBe("https://example.com/c");
    expect(set.awsContainerAuthorizationTokenFile).toBe("/var/run/token");
    expect(set.awsContainerCredentialsUri).toBe("/v2/x");
  });

  describe("what the installed SDK does with the same environment", () => {
    // Resolves credentials through the S3 client's default chain in a child
    // process with a minimal environment, the instance metadata lookup off, and
    // a local credentials server on loopback that records the Authorization
    // header. "PORT" in a value is replaced by that server's port.
    let dir: string;
    beforeAll(() => {
      dir = mkdtempSync(join(tmpdir(), "container-creds-"));
      writeFileSync(join(dir, "token"), "tok-from-file");
    });
    afterAll(() => {
      rmSync(dir, { recursive: true, force: true });
    });
    const PROBE = `
      const http = require("http");
      const s3 = require(${JSON.stringify(
        resolve(process.cwd(), "node_modules/@aws-sdk/client-s3")
      )});
      (async () => {
        let hits = 0, auth = "-";
        const srv = http.createServer((q, r) => { hits++; auth = q.headers.authorization || "-"; r.setHeader("content-type", "application/json");
          r.end(JSON.stringify({ AccessKeyId: "AKIACONT", SecretAccessKey: "s", Token: "t", Expiration: "2099-01-01T00:00:00Z" })); });
        await new Promise(r => srv.listen(0, "127.0.0.1", r));
        const port = srv.address().port;
        for (const k of Object.keys(process.env)) process.env[k] = process.env[k].replace("PORT", port);
        const c = new s3.S3Client({ region: "us-east-1" });
        let out;
        try { out = "creds " + (await c.config.credentials()).accessKeyId; }
        catch (e) { out = e.name === "CredentialsProviderError" ? "none" : "error " + (e.code || e.name); }
        console.log(out + " hits=" + hits + " auth=" + auth);
        srv.close();
      })();
    `;
    const sdk = (set: Record<string, string>) =>
      execFileSync(process.execPath, ["-e", PROBE], {
        cwd: dir,
        env: {
          PATH: process.env.PATH ?? "",
          AWS_EC2_METADATA_DISABLED: "true",
          ...set,
        },
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();
    const warned = (set: Record<string, string>) =>
      awsContainerCredentialsWarnings(
        BUCKET,
        set[REL] ?? "",
        (set[FULL] ?? "").replace("PORT", "8080"),
        set[TOKEN] ?? "",
        set.AWS_ACCESS_KEY_ID ?? "",
        set.AWS_SECRET_ACCESS_KEY ?? "",
        set.AWS_PROFILE ?? "",
        false,
        path => isReadableFile(resolve(dir, path))
      ).length > 0;

    it("accepts, and does not warn about, exactly the full addresses it can use", () => {
      const cases: [string, string][] = [
        ["http://127.0.0.1:PORT/c", "creds AKIACONT hits=1 auth=-"],
        ["http://localhost:PORT/c", "creds AKIACONT hits=1 auth=-"],
        ["http://127.1:PORT/c", "creds AKIACONT hits=1 auth=-"],
        ["HTTP://127.0.0.1:PORT/c", "creds AKIACONT hits=1 auth=-"],
        ["  http://127.0.0.1:PORT/c  ", "creds AKIACONT hits=1 auth=-"],
        ["127.0.0.1:PORT/c", "error ERR_INVALID_URL hits=0 auth=-"],
        ["//127.0.0.1:PORT/c", "error ERR_INVALID_URL hits=0 auth=-"],
        ['"http://127.0.0.1:PORT/c"', "error ERR_INVALID_URL hits=0 auth=-"],
        ["http://example.com/c", "none hits=0 auth=-"],
        ["http://10.0.0.5/c", "none hits=0 auth=-"],
        ["http://0.0.0.0:PORT/c", "none hits=0 auth=-"],
      ];
      for (const [full, result] of cases) {
        const set = { [FULL]: full };
        expect([full, sdk(set), warned(set)]).toEqual([
          full,
          result,
          !result.startsWith("creds"),
        ]);
      }
    });

    it("sends the token file's contents, and fails on a file it cannot read, exactly as the check says", () => {
      const full = "http://127.0.0.1:PORT/c";
      const cases: [string, string][] = [
        [join(dir, "token"), "creds AKIACONT hits=1 auth=tok-from-file"],
        ["token", "creds AKIACONT hits=1 auth=tok-from-file"],
        [join(dir, "missing"), "error ENOENT hits=0 auth=-"],
        ["~/token", "error ENOENT hits=0 auth=-"],
        [` ${join(dir, "token")}`, "error ENOENT hits=0 auth=-"],
      ];
      for (const [tokenFile, result] of cases) {
        const set = { [FULL]: full, [TOKEN]: tokenFile };
        expect([tokenFile, sdk(set), warned(set)]).toEqual([
          tokenFile,
          result,
          !result.startsWith("creds"),
        ]);
      }
    });

    it("uses the relative address and ignores the full one when both are set", () => {
      const set = { [REL]: "/x", [FULL]: "http://127.0.0.1:PORT/c" };
      expect(sdk(set)).toBe("none hits=0 auth=-");
      expect(warned(set)).toBe(true);
    });

    it("never reaches the container address with a complete key pair, unless AWS_PROFILE makes the chain skip the pair", () => {
      const pair = { AWS_ACCESS_KEY_ID: "AKIAENV", AWS_SECRET_ACCESS_KEY: "x" };
      for (const full of ["http://example.com/c", "garbage"]) {
        const set = { [FULL]: full, ...pair };
        expect([full, sdk(set), warned(set)]).toEqual([
          full,
          "creds AKIAENV hits=0 auth=-",
          false,
        ]);
      }
      const skipped = {
        [FULL]: "http://127.0.0.1:PORT/c",
        ...pair,
        AWS_PROFILE: "not-there",
      };
      expect(sdk(skipped)).toBe("creds AKIACONT hits=1 auth=-");
      expect(warned(skipped)).toBe(false);
      const broken = { ...skipped, [FULL]: "garbage" };
      expect(sdk(broken)).toBe("error ERR_INVALID_URL hits=0 auth=-");
      expect(warned(broken)).toBe(true);
    });
  });
});
