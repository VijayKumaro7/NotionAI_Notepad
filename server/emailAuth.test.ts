import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./email", () => ({
  isEmailConfigured: vi.fn(() => true),
  sendEmail: vi.fn(async () => undefined),
  appUrl: (path: string) => `https://notes.test${path}`,
}));

vi.mock("./db", () => {
  const state = {
    users: [] as any[],
    tokens: [] as any[],
    nextId: 1,
  };
  return {
    __state: state,
    normalizeEmail: (e: string) => e.trim().toLowerCase(),
    getUserByEmail: vi.fn(async (email: string) =>
      state.users.find(u => u.email === email.toLowerCase()) ?? null
    ),
    insertUser: vi.fn(async (user: any) => {
      if (state.users.some(u => u.email === user.email)) return null;
      const row = { ...user, id: state.nextId++, emailVerifiedAt: null };
      state.users.push(row);
      return row;
    }),
    setPasswordHash: vi.fn(async (id: number, hash: string) => {
      const u = state.users.find(x => x.id === id);
      if (u) u.passwordHash = hash;
    }),
    markEmailVerified: vi.fn(async (id: number) => {
      const u = state.users.find(x => x.id === id);
      if (u) u.emailVerifiedAt = new Date();
    }),
    touchLastSignedIn: vi.fn(async () => undefined),
    createEmailAuthToken: vi.fn(async (t: any) => {
      state.tokens.push({ ...t, consumedAt: null });
    }),
    consumeEmailAuthToken: vi.fn(async (hash: string, purpose: string) => {
      const t = state.tokens.find(
        x =>
          x.tokenHash === hash &&
          x.purpose === purpose &&
          !x.consumedAt &&
          x.expiresAt > new Date()
      );
      if (!t) return null;
      t.consumedAt = new Date();
      return t;
    }),
    invalidateEmailAuthTokens: vi.fn(async (userId: number, purpose: string) => {
      for (const t of state.tokens) {
        if (t.userId === userId && t.purpose === purpose) t.consumedAt = new Date();
      }
    }),
  };
});

import * as dbMock from "./db";
import { sendEmail } from "./email";
import {
  register,
  signIn,
  verifyEmail,
  requestPasswordReset,
  resetPassword,
  EmailAuthError,
} from "./emailAuth";

const state = (dbMock as any).__state;
const mailed = vi.mocked(sendEmail);

/** Pull the token out of whatever link the last email contained. */
const lastToken = () => {
  const body = mailed.mock.calls[mailed.mock.calls.length - 1][0].text;
  return decodeURIComponent(body.match(/token=([^\s&]+)/)![1]);
};

/**
 * A fresh origin per call. The rate limiters are module singletons shared
 * across this whole file, so tests that reuse an address start tripping each
 * other's caps — which is the limiter working, not a bug, but it is not what
 * these tests are trying to measure.
 */
let originCounter = 0;
const origin = () => `10.0.0.${++originCounter}`;

const PASSWORD = "a-sufficiently-long-password";
const SLOW = 30_000;

beforeEach(() => {
  state.users.length = 0;
  state.tokens.length = 0;
  state.nextId = 1;
  mailed.mockClear();
});

describe("register", () => {
  it("creates an unverified account and sends a confirmation link", async () => {
    await register({ email: "New@Example.test", password: PASSWORD, origin: origin() });

    expect(state.users).toHaveLength(1);
    expect(state.users[0].email).toBe("new@example.test");
    expect(state.users[0].emailVerifiedAt).toBeNull();
    expect(mailed.mock.calls[0][0].subject).toMatch(/confirm/i);
  }, SLOW);

  it("never stores the password itself", async () => {
    await register({ email: "a@example.test", password: PASSWORD, origin: origin() });
    expect(state.users[0].passwordHash).not.toContain(PASSWORD);
    expect(state.users[0].passwordHash.startsWith("scrypt$")).toBe(true);
  }, SLOW);

  it("tells the owner, not the requester, when an address is taken", async () => {
    await register({ email: "taken@example.test", password: PASSWORD, origin: origin() });
    mailed.mockClear();

    // Same result as a fresh registration — no error, nothing different to see.
    await expect(
      register({ email: "taken@example.test", password: PASSWORD, origin: origin() })
    ).resolves.toBeUndefined();

    expect(state.users).toHaveLength(1);
    const notice = mailed.mock.calls[0][0];
    expect(notice.to).toBe("taken@example.test");
    expect(notice.subject).toMatch(/tried to sign up/i);
  }, SLOW);

  it("refuses a short password", async () => {
    await expect(
      register({ email: "b@example.test", password: "short", origin: origin() })
    ).rejects.toMatchObject({ reason: "weak_password" });
    expect(state.users).toHaveLength(0);
  });
});

