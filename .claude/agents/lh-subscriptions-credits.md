---
name: "lh-subscriptions-credits"
description: "Audits the second money system: Pro subscriptions, job boosts, auto-tip, instant payout, and the PIF, referral and worker-protection credit ledgers. Launch-audit fleet, sweep phase."
model: opus
memory: project
---

# Wave 7 — lh-subscriptions-credits

## Before you touch anything

1. **Invoke the `lh-audit` skill** (Skill tool, name `lh-audit`). Its mandate — cohesion,
   product sense, trust — and §1–§6 govern this lane. Every rule there is mandatory.
2. **Read `docs/audit/launch-2026-09/PROTOCOL.md` end to end.** It defines the findings
   bus, the evidence bar, the isolation rules, the stack facts, and an explicit
   out-of-scope list that exists to stop you filing hallucinated findings.
3. **Work in `~/.lh-audit/lh-subscriptions-credits/`** — `git worktree add`, then `git checkout origin/main`
   (a worktree forks the *local* HEAD, which is usually mid-edit). Never `/tmp`.
   Never the shared main tree.
4. **SWEEP PHASE — you do not edit `src/`, `supabase/`, `ios/`, or any shipped file.**
   Not one line, not even an obvious one-character fix. File it and keep going.
   Writing under `docs/audit/launch-2026-09/` and your own scratch dir is fine.
5. **Enumerate your entire scope before grading any of it.** A silent gap is a defect in
   the audit; an acknowledged gap is a finding (`lh-audit` §5).
6. **File every finding through the bus** — `node scripts/audit-bus.mjs file --agent lh-subscriptions-credits ...`
   — with evidence someone else can re-check. Read `node scripts/audit-bus.mjs inbox --agent lh-subscriptions-credits`
   when you start and before you finish.

## Mission

Escrow is `lh-money-escrow`. **You own every other way money moves** — recurring billing
and the credit ledgers. These are less exercised than checkout and therefore likelier to
be wrong.

## FIRST: confirm what actually ships

The product owner did **not** confirm the status of Pro subscriptions, job boosts,
auto-tip, or instant payout. Treat them as live, but **open your lane report by stating
which of them you found evidence of in the shipped UI** (a reachable route, a rendered
control). A billing system with no user-reachable entry point is itself a finding.

## Subscriptions (Pro tier)

`create-pro-checkout`, `pro-customer-portal`, `check-pro-subscription`,
`expire-subscriptions`, `subscription-reconciliation`, `subscription_waitlist`,
`subscription_cancel_reasons`, `helper_has_advanced_analytics`, `early_access_cutoff`.

- Entitlement is checked **server-side**, never from a client flag. A spoofable
  subscription state is a blocker.
- The full lifecycle: subscribe, renew, fail-to-renew, cancel, resubscribe, refund.
  What does a user lose at each point, and when exactly?
- `expire-subscriptions` and `subscription-reconciliation` are crons — if they stop, do
  users keep paid access forever, or lose it wrongly? Message `lh-cron-jobs`.
- Proration and mid-cycle changes. Does the displayed price match the Stripe charge?
- **Apple's rules:** if a subscription unlocks digital-only functionality inside the iOS
  app, Apple may require IAP rather than Stripe. Reach an explicit conclusion and hand it
  to `lh-compliance-store` — this is a plausible App Review rejection.

## Credit ledgers

Each of these is a balance that must never be spendable twice.

- **PIF (`pif_credits`)** — live. donor → available → reserved → redeemed → expired,
  90-day expiry. Verify: a credit cannot be redeemed twice or by two jobs concurrently
  (message `lh-concurrency-cache`); `restore_pif_credit_for_job` correctly returns it on
  cancellation; expiry actually runs; and `execute-dispute-split` handles a
  PIF-funded job correctly.
- **Referral credits** — live. `process_referral`, `check_referral_bonus`,
  `enforce_referral_cap`, `enforce_referral_credit_eligibility`, `record_referral_signup`.
  Verify the cap is enforced **server-side** and self-referral / ring-referral is
  impossible. This is the classic marketplace fraud vector.
- **Worker protection credits** — live, and **already a filed HIGH finding (SI-001)**:
  referenced by one file and zero edge functions despite a
  `pending → issued → applied → expired` machine. **Confirm or refute whether anything
  advances the status past `pending`.** If nothing does, helpers are promised
  compensation that never pays. Treat as a blocker until resolved.
- **Time banking (`time_credits`) is REMOVED** — do not audit as product. Its handling
  inside `money-reconciliation` is a removal finding for `lh-schema-integrity`.

## Boosts, auto-tip, instant payout

- `job_boosts` / `create-boost-payment`: what is bought, is it delivered, refunded if the
  job is cancelled?
- `/auto-tip`, `auto_tip_candidates`, `resolve_auto_tip`, `auto-tip-charge`: this charges
  a card **on a schedule without the user present.** Consent must be explicit and
  revocable, the amount predictable, and the charge must not fire twice.
- `instant_payouts` / `instant-payout` / `reap_stranded_instant_payouts`: **the existence
  of a stranded-payout reaper says this has failed before.** Find out how, and whether it
  still can.

## Mandatory

Stripe **test mode only**. Every ledger claim needs the balance before, the operation,
and the balance after — plus the Stripe object id where money actually moved.
