# rentals-s1 handoff (lane F, end of session 6, 2026-10-17 ~05:32Z)

Worktree ~/.lh-wt/rentals-s1, branch ready/rentals-s1 (local). PUSHED ONLY TO wip/rentals-s1 @ 61edc38e8.
origin/ready/rentals-s1 is still the OLD 6ed71a3f2 (on old main 35b616cf8): NOT ready, do not land it.
Base: origin/main 64948824e.

Commits on main (oldest first):
- 1c9948756 feat(rentals) S1: sessions 1-5 squashed (4 commits -> 1, messages verbatim incl. all Sensitive-Review trailers), rebased.
- f2bdde8f1 session 6 rebase + export_my_data reconcile 20261017044117 (lh-authz-rls: approve, trailer on it).
- 24cf62603 owner decision 2026-10-17: landlord never sees which admin reviewed the proof (lh-authz-rls OK-with-nits, N1-N3 fixed, trailer on it).
- 61edc38e8 WIP, UNVERIFIED: removed the null-arg twin's stub job_offer_cutoff (conflicts with the verbatim newest def:
  "cannot change name of input parameter p_date"); made the staff-drop PGlite check `!skip &&`. Squash into 24cf62603
  (or f2bdde8f1 for the twin part) once verified; fix its message.

Measured so far:
- PGlite rentalsMaintenance.pglite.mjs on 24cf62603: 122 PASS / 0 FAIL. NEW_MIGRATION=skip: 2 PASS / 120 FAIL; one of the 2
  ("notice dropped") was vacuous -> 61edc38e8 adds !skip; rerun skip expecting 1 PASS (the inventory sanity check).
- Reconcile planted defects (RECONCILE_PATH): rental_tenancies key renamed -> 1 FAIL; 061259's older body -> 1 FAIL; GRANT
  to authenticated -> 1 FAIL.
- restate check (`node ~/.lh-wt/restate-guard/scripts/check-out-of-order-restatements.mjs --base origin/main`): 0 conflicts
  (1 without the reconcile, reviewer measured).
- nullArgNeverAllows.pglite.mjs is broken ON MAIN: duplicate CREATE TABLE ban_settlement_queue (42P07, fixed in f2bdde8f1)
  then the duplicate job_offer_cutoff stub (fixed in 61edc38e8, NOT yet rerun).

NOT DONE (all need the heavy lock; it was held by lander A then lane H restate-guard for most of the hour):
1. Rerun: NEW_MIGRATION=skip rentalsMaintenance proof; nullArgNeverAllows twin (expect ALL PASS incl. rentals_caller_is_active_tenant_of).
2. npm run typecheck (RentalProperty is now Omit<Row,'ownership_reviewed_by'>; check rentalsScreens.test.tsx fixtures still type).
3. npx eslint --quiet on changed .ts/.tsx/.mjs (git diff --name-only origin/main..HEAD).
4. node scripts/check-race-class (whatever the lead's command is; was clean in session 2).
5. npm run inventories:refresh, check:generated --skip-post-merge, check:counts (generated docs were taken from main and NOT
   yet regenerated: docs/audit/form-inventory.md, docs/audit/toast-inventory.json, others).
6. land.sh run 1, all chunks: node ~/.lh-tools/allchunks.mjs ~/.lh-wt/rentals-s1 ~/.lh-shots/rentals-s6-run1
7. land.sh run 2, all chunks: node ~/.lh-wt/rentals-s1-run2.mjs ~/.lh-wt/rentals-s1 ~/.lh-shots/rentals-s6-run2
   (keep-going copy of land.sh's --files $NAMED_TESTS + fixed list).
8. CI-only guards: npx vitest run src/test/<name>.test.ts for each name in ~/.lh-tools/ci-only-guards.txt.
EXPECTED red until land.sh numbers them: openUnnumberedRatchet (10 Q? placeholders; land.sh assigns numbers).
Then push ready/rentals-s1 --force-with-lease (hooks off) and report "rentals ready <sha>".

Conflict resolutions (28 files): keep-both everywhere (quotes/Declutter + Rentals). Exact counts recomputed:
userIdForeignKeys 157 (149 + 8; NOT yet run), App.tsx size 606 (component-size-baseline --write). measurements.json:
main's + branch's 9 Rentals surfaces via --merge from a partial rebuilt from 6ed71a3f2's file (166 surfaces, +1189/-0).
OPEN.md item by item; Q?nullarg-twin-broken dropped (main's Q1784 is that crash; but see the twin note above: main's twin
is broken again by two duplicate stubs, fixed here).

Traps: mutate lines on export_my_data must target 20261017044117 (newest). Any later export restatement must start from
20261017044117's body. Q1866 (quotes export) waits for this branch to land.

## Session 7 (2026-10-17 05:31Z-05:46Z), stopped early (harness forced handback)
- wip/rentals-s1 = local ready/rentals-s1 = 68aa24a79 (61edc38e8 squashed into 24cf62603, trailer kept, message gained a
  PGlite-harness bullet; tree identical to 61edc38e8). origin/ready/rentals-s1 still OLD 6ed71a3f2.
- MEASURED (no lock needed, logs ~/.lh-wt/rentals-s1-logs/): rentalsMaintenance NEW_MIGRATION=skip 1 PASS / 121 FAIL
  (the inventory sanity check only); green 122 PASS / 0 FAIL; nullArgNeverAllows twin ALL PASS (rentals_caller_is_active_tenant_of
  loaded @20261015061259).
- MAIN MOVED: 7d2666724 adds 20261016053541_declutter_wanted_price_hint.sql which RESTATES export_my_data (084728 body +
  declutter_wanted). Section A (origin/wip/lander-a-1017) carries 20261017044046 built on 053541's body (verified: contains
  7d2666724, 044046 has declutter_wanted). A's land.sh held the heavy lock from 05:13Z; A not merged at 05:43Z.
- NEXT: after A merges: rebase onto origin/main; rebuild 20261017044117 = 044046's body + the 13 rentals lines (diff of
  b084728.sql vs b044117.sql in the logs dir; extractor ~/.lh-wt/rentals-s1-logs/fnbody.py); update header comment to
  name 044046; repoint @mutate lines in dataExportCoversEveryUserTable.test.ts (23) + crewBlockFeeLedger.test.ts (1) to
  044117 and pick up main's new ones (declutter_wanted; user_strikes ones A dropped); body diff vs 044046 = only +13;
  restate-guard 0 conflicts; rerun rentals PGlite green+skip. Then steps 2-6 of the session-6 list under the lock.
