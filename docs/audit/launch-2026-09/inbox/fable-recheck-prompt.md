# Fable re-verification brief — trust nothing, re-derive everything

You are the SECOND model on this work. The first (Opus) shipped a long run of
pre-launch fixes and the owner does not trust any of it. Your job is not to
review its summaries — it is to independently RE-ESTABLISH every claim from
the world (live database, rendered UI, built bundle) and either confirm it
with evidence or refute it and FIX it. A claim you cannot re-prove is a claim
you report as unproven, not as done.

Repo: /Users/lexilombas/louisianahelpr — a Capacitor app (React 18 + TS +
Vite in `src/`, Supabase prod `fncmgoasalhdgfwzhsqa`, Stripe Connect in TEST
mode until the owner flips it). Read CLAUDE.md first; every rule in it is
mandatory. There is ONE database (staging was deleted 2026-09-05). Two test
accounts exist alongside the owner's two real ones; use the test accounts.

## The standard, in the owner's words
- "EVERY OUTCOME SHOULD BE MEASURED AGAIN EVERY SINGLE TIME." A fix is not
  done until it is re-measured after the change, by you, against live state.
- "EVERYTHING SHOULD ALSO BE DONE BY EYEBALL VISUALLY." Every screen you
  touch or verify gets driven in Chrome at 375 AND 1440, light AND dark, and
  LOOKED AT. A grep is not a visual check. A DOM measurement is not a visual
  check. Screenshot and look.
- "Never say X is broken or fixed from migration files or agent summaries."
  Verify against `pg_policies`, `pg_proc.proacl`, `pg_get_functiondef`, the
  rendered page, or the `dist/` bundle — never against the source that
  claims to produce them.
- Registries checked against themselves cannot fail. Derive every set from
  the world, then diff against the list.

## Recheck list — each of these was claimed fixed. Re-prove or refute.
1. Hiring blocker: `helper_award_block_reason` unified identity verdict.
   Prove: a verified helper on a funded job can be hired; an unverified one
   cannot; the paused case behaves as documented. Live RPC, not the file.
2. Verification email `BrandButton` — render the template and assert the
   `<a>` survives; then send one to a test account and open it in Gmail.
3. Signup: password minimum 12 enforced server-side on signup AND reset; ZIP
   → parish derived by trigger for ALL 720 rows (count the table; try a ZIP
   from the last-added block; try one that is not in the table).
4. Guest browse 401 — fetch `open_jobs_browse` / `get_public_open_jobs` as
   anon with curl and show the status.
5. `rpc_withdraw_dispute` callable by every legitimate caller (proacl + an
   impersonated call inside a rolled-back transaction).
6. Earnings $0.00 — seed exclusion; confirm a real completed job shows.
7. Anon SECURITY DEFINER count (claimed 58→33): re-count from `pg_proc`,
   and for each remaining one argue it is safe or fix it.
8. Location oracles: `open_jobs_browse` coordinates are 2dp; no RPC lets a
   caller choose the aggregation set (trilateration). Try to break it.
9. Distance filter on `/dashboard`: geodata first, signup ZIP fallback,
   `parish = null` never used as the answer. Drive it with an account that
   has no geodata.
10. Dispute description required server-side; escalation notifies admins
    server-side. Call the RPCs with bad input.
11. Email master switch — flip it, send, confirm nothing goes out; flip back.
12. Memberships: `create-pro-checkout` `customer_update` only when a customer
    exists; Plus tier exists in PRO_PRICE_MAP for every cycle; live Stripe
    price amounts match displayed amounts (ask Stripe, not our code).
13. Apple IAP: `verify-apple-iap` and `apple-app-store-notifications` update
    by `user_id` and assert a row was touched. Read the functions; there is
    no device path yet, so this one is code + a reasoned argument.
14. Anon EXECUTE revocations: every function revoked `FROM PUBLIC, anon`, not
    just PUBLIC; verify `proacl` has no `anon=X` on anything admin-shaped.
15. **IN FLIGHT — do not edit, do verify after:** a lane is gating
    application + hire on `payment_status` (an unpaid job was applicable and
    hireable by id). When its migration lands, re-run the attack: post, abandon
    checkout, apply as the other account via `/jobs/<id>`, try to hire.
16. Visual: the inner-box removal on EmptyState dock variant + Home/Post/Jobs.
    At 375 light+dark: exactly ONE rounded box, no square corners anywhere,
    no ~250px dead band under content. Screenshot each. If any square corner
    remains anywhere in the app (`pageCardSurfaces.ts:67` sets
    `borderBottom*Radius: 0` inline), find every consumer and show it.
17. Timezone: `jobStartDateTime` routes through `jobLocalStartMs`; a job
    posted for 9am Central renders 9am for both accounts, and a bad date
    string returns null rather than Invalid Date.
18. Payout: the owner's loop report said payout had a finding. Find what it
    was in `docs/audit/launch-2026-09/findings.jsonl`, and re-run the payout
    with Stripe test cards end to end.

## Then: the full visual drive
After the list, drive every screen and every state — empty, with content,
loading, error — on both accounts, 375 + 1440, light + dark. Log anything
inaccurate, inconsistent, misaligned, square, cut off, or lying about data.
Fix what you find. Re-measure after each fix.

## Rules
- Fix, don't just report — but demonstrate the defect BEFORE the fix, and
  re-measure AFTER. Both go in your report.
- Migrations via `npm run migration:new -- <slug>`, replay-safe, proven in
  PGlite installed outside the repo, applied 3×. Never MCP `apply_migration`.
  Never write to prod outside a rolled-back transaction, except through the
  app's own UI on the test accounts.
- Do not run `npm run typecheck` / vitest / eslint while other agents are
  active; use `node scripts/parsecheck.mjs`. The lead runs the gate.
- Commit direct to main, one concern per commit, end with
  `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- Never idle. Never ask "shall I continue." Batch questions to the end.
- Report as a table: claim | how you re-proved it | verdict | evidence path.
  Refuted claims first.
