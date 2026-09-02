# E2E fixtures & gates

## Signing in — no password, either role

`scripts/test-signin-link.mjs` is the general form of `mint-helper-login.sh`:
it covers BOTH seeded roles, so nothing needs the owner's own account.

```bash
node scripts/test-signin-link.mjs poster            # helpr-audit-web-0824@mailinator.com
node scripts/test-signin-link.mjs helper            # eli.test.helper@louisianahelpr.com
node scripts/test-signin-link.mjs helper --session --json   # localStorage blob for a harness
```

It refuses any address outside the seeded test set. Needs `.env`
(`VITE_SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`).

**Seed `localStorage["helpr_onboarding"] = {"completed":true,"currentStep":0,"completedSteps":[]}`
in the same step.** The onboarding tour opens on `/dashboard` in every fresh
context and blurs/intercepts the page — a harness that skips this audits the
tour.

## Seeded two-role identities
- **Poster (seeded)**: `helpr-audit-web-0824@mailinator.com` — profile id
  `e977a30f-7065-4e75-8498-dba435ac2044` ("Audit Weblane"), 7 posted jobs
  across every lifecycle state. Prefer this over the owner's account.
- **Poster (owner)**: the owner's own account (lexilombas05@gmail.com) — log in
  normally. Only when you specifically need the owner's real data.
- **Helper**: `eli.test.helper@louisianahelpr.com` — auth user bound to profile
  id 6bdc1f67-ae1f-46a0-8edf-4035629a6147 ("Audit Helper"). No password: mint a
  one-time login with `bash scripts/e2e/mint-helper-login.sh` (writes the magic
  link to /tmp/lh-helper-magiclink.txt). NOTE: the ORIGINAL seed Eli
  (user_id 11111111-1111-1111-1111-111111111104, owns the seeded jobs/messages)
  has NO auth user — creating one with that id collides with the profile
  trigger (500). Use the Audit Helper identity for driving, and the seed graph
  read-only.

## Two-origin trick
The dev server is one process, three origins — `localhost`, `127.0.0.1`, and
`[::1]` — each with isolated storage. Poster on localhost, helper on
127.0.0.1, guest on [::1]: three sessions, one server, zero sign-out risk.

## Stripe sandbox
`stripe-sandbox-on.sh` (owner-run; prompts for sk_test) flips the edge
functions to test mode and creates a test webhook endpoint;
`stripe-sandbox-off.sh` restores live. Test card: 4242 4242 4242 4242.
