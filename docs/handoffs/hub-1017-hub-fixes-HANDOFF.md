# hub-fixes (lane T2) handoff — 2026-10-17 ~01:06 CT

BRANCH: origin/wip/hub-fixes @ bc79e230c — NOT LANDED. ready/hub-fixes NOT pushed: the repo-wide checks never ran.
Worktree: ~/.lh-wt/hub-fixes (node_modules symlinked). One squashed commit on top of merge-base 7b4eceb3f.
It carries the trailer `Sensitive-Review: lh-money-escrow: APPROVE WITH NOTES`.

## Items
- Q1831 DONE (ticked [x]). The 12 trades are taxed like handyman in:
  - supabase/functions/_shared/salesTax.ts
  - src/lib/salesTax.ts
  - migration supabase/migrations/20261017055441_trades_taxed_like_handyman.sql, which restates enforce_funded_category_tax_class and is_category_taxable with grants restated.
  - Prod had 0 jobs in a trade category (measured).
- Same migration, ALSO FIXED: a live bug in enforce_funded_category_tax_class.
  - Since 20260924082243 it has written `COALESCE(OLD.category, '')` on the job_category enum, so every poster category edit raises 22P02.
  - How it was measured: PGlite running main's trigger verbatim; prod raising 22P02 for `select coalesce('cleaning'::public.job_category,'')`; the reviewer's read-only DO block on prod.
  - EditJobDialog saves with a direct jobs update, so the trigger always ran. Now `::text`.
- Q1833 DONE. is_category_taxable now uses the same list (cleaning, yard_work, moving, painting and delivery were labelled Taxable but never taxed).
- Q1835 DONE. LICENSE_WARNINGS.moving in src/components/postjob/detailsSection/detailsSectionConstants.ts.
  - The copy covers hauling only, because labor-only help was not confirmed.
  - NOT screenshotted: it is a copy-only change to an existing component. Someone should look at it at 375.
- Q1832 DONE. New supabase/functions/_shared/categorySkillMatch.ts (zero imports).
  - instant-job-match uses it.
  - It gets an edge-harness rewrite rule placed after stalledCompletion, away from the declutter-stack's harness hunks.
  - New export skillChipLabel in src/lib/jobCategories.ts; ProfileEditForm uses it.
- Q1834 SKIPPED. The item says the trade checklists and ranges must come from the owner or a researched source (never guess prices; the materials list has $ ranges too).
  - Noticed, not changed: pricingGuide.ts is cited in src/pages/info/helpCenter/helpCenterContent.ts:166, but only in a comment.
- Q1836 SKIPPED.
  - (a) origin/wip/declutter-stack changes src/components/declutter/DeclutterSellView.tsx (checked with a merge-base diff).
  - (b) is still an owner question.
- Q1852 SKIPPED. The stack adds declutter_seller_hidden to scripts/ci/null-arg-validators.sql and edits scripts/ci/definer-exec-allowlist.json, which the fix must change. No authz review was spawned.
- Q1863 SKIPPED. The stack changes supabase/functions/_shared/purgeBuckets.ts IDENTITY_SUBFOLDERS, which is the list the fix must read. It adds private buckets that may not exist yet.
- Q1837, Q1838 SKIPPED.
  - Q1837 needs measure-loading-states (Playwright) against a live is_seed declutter fixture.
  - Q1838 needs a browser measurement of the rail.
  - No Playwright or browser work was authorised for this lane.

## Proofs (all single-file runs, red on main's state, green on the branch)
- salesTax.parity.test.ts: 10/10 green.
  - Red with the migration removed: 3 failing.
  - Red with main's edge salesTax.ts: 5 failing.
- EditJobDialog.taxClass.test.tsx: 3/3 green; red with the migration removed.
- licenseWarning.test.tsx: 8/8 green; red with main's detailsSectionConstants.ts (2 failing).
- instant-job-match.test.ts: 11/11 green; red on the old substring matcher (missed 8 categories, including yard_work, pet_care, auto_repair and events).
- PGlite `node src/test/pglite/tradesTaxedLikeHandyman.pglite.mjs`: 6/6, with the migration applied 3x. `NEW_MIGRATION=skip` gives 5 failures.
  - The ACL failure in the skip run is only PGlite's default-ACL stub; prod's ACL is already service_role only.
- The @mutate lines were not run through vacuity.

## NOT RUN (left to the lander)
- typecheck
- eslint
- check-race-class
- inventories:refresh + check:generated + check:counts. The OPEN.md counts were rewritten with queue-count --write; inventories may still regenerate.
- Both land.sh vitest runs (all chunks)
- ci-only-guards

My runner (scratchpad checks.sh) waited on lander2's lock the whole time and never got it; it has been killed. I never held ~/.lh-heavy.lock.

## Money review (lh-money-escrow, opus): APPROVE WITH NOTES
- Every consumer reads _shared/salesTax.ts or src/lib/salesTax.ts; no other copy of the list exists, in source or on prod.
- The trades use the same Stripe code as handyman (Repair of TPP, the only code that taxes in LA).
  - For real-property trades this may over-collect. That is an owner/CPA call: attach it to the pending tax-advisor question.
- Grants match prod. Replay-safe. No out-of-order restatement.
- No open checkouts or recurring series are in trade categories.
- Note: the export's tax column is a category rule applied to past rows. `sales_tax_amount > 0` would be stable over time (not blocking).
- Note: the web bundle can lag up to 20 minutes behind the edge, so in that window a trade job's checkout quote shows no tax and Stripe adds the tax line. Build 7119 cannot pick trades.

## Traps
- Diff against the declutter stack with THREE dots (`origin/main...origin/wip/declutter-stack`). Two dots counts main's newer files as stack changes.
- The migration timestamp 20261017055441 must stay the newest restatement of both functions. Run the restate-guard before landing.
