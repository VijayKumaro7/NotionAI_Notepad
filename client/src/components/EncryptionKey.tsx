import { useState } from "react";
import { toast } from "sonner";
import { Copy, Download, KeyRound, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { downloadBlob } from "@/lib/exportService";
import { importRecoveryPhrase } from "@/lib/keyImport";
import { encodeRecoveryPhrase } from "@/lib/recoveryPhrase";
import { LOCAL_KEY_ID, readEncryptionKeyBytes } from "@/lib/storage";

/**
 * Carrying the encryption key to another browser.
 *
 * The key is made here and never leaves, which is why the server holds notes it
 * cannot read. The cost, until now, was that signing in somewhere else showed
 * an empty workspace next to a server full of notes — the rows arrive, they are
 * ciphertext, and nothing on the new device can open them. This panel is the
 * way across, and it is manual on purpose: the alternative is putting something
 * that unwraps the key on the server, which is the one thing the design is
 * built to avoid.
 *
 * Two things this is careful about, both learned from what the operation can
 * destroy rather than from what it should do:
 *
 * - The phrase is not shown until asked for. It is the notes, in one line, and
 *   it should not be sitting on screen behind whoever walks past.
 * - Importing re-seals what is already here first. A device that has been used
 *   has notes under the key it generated for itself, and swapping the key
 *   without moving them is indistinguishable from deleting them.
 */
export function EncryptionKey() {
  const [phrase, setPhrase] = useState<string | null>(null);
  const [revealing, setRevealing] = useState(false);
  const [incoming, setIncoming] = useState("");
  const [importing, setImporting] = useState(false);

  const reveal = async () => {
    setRevealing(true);
    try {
      // Read, never create. Falling back to getOrCreate here would mint a key
      // for an account that has never encrypted anything and present it as a
      // backup of notes that do not exist.
      const bytes = await readEncryptionKeyBytes(LOCAL_KEY_ID);
      if (!bytes) {
        toast.error(
          "This browser has not made an encryption key yet — write a note first."
        );
        return;
      }
      setPhrase(encodeRecoveryPhrase(bytes));
    } catch (error) {
      console.error("[Key] Could not read the key", error);
      toast.error("Could not read this browser's key.");
    } finally {
      setRevealing(false);
    }
  };

  const copy = async () => {
    if (!phrase) return;
    try {
      await navigator.clipboard.writeText(phrase);
      toast.success("Recovery phrase copied.");
    } catch {
      // Clipboard access is refused in plenty of ordinary situations — an
      // insecure origin, a permission prompt someone dismissed. The phrase is
      // on screen and selectable, so say that rather than failing silently.
      toast.error("Could not copy — select the phrase and copy it by hand.");
    }
  };

  const download = () => {
    if (!phrase) return;
    const lines = [
      "Notepad AI — encryption key recovery phrase",
      "",
      phrase,
      "",
      "Anyone with this phrase can read every note this account has synced.",
      "Keep it somewhere you would keep a password.",
      "",
      "To use it: open the account panel on the other device and paste it",
      "under 'Use a phrase from another device'.",
    ];

    downloadBlob(
      new Blob([lines.join("\n")], { type: "text/plain" }),
      `notepad-recovery-phrase-${new Date().toISOString().slice(0, 10)}.txt`
    );
  };

  const runImport = async () => {
    setImporting(true);
    try {
      // The rules live in lib/keyImport.ts, where they can be tested: a phrase
      // that does not check out never reaches the key store, and what is
      // already here is re-sealed before the key is swapped.
      const result = await importRecoveryPhrase(incoming);

      if (!result.ok) {
        toast.error(result.message);
        return;
      }

      toast.success(
        result.converted > 0
          ? `Key installed. ${result.converted} ${result.converted === 1 ? "note was" : "notes were"} moved onto it.`
          : "Key installed."
      );

      // A full load rather than a state update: the notes hook is holding the
      // old CryptoKey, the decrypted notes it opened and a sync baseline, and
      // the cheapest way to be sure none of it survives is not to have a next
      // render.
      window.location.replace("/app");
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="rounded-lg border border-border bg-muted/30 p-4 space-y-3">
      <div className="flex items-center gap-2">
        <KeyRound className="w-4 h-4 text-muted-foreground shrink-0" />
        {/* An explicit size: a bare h3 takes the landing-page display
            scale from index.css and renders at 36px in here. */}
        <h3 className="text-base font-medium text-foreground">
          Your encryption key
        </h3>
      </div>

      <div className="text-sm text-muted-foreground space-y-2">
        <p>
          Your notes are encrypted in this browser with a key that has never
          left it. That is why the server cannot read them — and why another
          browser cannot either, until you bring the key across.
        </p>
        <p>
          Anyone who has this phrase can read every note you have synced. Keep
          it where you would keep a password.
        </p>
      </div>

      {phrase ? (
        <div className="space-y-2">
          <p
            className="rounded-md border border-border bg-background px-3 py-2 font-mono text-sm break-all select-all"
            data-testid="recovery-phrase"
          >
            {phrase}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={copy}>
              <Copy className="w-4 h-4 mr-2" />
              Copy
            </Button>
            <Button variant="outline" size="sm" onClick={download}>
              <Download className="w-4 h-4 mr-2" />
              Save as a file
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setPhrase(null)}>
              Hide
            </Button>
          </div>
        </div>
      ) : (
        <Button variant="outline" onClick={reveal} disabled={revealing}>
          {revealing && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
          Show recovery phrase
        </Button>
      )}

      <div className="border-t border-border pt-3 space-y-2">
        <label
          htmlFor="incoming-phrase"
          className="text-sm font-medium text-foreground"
        >
          Use a phrase from another device
        </label>
        <p className="text-sm text-muted-foreground">
          This browser will start using that key instead of its own. Notes
          already here are moved onto the new key and stay readable; notes
          synced from the other device become readable for the first time.
        </p>
        <Textarea
          id="incoming-phrase"
          rows={3}
          spellCheck={false}
          autoComplete="off"
          className="font-mono text-sm"
          placeholder="Paste the recovery phrase from your other device"
          value={incoming}
          onChange={event => setIncoming(event.target.value)}
        />
        <Button
          variant="outline"
          disabled={incoming.trim().length === 0 || importing}
          onClick={runImport}
        >
          {importing && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
          Use this key
        </Button>
      </div>
    </div>
  );
}
