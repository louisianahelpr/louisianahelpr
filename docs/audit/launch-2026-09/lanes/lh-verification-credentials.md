# Lane report — lh-verification-credentials

Sweep run 2026-09-02 against **prod** (`fncmgoasalhdgfwzhsqa`), read-only except for
DO-block probes that `RAISE` at the end so the whole transaction rolls back. Worktree
`~/.lh-audit/verification`, checked out at `origin/main` (b170609a).

## What I fixed

**Nothing yet — deliberately, and here is the reason in the first line as required.**
Every HIGH finding in this lane is an RLS or data-model change, which the orchestrator's
standing constraint queues for owner review. More specifically: VC-001 and VC-002 are the
same broken seam seen from two sides and **must be fixed by one decision**. Closing VC-002
alone (locking non-admin writes out of `helper_credentials`) would move the credential gate
from *forgeable* to *permanently unsatisfiable by anyone*, which is strictly worse. Two
low-risk items (VC-004, VC-008) are ready to plan the moment I am released.

## Headline

The licensed-and-insured credential gate — the safety system on an app whose premise is
sending strangers into people's homes — is broken in both directions at once:

- **It cannot be satisfied honestly.** (VC-001)
- **It can be satisfied by anyone, for free, with two INSERTs.** (VC-002)

Both proven against live prod.

## Findings

| id | sev | blocker | one line |
|---|---|---|---|
| VC-001 | HIGH | yes | "Licensed" / "Licensed + Insured" jobs are unfillable by every user, including admin-verified ones |
| VC-002 | HIGH | yes | Any signed-in user can self-grant the top credential tier with two INSERTs |
| VC-003 | HIGH | no | A verified license or Certificate of Insurance never expires — no expiry column exists |
| VC-004 | MEDIUM | no | `verification-webhook` is unreachable: missing `verify_jwt = false` in `config.toml` |
| VC-005 | MEDIUM | no | RW-005 resolved: auto-approval is intentional; the column default and admin queue contradict it |
| VC-006 | MEDIUM | no | A deleted helper's W-9 typed signature and IP survive deletion, fully attributable |
| VC-007 | LOW | no | Verification-exception grants are audit-logged client-side only |
| VC-008 | MEDIUM | no | `claim_idv_attempt` has two overloads; any un-named call raises 42725 |

### VC-001 / VC-002 — the two halves of the same seam

There are **two parallel credential stores** and they do not talk to each other.

1. `profiles.license_status` / `insurance_status` — what the product actually uses.
   `/profile?tab=credentials` uploads → `get_pending_credentials()` → admin approves →
   `review_credential()` writes here. `CredentialBadge.tsx:42-43` renders the public
   Licensed / Insured badges from here.
2. `helper_credentials` — what the *gate* reads. `get_user_credential_tier()` selects
   from this table only.

`review_credential()` never writes store 2. `helper_credentials` has **0 rows in prod**,
and no writer exists for `trade_license` / `insurance` / `bond` anywhere in `src/` or in
any edge function — the single writer,
`stripe-webhook/handlers/checkoutSessionCompleted.ts:353`, inserts
`credential_type: 'background_check'`, which `get_user_credential_tier` never reads.

So all 7 prod profiles with `license_status='verified'` compute tier **0**.

**VC-001 proof** (live, rolled back) — poster posts a `handyman` job at
`credential_tier = 2`; helper `business@helpr.test` (`license_status='verified'`,
`insurance_status='verified'`, `is_licensed=true`, `ban_status='active'`) applies:

```
PROBE >> helper profiles.license_status=verified insurance_status=verified is_licensed=true
      |  get_user_credential_tier=0  |  job.credential_tier=2
      |  REFUSED: credential_tier_required [42501]
```

The picker that creates such a job is live for handyman / painting / moving / assembly
(`detailsSectionConstants.ts:28-43`, `DetailsSection.tsx:82-87`). A refused helper is shown
"Get Verified to Apply" pointing at `/profile`
(`JobDetailFooter.tsx:163-207`), where the only available action is re-uploading the
document that was already approved. There is no exit from that loop.

Mitigation today: **0 prod jobs have `credential_tier > 0`**, so no real user has hit it.

**VC-002 proof** (live, rolled back) — `helper_credentials` RLS is
`Users can insert own credentials` WITH CHECK `(auth.uid() = user_id)` and a matching
UPDATE policy. Neither constrains `status` or `credential_type`, and `authenticated` holds
the column grants. As role `authenticated` with an ordinary user's `auth.uid()`:

