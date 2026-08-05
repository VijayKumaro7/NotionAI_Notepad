import { useState } from "react";
import { toast } from "sonner";
import {
  AlertTriangle,
  Check,
  Copy,
  Download,
  Loader2,
  ShieldCheck,
  ShieldOff,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { trpc } from "@/lib/trpc";

interface TwoFactorSettingsProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Two-step verification settings.
 *
 * Setup is two steps and they are not the same step: the secret is stored when
 * it is shown, but nothing is enforced until a code proves it reached a phone.
 * A QR code that failed to scan therefore costs a retry rather than an account.
 *
 * The recovery codes are shown exactly once. Only their hashes are stored, so
 * there is no screen anywhere that can show them again — hence the deliberate
 * friction of a confirm button before this panel lets go of them.
 */

/** The setup key, in groups of four, because it is being typed by hand. */
function formatSecret(secret: string): string {
  return secret.match(/.{1,4}/g)?.join(" ") ?? secret;
}

export function TwoFactorSettings({
  open,
  onOpenChange,
}: TwoFactorSettingsProps) {
  const utils = trpc.useUtils();
  const [code, setCode] = useState("");
  const [setupSecret, setSetupSecret] = useState<{
    secret: string;
    otpauthUrl: string;
  } | null>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [confirmDisable, setConfirmDisable] = useState(false);

  const status = trpc.auth.twoFactor.status.useQuery(undefined, {
    retry: false,
    enabled: open,
  });

  const reset = () => {
    setCode("");
    setSetupSecret(null);
    setRecoveryCodes(null);
    setConfirmDisable(false);
  };

  const refresh = async () => {
    await utils.auth.twoFactor.status.invalidate();
  };

  const setup = trpc.auth.twoFactor.setup.useMutation({
    onSuccess: result => setSetupSecret(result),
    onError: error => toast.error(error.message),
  });

  const enable = trpc.auth.twoFactor.enable.useMutation({
    onSuccess: async result => {
      setRecoveryCodes(result.recoveryCodes);
      setSetupSecret(null);
      setCode("");
      await refresh();
    },
    onError: error => toast.error(error.message),
  });

  const disable = trpc.auth.twoFactor.disable.useMutation({
    onSuccess: async () => {
      toast.success("Two-step verification is off.");
      reset();
      await refresh();
    },
    onError: error => toast.error(error.message),
  });

  const regenerate = trpc.auth.twoFactor.regenerateRecoveryCodes.useMutation({
    onSuccess: async result => {
      setRecoveryCodes(result.recoveryCodes);
      setCode("");
      await refresh();
    },
    onError: error => toast.error(error.message),
  });

  const busy =
    setup.isPending ||
    enable.isPending ||
    disable.isPending ||
    regenerate.isPending;

  const copyRecoveryCodes = async () => {
    if (!recoveryCodes) return;
    await navigator.clipboard.writeText(recoveryCodes.join("\n"));
    toast.success("Recovery codes copied.");
  };

  const downloadRecoveryCodes = () => {
    if (!recoveryCodes) return;

    const blob = new Blob(
      [
        "Notepad AI recovery codes\n",
        "Each code works once. Keep them somewhere you can reach without your phone.\n\n",
        recoveryCodes.join("\n"),
        "\n",
      ],
      { type: "text/plain" }
    );

    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "notepad-ai-recovery-codes.txt";
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={next => {
        // Closing mid-setup throws away the unconfirmed secret, which is
        // harmless: it was never enforced, and Set up issues a fresh one.
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <div className="flex items-center gap-3 mb-1">
            <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
              <ShieldCheck className="w-5 h-5 text-primary" />
            </div>
            <DialogTitle className="text-xl">Two-step verification</DialogTitle>
          </div>
          <DialogDescription>
            Ask for a code from your phone as well as your account, so a stolen
            password is not enough on its own.
          </DialogDescription>
        </DialogHeader>

        {status.isLoading ? (
          <div className="flex items-center gap-2 py-8 justify-center text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin" />
            Loading
          </div>
        ) : recoveryCodes ? (
          <div className="space-y-4">
            <div className="flex gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3">
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0 text-amber-600" />
              <p className="text-sm text-foreground">
                Save these now. Each one works once, and this is the only time
                they can be shown — only their hashes are stored.
              </p>
            </div>

            <ul className="grid grid-cols-2 gap-2 font-mono text-sm">
              {recoveryCodes.map(recoveryCode => (
                <li
                  key={recoveryCode}
                  className="rounded-md border border-border bg-muted/40 px-3 py-2 text-center"
                >
                  {recoveryCode}
                </li>
              ))}
            </ul>

            <div className="flex flex-col sm:flex-row gap-2">
              <Button
                variant="outline"
                className="flex-1"
                onClick={copyRecoveryCodes}
              >
                <Copy className="w-4 h-4 mr-2" />
                Copy
              </Button>
              <Button
                variant="outline"
                className="flex-1"
                onClick={downloadRecoveryCodes}
              >
                <Download className="w-4 h-4 mr-2" />
                Download
              </Button>
              <Button className="flex-1" onClick={() => setRecoveryCodes(null)}>
                <Check className="w-4 h-4 mr-2" />I have saved them
              </Button>
            </div>
          </div>
        ) : setupSecret ? (
          <div className="space-y-4">
            <ol className="space-y-4 text-sm">
              <li>
                <p className="font-medium text-foreground">
                  1. Add this key to your authenticator app
                </p>
                <p className="text-muted-foreground mt-1">
                  Google Authenticator, 1Password, Authy, and anything else that
                  does six-digit codes. Choose &ldquo;enter a setup key&rdquo;.
                </p>
                <div className="mt-2 flex items-center gap-2">
                  <code className="flex-1 rounded-md border border-border bg-muted/40 px-3 py-2 font-mono text-sm tracking-wider break-all">
                    {formatSecret(setupSecret.secret)}
                  </code>
                  <Button
                    variant="outline"
                    size="icon"
                    aria-label="Copy setup key"
                    onClick={async () => {
                      await navigator.clipboard.writeText(setupSecret.secret);
                      toast.success("Setup key copied.");
                    }}
                  >
                    <Copy className="w-4 h-4" />
                  </Button>
                </div>
                <a
                  href={setupSecret.otpauthUrl}
                  className="mt-2 inline-block text-primary hover:underline"
                >
                  Or open it directly in an app on this device
                </a>
              </li>
              <li>
                <p className="font-medium text-foreground">
                  2. Enter the code it shows
                </p>
                <form
                  className="mt-2 flex gap-2"
                  onSubmit={event => {
                    event.preventDefault();
                    enable.mutate({ code: code.trim() });
                  }}
                >
                  <Input
                    autoFocus
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    placeholder="123456"
                    maxLength={6}
                    value={code}
                    onChange={event => setCode(event.target.value)}
                  />
                  <Button
                    type="submit"
                    disabled={busy || code.trim().length < 6}
                  >
                    {enable.isPending && (
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    )}
                    Turn on
                  </Button>
                </form>
              </li>
            </ol>
          </div>
        ) : status.data?.enabled ? (
          <div className="space-y-4">
            <div className="flex items-center gap-3 rounded-lg border border-border bg-muted/40 p-3">
              <ShieldCheck className="w-5 h-5 text-primary shrink-0" />
              <div className="text-sm">
                <p className="font-medium text-foreground">On</p>
                <p className="text-muted-foreground">
                  {status.data.recoveryCodesRemaining} recovery{" "}
                  {status.data.recoveryCodesRemaining === 1 ? "code" : "codes"}{" "}
                  left.
                </p>
              </div>
            </div>

            {status.data.recoveryCodesRemaining <= 2 && (
              <p className="text-sm text-amber-600">
                Running low. Generate a new set before you are locked out.
              </p>
            )}

            <div className="space-y-2">
              <label
                htmlFor="current-code"
                className="text-sm text-muted-foreground"
              >
                Both actions below need a current code or an unused recovery
                code — being signed in is not enough on its own.
              </label>
              <Input
                id="current-code"
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="123456"
                value={code}
                onChange={event => setCode(event.target.value)}
              />
            </div>

            <div className="flex flex-col sm:flex-row gap-2">
              <Button
                variant="outline"
                className="flex-1"
                disabled={busy || code.trim().length < 6}
                onClick={() => regenerate.mutate({ code: code.trim() })}
              >
                {regenerate.isPending && (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                )}
                New recovery codes
              </Button>
              <Button
                variant={confirmDisable ? "destructive" : "outline"}
                className="flex-1"
                disabled={busy || code.trim().length < 6}
                onClick={() => {
                  if (!confirmDisable) {
                    setConfirmDisable(true);
                    return;
                  }
                  disable.mutate({ code: code.trim() });
                }}
              >
                {disable.isPending ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <ShieldOff className="w-4 h-4 mr-2" />
                )}
                {confirmDisable ? "Confirm turning it off" : "Turn off"}
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center gap-3 rounded-lg border border-border bg-muted/40 p-3">
              <ShieldOff className="w-5 h-5 text-muted-foreground shrink-0" />
              <div className="text-sm">
                <p className="font-medium text-foreground">Off</p>
                <p className="text-muted-foreground">
                  Signing in needs only your account.
                </p>
              </div>
            </div>

            <Button
              className="w-full"
              disabled={busy}
              onClick={() => setup.mutate()}
            >
              {setup.isPending && (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              )}
              Set up two-step verification
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
