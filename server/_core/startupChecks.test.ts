import { describe, expect, it } from "vitest";
import { assertStartupConfig, configProblems } from "./startupChecks";

const DB = "mysql://user:pass@db.example.com:3306/notes";

describe("configProblems", () => {
  it("has nothing to say about a server with no database, which cannot sign anyone in", () => {
    // How smoke, the e2e suite and a static deploy run.
    expect(configProblems({ databaseUrl: "", appId: "" })).toEqual([]);
  });

  it("has nothing to say when there is a database and an app id", () => {
    expect(configProblems({ databaseUrl: DB, appId: "my-app" })).toEqual([]);
  });

  it("has nothing to say about an app id with no database", () => {
    expect(configProblems({ databaseUrl: "", appId: "my-app" })).toEqual([]);
  });

  it("names the missing variable when there is a database and no app id", () => {
    const problems = configProblems({ databaseUrl: DB, appId: "" });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/VITE_APP_ID/);
    expect(problems[0]).toMatch(/DATABASE_URL/);
  });

  it("treats an app id that is only whitespace as missing", () => {
    expect(configProblems({ databaseUrl: DB, appId: "   " })).toHaveLength(1);
  });

  it("treats a database URL that is only whitespace as no database", () => {
    expect(configProblems({ databaseUrl: "  ", appId: "" })).toEqual([]);
  });

  it("never repeats the database URL, which carries a password", () => {
    const text = JSON.stringify(configProblems({ databaseUrl: DB, appId: "" }));
    expect(text).not.toContain("pass");
    expect(text).not.toContain("db.example.com");
  });
});

describe("assertStartupConfig", () => {
  it("returns quietly when the configuration can work", () => {
    expect(() =>
      assertStartupConfig({ databaseUrl: "", appId: "" })
    ).not.toThrow();
    expect(() =>
      assertStartupConfig({ databaseUrl: DB, appId: "my-app" })
    ).not.toThrow();
  });

  it("throws an error that lists the problem", () => {
    expect(() => assertStartupConfig({ databaseUrl: DB, appId: "" })).toThrow(
      /Invalid configuration:[\s\S]*VITE_APP_ID/
    );
  });
});