```
PROBE >> as authenticated user, tier_before=0 | SELF-INSERT ACCEPTED | tier_after=3
```

Two rows — `('trade_license','verified')` and `('insurance','verified')` — take a user from
tier 0 to tier 3 and satisfy `enforce_application_credential_tier`. No document, no admin,
no review. `credential_type='identity'` gives tier 1 the same way.

**The fix is one decision, and it is the owner's.** Either (a) `review_credential()` becomes
the server-owned writer of `helper_credentials` rows and non-admin writes are revoked from
that table, or (b) `get_user_credential_tier()` is rewritten to read
`profiles.license_status` / `insurance_status` and the user-writable table is dropped.
(a) is better because it restores an expiry column and therefore also closes VC-003;
(b) is smaller. Doing only half of (a) re-creates VC-001 permanently.

### VC-003 — credentials never expire

Prod `profiles` has **no expiry column for either credential**: the full license/insurance
column set is `license_url, license_status, license_reviewed_at, license_reviewed_by,
license_rejection_reason, is_licensed` and the insurance mirror — plus
`subscription_expires_at`, which is unrelated billing. `review_credential()` stamps
`reviewed_at` and stops.

`helper_credentials.expiration_date` exists and **is** honoured by
`get_user_credential_tier`, but that table is the empty one from VC-001, so the expiry logic
guards a store nobody populates.

