# Done queue items — archived from docs/OPEN.md (2026-10)

Historical record, not a work list. Every item here was ticked [x] in
docs/OPEN.md and was moved verbatim by `node scripts/archive-done.mjs --write`
(run by `npm run inventories:refresh`; docs/OPEN.md Q16). The queue tools still
read this file with docs/OPEN.md: the score line and next free number
(scripts/queue-count.mjs), the Everything-open block (scripts/scoreboard.mjs)
and src/test/queueItemsNameTheirGuard.test.ts. To REOPEN an item, move its
block back into docs/OPEN.md and untick it (a number in both files fails the
duplicate-number check).
