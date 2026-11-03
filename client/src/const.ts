export { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";

// The sign-in link goes through the server, which issues the OAuth `state`
// and keeps it in a cookie for the callback to check. Building the link here
// with a `state` derived from the origin made it a constant any site could
// reproduce, which is not a defence against a forged callback.
export const getLoginUrl = () => {
  const oauthPortalUrl = import.meta.env.VITE_OAUTH_PORTAL_URL;
  const appId = import.meta.env.VITE_APP_ID;
  if (!oauthPortalUrl || !appId) {
    console.warn(
      "[Auth] VITE_OAUTH_PORTAL_URL / VITE_APP_ID are not configured — sign-in is unavailable."
    );
    return "#";
  }

  return "/api/oauth/start";
};