describe("signIn", () => {
  const setUpVerifiedAccount = async () => {
    await register({ email: "user@example.test", password: PASSWORD, origin: origin() });
    await verifyEmail(lastToken());
  };

  it("accepts the right password once the address is confirmed", async () => {
    await setUpVerifiedAccount();
    const user = await signIn({
      email: "user@example.test",
      password: PASSWORD,
      origin: origin(),
    });
    expect(user.openId.startsWith("email:")).toBe(true);
  }, SLOW);

  it("is case-insensitive about the address", async () => {
    await setUpVerifiedAccount();
    await expect(
      signIn({ email: "USER@Example.TEST", password: PASSWORD, origin: origin() })
    ).resolves.toMatchObject({ id: 1 });
  }, SLOW);

  it("refuses the wrong password", async () => {
    await setUpVerifiedAccount();
    await expect(
      signIn({ email: "user@example.test", password: "wrong-but-long-enough", origin: origin() })
    ).rejects.toMatchObject({ reason: "invalid_credentials" });
  }, SLOW);

  it("says exactly the same thing for an address that has no account", async () => {
    await setUpVerifiedAccount();

    const wrongPassword = await signIn({
      email: "user@example.test",
      password: "wrong-but-long-enough",
      origin: origin(),
    }).catch(e => e as EmailAuthError);

    const noSuchUser = await signIn({
      email: "nobody@example.test",
      password: "wrong-but-long-enough",
      origin: origin(),
    }).catch(e => e as EmailAuthError);

    // Same message and same reason: the form cannot be used to find out which
    // addresses have accounts.
    expect(noSuchUser.message).toBe(wrongPassword.message);
    expect(noSuchUser.reason).toBe(wrongPassword.reason);
  }, SLOW);

  it("still hashes when there is no account, so timing does not answer either", async () => {
    // Not a wall-clock assertion — those are flaky. This pins the mechanism:
    // a miss reaches the KDF rather than returning early, which is what makes
    // the two paths cost the same.
    const started = Date.now();
    await signIn({
      email: "nobody-at-all@example.test",
      password: "wrong-but-long-enough",
      origin: origin(),
    }).catch(() => undefined);
    // A 64MB scrypt is not instant; an early return would be.
    expect(Date.now() - started).toBeGreaterThan(50);
  }, SLOW);

  it("will not sign in an account that has not confirmed its address", async () => {
    await register({ email: "unconfirmed@example.test", password: PASSWORD, origin: origin() });

    await expect(
      signIn({ email: "unconfirmed@example.test", password: PASSWORD, origin: origin() })
    ).rejects.toMatchObject({ reason: "unverified" });
  }, SLOW);

  it("will not let a passwordless account be signed into with any password", async () => {
    // A Google-only or portal account has no passwordHash. It must fail like
    // any other bad credential, not fall through a null check.
    state.users.push({
      id: 99,
      openId: "google:abc",
      email: "google-only@example.test",
      passwordHash: null,
      emailVerifiedAt: new Date(),
      name: null,
    });

    await expect(
      signIn({ email: "google-only@example.test", password: "anything-at-all-here", origin: origin() })
    ).rejects.toMatchObject({ reason: "invalid_credentials" });
  }, SLOW);
});

