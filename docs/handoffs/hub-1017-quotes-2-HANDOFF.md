# quotes-2 handoff (lane I, session 6; written 2026-10-17 ~00:20 CDT)

Branch: origin/wip/quotes-2 (worktree ~/.lh-wt/quotes-2). NOT landed, not ready/ yet (see "Left").

## Built (owner answers 8-12, docs/specs/owner-questions-hub-1015.md on origin/wip/declutter-terms)
- Migration supabase/migrations/20261017045002_quote_hire_on_pay_alerts.sql
  - 8: trg_quote_job_funded_hires_quoter (AFTER UPDATE OF payment_status ON jobs): on the FIRST funding
    (OLD unpaid/failed/abandoned/NULL -> funded) of a job booked from an agreed quote, checks
    direct_accept_block_reason, then complete_direct_offer_accept, or job_accept_pending when payout
    setup / ID is unfinished. Everything else -> error_logs. Never aborts the webhook's write.
  - 10: quote_notify_about (row + send-notification-email when p_email); submit_job_quote and
    respond_to_job_quote restated (main's bodies, only the new-quote / counter notice changed to email);
    sweep_quote_alerts + pg_cron 'quote-alerts' '11-59/15' (reminder ~4 h before 48 h ends; close notice
    with the quote count), claimed by markers job_quotes.reminder_sent_for / job_quote_requests.close_notice_sent_at,
    per-row isolation + log_cron_defect, gated by feature_enabled_for_user('quotes', recipient).
  - 11: cancel_quote_request restated: an agreed request's never-funded job (open, no helper, unpaid/abandoned,
    no session, no PI, customer_id = caller) is DELETED; FK violation -> request_booked in words.
  - 9: already the rule; now pinned in vitest (src/test/quoteHireOnPay.test.ts).
- 12: Wants Quotes row in the browse filter sheet (FilterSheet.buildJobFilterSections, BrowseTasksToolbar,
  Dashboard swaps BrowseTasksFeed for src/components/quotes/WantsQuotesFeed.tsx, map column steps aside);
  Quotes in DesktopSidebarNav and QuotesEntryRow on the Profile landing. OpenRow moved to
  src/components/quotes/OpenQuoteRequestRow.tsx (shared with /quotes).
- Tests: src/test/quoteHireOnPay.test.ts (static, 13 @mutate all RED), src/test/pglite/quoteHireOnPay.pglite.mjs
  (15/15 applied 3x; --before 12 fail + 3 controls hold; 12 planted mutants each RED),
  src/components/quotes/wantsQuotesFilter.test.tsx, quotesMenuLink.test.tsx (all @mutate RED).
  Registry: e2e/journeys/notifications/producers.ts (sql:quote_notify -> sql:quote_notify_about),
  seedNeverNotifiesReal emailers list, types.ts, retargeted @mutates in jobQuotes.test.ts / hireRefusedAcrossBlock.test.ts.
- OPEN.md: Q1872 ticked; new Q1883-Q1888; Q1865 progress note.

## Reviews (all opus, REVIEW ONLY)
- lh-authz-rls: approve (fe7c864e1; S1, S2, N2 verified fixed)
- lh-silent-failure: approve (fe7c864e1; M1/S1/S3 re-run against the guards' own parsers; S2 read)
- lh-money-escrow: approve (M1+S1 fixed and proven red/green; M2 open, logged, must be fixed before the 'quotes' switch leaves 'off')
  -> M2 = Q1883 (HIGH, owner pop-up needed). Trailers still to be put on the final commit.

## Left / next steps
1. Full local checks (~/.lh-shots/quotes-2/fullcheck.sh: inventories:refresh, check:generated --skip-post-merge,
   check:counts, typecheck, both land.sh vitest runs ALL chunks, ci-only + brief guards). See
   ~/.lh-shots/quotes-2/fullcheck.out for the last result.
2. Squash/final commit with the three Sensitive-Review trailers, push ready/quotes-2.
3. Visual look + loading measurement of the new UI is blocked until 'quotes' is on for testers (Q1888).
4. Q1883 (offer lapse / ACH) gates turning the switch on.

## Traps
- race-class: a DELETE FROM jobs must start its own statement (hence the PERFORM ... FOR UPDATE before it).
- mutateTargetsTheNewestDefinition: any @mutate on submit/respond/cancel must target 20261017045002 now.
- vacuity parser trims each @mutate field; multi-line finds use \n.

## STATE AT STOP (2026-10-17 00:55 CDT, 1-hour rule)
- Branch head: origin/wip/quotes-2 @ 294956046 (pushed; worktree clean).
- Full local checks NOT run: the heavy lock was held by "lander A recheck+land.sh" from 05:13Z through 05:55Z.
  What WAS run (single-file, outside the lock): typecheck (no errors, under the lock at ~05:12Z), eslint on all
  changed files (clean), check-race-class (0 new), check-loading-state-shape (pass), out-of-order restatements
  (0 conflicts), and these vitest files green: quoteHireOnPay, quotesMenuLink, wantsQuotesFilter, jobQuotes,
  hireRefusedAcrossBlock, mutateTargetsTheNewestDefinition, typesCoverMigrationFunctions,
  newDefinersAreAllowlisted, notificationProducersCovered, seedNeverNotifiesReal, openItemsHaveTier,
  reviewFindingsCarryATag, openNoDuplicateItems, queueItemsNameTheirGuard, openUnnumberedRatchet.
  NEXT: run `bash ~/.lh-shots/quotes-2/fullcheck.sh` (one lock hold; it waits for the lock), fix what it finds,
  then a final commit carrying the three Sensitive-Review trailers above, push ready/quotes-2.
- The fullcheck script still needs inventories:refresh output committed if it regenerates files.

## NEW ITEMS FROM THE LEAD (arrived at the stop; none started)
Read each in docs/OPEN.md on origin/main; tick each in the commit that fixes it, with its guard.
- Q1867 MEDIUM create-payment refuses an agreed-quote job whose budget != accepted price_cents (edge test in
  src/test/edge/; needs lh-money-escrow review). Natural to pair with Q1883's create-payment refusal.
- Q1868 LOW static test pinning the newest "Customers can create jobs" WITH CHECK beside quote_insert_job.
- Q1862 LOW create-payment allowlisted returnPath (/quotes/request/:id) for cancel_url (edge test; money re-review).
- Q1864 LOW a block closes the pair's pending quotes (block_user_and_settle; PGlite step in jobQuotes.pglite.mjs).
  Restate block_user_and_settle from main's NEWEST body (run the restate guard first).
- Q1871 MEDIUM two-session race proof on prod test rows (needs the switch on for testers; the repo's race method:
  fresh rows per round, Promise.allSettled, cleanup, see MEMORY "Race proofs").
- Q1873 LOW PaymentSuccess drops the Post a Job draft only when DRAFT_CHECKOUT_JOB_KEY == paid job id (test).
- Q1874 LOW fetchBookedJobPaid names refunded / cancelled separately (quoteScreens test per payment_status).
- Q1872: ticked on this branch (alerts built). Q1865: tick with a one-line note citing 232eb69a6 (screens landed)
  + this branch's Wants Quotes / menu work. Q1866 WAITS (export_my_data reconcile). Q1869/Q1870 wait for Shops.
