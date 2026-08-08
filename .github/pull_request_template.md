## What changed

<!-- What this does, and why. If it fixes a bug, say what the bug was. -->

## How it was verified

<!-- What you actually ran or observed — not what should work in principle.
     Tests, a browser check, a request against a running server. If something
     could not be verified here, say so plainly; an honest gap is more useful
     than an implied guarantee. -->

## Security

Delete this section only if the change cannot touch any of it.

- [ ] No new way for one user to read or write another user's data (note queries
      filter by `userId`; backup keys are namespaced per user)
- [ ] No plaintext note content reaches the server — it is encrypted in the
      browser before it leaves
- [ ] Session handling unchanged, or: a `pending_2fa` token still cannot reach a
      protected procedure
- [ ] No secret added to a `VITE_`-prefixed variable — those are compiled into
      the client bundle and are public
- [ ] New user input reaching the database or the filesystem is validated, and
      new tRPC procedures use `protectedProcedure` unless being public is the
      point
- [ ] Anything comparing a secret uses a constant-time comparison

If this changes the security model or a stated limitation, update `SECURITY.md`
in the same pull request.

## Notes for review

<!-- Anything a reviewer would otherwise have to work out: a decision with a
     real alternative, a risk you accepted, something left undone. -->
