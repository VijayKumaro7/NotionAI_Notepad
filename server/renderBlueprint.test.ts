import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

/**
 * The Render Blueprint has to keep up with the code.
 *
 * Nothing else notices when it does not. A variable added to the server and
 * forgotten in render.yaml deploys perfectly and then behaves as though the
 * feature were switched off — which is exactly what happened here: the
 * Blueprint had fallen nine variables behind, so a deploy from it would have
 * come up with no email, no Google sign-in and no robot check, reporting each
 * as "not configured" with nothing to say why.
 *
 * This compares what the server reads against what the Blueprint declares.
 */

const ROOT = resolve(process.cwd());

/** Set by the platform for every service; never declared by us. */
const PLATFORM_PROVIDED = new Set([
  "PORT",
  "NODE_ENV",
  // Render sets this to the service's own URL. env.ts falls back to it so a
  // Blueprint deploy needs no URL pasted back in.
  "RENDER_EXTERNAL_URL",
]);

/**
 * Named only so startup can check them. The S3_ pair is ignored by the app
 * (s3IgnoredCredentialWarnings), and declaring it in the Blueprint would invite
 * setting it; the AWS_ pair is read by the SDK, not by us, and may equally come
 * from a profile or a role (awsCredentialWarnings), so the Blueprint does not
 * require it. AWS_REGION is ignored by the backup client (awsRegionWarning), so
 * declaring it would invite setting it. AWS_PROFILE is read by the SDK, not by
 * us, and a profile needs files the Blueprint cannot provide (awsProfileWarnings).
 * The AWS_ENDPOINT_URL pair and AWS_IGNORE_CONFIGURED_ENDPOINT_URLS are read by
 * the SDK, and S3_ENDPOINT is the setting the app reads (awsEndpointUrlWarnings).
 * AWS_USE_FIPS_ENDPOINT is read by the SDK too, and turns FIPS on only when exactly
 * true (awsFipsEndpointWarnings).
 * AWS_USE_DUALSTACK_ENDPOINT is the same story for dual-stack (awsDualstackEndpointWarnings).
 * AWS_EC2_METADATA_DISABLED and the AWS_CONTAINER_CREDENTIALS_* pair are read by
 * the SDK's credential chain; the app only reads them to warn (awsEc2MetadataDisabledWarning).
 * AWS_S3_US_EAST_1_REGIONAL_ENDPOINT is an old-SDK setting nothing here reads
 * (awsS3UsEast1RegionalEndpointWarning).
 * HTTP_PROXY, HTTPS_PROXY, ALL_PROXY, NO_PROXY and NODE_USE_ENV_PROXY are read
 * by libraries and the runtime, not by us (outboundProxyWarnings, noProxyWarnings).
 * WEB_CONCURRENCY and NODE_APP_INSTANCE are set by process managers that run
 * several copies of the server; this app never reads them for behaviour, only
 * to warn that the per-address flood limits, which count in each process's
 * memory, are then multiplied (instanceWarnings).
 */
const WARNED_ABOUT_ONLY = new Set([
  "S3_ACCESS_KEY_ID",
  "S3_SECRET_ACCESS_KEY",
  "AWS_ACCESS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY",
  "AWS_SESSION_TOKEN",
  "AWS_REGION",
  "AWS_PROFILE",
  "AWS_USE_FIPS_ENDPOINT",
  "AWS_USE_DUALSTACK_ENDPOINT",
  "AWS_EC2_METADATA_DISABLED",
  "AWS_CONTAINER_CREDENTIALS_RELATIVE_URI",
  "AWS_CONTAINER_CREDENTIALS_FULL_URI",
  "AWS_S3_US_EAST_1_REGIONAL_ENDPOINT",
  "AWS_ENDPOINT_URL",
  "AWS_ENDPOINT_URL_S3",
  "AWS_IGNORE_CONFIGURED_ENDPOINT_URLS",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "NODE_USE_ENV_PROXY",
  "ALL_PROXY",
  "NO_PROXY",
  "WEB_CONCURRENCY",
  "NODE_APP_INSTANCE",
]);

function serverSources(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) found.push(...serverSources(full));
    else if (full.endsWith(".ts") && !full.endsWith(".test.ts"))
      found.push(full);
  }
  return found;
}

function envVarsRead(): Set<string> {
  const names = new Set<string>();
  for (const file of serverSources(join(ROOT, "server"))) {
    for (const match of readFileSync(file, "utf8").matchAll(
      /process\.env\.([A-Z0-9_]+)/g
    )) {
      names.add(match[1]);
    }
  }
  return names;
}

function envVarsDeclared(): Set<string> {
  const yaml = readFileSync(join(ROOT, "render.yaml"), "utf8");
  return new Set(
    [...yaml.matchAll(/- key: ([A-Z0-9_]+)/g)].map(match => match[1])
  );
}

describe("render.yaml", () => {
  it("finds the sources to scan", () => {
    // A broken glob would make the assertion below vacuously true.
    expect(serverSources(join(ROOT, "server")).length).toBeGreaterThan(10);
  });

  it("declares every environment variable the server reads", () => {
    const undeclared = [...envVarsRead()]
      .filter(name => !PLATFORM_PROVIDED.has(name))
      .filter(name => !WARNED_ABOUT_ONLY.has(name))
      .filter(name => !envVarsDeclared().has(name))
      .sort();

    expect(undeclared).toEqual([]);
  });

  it("keeps the build and start commands the app actually has", () => {
    const yaml = readFileSync(join(ROOT, "render.yaml"), "utf8");
    const scripts = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"))
      .scripts as Record<string, string>;

    // The Blueprint runs these by name; renaming one in package.json without
    // touching render.yaml breaks the deploy and nothing else.
    expect(yaml).toContain("pnpm build");
    expect(yaml).toContain("pnpm start");
    expect(scripts.build).toBeTruthy();
    expect(scripts.start).toBeTruthy();
  });

  it("health-checks a path the server answers without a session", () => {
    const yaml = readFileSync(join(ROOT, "render.yaml"), "utf8");
    // `/` is served by express.static, so it answers a bare health probe with
    // no Accept header — which the SPA fallback deliberately would not.
    expect(yaml).toMatch(/healthCheckPath:\s*\/\s*$/m);
  });
});
