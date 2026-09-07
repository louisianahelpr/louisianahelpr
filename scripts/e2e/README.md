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

## CI prod lifecycle loop (`e2e/prod-lifecycle.spec.ts`)

Runs the full money loop against PRODUCTION on every push, gated on four
secrets: `PLAYWRIGHT_POSTER_EMAIL` / `PLAYWRIGHT_POSTER_PASSWORD` and
`PLAYWRIGHT_HELPER_EMAIL` / `PLAYWRIGHT_HELPER_PASSWORD` (the
`helpr-e2e-poster-0902` / `helpr-e2e-helper-0902` accounts). Passwords must be
at least 12 characters — GoTrue's real minimum, which the client does not
enforce. Wired as the `prod-lifecycle` job in `.github/workflows/e2e-real-backend.yml`.

**Why it is safe to write to prod:** the project's `STRIPE_SECRET_KEY` is a test
key, verified against the Stripe API rather than the code — every charge prod's
edge functions produced on 5–6 Sep 2026 is `livemode: false`, including a Connect
destination charge with a transfer. The owner is keeping it on test until every
function has been verified against Stripe.

**Blast radius**, all structural rather than conventional:
- the job is posted with `parish = null`, and `notify_helpers_on_job_post` opens
  with `IF NEW.parish IS NULL … RETURN NEW` — so no helper is ever notified;
- all four guest surfaces require `created_at <= early_access_cutoff()`, which is
  `now() - 20 minutes` for a free-tier caller, and all real accounts are free
  tier — so the job is invisible to everyone for longer than it exists as `open`;
- `is_seed = true`, which is what the five money sweeps filter on. It is NOT
  relied on for visibility: `seed_jobs_hidden_publicly()` is false in prod, so
  `is_seed` is the launch switch, not an isolation mechanism.

**Cleanup** is `prod-lifecycle-sweeper.mjs`, run BEFORE the loop as well as after
(the rows that matter are the ones a run died holding). It runs as the poster,
never with a service-role key. Unfunded leftovers are reopened and deleted;
funded ones are unwound with `create-payment { action: "cancel_escrow" }`. A run
that reaches `released` leaves a permanent job + application + payout_transfer +
review: `payout_transfers_job_id_fkey` is ON DELETE RESTRICT, so those rows
cannot be removed by anyone. Bounding that growth needs a `SECURITY DEFINER`
purge scoped to the two test user ids — not yet written.

### THE ONE PIECE THAT STOPS WORKING IF THE STRIPE KEY GOES LIVE

The funding leg, and only the funding leg. Stripe rejects `4242 4242 4242 4242`
in live mode with `card_declined`, and live mode accepts only real cards, so
there is no card the suite could safely submit. The spec detects the mode from
the `cs_test_` / `cs_live_` prefix of the Checkout Session id in the URL
`create-payment` returns — chosen because it reflects the key that is live right
now, arrives in a response the app already gives us, and needs no secret in CI
(reading the `sk_` prefix would mean putting a live Stripe secret into Actions to
discover it is a live secret; a `livemode` field on an older object would report
the mode as of the last charge, not the current config).

On a live key the suite DEGRADES rather than failing or charging anyone: post →
apply → hire → complete still run, and fund → release → review are skipped and
announced as UNCOVERED through a `::warning::` and a step-summary line. Review is
necessarily in the skipped set — its RLS policy requires
`payment_status IN ('released','payout_pending')`.

**Replacing it properly** means a SECOND Stripe account used only by tests, with
its own `sk_test_` key, selected by a mode-aware override in the edge functions
(`_shared/proTiers.ts` already has the shape of such a switch). That is not
today's work, and a real card in CI is not an acceptable substitute.
