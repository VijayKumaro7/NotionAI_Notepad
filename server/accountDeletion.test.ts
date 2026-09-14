import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./db", () => ({
  deleteAccountData: vi.fn(async () => ({ notes: 3, conversations: 2 })),
}));

vi.mock("./storage", () => ({
  deleteAllBackups: vi.fn(async () => 1),
}));

vi.mock("./twoFactor", () => ({
  getStatus: vi.fn(async () => ({
    enabled: false,
    pendingSetup: false,
    recoveryCodesRemaining: 0,
  })),
  verifySecondFactor: vi.fn(async () => ({ usedRecoveryCode: false })),
}));

const db = await import("./db");
const backups = await import("./storage");
const twoFactor = await import("./twoFactor");
const { hashPassword } = await import("./password");
const { accountDeleteLimiter } = await import("./rateLimit");
const {
  AccountDeletionError,
  CONFIRMATION_PHRASE,
  deleteAccount,
  requiredProof,
} = await import("./accountDeletion");

const PASSWORD = "correct horse battery staple";
const passwordHash = await hashPassword(PASSWORD);

/** Each test gets its own id so the per-account limiter starts empty. */
let nextUserId = 1;
const freshUser = (passwordHash: string | null = null) => ({
  id: nextUserId++,
  passwordHash,
});

const twoFactorOn = () =>
  vi.mocked(twoFactor.getStatus).mockResolvedValue({
    enabled: true,
    pendingSetup: false,
    recoveryCodesRemaining: 8,
  });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(db.deleteAccountData).mockResolvedValue({
    notes: 3,
    conversations: 2,
  });
  vi.mocked(backups.deleteAllBackups).mockResolvedValue(1);
  vi.mocked(twoFactor.getStatus).mockResolvedValue({
    enabled: false,
    pendingSetup: false,
    recoveryCodesRemaining: 0,
  });
});

describe("what an account is asked for", () => {
  it("asks for a code when two-step verification is on, password or not", async () => {
    twoFactorOn();

    await expect(requiredProof(freshUser(passwordHash))).resolves.toBe(
      "two_factor_code"
    );
    await expect(requiredProof(freshUser(null))).resolves.toBe(
      "two_factor_code"
    );
  });

  it("asks for the password when there is one and no second factor", async () => {
    await expect(requiredProof(freshUser(passwordHash))).resolves.toBe(
      "password"
    );
  });

  // A Google or portal account has no password to ask for. Demanding one would
  // be a door with no key rather than a second lock.
  it("asks for nothing more when the session is the only factor there is", async () => {
    await expect(requiredProof(freshUser(null))).resolves.toBe("session");
  });
});

