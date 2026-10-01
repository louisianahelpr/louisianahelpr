# Done queue items — archived from docs/OPEN.md (2026-10)

Historical record, not a work list. Every item here was ticked [x] in
docs/OPEN.md and was moved verbatim by `node scripts/archive-done.mjs --write`
(run by `npm run inventories:refresh`; docs/OPEN.md Q16). The queue tools still
read this file with docs/OPEN.md: the score line and next free number
(scripts/queue-count.mjs), the Everything-open block (scripts/scoreboard.mjs)
and src/test/queueItemsNameTheirGuard.test.ts. To REOPEN an item, move its
block back into docs/OPEN.md and untick it (a number in both files fails the
duplicate-number check).

## Archived 2026-10-01 — from "FEEDS — mirrored from the alert ledger, nightly-red issues and the audit bus (node scripts/open-sync-trackers.mjs)"

- [x] **Q888 refresh bot force-pushed over a person's fix on its PR.** 2026-09-30: `.github/actions/refresh-pr` rebuilt bot/refresh/<id> from main and force-pushed it every run, so 90fa25368 (a human fix on bot/refresh/loading-states, PR #1932) was wiped by the bot's 926ebcbe0. Fixed: every bot-branch push now goes through `scripts/ci/bot-branch-push.sh`, which replays non-bot commits onto main with the fresh measurement on top, refuses (exit 3, `::error::` + PR comment naming the commits, nothing pushed) on any conflict or hand-edited merge, and pushes only with `--force-with-lease=<ref>:<sha it read>`; the no-change path rebases instead of closing and deleting a branch that carries a person's commit. Guard: `src/test/botBranchPushKeepsHumanCommits.test.ts` (no direct git push in any workflow/action YAML; lease-only pushes; 9 behaviour cases against a throwaway git repo) — red 11/11 on main, vacuity 6/6 killed.
