# lh-email-delivery — lane report (2026-09-02)

Worktree: `~/.lh-audit/lh-email-delivery` off `origin/main` (b170609a). All prod
reads via Supabase MCP `execute_sql` (read-only) against `fncmgoasalhdgfwzhsqa`
except one deliberate seed-then-purge probe (see ED-001), cleaned up
immediately after. No mutations to real user data. No Stripe touched (out of
scope for this lane).

## Findings filed

- **ED-001 (HIGH)** — `email_tracking` (open/click pixel: `user_id`,
  `ip_address`, `user_agent`) has no FK to `auth.users` and is not touched by
  `purge_user_data()`. Proven live: seeded a synthetic-uuid row, ran the real
  purge RPC against it, row survived with IP + UA intact, cleaned up. Same
  defect class as SI-006, just missed by that migration's empirical census
  method because the table currently holds 0 rows in prod (latent, not yet
  leaking — will start the moment any open/click-tracked send fires). Fix
  belongs in `purge_user_data()` (data-model / account-lifecycle territory,
  not this lane's to edit) — queued to team-lead / `lh-account-lifecycle`.
- **ED-002 (MEDIUM)** — `auth-email-hook` has zero `postSlackOpsAlert` calls on
  any of its 5 failure branches, unlike every other inbound webhook in the
  repo (`stripe-webhook`, `stripe-idv-webhook`, `verification-webhook`, etc.).
  A single-user failure is loud to that user (Auth surfaces the non-2xx), but
  a systemic failure (secret rotated, `enqueue_email` broken) silently blocks
  every signup confirmation and password reset with no ops paging. Auth-channel
  change — queued, not fixed, per this lane's mandate.
- **EF-006 (owned by lh-edge-functions, HIGH, not blocker)** — confirmed and
  added the precise downstream consequence from this lane's side: `resend-webhook`
  refuses every delivery (503, missing `RESEND_WEBHOOK_SECRET`),
  `suppressed_emails` is 0 rows against 171 sent (160 in 30d), and no other
  code path writes that table — so a bounced/complained address is retried
  forever by every future send, degrading the whole sending domain including
  the auth channel. Owner-only fix (mint the Resend webhook secret).
- **CJ-006 (owned by lh-cron-jobs, LOW, verified)** — DLQ path records but
  never drains; still latent (0 messages in either DLQ). No new action from
  this lane.

## Swept clean (evidenced, no finding)

- **Brand-asset image fix already shipped.** All templates route the wordmark
  through `LOGO_URL` = the `brand-asset` edge function
  (`_shared/email-templates/styles.ts:83`), not the marketing host. Live-fetched
  it: `HTTP/2 200`, `content-type: image/png`, cacheable. No template
  hardcodes the marketing host.
- **Gift-card claim URL already correct.** `_shared/pifGiftEmail.ts:53` mails
  `/gift-card?claim=<token>` (the current route, `App.tsx:333`), and
  `ProtectedRoute` preserves `pathname + search` through the login redirect
  (`ProtectedRoute.tsx:197-200`) so an unauthenticated recipient returns to the
  claim after signing in. `PayItForward.tsx:113-121` fires the claim exactly
  once per token, waits for auth to settle, and strips the param after use.
- **Unsubscribe is HMAC-signed, not a guessable/stored token.**
  `email-unsubscribe/index.ts` + `_shared/unsubscribe.ts`: base64url address +
  HMAC-SHA256 over `unsub.v1:<address>`, keyed off `EMAIL_UNSUBSCRIBE_SECRET`
  (falls back to `CRON_SECRET`). The `email_unsubscribe_tokens` table this
  lane's brief named was confirmed **dropped in prod**
  (`to_regclass` → null; migration `20260830072801_drop_unused_scaffold_tables.sql`)
  — no dangling object, no scoping question to ask.
- **Suppression vs. opt-out correctly kept as two separate lists** —
  `suppressed_emails` (hard/permanent, all mail) vs.
  `marketing_consent`/`email_promotions` (soft/reversible, commercial only) —
  documented and enforced in `email-unsubscribe/index.ts`'s header comment;
  verified the code never cross-writes between them.
- **resend-webhook**: signature verified via the Resend/Svix SDK (reads
  `svix-*` and `webhook-*` headers defensively — the exact prior bug that made
  this 401 on every delivery is fixed and explained in-file), fails closed
  with no secret, upserts `ON CONFLICT DO NOTHING` for replay safety,
  transient bounces are NOT suppressed (only hard/permanent + complaints).
- **process-email-queue**: live queue metrics show it draining
  (`auth_emails`/`transactional_emails` both `queue_length: 0`,
  `total_messages` 44/130 — genuinely processing, not stuck), visibility
  timeout is derived from batch size × per-send timeout (not a hardcoded
  guess), duplicate-send guard fails closed, TTL-expiry and max-retry both
  route to their DLQ with a logged defect if the move itself fails.
- **All 16 templates route through the shared `BaseLayout`** — verified by
  grep (every `.tsx` in `_shared/email-templates/` references it) — so
  dark-mode (`color-scheme` meta + `@media (prefers-color-scheme: dark)`),
  plain-text generation, and the branded wordmark are uniform; none of the 16
  hand-rolls its own header/footer.
- **Null-field safety spot-checked**: `notification.tsx` degrades
  `userName || 'there'`; `PayItForward`/`pifGiftEmail` claim path is
  null-guarded at every stage.
- **notify-email-change** notifies the OLD address on an email change
  (`notify-email-change/index.ts:59-101`); the NEW address goes through the
  standard `auth-email-hook` `email_change_new` confirmation. Both sides
  covered.
- **Deliverability DNS**: SPF present (`v=spf1 include:_spf.google.com ~all`),
  DMARC `p=quarantine` with `rua=` reporting, DKIM CNAME live at
  `resend._domainkey.louisianahelpr.com` with a real key matching Resend's
  selector — DMARC alignment is satisfied via DKIM even though SPF covers
  Google Workspace, not Resend's sending IPs (expected/correct for this setup,
  not a finding).
- **List-Unsubscribe / List-Unsubscribe-Post**: present on commercial/lifecycle
  sends via `_shared/unsubscribe.ts`, deliberately absent on transactional
  mail (documented in `engagement-automations/index.ts:588,805` — a
  transactional message must never offer an unsubscribe control).
- **CAN-SPAM postal address**: `POSTAL_ADDRESS_LITERAL` is empty; this is a
  documented, owner-accepted gap dated 2026-08-31 (not re-filed — re-litigating
  an explicitly accepted, dated decision is out of scope per protocol).

## Unverified

- Real rendering in live Gmail/Apple Mail/Outlook clients (no test inbox
  credentials provisioned to this lane) — relied on source-level dark-mode /
  plain-text / BaseLayout-consistency checks instead. A future pass with
  Litmus/real test-inbox access should close this.
- Full 20-template line-by-line long-name/overflow visual render — sampled
  `notification.tsx` and the unsubscribe confirmation page directly; did not
  screenshot all 16 `.tsx` templates individually given the effort budget.
- `send-account-status-email` / `admin-action.tsx` — read for PII/structure,
  not driven end-to-end with a real admin action.

## Prod mutations performed (and reverted)

One: seeded + deleted a synthetic `email_tracking` row
(`user_id = 00000000-dead-beef-0000-0000000ffff2`) to prove ED-001. Verified
0 rows before, 1 after seed, 1 survives purge, 0 after cleanup.
