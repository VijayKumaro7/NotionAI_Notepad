export const ENV = {
  appId: process.env.VITE_APP_ID ?? "",
  cookieSecret: process.env.JWT_SECRET ?? "",
  databaseUrl: process.env.DATABASE_URL ?? "",
  oAuthServerUrl: process.env.OAUTH_SERVER_URL ?? "",
  ownerOpenId: process.env.OWNER_OPEN_ID ?? "",
  isProduction: process.env.NODE_ENV === "production",
  forgeApiUrl: process.env.BUILT_IN_FORGE_API_URL ?? "",
  forgeApiKey: process.env.BUILT_IN_FORGE_API_KEY ?? "",
  // Cloud backup. Unset means the feature reports itself unavailable rather
  // than failing at the point of use.
  s3Bucket: process.env.S3_BUCKET ?? "",
  s3Region: process.env.S3_REGION ?? "",
  // Optional: MinIO, Cloudflare R2, or any other S3-compatible endpoint.
  s3Endpoint: process.env.S3_ENDPOINT ?? "",

  // Transactional email, for address verification and password reset. Same
  // rule as S3: unset means the feature reports itself unavailable rather than
  // half-working. See server/email.ts.
  emailApiUrl: process.env.EMAIL_API_URL ?? "",
  emailApiKey: process.env.EMAIL_API_KEY ?? "",
  emailFrom: process.env.EMAIL_FROM ?? "",

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
   */
  publicOrigin: process.env.PUBLIC_ORIGIN ?? "",
};