describe("verifyEmail", () => {
  it("marks the address confirmed", async () => {
    await register({ email: "v@example.test", password: PASSWORD, origin: origin() });
    await verifyEmail(lastToken());
    expect(state.users[0].emailVerifiedAt).toBeInstanceOf(Date);
  }, SLOW);

  it("refuses a second use of the same link", async () => {
    await register({ email: "v2@example.test", password: PASSWORD, origin: origin() });
    const token = lastToken();
    await verifyEmail(token);

    await expect(verifyEmail(token)).rejects.toMatchObject({ reason: "invalid_token" });
  }, SLOW);

  it("refuses a token nobody issued", async () => {
    await expect(verifyEmail("made-up-token")).rejects.toMatchObject({
      reason: "invalid_token",
    });
  });

  it("stores only a hash of the token", async () => {
    await register({ email: "v3@example.test", password: PASSWORD, origin: origin() });
    const token = lastToken();

    // The row must not contain the token that was emailed: a leaked table is
    // then useless without the inbox.
    expect(state.tokens[0].tokenHash).not.toBe(token);
    expect(state.tokens[0].tokenHash).toMatch(/^[0-9a-f]{64}$/);
  }, SLOW);
});

describe("password reset", () => {
  const registerAndVerify = async (email: string) => {
    await register({ email, password: PASSWORD, origin: origin() });
    await verifyEmail(lastToken());
    mailed.mockClear();
  };

  it("sends a link for an address that has an account", async () => {
    await registerAndVerify("r@example.test");
    await requestPasswordReset({ email: "r@example.test" });
    expect(mailed.mock.calls[0][0].subject).toMatch(/reset/i);
  }, SLOW);

  it("says nothing and sends nothing for an address that does not", async () => {
    await requestPasswordReset({ email: "ghost@example.test" });
    expect(mailed).not.toHaveBeenCalled();
  });

  it("sets the new password and lets it sign in", async () => {
    await registerAndVerify("r2@example.test");
    await requestPasswordReset({ email: "r2@example.test" });

    const newPassword = "an-entirely-new-password";
    await resetPassword({ token: lastToken(), password: newPassword });

    await expect(
      signIn({ email: "r2@example.test", password: newPassword, origin: origin() })
    ).resolves.toMatchObject({ id: 1 });
    await expect(
      signIn({ email: "r2@example.test", password: PASSWORD, origin: origin() })
    ).rejects.toMatchObject({ reason: "invalid_credentials" });
  }, SLOW);

  it("retires every other outstanding reset link once one is used", async () => {
    await registerAndVerify("r3@example.test");

    await requestPasswordReset({ email: "r3@example.test" });
    const firstLink = lastToken();
    await requestPasswordReset({ email: "r3@example.test" });
    const secondLink = lastToken();

    await resetPassword({ token: secondLink, password: "brand-new-password-here" });

    // The earlier link — the one that might be sitting in an attacker's hands
    // after a mailbox compromise — is dead too.
    await expect(
      resetPassword({ token: firstLink, password: "another-new-password" })
    ).rejects.toMatchObject({ reason: "invalid_token" });
  }, SLOW);

  it("refuses a weak new password", async () => {
    await registerAndVerify("r4@example.test");
    await requestPasswordReset({ email: "r4@example.test" });

    await expect(
      resetPassword({ token: lastToken(), password: "short" })
    ).rejects.toMatchObject({ reason: "weak_password" });
  }, SLOW);

  it("counts a completed reset as confirming the address", async () => {
    // Reaching the link proves the inbox, which is the same thing the
    // confirmation link proves.
    await register({ email: "r5@example.test", password: PASSWORD, origin: origin() });
    mailed.mockClear();

    await requestPasswordReset({ email: "r5@example.test" });
    await resetPassword({ token: lastToken(), password: "yet-another-password" });

    expect(state.users[0].emailVerifiedAt).toBeInstanceOf(Date);
  }, SLOW);
});