describe("deleting", () => {
  it("erases rows and backups and reports what went", async () => {
    const user = freshUser(null);

    await expect(
      deleteAccount(user, { confirmation: CONFIRMATION_PHRASE })
    ).resolves.toEqual({ notes: 3, conversations: 2, backups: 1 });

    expect(backups.deleteAllBackups).toHaveBeenCalledWith(user.id);
    expect(db.deleteAccountData).toHaveBeenCalledWith(user.id);
  });

  // The only thing that can name an account's backups is the row that is about
  // to be deleted, so they have to go first or they can never go at all.
  it("deletes the backups before the rows that point at them", async () => {
    const order: string[] = [];
    vi.mocked(backups.deleteAllBackups).mockImplementation(async () => {
      order.push("backups");
      return 0;
    });
    vi.mocked(db.deleteAccountData).mockImplementation(async () => {
      order.push("rows");
      return { notes: 0, conversations: 0 };
    });

    await deleteAccount(freshUser(null), { confirmation: CONFIRMATION_PHRASE });

    expect(order).toEqual(["backups", "rows"]);
  });

  it("stops at a failed backup sweep, leaving the account intact", async () => {
    vi.mocked(backups.deleteAllBackups).mockRejectedValue(
      new Error("S3 unreachable")
    );

    await expect(
      deleteAccount(freshUser(null), { confirmation: CONFIRMATION_PHRASE })
    ).rejects.toThrow("S3 unreachable");
    expect(db.deleteAccountData).not.toHaveBeenCalled();
  });

  it("refuses without the phrase, and touches nothing", async () => {
    await expect(
      deleteAccount(freshUser(null), { confirmation: "delete" })
    ).rejects.toMatchObject({ reason: "not_confirmed" });

    expect(backups.deleteAllBackups).not.toHaveBeenCalled();
    expect(db.deleteAccountData).not.toHaveBeenCalled();
  });

  it("reports the store being unavailable rather than claiming success", async () => {
    vi.mocked(db.deleteAccountData).mockResolvedValue(null);

    await expect(
      deleteAccount(freshUser(null), { confirmation: CONFIRMATION_PHRASE })
    ).rejects.toMatchObject({ reason: "unavailable" });
  });

  describe("with a password on the account", () => {
    it("deletes when the password is right", async () => {
      await expect(
        deleteAccount(freshUser(passwordHash), {
          confirmation: CONFIRMATION_PHRASE,
          password: PASSWORD,
        })
      ).resolves.toMatchObject({ notes: 3 });
    });

    it("refuses a wrong password, and erases nothing", async () => {
      await expect(
        deleteAccount(freshUser(passwordHash), {
          confirmation: CONFIRMATION_PHRASE,
          password: "not the password",
        })
      ).rejects.toMatchObject({ reason: "invalid_password" });

      expect(db.deleteAccountData).not.toHaveBeenCalled();
    });

    it("refuses a missing password", async () => {
      await expect(
        deleteAccount(freshUser(passwordHash), {
          confirmation: CONFIRMATION_PHRASE,
        })
      ).rejects.toMatchObject({ reason: "invalid_password" });
    });
  });

  describe("with two-step verification on", () => {
    it("sends the code to the same check sign-in uses", async () => {
      twoFactorOn();
      const user = freshUser(passwordHash);

      await deleteAccount(user, {
        confirmation: CONFIRMATION_PHRASE,
        code: "123456",
      });

      expect(twoFactor.verifySecondFactor).toHaveBeenCalledWith(
        user.id,
        "123456"
      );
    });

    // The password is not a way around the second factor. If it were, turning
    // two-step verification on would protect everything except the button that
    // deletes it all.
    it("is not satisfied by the password instead", async () => {
      twoFactorOn();
      vi.mocked(twoFactor.verifySecondFactor).mockRejectedValue(
        new Error("wrong code")
      );

      await expect(
        deleteAccount(freshUser(passwordHash), {
          confirmation: CONFIRMATION_PHRASE,
          password: PASSWORD,
        })
      ).rejects.toThrow("wrong code");

      expect(db.deleteAccountData).not.toHaveBeenCalled();
    });
  });

  describe("rate limiting", () => {
    it("refuses once the attempts are spent, and lets a typo through free", async () => {
      const user = freshUser(passwordHash);

      // Wrong phrases are not attempts — they cost nothing.
      for (let i = 0; i < 20; i++) {
        await expect(
          deleteAccount(user, { confirmation: "nope" })
        ).rejects.toMatchObject({ reason: "not_confirmed" });
      }

      for (let i = 0; i < 5; i++) {
        await expect(
          deleteAccount(user, {
            confirmation: CONFIRMATION_PHRASE,
            password: "wrong",
          })
        ).rejects.toMatchObject({ reason: "invalid_password" });
      }

      const refused = await deleteAccount(user, {
        confirmation: CONFIRMATION_PHRASE,
        password: PASSWORD,
      }).catch((error: unknown) => error);

      expect(refused).toBeInstanceOf(AccountDeletionError);
      expect(refused).toMatchObject({ reason: "rate_limited" });
      expect(db.deleteAccountData).not.toHaveBeenCalled();

      accountDeleteLimiter.reset(`account-delete:${user.id}`);
    });
  });
});
