import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { trpc } from '@/lib/trpc';
import { toast } from 'sonner';
import { Mail, Lock, ArrowLeft } from 'lucide-react';

type Mode = 'signin' | 'register' | 'forgot';

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
  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [notice, setNotice] = useState<string | null>(null);

  const methods = trpc.auth.methods.useQuery(undefined, {
    retry: false,
    refetchOnWindowFocus: false,
  });

  const signIn = trpc.auth.email.signIn.useMutation({
    onSuccess: ({ destination }) => {
      // A full load rather than a client-side navigation: the session cookie
      // was just set, and every query mounted under the old signed-out state
      // has to be re-made against the new one.
      window.location.href = destination;
    },
    onError: (error) => toast.error(error.message),
  });

  const register = trpc.auth.email.register.useMutation({
    onSuccess: ({ message }) => {
      setNotice(message);
      setPassword('');
    },
    onError: (error) => toast.error(error.message),
  });

  const forgot = trpc.auth.email.requestPasswordReset.useMutation({
    onSuccess: ({ message }) => setNotice(message),
    onError: (error) => toast.error(error.message),
  });

  const busy = signIn.isPending || register.isPending || forgot.isPending;
  const emailReady = methods.data?.email ?? false;
  const googleReady = methods.data?.google ?? false;

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    setNotice(null);

    if (mode === 'forgot') {
      forgot.mutate({ email });
      return;
    }
    if (mode === 'register') {
      register.mutate({ email, password, name: name.trim() || undefined });
      return;
    }
    signIn.mutate({ email, password });
  };

  if (methods.isLoading) {
    return (
      <div className="flex justify-center py-6">
        <Spinner />
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
          {mode === 'register' && (
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
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
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              autoComplete="email"
              disabled={busy}
              className="pl-10"
            />
          </div>

          {mode !== 'forgot' && (
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={mode === 'register' ? 'At least 12 characters' : 'Password'}
                // The browser is told which of the two this is, so a password
                // manager offers to save a new one rather than overwrite.
                autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
                disabled={busy}
                className="pl-10"
              />
            </div>
          )}

          <Button type="submit" size="lg" className="w-full" disabled={busy}>
            {busy && <Spinner className="mr-2" />}
            {mode === 'signin' && 'Sign in'}
            {mode === 'register' && 'Create account'}
            {mode === 'forgot' && 'Send a reset link'}
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
          {mode !== 'signin' ? (
            <button
              type="button"
              onClick={() => {
                setMode('signin');
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
                  setMode('register');
                  setNotice(null);
                }}
                className="text-primary hover:underline"
              >
                Create an account
              </button>
              <button
                type="button"
                onClick={() => {
                  setMode('forgot');
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
          Email and Google sign-in are not configured on this server yet.
        </p>
      )}
    </div>
  );
}
