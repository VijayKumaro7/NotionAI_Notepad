import { AXIOS_TIMEOUT_MS, COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";
import { ForbiddenError } from "@shared/_core/errors";
import axios, { type AxiosInstance } from "axios";
import { parse as parseCookie } from "cookie";
import type { Request } from "express";
import { SignJWT, jwtVerify } from "jose";
import type { User } from "../../drizzle/schema";
import * as db from "../db";
import { ENV } from "./env";
import { checkSession } from "../sessionStore";
import type {
  ExchangeTokenRequest,
  ExchangeTokenResponse,
  GetUserInfoResponse,
  GetUserInfoWithJwtRequest,
  GetUserInfoWithJwtResponse,
} from "./types/manusTypes";
// Utility function
const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0;

/**
 * How far a session token gets you.
 *
 * `full` is an ordinary signed-in session. `pending_2fa` says the first factor
 * passed and nothing else — it is issued between the OAuth callback and the
 * code being entered, and authenticateRequest refuses it, so it cannot reach a
 * single protected procedure. Without this split the only way to remember "this
 * person is halfway through signing in" would be a session that already works,
 * which is the whole thing two-step verification is meant to prevent.
 *
 * Tokens issued before this existed carry no scope and are read as `full`.
 * Treating them as pending instead would have signed out everyone with a live
 * cookie the moment this deployed.
 */
export type SessionScope = "full" | "pending_2fa";

export type SessionPayload = {
  openId: string;
  appId: string;
  name: string;
  scope?: SessionScope;
  /**
   * Names the row in `userSessions` that decides whether this token still
   * stands for anything. See server/sessionStore.ts.
   *
   * Optional in the type and required in effect: authenticateRequest refuses a
   * token without one. It has to be optional here because the claim is written
   * by whoever mints the token, and the pending-session reader needs to parse a
   * token before it knows whether the claim is there.
   */
  sid?: string;
};

export type VerifiedSession = {
  openId: string;
  appId: string;
  name: string;
  scope: SessionScope;
  sid: string | null;
};

/**
 * How long the half-signed-in state lasts. Long enough to fetch a phone from
 * another room, short enough that an abandoned attempt on a shared computer is
 * not still waiting for someone else to finish.
 */
export const PENDING_SESSION_MS = 10 * 60 * 1000;

const EXCHANGE_TOKEN_PATH = `/webdev.v1.WebDevAuthPublicService/ExchangeToken`;
const GET_USER_INFO_PATH = `/webdev.v1.WebDevAuthPublicService/GetUserInfo`;
const GET_USER_INFO_WITH_JWT_PATH = `/webdev.v1.WebDevAuthPublicService/GetUserInfoWithJwt`;

class OAuthService {
  constructor(private client: ReturnType<typeof axios.create>) {
    console.log("[OAuth] Initialized with baseURL:", ENV.oAuthServerUrl);
    if (!ENV.oAuthServerUrl) {
      console.error(
        "[OAuth] ERROR: OAUTH_SERVER_URL is not configured! Set OAUTH_SERVER_URL environment variable."
      );
    }
  }

  private decodeState(state: string): string {
    const redirectUri = atob(state);
    return redirectUri;
  }

  async getTokenByCode(
    code: string,
    state: string
  ): Promise<ExchangeTokenResponse> {
    const payload: ExchangeTokenRequest = {
      clientId: ENV.appId,
      grantType: "authorization_code",
      code,
      redirectUri: this.decodeState(state),
    };

    const { data } = await this.client.post<ExchangeTokenResponse>(
      EXCHANGE_TOKEN_PATH,
      payload
    );

    return data;
  }

  async getUserInfoByToken(
    token: ExchangeTokenResponse
  ): Promise<GetUserInfoResponse> {
    const { data } = await this.client.post<GetUserInfoResponse>(
      GET_USER_INFO_PATH,
      {
        accessToken: token.accessToken,
      }
    );

    return data;
  }
}

const createOAuthHttpClient = (): AxiosInstance =>
  axios.create({
    baseURL: ENV.oAuthServerUrl,
    timeout: AXIOS_TIMEOUT_MS,
  });

class SDKServer {
  private readonly client: AxiosInstance;
  private readonly oauthService: OAuthService;

  constructor(client: AxiosInstance = createOAuthHttpClient()) {
    this.client = client;
    this.oauthService = new OAuthService(this.client);
  }

  private deriveLoginMethod(
    platforms: unknown,
    fallback: string | null | undefined
  ): string | null {
    if (fallback && fallback.length > 0) return fallback;
    if (!Array.isArray(platforms) || platforms.length === 0) return null;
    const set = new Set<string>(
      platforms.filter((p): p is string => typeof p === "string")
    );
    if (set.has("REGISTERED_PLATFORM_EMAIL")) return "email";
    if (set.has("REGISTERED_PLATFORM_GOOGLE")) return "google";
    if (set.has("REGISTERED_PLATFORM_APPLE")) return "apple";
    if (
      set.has("REGISTERED_PLATFORM_MICROSOFT") ||
      set.has("REGISTERED_PLATFORM_AZURE")
    )
      return "microsoft";
    if (set.has("REGISTERED_PLATFORM_GITHUB")) return "github";
    const first = Array.from(set)[0];
    return first ? first.toLowerCase() : null;
  }

  /**
   * Exchange OAuth authorization code for access token
   * @example
   * const tokenResponse = await sdk.exchangeCodeForToken(code, state);
   */
  async exchangeCodeForToken(
    code: string,
    state: string
  ): Promise<ExchangeTokenResponse> {
    return this.oauthService.getTokenByCode(code, state);
  }

  /**
   * Get user information using access token
   * @example
   * const userInfo = await sdk.getUserInfo(tokenResponse.accessToken);
   */
  async getUserInfo(accessToken: string): Promise<GetUserInfoResponse> {
    const data = await this.oauthService.getUserInfoByToken({
      accessToken,
    } as ExchangeTokenResponse);
    const loginMethod = this.deriveLoginMethod(
      (data as any)?.platforms,
      (data as any)?.platform ?? data.platform ?? null
    );
    return {
      ...(data as any),
      platform: loginMethod,
      loginMethod,
    } as GetUserInfoResponse;
  }

  private parseCookies(cookieHeader: string | undefined) {
    if (!cookieHeader) {
      return new Map<string, string>();
    }

    const parsed = parseCookie(cookieHeader);
    return new Map(Object.entries(parsed));
  }

  private getSessionSecret() {
    const secret = ENV.cookieSecret;
    return new TextEncoder().encode(secret);
  }

  /**
   * Create a session token for a Manus user openId
   * @example
   * const sessionToken = await sdk.createSessionToken(userInfo.openId);
   */
  async createSessionToken(
    openId: string,
    options: {
      expiresInMs?: number;
      name?: string;
      scope?: SessionScope;
      sid?: string;
    } = {}
  ): Promise<string> {
    return this.signSession(
      {
        openId,
        appId: ENV.appId,
        name: options.name || "",
        scope: options.scope,
        sid: options.sid,
      },
      options
    );
  }

  async signSession(
    payload: SessionPayload,
    options: { expiresInMs?: number } = {}
  ): Promise<string> {
    const issuedAt = Date.now();
    const expiresInMs = options.expiresInMs ?? ONE_YEAR_MS;
    const expirationSeconds = Math.floor((issuedAt + expiresInMs) / 1000);
    const secretKey = this.getSessionSecret();

    return new SignJWT({
      openId: payload.openId,
      appId: payload.appId,
      name: payload.name,
      scope: payload.scope ?? "full",
      ...(payload.sid ? { sid: payload.sid } : {}),
    })
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .setExpirationTime(expirationSeconds)
      .sign(secretKey);
  }

  async verifySession(
    cookieValue: string | undefined | null
  ): Promise<VerifiedSession | null> {
    if (!cookieValue) {
      console.warn("[Auth] Missing session cookie");
      return null;
    }

    try {
      const secretKey = this.getSessionSecret();
      const { payload } = await jwtVerify(cookieValue, secretKey, {
        algorithms: ["HS256"],
      });
      const { openId, appId, name, scope, sid } = payload as Record<
        string,
        unknown
      >;

      if (
        !isNonEmptyString(openId) ||
        !isNonEmptyString(appId) ||
        !isNonEmptyString(name)
      ) {
        console.warn("[Auth] Session payload missing required fields");
        return null;
      }

      // An unrecognised scope is treated as pending rather than full. A token
      // whose claims we cannot read should get less access, not more.
      const resolvedScope: SessionScope =
        scope === undefined || scope === "full" ? "full" : "pending_2fa";

      return {
        openId,
        appId,
        name,
        scope: resolvedScope,
        sid: isNonEmptyString(sid) ? sid : null,
      };
    } catch (error) {
      console.warn("[Auth] Session verification failed", String(error));
      return null;
    }
  }

  /** The session cookie's value, whatever scope it carries. */
  readSessionCookie(req: Request): string | undefined {
    return this.parseCookies(req.headers.cookie).get(COOKIE_NAME);
  }

  /**
   * The half-signed-in session, if that is what the cookie holds.
   *
   * The /login page needs to know whose code it is asking for without that
   * knowledge being an authenticated session. Returns null for a full session
   * too — a signed-in person has no second step left to take.
   */
  async readPendingSession(
    req: Request
  ): Promise<{ openId: string; name: string; sid: string } | null> {
    const session = await this.verifySession(this.readSessionCookie(req));
    if (!session || session.scope !== "pending_2fa" || !session.sid) {
      return null;
    }

    // A half-signed-in session is a row like any other, so it can be revoked
    // like any other — and it must be checked like any other, or "cancel this
    // sign-in attempt" would leave the attempt able to finish.
    const check = await checkSession(session.sid);
    if (!check.ok || check.scope !== "pending_2fa") return null;

    return { openId: session.openId, name: session.name, sid: session.sid };
  }

  async getUserInfoWithJwt(
    jwtToken: string
  ): Promise<GetUserInfoWithJwtResponse> {
    const payload: GetUserInfoWithJwtRequest = {
      jwtToken,
      projectId: ENV.appId,
    };

    const { data } = await this.client.post<GetUserInfoWithJwtResponse>(
      GET_USER_INFO_WITH_JWT_PATH,
      payload
    );

    const loginMethod = this.deriveLoginMethod(
      (data as any)?.platforms,
      (data as any)?.platform ?? data.platform ?? null
    );
    return {
      ...(data as any),
      platform: loginMethod,
      loginMethod,
    } as GetUserInfoWithJwtResponse;
  }

  /**
   * Who is calling, or nobody.
   *
   * Three gates, cheapest first, and the order is the point: a forged cookie is
   * rejected by the signature without a database round trip, so an unauthenticated
   * flood cannot turn itself into a query load.
   *
   *   1. the signature — this token came from us and has not been edited
   *   2. the scope     — the second factor is done, not merely started
   *   3. the row       — the session has not been revoked, expired or idled out
   *
   * Gate 3 is the one that is new, and it is why a token without a `sid` is
   * refused outright rather than waved through: a token that names no session
   * is a token nothing can revoke, which is exactly the shape of cookie this
   * change exists to stop honouring. Sessions minted before the store existed
   * therefore stop working, and the people holding them sign in again.
   */
  async authenticateRequest(req: Request): Promise<User> {
    const cookies = this.parseCookies(req.headers.cookie);
    const sessionCookie = cookies.get(COOKIE_NAME);
    const session = await this.verifySession(sessionCookie);

    if (!session) {
      throw ForbiddenError("Invalid session cookie");
    }

    // The single line that makes two-step verification mean anything. Every
    // protected procedure reaches the user through here, so a token that has
    // only cleared the first factor stops at this check rather than at each
    // call site remembering to look.
    if (session.scope !== "full") {
      throw ForbiddenError("Two-step verification is not complete");
    }

    if (!session.sid) {
      throw ForbiddenError("Session cannot be verified");
    }

    const check = await checkSession(session.sid);
    if (!check.ok) {
      throw ForbiddenError("Session is no longer valid");
    }

    // The scope is asserted twice on purpose. The claim in the cookie says what
    // the session was when it was minted; the row says what it is now. Reading
    // only the cookie would mean a session promoted or demoted since then is
    // judged on stale information, and the row is the copy an attacker cannot
    // hold a snapshot of.
    if (check.scope !== "full") {
      throw ForbiddenError("Two-step verification is not complete");
    }

    // By id, from the session row — not by the openId in the cookie. They agree
    // today, and making the row the authority means they cannot disagree
    // tomorrow: whoever the session was created for is who it authenticates.
    const user = await db.getUserById(check.userId);

    if (!user) {
      // The account was deleted while a session was live. Nothing to sync and
      // nothing to sign in as.
      throw ForbiddenError("User not found");
    }

    await db.upsertUser({
      openId: user.openId,
      lastSignedIn: new Date(),
    });

    return user;
  }
}

export const sdk = new SDKServer();
