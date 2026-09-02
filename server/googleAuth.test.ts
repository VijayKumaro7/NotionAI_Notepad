import { describe, it, expect, vi, beforeEach } from "vitest";

const ENV = vi.hoisted(() => ({
  googleClientId: "client-id.apps.googleusercontent.com",
  googleClientSecret: "client-secret",
  publicOrigin: "https://notes.example.test",
}));

vi.mock("./_core/env", () => ({ ENV }));

import {
  authorizeUrl,
  codeChallenge,
  createFlowSecrets,
  isGoogleConfigured,
  openFlow,
  redirectUri,
  resolveGoogleAccount,
  sameSecret,
  sealFlow,
  GoogleAuthError,
  type GoogleIdentity,
} from "./googleAuth";
import { createHash } from "crypto";

const KEY = new TextEncoder().encode("a-test-signing-secret-long-enough");

describe("configuration", () => {
  it("is configured when id, secret and origin are all present", () => {
    expect(isGoogleConfigured()).toBe(true);
  });

  it("builds a fixed redirect_uri from PUBLIC_ORIGIN", () => {
    // Never from a request header — an attacker-chosen Host would otherwise
    // become the redirect target we hand Google.
    expect(redirectUri()).toBe(
      "https://notes.example.test/api/auth/google/callback"
    );
  });
});

describe("authorizeUrl", () => {
  it("carries state, nonce and an S256 challenge", () => {
    const secrets = createFlowSecrets();
    const url = new URL(authorizeUrl(secrets));

    expect(url.origin + url.pathname).toBe(
      "https://accounts.google.com/o/oauth2/v2/auth"
    );
    expect(url.searchParams.get("state")).toBe(secrets.state);
    expect(url.searchParams.get("nonce")).toBe(secrets.nonce);
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("response_type")).toBe("code");
  });

  it("sends the hash of the verifier, never the verifier", () => {
    const secrets = createFlowSecrets();
    const url = new URL(authorizeUrl(secrets));
    const challenge = url.searchParams.get("code_challenge")!;

    expect(challenge).not.toBe(secrets.codeVerifier);
    expect(challenge).toBe(
      createHash("sha256").update(secrets.codeVerifier).digest("base64url")
    );
  });

  it("never puts the client secret in the redirect", () => {
    const url = authorizeUrl(createFlowSecrets());
    expect(url).not.toContain(ENV.googleClientSecret);
  });
});

describe("flow secrets", () => {
  it("are different every time", () => {
    const a = createFlowSecrets();
    const b = createFlowSecrets();
    expect(a.state).not.toBe(b.state);
    expect(a.nonce).not.toBe(b.nonce);
    expect(a.codeVerifier).not.toBe(b.codeVerifier);
  });

  it("produce a verifier long enough for RFC 7636", () => {
    expect(createFlowSecrets().codeVerifier.length).toBeGreaterThanOrEqual(43);
  });

  it("round-trip through the sealed cookie", async () => {
    const secrets = createFlowSecrets();
    const sealed = await sealFlow(secrets, KEY);
    await expect(openFlow(sealed, KEY)).resolves.toEqual(secrets);
  });

  it("refuse a cookie signed with another key", async () => {
    const sealed = await sealFlow(createFlowSecrets(), KEY);
    const otherKey = new TextEncoder().encode("a-different-secret-entirely-ok");

    await expect(openFlow(sealed, otherKey)).rejects.toMatchObject({
      reason: "bad_state",
    });
  });

  it("refuse a missing cookie, so a callback cannot be replayed cold", async () => {
    await expect(openFlow(undefined, KEY)).rejects.toMatchObject({
      reason: "bad_state",
    });
  });

  it("refuse a tampered cookie", async () => {
    const sealed = await sealFlow(createFlowSecrets(), KEY);
    const tampered = sealed.slice(0, -4) + "AAAA";
    await expect(openFlow(tampered, KEY)).rejects.toBeInstanceOf(
      GoogleAuthError
    );
  });
});

describe("sameSecret", () => {
  it("matches identical values", () => {
    expect(sameSecret("abc123", "abc123")).toBe(true);
  });

  it("rejects different values", () => {
    expect(sameSecret("abc123", "abc124")).toBe(false);
  });

  it("rejects different lengths without throwing", () => {
    // timingSafeEqual throws on a length mismatch; the guard has to come first.
    expect(sameSecret("short", "a-much-longer-value")).toBe(false);
  });
});

