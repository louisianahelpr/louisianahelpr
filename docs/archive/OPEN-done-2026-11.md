# Done queue items — archived from docs/OPEN.md (2026-11)

Historical record, not a work list. Every item here was ticked [x] in
docs/OPEN.md and was moved verbatim by `node scripts/archive-done.mjs --write`
(run by `npm run inventories:refresh`; docs/OPEN.md Q16). The queue tools still
read this file with docs/OPEN.md: the score line and next free number
(scripts/queue-count.mjs), the Everything-open block (scripts/scoreboard.mjs)
and src/test/queueItemsNameTheirGuard.test.ts. To REOPEN an item, move its
block back into docs/OPEN.md and untick it (a number in both files fails the
duplicate-number check).

## Archived 2026-11-01 — from "FEEDS — mirrored from the alert ledger, nightly-red issues and the audit bus (node scripts/open-sync-trackers.mjs)"

- [x] **Q2547 MEDIUM db-deploy failed on main.** Mirrored 2026-11-01 from alert-ledger row 54ef0bfdcec3 (workflow: db-deploy; `node scripts/ops-alert-ledger.mjs list`) by `scripts/open-sync-trackers.mjs`: find the root cause, fix it, re-run the source's own detector. feed: ledger 54ef0bfdcec3. done-when: sql `SELECT status FROM public.ops_alert_ledger WHERE fingerprint = '54ef0bfdcec3bbc35e6f8e9764306afc'` => closed **DONE 2026-11-01 (auto-tick, verified live): every done-when marker on this item read as expected on prod (got closed, want closed).**
