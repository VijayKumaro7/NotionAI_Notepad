import { Link } from "wouter";
import {
  ArrowLeft,
  Cookie,
  Database,
  Globe,
  Monitor,
  Sparkles,
  Trash2,
} from "lucide-react";
import { Logo } from "@/components/Logo";

/**
 * What this app stores, where, and who can read it.
 *
 * Written from the code rather than from a template, and deliberately specific:
 * a page that says "we value your privacy" and lists cookie categories nobody
 * set would be worse than nothing, because it cannot be checked. Every claim
 * here names the thing that makes it true — a column, a table, a switch — so a
 * reader can go and look, and so a change that falsifies one of them is
 * something a reviewer can notice.
 *
 * Keep it in step with SECURITY.md, which covers the same ground for people
 * reading the source rather than using the app.
 */

function Section({
  icon: Icon,
  title,
  children,
}: {
  icon: typeof Cookie;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <h2 className="flex items-center gap-2 text-lg font-semibold text-foreground">
        <Icon className="h-5 w-5 shrink-0 text-primary" />
        {title}
      </h2>
      <div className="space-y-3 text-sm leading-relaxed text-muted-foreground">
        {children}
      </div>
    </section>
  );
}

/** A stored item and what it is for. */
function Item({ name, children }: { name: string; children: React.ReactNode }) {
  return (
    <li className="flex flex-col gap-0.5">
      <code className="w-fit rounded bg-muted px-1.5 py-0.5 text-xs text-foreground">
        {name}
      </code>
      <span>{children}</span>
    </li>
  );
}

export default function Privacy() {
  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-2xl px-4 py-10 sm:px-6 sm:py-16">
        <Link
          href="/"
          className="mb-8 inline-flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to home
        </Link>

        <div className="mb-8">
          <Logo size="sm" variant="full" />
        </div>

        <h1 className="mb-3 text-3xl font-bold text-foreground">Privacy</h1>
        <p className="mb-10 text-sm leading-relaxed text-muted-foreground">
          The short version: your notes are encrypted in this browser before
          they are stored anywhere, so the server holds a blob it cannot read.
          There is no analytics, no telemetry, and no third-party tracking. What
          follows is the long version, and it is specific on purpose — each
          claim below is something you can check in the source.
        </p>

        <div className="space-y-10">
          <Section icon={Cookie} title="Cookies">
            <p>
              Two, both set by the server, both marked <code>httpOnly</code> so
              no script can read them, and both necessary for the thing you
              asked for:
            </p>
            <ul className="space-y-3">
              <Item name="app_session_id">
                Keeps you signed in. Without it there is no way to be signed in
                at all.
              </Item>
              <Item name="google_oauth_flow">
                Holds the unspent OAuth state and PKCE verifier for the seconds
                a Google sign-in is in flight, and is discarded once it lands.
                Only set if you choose Google.
              </Item>
            </ul>
            <p>
              That is the whole list. Nothing here is for analytics, advertising
              or profiling, which is why the notice at the bottom of the page
              tells you about them rather than asking permission: refusing a
              cookie you need in order to sign in is refusing to sign in, and a
              consent box that cannot honour a No is a box that lies.
            </p>
          </Section>

          <Section icon={Monitor} title="Kept in your browser">
            <p>
              This is a local-first app, so most of what you create never leaves
              the machine you are on unless you sign in and sync it.
            </p>
            <ul className="space-y-3">
              <Item name="IndexedDB">
                Your notes, folders and tags. Note content is encrypted with a
                key held in this browser.
              </Item>
              <Item name="localStorage">
                Small preferences: the light or dark theme, the deadline of a
                running demo session, and a record that you have seen the cookie
                notice.
              </Item>
            </ul>
            <p>
              Clearing this site&apos;s data clears all of it. If you have never
              signed in, that is everything the app knows about you.
            </p>
          </Section>

          <Section icon={Database} title="Kept on the server, once you sign in">
            <ul className="space-y-3">
              <Item name="Your account">
                The identifier from your sign-in method, and the name and email
                it supplied.
              </Item>
              <Item name="Synced notes">
                Stored as an opaque encrypted blob. The title column is written
                empty and the whole note — title, body and tags — is inside the
                blob, so &ldquo;the server cannot read your notes&rdquo;
                includes their titles.
              </Item>
              <Item name="Published notes">
                A note you publish for real-time collaboration is copied into a
                separate table in readable form, because several people on
                different devices need a server that can order their edits. That
                is a deliberate trade, it applies only to notes you publish, and
                private notes stay encrypted.
              </Item>
              <Item name="Chat transcripts">
                Stored in clear text, unlike notes: the server has to rebuild a
                conversation to send it to the model. The chat box has a{" "}
                <span className="text-foreground">Save this chat</span> switch,
                and with it off nothing is written at all. You can delete a
                saved conversation, and it is deleted outright rather than
                flagged.
              </Item>
              <Item name="Two-step verification">
                The shared secret is stored encrypted, so a database dump is not
                a set of working second factors.
              </Item>
              <Item name="Demo sessions">
                A signed-out visitor&apos;s 30 minutes may be recorded against
                an HMAC of their address and coarse browser family. The address
                itself is never stored, and the record is deleted a day after
                the demo ends.
              </Item>
            </ul>
          </Section>

          <Section icon={Sparkles} title="When you use an AI feature">
            <p>
              The assistant, chat, voice transcription and template drafting all
              call a provider from the server, never from your browser — the
              provider key is not in the page, and the instructions behind each
              action are written on the server rather than sent from it.
            </p>
            <p>
              What reaches the provider is the text you pointed the feature at:
              the note or selection you asked about, the message you typed, or
              the recording you made. Nothing is sent until you press something.
              Notes you never run an AI feature on are never decrypted for it.
            </p>
          </Section>

          <Section
            icon={Database}
            title="Other services, and only if configured"
          >
            <p>
              Each of these is optional, and a deployment that has not set it up
              reports the feature unavailable rather than half-working: Google
              for sign-in, a transactional email service for address
              verification and password resets, reCAPTCHA for the robot check,
              and an S3 bucket for encrypted backups — which are encrypted in
              this browser first, exactly like notes.
            </p>
            <p className="text-foreground">
              There is no analytics provider, no telemetry, no advertising
              network and no third-party tracker anywhere in this app. Nothing
              is sold or shared for marketing.
            </p>
          </Section>

          <Section icon={Trash2} title="Deleting things">
            <p>
              Notes can be deleted in the app, with a recently-deleted list to
              recover from. Saved chats can be deleted outright. Clearing this
              site&apos;s data removes everything held in this browser.
            </p>
            <p>
              There is no self-service account deletion yet — removing an
              account and its server-side rows is a request to whoever runs this
              deployment. Saying so is better than implying a button that does
              not exist.
            </p>
          </Section>
        </div>

        <p className="mt-12 border-t border-border pt-6 text-xs text-muted-foreground">
          SECURITY.md in the repository covers the same ground for people
          reading the source, including the limitations this page summarises.
        </p>
      </div>
    </div>
  );
}