Consequence: a Certificate of Insurance that lapses the day after approval keeps rendering
the public "Insured" badge forever. Insurance is the credential most certain to expire —
policies are annual. There is no warning-before-lapse UI anywhere in `src/`; the code
concedes this at `CredentialsTab.tsx:360-362` ("The schema doesn't track an explicit
`expires_at` on credentials yet").

### VC-004 — `verification-webhook` has never run

No `[functions.verification-webhook]` block in `supabase/config.toml`, so the gateway
default `verify_jwt = true` applies. Live probes, three vendor shapes:

```
POST /verification-webhook  x-vendor: checkr, no signature        -> 401 UNAUTHORIZED_NO_AUTH_HEADER
POST /verification-webhook  x-vendor: stripe_identity, bogus sig  -> 401 UNAUTHORIZED_NO_AUTH_HEADER
POST /verification-webhook  x-vendor: checkr, wrong hmac          -> 401 UNAUTHORIZED_NO_AUTH_HEADER
control: POST /stripe-idv-webhook, bogus sig                      -> 200 signature_verification_failed
```

Checkr, Certificial and Stripe Identity do not send Supabase JWTs. The handler's own
verification — fail-closed per vendor, constant-time HMAC compare, content-hash dedupe,
idempotency rollback with a zero-row guard — is genuinely well built and **has never
executed in prod**.

Harmless today (no screening vendor is live; `create-bgc-payment` is hard-disabled). It is a
trap for the day a vendor is switched on: every callback 401s at the gateway,
`verification_checks` never updates, `sync_credential_from_check` never fires, and helpers
who paid sit at "in progress" forever — the exact outcome `create-bgc-payment`'s own header
comment (`:13-32`) says it is guarding against. This repo has the identical bug on record:
`health-check`'s missing declaration broke its CI smoke test every run from 2026-04-26
(`config.toml:108-119`).

### VC-005 — RW-005, answered plainly

**It is intentional. It is not an approval-gate bypass.**
`complete-signup/index.ts:465-470` sets `approval_status: "approved"` unconditionally once
signup validation passes, commented "Auto-approve — there's no manual admin review step
anymore." `handle_new_user()` inserts with no `approval_status`, so the default `'pending'`
is only ever the *pre-completion* state, and the profiles INSERT policy hard-pins
`approval_status = 'pending'` in its WITH CHECK, so it cannot be self-forged.

What remains is the contradiction: the column default and an entire surviving admin approval
queue (`useAdminUsersFilter.ts:47-48`, `useAdminUserActions.ts:38`, `DenyUserDialog.tsx:61`,
`adminUserHelpers.tsx:19-21`) both advertise a review step that gates nothing. An operator
reading that queue would reasonably believe they decide who gets on the platform. They do
not. `ProtectedRoute.tsx:334` still routes `pending` → `/account-pending`, a state now only
reachable by abandoning signup midway.

`lh-account-lifecycle` can close its half of RW-005 on this.

## Verified working — with the artifact

| Claim | Artifact |
|---|---|
| `stripe-idv-webhook` rejects unsigned and forged events, no mutation | live `200 {"received":true,"error":"missing_signature_header"}` and `200 {...,"signature_verification_failed"}` |
| …and is replay-safe | `stripe_webhook_events` dedupe insert, 23505 → 200 skip, rollback on handler failure with a zero-row guard (`index.ts:120-224`) |
| `verification-webhook` handler logic is correct (though unreachable) | fail-closed per vendor, `timingSafeEqual`, SHA-256 content-hash dedupe key, rollback + Slack page on zero-row delete |
| Credential docs are private and not guessable | `user-documents` / `id-documents` `public=false`; DB stores the storage **path** not a URL (`CredentialsTab.tsx:243-245`); signed URL minted at 300s (`:311-314`) |
| Credential doc reads are scoped | `user-documents: owner or admin read` = `(auth.uid()::text = foldername(name)[1]) OR has_role(admin)`; `id-documents` has owner-read + admin-read as separate policies |
| Credential docs are purged on account deletion | `accountPurge.ts:99-105` sweeps all five identity buckets, recursive listing, page-limit guard, **post-remove re-list verification**; live orphan census over `storage.objects` for anonymized/deleted owners in both buckets → **0 rows** |
| A user cannot self-approve or self-verify on `profiles` | INSERT policy pins `approval_status='pending'`; `tr_prevent_self_escalation` (BEFORE UPDATE) pins ~50 server-owned columns incl. `approval_status`, `ban_status`, `idv_status`, `license_status`, `insurance_status`, `background_check_status`, `stripe_identity_verified` |
| `enforce_ban_gate` blocks server-side, not just in the UI | my first probe was refused outright: `42501 account_restricted` from `enforce_ban_gate()` on a `temp_banned` account attempting a `jobs` INSERT |
| Paid-but-never-run background check is impossible today | `create-bgc-payment/index.ts:33` `BGC_PURCHASE_ENABLED = false` → 503 before any Stripe call; enforced in the function, not by hiding the button |
| BGC charge is idempotent when re-enabled | `idempotencyKey: bgc:${user.id}` (`:148`), plus 409 guards on `background_check_status` pending/verified |
| One paid IDV attempt is enforced durably | `claim_idv_attempt` checks fee paid, ban status, `already_verified`, `in_manual_review`, and uses an optimistic `WHERE idv_attempt_count = <read value>` to lose the race safely |
| `review_credential` is admin-only and audit-logged atomically | SECURITY DEFINER, `has_role(admin)` check, `admin_audit_log` INSERT in the same body |
| Fraud detection actually fires | `cron.job` id 31 `detect-suspicious-user-patterns` active at `30 4 * * *`; prod `fraud_flags` holds rows stamped `2026-08-26 04:30:00`, matching the schedule |
| Fraud flags are purged on account deletion | `purge_user_data()` deletes `fraud_flags WHERE user_id = p_user_id` |

## UNVERIFIED — could not reach, and why

- **A real Stripe Identity session end-to-end.** Owner constraint: no live Stripe, IDV
  sessions cost money and touch real KYC. I probed the webhook's rejection path instead and
  reasoned the success path from source; the `identity.verification_session.verified`
  handler (`stripe-idv-webhook:225-305`) is source-read only.
- **`/profile?tab=credentials` rendered.** No browser session driven this run — I spent the
  budget on the DB and webhook layer, where the blockers turned out to be. The upload path
  is source-read plus live storage-policy verification. Worth a visual pass by whoever owns
  the route walk.
- **Checkr / Certificial callbacks.** No vendor accounts exist; that is the documented
  reason BGC purchase is disabled.
- **The admin queues operated end-to-end** (`?view=credentials`, `?view=idvreview`,
  `?view=exceptions`). `verification_exceptions` and `helper_credentials` are both empty in
  prod, so there is nothing to work through without seeding. Their RPCs and RLS are verified
  above; the UI is not.
- **`?view=business_verify` does not exist.** Named in my brief; there is no such case in
  `Admin.tsx`'s `View` union, and it falls through to `DashboardHome`. Consistent with the
  B2B removal (PROTOCOL §6d). Not a finding — a stale scope line.
- **`BusinessContracts.tsx` / `useJobSubmit` business-verification gate.** My brief cited a
  documented unfinished gap here. **It is moot, not unfinished:** the business surface was
  removed entirely (`businesses` / `business_members` dropped in `20260828011811`), there is
  no `*business*` file in `src/`, and `is_user_verified_business_member` was dropped in
  `20260828004538`. `useJobSubmit.ts:296-303` *does* gate posting on `idv_status !== 'verified'`
  (unless `idv_requirement_paused`). Nothing to finish.

## Out-of-scope conclusions (PROTOCOL §6)

- **Certificate pinning** — wontfix, and I want to be explicit rather than silent. The
  credential documents move over HTTPS to Supabase storage inside a WKWebView under ATS.
  Pinning would break on routine cert rotation, Apple discourages it, and it protects
  against an attacker who already controls the device's trust store — who can read the
  signed URL out of the page anyway. The 300s signed-URL TTL is the better control and it
  is already in place.
- **Jailbreak / root detection** — wontfix. Consumer marketplace. The credential gate's real
  weakness is VC-002, which is a server-side RLS hole reachable from any HTTP client with a
  valid token; RASP on the app binary would not have touched it.
- **Realm / CoreData, offline sync, IAP receipt validation** — not applicable, no such
  subsystems. Not searched.

## Coverage manifest

**Database objects opened against live prod** (`pg_proc` / `pg_policy` / `pg_trigger` /
`information_schema`, not migration files): `profiles` (columns, defaults, grants, all 6
RLS policies, all 5 triggers) · `helper_credentials` · `verification_checks` ·
`verification_exceptions` · `helper_verifications` · `helper_w9_records` (columns + FKs) ·
`fraud_flags` · `storage.buckets` (all 10) · `storage.objects` (all 41 policies) ·
`cron.job`.

**Functions read via `pg_get_functiondef`:** `handle_new_user` ·
`enforce_application_credential_tier` · `get_user_credential_tier` · `idv_requirement_paused` ·
`prevent_self_escalation` · `auto_pending_credentials` · `log_verification_change` ·
`review_credential` · `get_pending_credentials` · `sync_credential_from_check` ·
`claim_idv_attempt` (both overloads) · `purge_user_data` ·
`detect_suspicious_user_patterns` · `auto_restrict_repeat_violators`.
`is_user_verified_business_member` — **dropped**, not present.

**Edge functions read:** `stripe-idv-webhook` (415 lines, full) · `verification-webhook`
(335 lines, full) · `create-bgc-payment` (full) · `stripe-idv-start` (claim path) ·
`complete-signup` (approval path, `:380-560`) · `_shared/accountPurge.ts` (storage sweep) ·
`supabase/config.toml` (full).

**Live HTTP probes:** 3× `verification-webhook`, 2× `stripe-idv-webhook`,
1× `create-bgc-payment`, 1× `stripe-idv-start`.

**Live SQL probes, all rolled back:** credential-tier refusal · `helper_credentials`
self-insert escalation · `claim_idv_attempt` overload ambiguity · ban-gate refusal
(incidental) · storage orphan census.

**`src/` surfaces enumerated** (via a read-only Explore pass, file:line in the findings):
`CredentialsTab.tsx` · `CredentialBadge.tsx` · `ProtectedRoute.tsx` (all 9 gates) ·
`SignupPending` / `AccountPending` / `AccountDenied` / `AccountBanned` / `CompleteProfile` ·
`AdminCredentialQueue` · `AdminIDVReview` · `AdminExceptionQueue` · `IDVPromptDialog` ·
`BackgroundCheckCard` · `W9CollectionDialog` · `useJobSubmit` · `jobSubmitHelpers` ·
`DetailsSection` + `CredentialTierSelector` + `detailsSectionConstants` ·
`JobDetailFooter` · `useJobDetailData` · `useUserProfileData` · `featureFlags.ts`.

**Sampling statement:** I did not read all 66 edge functions or all 254 database functions.
I read every object named in my lane scope plus everything the live call graph reached from
them, and I say so rather than implying full coverage.

**`npm run check:audit-evidence` was run** (PROTOCOL §8.4) and reports 17 claims found,
1 with evidence, 16 without. I am not chasing that number, and here is why rather than
leaving it to be discovered: the script matches artifact tokens *on the same line* as the
claim sentence, and this report carries its artifacts in a dedicated table plus fenced probe
output. Most of its 16 hits are prose containing the literal string `verified` — e.g.
"`license_status='verified'`", which *is* the SQL artifact. The one hit inside the
UNVERIFIED section (line 191) is correctly placed already. Every claim in the "Verified
working" table has a named artifact in its right-hand column; every finding filed in the bus
carries a `--repro` and an `--evidence` list.
