import { useEffect, useState } from 'react';
import { useLocation } from 'wouter';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { trpc } from '@/lib/trpc';
import { toast } from 'sonner';
import { CheckCircle2, Lock, XCircle } from 'lucide-react';

/**
 * Where the links in email land: confirming an address, and setting a new
 * password after a reset.
 *
 * The token is read from the query string and never shown or stored. It is
 * single-use server-side, so a second visit to the same link reports failure —
 * which is correct, and the message says so rather than implying the account is
 * broken.
 */

function useToken(): string {
  // Read once on mount. Taking it from the URL on every render would keep a
  // live token in a component's props for as long as the page is open.
  const [token] = useState(() =>
    new URLSearchParams(window.location.search).get('token') ?? ''
  );
  return token;
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-md space-y-6 rounded-2xl border border-border bg-card p-6 sm:p-8">
        {children}
      </div>
    </div>
  );
}

export function VerifyEmail() {
  const token = useToken();
  const [, navigate] = useLocation();
  const verify = trpc.auth.email.verify.useMutation();

  // Fired once. A verification link is single-use, so retrying on a re-render
  // would spend it and then report that it had already been spent.
  useEffect(() => {
    if (token) verify.mutate({ token });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  return (
    <Shell>
      {!token ? (
        <Message
          kind="error"
          title="That link is incomplete"
          body="Open the link from your email exactly as it was sent."
        />
      ) : verify.isPending ? (
        <div className="flex flex-col items-center gap-3 py-6">
          <Spinner />
          <p className="text-sm text-muted-foreground">Confirming your address…</p>
        </div>
      ) : verify.isSuccess ? (
        <>
          <Message
            kind="ok"
            title="Address confirmed"
            body="You can sign in now."
          />
          <Button className="w-full" onClick={() => navigate('/login')}>
            Go to sign in
          </Button>
        </>
      ) : (
        <>
          <Message
            kind="error"
            title="That link did not work"
            body={
              verify.error?.message ??
              'It may have expired or already been used. Sign in to have another sent.'
            }
          />
          <Button variant="outline" className="w-full" onClick={() => navigate('/login')}>
            Back to sign in
          </Button>
        </>
      )}
    </Shell>
  );
}

export function ResetPassword() {
  const token = useToken();
  const [, navigate] = useLocation();
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');

  const reset = trpc.auth.email.resetPassword.useMutation({
    onSuccess: () => toast.success('Password updated — sign in with it now.'),
    onError: (error) => toast.error(error.message),
  });

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (password !== confirmation) {
      toast.error('Those two passwords do not match');
      return;
    }
    reset.mutate({ token, password });
  };

  if (!token) {
    return (
      <Shell>
        <Message
          kind="error"
          title="That link is incomplete"
          body="Open the link from your email exactly as it was sent."
        />
      </Shell>
    );
  }

  if (reset.isSuccess) {
    return (
      <Shell>
        <Message kind="ok" title="Password updated" body="Sign in with your new password." />
        <Button className="w-full" onClick={() => navigate('/login')}>
          Go to sign in
        </Button>
      </Shell>
    );
  }

  return (
    <Shell>
      <div className="space-y-1">
        <h1 className="text-2xl font-bold">Choose a new password</h1>
        <p className="text-sm text-muted-foreground">
          At least 12 characters. Length matters more than symbols.
        </p>
      </div>

      <form onSubmit={submit} className="space-y-3">
        <div className="relative">
          <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="New password"
            autoComplete="new-password"
            disabled={reset.isPending}
            className="pl-10"
          />
        </div>
        <div className="relative">
          <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            type="password"
            required
            value={confirmation}
            onChange={(e) => setConfirmation(e.target.value)}
            placeholder="Type it again"
            autoComplete="new-password"
            disabled={reset.isPending}
            className="pl-10"
          />
        </div>
        <Button type="submit" className="w-full" disabled={reset.isPending}>
          {reset.isPending && <Spinner className="mr-2" />}
          Set new password
        </Button>
      </form>
    </Shell>
  );
}

function Message({
  kind,
  title,
  body,
}: {
  kind: 'ok' | 'error';
  title: string;
  body: string;
}) {
  const Icon = kind === 'ok' ? CheckCircle2 : XCircle;
  return (
    <div className="space-y-2 text-center">
      <Icon
        className={`w-10 h-10 mx-auto ${kind === 'ok' ? 'text-primary' : 'text-destructive'}`}
      />
      <h1 className="text-xl font-bold">{title}</h1>
      <p className="text-sm text-muted-foreground">{body}</p>
    </div>
  );
}
