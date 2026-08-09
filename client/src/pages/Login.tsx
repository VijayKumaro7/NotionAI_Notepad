import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { toast } from "sonner";
import {
  ArrowLeft,
  KeyRound,
  Loader2,
  Lock,
  ShieldCheck,
  Smartphone,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSeparator,
  InputOTPSlot,
} from "@/components/ui/input-otp";
import { Logo } from "@/components/Logo";
import { BrandedLoader } from "@/components/BrandedLoader";
import { getLoginUrl } from "@/const";
import { trpc } from "@/lib/trpc";

/**
 * The sign-in page.
 *
 * It renders whichever step the server says this browser is on, rather than
 * keeping that in component state. Sign-in crosses an origin — off to the OAuth
 * portal and back — so any state held here is gone by the time the person
 * returns; the cookie they come back with is the only reliable record of how
 * far they got.
 *
 * The second step lives at this same URL on purpose. A dedicated /verify route
 * would be bookmarkable and shareable while meaning nothing without the cookie,
 * and would show a code prompt to people who have no code to give.
 */

const AUTH_ERROR_MESSAGES: Record<string, string> = {
  missing_code: "Sign-in was cancelled or the link expired. Please try again.",
  no_account:
    "That account is missing an ID we need. Try a different sign-in method.",
  callback_failed: "Sign-in failed. Please try again.",
};

