# Build queue — Louisiana hub (owner 2026-10-15: "launch 2-3 agents continuously until it's all done")

Lead (this session) keeps 2-3 agents running; when one finishes, the next unblocked item starts.
Every item's decisions are already recorded (specs below); agents never re-decide them.
Landing on main: one at a time via scripts/land.sh, coordinated with the lead session (louisianahelpr-c3).
Rules for every lane: AGENT-BRIEF.md; push WIP every 20-30 min; 1-hour rule handoffs in ~/.lh-shots/handoffs-1015/;
money/authz diffs need lh-money-escrow / lh-authz-rls REVIEW-ONLY + Sensitive-Review trailers;
heavy tests: targeted files + parsecheck while other lanes run; the FULL suite only right before landing.

| # | Item | Spec | Depends on | Status |
|---|------|------|------------|--------|
| 1 | Declutter slices 1-2 pass full CI + land | declutter-auctions.md | — | DONE: PR #3129 merged 2026-10-15 05:04Z; db-deploy ok; switch 'declutter' -> TESTERS 05:14Z (audited) |
| 1b | Declutter visual verification as testers on prod (every screen 375 + 1440, recordReview), re-measure the 3 loading-state routes, messy-input FORMS sweep for the 3 GAPS forms, fix defects | declutter-auctions.md 'Open after slice 2' | 1 + web deploy | DONE 2026-10-15 06:51Z: ready/declutter-visual 8086ff5da (6 fixes + guards, FORMS sweep), awaiting landing. LEFT: 1c below |
| 1c | Declutter loading skeleton: DeclutterGate renders blank while the switch loads (+754px jump on /declutter and /declutter/item/:id); give it a page-shaped skeleton, re-measure, add the routes to the loading catalog. Also: location prompt fires on open with job wording; AI photo fill has no retry on model 503 | ~/.lh-shots/handoffs-1015/declutter-visual.md | 1 | NEXT free lane (browser) |
| 1d | ALERT (main red, Coverage floor src/lib 80.67% < 81.17%, measured by lead on 3b551a8dc): unit tests for src/lib/declutter/api.ts (336 lines) and src/lib/declutter/errors.ts (no tests on main); never lower the floor; set coverage-baseline only if it ROSE | lead message 2026-10-15 | 1 | NEXT free lane (no browser) |
| 3a | Declutter slice 3/3b/F1/4 (offers, checkout, buyer fee, handover, seller payout, refunds): ready/declutter-4 34f710221, money + authz approve-with-notes, 6/6 chunks green; LAND after declutter-visual. Before the switch goes past testers: review should-fixes in declutter-auctions.md 'Open after slice 4' (gave-up refund alert + buyer notice, Dashboard-refund reconciliation, 24h webhook redelivery, PORCH PHOTOS IN THE PUBLIC job-photos BUCKET -> move to a private bucket) | declutter-4 handoff | 1 | READY TO LAND: ready/declutter-4 5025c13f4 (reconcile 20261015084728 + slice-4 email gate; authz approve-with-notes; 6/6 chunks + 10 CI-only guards green). Rentals must reconcile export_my_data on top of 084728 after it lands |
| 0g | GAP (CI guard): fail when a branch migration restates a function/view that a NEWER migration on main also restates (db-deploy --include-all applies the older one last and drops the newer change). Detector prototype ~/.lh-shots/restate-check.py | lead finding 2026-10-15 | 1 | BUILT: ready/restate-guard e7c6ea9fa (land.sh + migration-lint); red on old declutter-4, green on main/fee-flat/reconciled declutter-4. Lead c3 asked to review (edits land.sh) |
| 2 | [READY ready/fee-flat 36584b5c1 (memberships switch created at TESTERS; Apple purchase refused for non-testers)] Jobs flat fee 5% + $0.70 from the Helpr (poster pays job price; card cost inside; new jobs only; refunds minus card cost) + memberships (Pro) OFF + in-app boost purchases paused | louisiana-hub-roadmap.md F3, F4, F5 | — | lane B |
| 3 | Declutter buyer fee -> 5% + $0.70 (replace 15%/$1) + slice 4 (handover QR/4-digit, I-got-it, porch, auto-pay, seller payout + fee-debt, Report a problem/disputes, no-shows, address after paying) + slice-3b open items | declutter-auctions.md rows 13-28, 60, 67, 91-98, F1 | slices 3/3b branch | lane C |
| 4 | Trade categories in Jobs (T1-T2) + "Suggest a category" (I1) | roadmap T1-T2, I1 | — | DONE: merged PR #3138 at 2026-10-15 08:19Z (95175f37e); "suggest_category" switch = testers. LEFT: Q?trades-* items on OPEN.md |
| 5 | Declutter slice 6: admin (storm pause, strike appeals, review queue polish) + alerts | declutter-auctions.md rows 39, 44, 49 | 3 | queued |
| 6 | Rentals S1: maintenance requests -> Helpr jobs (invited tenants, approve -> draft job, emergencies, entry, done, recurring upkeep, auto-approve limit) | landlord-hub-prep.md Q37-Q48 | 2 | BUILT 2026-10-15 07:4xZ: ready/rentals-s1 e56f15b16 (on top of ready/fee-flat; money + authz reviews OK), owes land-vitest-changed; lands AFTER fee-flat. LEFT: 6b visual pass 375/1440 (HIGH) + 6 Q?rentals-* items |
| 7 | Quotes on jobs (Q1-Q8) | roadmap Q1-Q8 | 2 | queued |
| 8 | Declutter slice 5: Helpr delivery (after launch) | declutter-auctions.md rows 29-30, 40-43 | 3 | queued |
| 9 | Shops (makers, bakers, rentals of equipment, business profiles, boosts, appointments, punch cards, invoices, B2B, review links, rate cards) | local-shops-prep.md L1-L92, roadmap B1-B8 | 3 | queued |
| 10 | Rentals S2+: listings, tours, applications, leases (template), e-sign, rent tracker | landlord-hub-prep.md | 6 | queued |
| 11 | Hub features: storm hub, events, licensed pros, hiring board (jobs), deals/gift cards, community board, rewards, interest groups, skills tags | roadmap | various | queued |
| 12 | Navigation G2b (Home · Jobs · Declutter · Shops · Rentals) + Home "near you" feed + landing page update | roadmap G2b, G3, G4 | sections exist | queued |
| 13 | Spanish (S1-S4) | roadmap | all sections launched | queued |