describe("codeChallenge", () => {
  it("matches the RFC 7636 S256 example", () => {
    // The worked example from the spec, so this pins the encoding rather than
    // just agreeing with itself.
    expect(codeChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe(
      "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
    );
  });
});

describe("resolveGoogleAccount", () => {
  const identity: GoogleIdentity = {
    sub: "google-sub-123",
    email: "person@example.test",
    emailVerified: true,
    name: "A Person",
  };

  let store: any;

  beforeEach(() => {
    store = {
      getUserByGoogleSub: vi.fn(async () => null),
      getUserByEmail: vi.fn(async () => null),
      linkGoogleSub: vi.fn(async () => true),
      claimAccountForGoogle: vi.fn(async () => true),
      insertUser: vi.fn(async (u: any) => ({
        id: 7,
        openId: u.openId,
        name: u.name,
      })),
      touchLastSignedIn: vi.fn(async () => undefined),
    };
  });

  it("matches an existing account on sub, not email", async () => {
    store.getUserByGoogleSub.mockResolvedValue({
      id: 1,
      openId: "google:google-sub-123",
      name: "A",
    });

    const user = await resolveGoogleAccount(identity, store);

    expect(user.id).toBe(1);
    // Email is never consulted once sub matched: an address that moved to a
    // different person must not drag the account with it.
    expect(store.getUserByEmail).not.toHaveBeenCalled();
  });

  it("links to an account whose address was already verified", async () => {
    store.getUserByEmail.mockResolvedValue({
      id: 2,
      openId: "email:abc",
      name: "B",
      emailVerifiedAt: new Date(),
    });

    const user = await resolveGoogleAccount(identity, store);

    expect(user.id).toBe(2);
    expect(store.linkGoogleSub).toHaveBeenCalledWith(2, "google-sub-123");
    expect(store.claimAccountForGoogle).not.toHaveBeenCalled();
  });

  it("claims an account whose address was never verified, clearing its password", async () => {
    // The squatting case: someone registered this address and never proved it.
    // Linking as-is would leave their password working on the real owner's
    // account, so the account is claimed instead.
    store.getUserByEmail.mockResolvedValue({
      id: 3,
      openId: "email:squatter",
      name: null,
      emailVerifiedAt: null,
    });

    const user = await resolveGoogleAccount(identity, store);

    expect(user.id).toBe(3);
    expect(store.claimAccountForGoogle).toHaveBeenCalledWith(
      3,
      "google-sub-123"
    );
    expect(store.linkGoogleSub).not.toHaveBeenCalled();
  });

  it("refuses when the account already belongs to a different Google identity", async () => {
    // linkGoogleSub is conditional on the account having no googleSub yet, so
    // it reports false when one is already attached. Ignoring that and signing
    // in anyway hands a second Google identity the first one's account.
    store.getUserByEmail.mockResolvedValue({
      id: 4,
      openId: "google:the-original",
      name: "Original owner",
      emailVerifiedAt: new Date(),
    });
    store.linkGoogleSub.mockResolvedValue(false);

    const refusal = resolveGoogleAccount(identity, store);

    await expect(refusal).rejects.toBeInstanceOf(GoogleAuthError);
    // The reason, not just the type: the sign-in page turns it into what the
    // person reads, and "start again" — which is what bad_state means, and
    // what this used to send — is advice that cannot work here.
    await expect(refusal).rejects.toMatchObject({ reason: "already_linked" });
    expect(store.touchLastSignedIn).not.toHaveBeenCalled();
  });

  it("refuses when claiming an unverified account does not apply", async () => {
    store.getUserByEmail.mockResolvedValue({
      id: 5,
      openId: "email:squatter",
      name: null,
      emailVerifiedAt: null,
    });
    store.claimAccountForGoogle.mockResolvedValue(false);

    const refusal = resolveGoogleAccount(identity, store);

    await expect(refusal).rejects.toBeInstanceOf(GoogleAuthError);
    await expect(refusal).rejects.toMatchObject({ reason: "already_linked" });
    expect(store.touchLastSignedIn).not.toHaveBeenCalled();
  });

  it("creates a new account when nothing matches", async () => {
    const user = await resolveGoogleAccount(identity, store);

    expect(user.openId).toBe("google:google-sub-123");
    const created = store.insertUser.mock.calls[0][0];
    expect(created.googleSub).toBe("google-sub-123");
    expect(created.emailVerifiedAt).toBeInstanceOf(Date);
    // Nothing to sign in with by password until one is deliberately set.
    expect(created.passwordHash).toBeUndefined();
  });

  it("reads back the winner when a simultaneous first sign-in wins the insert", async () => {
    store.insertUser.mockResolvedValue(null);
    store.getUserByGoogleSub.mockResolvedValueOnce(null).mockResolvedValueOnce({
      id: 9,
      openId: "google:google-sub-123",
      name: null,
    });

    await expect(resolveGoogleAccount(identity, store)).resolves.toMatchObject({
      id: 9,
    });
  });
});