export default function Login() {
  const [, navigate] = useLocation();
  const utils = trpc.useUtils();
  const [showRecoveryCode, setShowRecoveryCode] = useState(false);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [lockedOut, setLockedOut] = useState(false);

  const loginState = trpc.auth.loginState.useQuery(undefined, {
    retry: false,
    refetchOnWindowFocus: false,
  });

  const verify = trpc.auth.twoFactor.verifyLogin.useMutation();
  const cancel = trpc.auth.logout.useMutation();

  const status = loginState.data?.status;

  // The OAuth callback sends failures here with a reason attached, so the
  // person lands somewhere they can act on rather than on a blank page.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const reason = params.get("auth_error");
    if (!reason) return;

    toast.error(
      AUTH_ERROR_MESSAGES[reason] ?? AUTH_ERROR_MESSAGES.callback_failed
    );

    params.delete("auth_error");
    const query = params.toString();
    window.history.replaceState({}, "", `/login${query ? `?${query}` : ""}`);
  }, []);

  // Nothing to do here once signed in, and arriving on a sign-in page while
  // already signed in is usually a stale tab or a back button.
  useEffect(() => {
    if (status === "signed_in") navigate("/app");
  }, [status, navigate]);

  const handleSignIn = () => {
    const url = getLoginUrl();
    if (url === "#") {
      toast.error("Sign-in is not configured on this deployment.");
      return;
    }
    window.location.href = url;
  };

  const handleVerify = async (submitted: string) => {
    setError(null);

    try {
      const result = await verify.mutateAsync({ code: submitted });

      if (result.usedRecoveryCode) {
        toast.success(
          result.recoveryCodesRemaining > 0
            ? `Recovery code used. ${result.recoveryCodesRemaining} left.`
            : "That was your last recovery code. Set up a new device soon."
        );
      }

      // A full page load, not navigate("/app").
      //
      // The cookie has just been replaced with a real session, but nothing in
      // this tab knows that yet: auth.me still holds the null it cached while
      // the session was pending. The /app route reads exactly that value, so a
      // client-side navigation reaches the guard before the new state does,
      // the guard sees "not signed in", and it redirects to the landing page —
      // a correct code depositing you on the marketing site.
      //
      // Observed against a real server, not theorised: verifyLogin 200 ->
      // NAV /app -> NAV / -> and only then the auth.me refetch returning the
      // user. Awaiting an invalidate first does not reliably close that
      // window, because the refetch is issued after the navigation has already
      // been decided.
      //
      // Reloading re-runs auth from scratch against the new cookie, which is
      // also what the OAuth callback does when it redirects to /app.
      window.location.href = "/app";
    } catch (caught) {
      const message =
        caught instanceof Error ? caught.message : "That code is not right.";
      setError(message);
      setLockedOut(/too many attempts/i.test(message));
      setCode("");
    }
  };

  const handleCancel = async () => {
    // Clears the half-signed-in cookie. Leaving it would strand the next person
    // at this computer on a code prompt for an account that is not theirs.
    await cancel.mutateAsync().catch(() => undefined);
    await utils.auth.loginState.invalidate();
    setCode("");
    setError(null);
    setLockedOut(false);
    setShowRecoveryCode(false);
  };

  if (loginState.isLoading) {
    return <BrandedLoader />;
  }

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <header className="p-6">
        <button
          onClick={() => navigate("/")}
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to home
        </button>
      </header>

      <main className="flex-1 flex items-start justify-center px-4 pb-16">
        <div className="w-full max-w-md space-y-8">
          <div className="flex flex-col items-center gap-4 text-center">
            <Logo size="lg" />
            <div className="space-y-1">
              <h1 className="text-2xl font-semibold text-foreground">
                {status === "pending_2fa"
                  ? "One more step"
                  : "Sign in to Notepad AI"}
              </h1>
              <p className="text-sm text-muted-foreground">
                {status === "pending_2fa"
                  ? `Enter the code from your authenticator app to finish signing in${
                      loginState.data?.name ? ` as ${loginState.data.name}` : ""
                    }.`
                  : "Your notes are encrypted in this browser before they are stored anywhere."}
              </p>
            </div>
          </div>

          {status === "pending_2fa" ? (
            <div className="space-y-6 rounded-xl border border-border bg-card p-6">
              {showRecoveryCode ? (
                <form
                  className="space-y-3"
                  onSubmit={event => {
                    event.preventDefault();
                    if (code.trim()) handleVerify(code.trim());
                  }}
                >
                  <label
                    htmlFor="recovery-code"
                    className="text-sm font-medium text-foreground"
                  >
                    Recovery code
                  </label>
                  <Input
                    id="recovery-code"
                    autoFocus
                    autoComplete="one-time-code"
                    placeholder="abcde-fghjk"
                    value={code}
                    disabled={verify.isPending || lockedOut}
                    onChange={event => setCode(event.target.value)}
                  />
                  <Button
                    type="submit"
                    className="w-full"
                    disabled={verify.isPending || lockedOut || !code.trim()}
                  >
                    {verify.isPending && (
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    )}
                    Verify
                  </Button>
                </form>
              ) : (
                <div className="flex flex-col items-center gap-4">
                  <InputOTP
                    maxLength={6}
                    value={code}
                    autoFocus
                    disabled={verify.isPending || lockedOut}
                    onChange={setCode}
                    // Six digits is the whole input, so waiting for a button
                    // press only adds a step. Submitting on completion is what
                    // every authenticator flow does.
                    onComplete={handleVerify}
                  >
                    <InputOTPGroup>
                      {[0, 1, 2].map(index => (
                        <InputOTPSlot
                          key={index}
                          index={index}
                          className="h-12 w-11 text-lg"
                        />
                      ))}
                    </InputOTPGroup>
                    <InputOTPSeparator />
                    <InputOTPGroup>
                      {[3, 4, 5].map(index => (
                        <InputOTPSlot
                          key={index}
                          index={index}
                          className="h-12 w-11 text-lg"
                        />
                      ))}
                    </InputOTPGroup>
                  </InputOTP>

                  {verify.isPending && (
                    <p className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Checking
                    </p>
                  )}
                </div>
              )}

              {error && (
                <p
                  role="alert"
                  className="text-sm text-destructive text-center"
                >
                  {error}
                </p>
              )}

              <div className="flex flex-col gap-2 pt-2 border-t border-border">
                <button
                  onClick={() => {
                    setShowRecoveryCode(!showRecoveryCode);
                    setCode("");
                    setError(null);
                  }}
                  className="text-sm text-primary hover:underline"
                >
                  {showRecoveryCode
                    ? "Use a code from your authenticator app"
                    : "Lost your phone? Use a recovery code"}
                </button>
                <button
                  onClick={handleCancel}
                  disabled={cancel.isPending}
                  className="text-sm text-muted-foreground hover:text-foreground"
                >
                  Cancel and sign in as someone else
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <Button size="lg" className="w-full" onClick={handleSignIn}>
                Continue to sign in
              </Button>
              <p className="text-xs text-center text-muted-foreground">
                You will be sent to our sign-in portal and brought straight
                back.
              </p>
            </div>
          )}

          <ul className="space-y-3 text-sm text-muted-foreground">
            <li className="flex gap-3">
              <Lock className="w-4 h-4 mt-0.5 shrink-0 text-primary" />
              <span>
                Notes are encrypted in your browser. The server stores the
                result and cannot read it.
              </span>
            </li>
            <li className="flex gap-3">
              <ShieldCheck className="w-4 h-4 mt-0.5 shrink-0 text-primary" />
              <span>
                Two-step verification is available once you are in, under
                Security.
              </span>
            </li>
            <li className="flex gap-3">
              <Smartphone className="w-4 h-4 mt-0.5 shrink-0 text-primary" />
              <span>No analytics, no telemetry, no third-party tracking.</span>
            </li>
          </ul>

          {status !== "pending_2fa" && (
            <p className="text-center text-sm text-muted-foreground">
              Just looking?{" "}
              <button
                onClick={() => navigate("/")}
                className="text-primary hover:underline inline-flex items-center gap-1"
              >
                <KeyRound className="w-3.5 h-3.5" />
                Try it for 30 minutes without an account
              </button>
            </p>
          )}
        </div>
      </main>
    </div>
  );
}
