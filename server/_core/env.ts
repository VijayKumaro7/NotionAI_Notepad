export const ENV = {
  port: process.env.PORT ?? "",
  nodeEnv: process.env.NODE_ENV ?? "",
  proxyHops: process.env.TRUSTED_PROXY_HOPS ?? "",
  webConcurrency: process.env.WEB_CONCURRENCY ?? "",
  nodeAppInstance: process.env.NODE_APP_INSTANCE ?? "",
  // Read by libraries, not by us: axios (portal sign-in) takes the lower-case
  // name before the upper-case one, and Node's fetch reads them only when
  // NODE_USE_ENV_PROXY is exactly "1". Kept so startupChecks can say which of
  // our outbound calls would follow them.
  httpProxy: process.env.http_proxy || process.env.HTTP_PROXY || "",
  httpsProxy: process.env.https_proxy || process.env.HTTPS_PROXY || "",
  nodeUseEnvProxy: process.env.NODE_USE_ENV_PROXY ?? "",
  // axios only: Node's fetch ignores it even with NODE_USE_ENV_PROXY=1.
  allProxy: process.env.all_proxy || process.env.ALL_PROXY || "",
  // Both stacks read it; axios takes the lower-case name first. Which wins in
  // Node's fetch when both are set was not tested.
  noProxy: process.env.no_proxy || process.env.NO_PROXY || "",
  demoLimitSalt: process.env.DEMO_LIMIT_SALT ?? "",
  appId: process.env.VITE_APP_ID ?? "",
  cookieSecret: process.env.JWT_SECRET ?? "",
  databaseUrl: process.env.DATABASE_URL ?? "",
  oAuthServerUrl: process.env.OAUTH_SERVER_URL ?? "",
  // Read by the client at build time, never by the server; kept so startupChecks
  // can judge it where the build and the runtime share an environment.
  oauthPortalUrl: process.env.VITE_OAUTH_PORTAL_URL ?? "",
  ownerOpenId: process.env.OWNER_OPEN_ID ?? "",
  isProduction: process.env.NODE_ENV === "production",
  forgeApiUrl: process.env.BUILT_IN_FORGE_API_URL ?? "",
  forgeApiKey: process.env.BUILT_IN_FORGE_API_KEY ?? "",
  // Which models to ask that endpoint for. Optional, like the URL: unset means
  // the defaults in server/_core/forge.ts. They matter once BUILT_IN_FORGE_API_URL
  // points somewhere else, because a different provider has different names and
  // the endpoint alone was not enough to move.
  // Names only, never values: this is what the credential-name check reads.
  // Vite exposes exactly the variables starting with "VITE_", case-sensitively.
  viteVariableNames: Object.keys(process.env).filter(name =>
    name.startsWith("VITE_")
  ),
  forgeModel: process.env.BUILT_IN_FORGE_MODEL ?? "",
  forgeTranscriptionModel: process.env.BUILT_IN_FORGE_TRANSCRIPTION_MODEL ?? "",
  // Cloud backup. Unset means the feature reports itself unavailable rather
  // than failing at the point of use.
  s3Bucket: process.env.S3_BUCKET ?? "",
  s3Region: process.env.S3_REGION ?? "",
  // Optional: MinIO, Cloudflare R2, or any other S3-compatible endpoint.
  s3Endpoint: process.env.S3_ENDPOINT ?? "",
  // Nothing reads these: the SDK takes credentials from AWS_ACCESS_KEY_ID and
  // AWS_SECRET_ACCESS_KEY. They are here only so startup can say so.
  s3AccessKeyId: process.env.S3_ACCESS_KEY_ID ?? "",
  s3SecretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? "",
  // The names the SDK does read. Held here only so startup can check them; the
  // client in storage.ts is still built without credentials.
  awsAccessKeyId: process.env.AWS_ACCESS_KEY_ID ?? "",
  awsSecretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? "",
  awsSessionToken: process.env.AWS_SESSION_TOKEN ?? "",
  // Not read by the backup client, which is built with an explicit region; kept
  // so startupChecks can say so when it is set to something the client ignores.
  awsRegion: process.env.AWS_REGION ?? "",
  // Read by the AWS SDK's credential chain, not by us; kept so startupChecks can
  // say what it does to the key pair above.
  awsProfile: process.env.AWS_PROFILE ?? "",
  awsUseFipsEndpoint: process.env.AWS_USE_FIPS_ENDPOINT ?? "",
  awsUseDualstackEndpoint: process.env.AWS_USE_DUALSTACK_ENDPOINT ?? "",
  awsEndpointUrl: process.env.AWS_ENDPOINT_URL ?? "",
  awsEndpointUrlS3: process.env.AWS_ENDPOINT_URL_S3 ?? "",
  awsIgnoreEndpointUrls: process.env.AWS_IGNORE_CONFIGURED_ENDPOINT_URLS ?? "",
  awsEc2MetadataDisabled: process.env.AWS_EC2_METADATA_DISABLED ?? "",
  // Either one stops the SDK asking the instance metadata service at all, so
  // it is read the way the SDK reads it: truthiness, relative first.
  awsContainerCredentialsUri:
    process.env.AWS_CONTAINER_CREDENTIALS_RELATIVE_URI ||
    process.env.AWS_CONTAINER_CREDENTIALS_FULL_URI ||
    "",

  // Transactional email, for address verification and password reset. Same
  // rule as S3: unset means the feature reports itself unavailable rather than
  // half-working. See server/email.ts.
  emailApiUrl: process.env.EMAIL_API_URL ?? "",
  emailApiKey: process.env.EMAIL_API_KEY ?? "",
  emailFrom: process.env.EMAIL_FROM ?? "",

  /**
   * reCAPTCHA. The site key is public and is served to the browser at runtime
   * by auth.methods; the secret never leaves the server. Neither gets a VITE_
   * prefix — see server/recaptcha.ts for why even the public one does not.
   */
  recaptchaSiteKey: process.env.RECAPTCHA_SITE_KEY ?? "",
  recaptchaSecretKey: process.env.RECAPTCHA_SECRET_KEY ?? "",

  // Google sign-in. The secret is server-side only and must never be given a
  // VITE_ prefix — see client/src/lib/clientSecrets.test.ts for the guard.
  googleClientId: process.env.GOOGLE_CLIENT_ID ?? "",
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",

  /**
   * Absolute origin this app is served from, e.g. https://notes.example.com.
   *
   * Needed because two things must not be built from a request header:
   * the Google redirect_uri, and the links inside verification and reset
   * email. Host headers are attacker-controlled, and a reset link built from
   * one is a password reset delivered to someone else's server.
   *
   * RENDER_EXTERNAL_URL is the platform's own answer to the same question and
   * is set for every Render web service, so a Blueprint deploy works without
   * anyone having to paste back a URL that does not exist until the service
   * does. It is an environment variable set by the host, not a request header,
   * which is what makes it safe to trust here. An explicit PUBLIC_ORIGIN still
   * wins — a custom domain is exactly the case where the two differ.
   */
  publicOrigin:
    process.env.PUBLIC_ORIGIN ?? process.env.RENDER_EXTERNAL_URL ?? "",
  /** Which variable `publicOrigin` was read from, so a warning can name it. */
  publicOriginVar: (process.env.PUBLIC_ORIGIN === undefined &&
  process.env.RENDER_EXTERNAL_URL !== undefined
    ? "RENDER_EXTERNAL_URL"
    : "PUBLIC_ORIGIN") as "PUBLIC_ORIGIN" | "RENDER_EXTERNAL_URL",
};
