import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Mail, Lock, ArrowLeft } from "lucide-react";
import { Recaptcha, type RecaptchaHandle } from "@/components/Recaptcha";

type Mode = "signin" | "register" | "forgot";

/**
 * Email and password, plus Google.
 *
 * Only the methods the server says it can actually do are offered — a Google
 * button that dead-ends because no client id is configured is worse than no
 * button. The success messages are deliberately identical whether or not an
 * address has an account; the server is careful about that and the UI must not
 * undo it by saying something more specific.
 */
export function EmailSignInForm() {
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const recaptcha = useRef<RecaptchaHandle | null>(null);

  // A token is spent once Google has verified it, so every outcome — success or
  // failure — has to clear the tick. Leaving it would make the next submit send
  // a token the server has already seen and will refuse.
  const clearRecaptcha = () => recaptcha.current?.reset();

  const methods = trpc.auth.methods.useQuery(undefined, {
    retry: false,
    refetchOnWindowFocus: false,
  });

  const signIn = trpc.auth.email.signIn.useMutation({
    onSettled: clearRecaptcha,
    onSuccess: ({ destination }) => {
      // A full load rather than a client-side navigation: the session cookie
      // was just set, and every query mounted under the old signed-out state
      // has to be re-made against the new one.
      window.location.href = destination;
    },
    onError: error => toast.error(error.message),
  });

  const register = trpc.auth.email.register.useMutation({
    onSettled: clearRecaptcha,
    onSuccess: ({ message }) => {
      setNotice(message);
      setPassword("");
    },
    onError: error => toast.error(error.message),
  });

  const forgot = trpc.auth.email.requestPasswordReset.useMutation({
    onSettled: clearRecaptcha,
    onSuccess: ({ message }) => setNotice(message),
    onError: error => toast.error(error.message),
  });

  const busy = signIn.isPending || register.isPending || forgot.isPending;
  const emailReady = methods.data?.email ?? false;
  const googleReady = methods.data?.google ?? false;
  const recaptchaSiteKey = methods.data?.recaptchaSiteKey ?? null;
  const recaptchaNeeded = Boolean(recaptchaSiteKey);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    setNotice(null);

    // Empty when the box is unticked. Sent anyway rather than blocked here: the
    // server decides, and it is the only side that can. A client-side "tick the
    // box first" is a convenience, not a check.
    const recaptchaToken = recaptcha.current?.getToken() ?? "";

    if (recaptchaNeeded && !recaptchaToken) {
      toast.error("Confirm you are not a robot first");
      return;
    }

    if (mode === "forgot") {
      forgot.mutate({ email, recaptchaToken });
      return;
    }
    if (mode === "register") {
      register.mutate({
        email,
        password,
        name: name.trim() || undefined,
        recaptchaToken,
      });
      return;
    }
    signIn.mutate({ email, password, recaptchaToken });
  };

  if (methods.isLoading) {
    return (
      <div className="flex justify-center py-6">
        <Spinner />
      </div>
    );
  }

  // "The server says these are off" and "no server answered" are different
  // problems with different fixes, and they used to render the same sentence.
  // Saying "not configured on this server" when the request never arrived sends
  // someone off to set environment variables that will change nothing — the
  // frontend-only Netlify deploy is exactly this case, where /api/* returns 404
  // by design and no sign-in method can work, portal included.
  if (methods.isError) {
    return (
      <div className="space-y-2 rounded-lg border border-border bg-muted/40 p-4 text-sm">
        <p className="font-medium text-foreground">
          This deployment has no server running.
        </p>
        <p className="text-muted-foreground">
          Sign-in, synced notes and collaboration all need the backend, and its
          API is not answering here. A static-only deploy serves the app but
          nothing behind it. See Deployment in the README.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {googleReady && (
        <>
          {/* A plain link, not a fetch: the server answers with a redirect to
              Google and sets the flow cookie on the way. */}
          <Button asChild size="lg" variant="outline" className="w-full">
            <a href="/api/auth/google/start">Continue with Google</a>
          </Button>

          {emailReady && (
            <div className="flex items-center gap-3">
              <span className="h-px flex-1 bg-border" />
              <span className="text-xs text-muted-foreground">or</span>
              <span className="h-px flex-1 bg-border" />
            </div>
          )}
        </>
      )}

      {emailReady && (
        <form onSubmit={submit} className="space-y-3">
          {mode === "register" && (
            <Input
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Your name (optional)"
              autoComplete="name"
              disabled={busy}
            />
          )}

          <div className="relative">
            <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              type="email"
              required
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="you@example.com"
              autoComplete="email"
              disabled={busy}
              className="pl-10"
            />
          </div>

          {mode !== "forgot" && (
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                type="password"
                required
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder={
                  mode === "register" ? "At least 12 characters" : "Password"
                }
                // The browser is told which of the two this is, so a password
                // manager offers to save a new one rather than overwrite.
                autoComplete={
                  mode === "register" ? "new-password" : "current-password"
                }
                disabled={busy}
                className="pl-10"
              />
            </div>
          )}

          {recaptchaSiteKey && (
            <Recaptcha
              ref={recaptcha}
              siteKey={recaptchaSiteKey}
              onError={message => toast.error(message)}
            />
          )}

          <Button type="submit" size="lg" className="w-full" disabled={busy}>
            {busy && <Spinner className="mr-2" />}
            {mode === "signin" && "Sign in"}
            {mode === "register" && "Create account"}
            {mode === "forgot" && "Send a reset link"}
          </Button>
        </form>
      )}

      {notice && (
        <p className="text-sm text-center text-muted-foreground bg-muted/40 rounded-lg p-3">
          {notice}
        </p>
      )}

      {emailReady && (
        <div className="flex flex-wrap justify-center gap-x-4 gap-y-1 text-sm">
          {mode !== "signin" ? (
            <button
              type="button"
              onClick={() => {
                setMode("signin");
                setNotice(null);
              }}
              className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              Back to sign in
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={() => {
                  setMode("register");
                  setNotice(null);
                }}
                className="text-primary hover:underline"
              >
                Create an account
              </button>
              <button
                type="button"
                onClick={() => {
                  setMode("forgot");
                  setNotice(null);
                }}
                className="text-muted-foreground hover:text-foreground"
              >
                Forgot password?
              </button>
            </>
          )}
        </div>
      )}

      {!emailReady && !googleReady && (
        <p className="text-sm text-center text-muted-foreground">
          The server is running but has no email or Google sign-in configured
          yet.
        </p>
      )}
    </div>
  );
}
