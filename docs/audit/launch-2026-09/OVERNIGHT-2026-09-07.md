# Overnight run — owner asleep from 2026-09-08 ~00:40 PT

Standing instruction (owner, verbatim): "Finish this out autonomously. If you need
anything you can do it yourself. If you have questions hold off until morning but do
not stop bc you are waiting on me always find something to do to finish the full
thing. Orchestrate the right model per lane."

## Decisions already given — do not re-ask
- Take-home stays FLOORED on cards; charge screens exact; the dispute split column is 2dp.
- ONE reputation, overall star only (sub-criteria dropped).
- Two fonts: Bodoni headings, Montserrat everything else. Wordmark stays Montserrat.
  Italics removed everywhere outside Bodoni headings.
- Identity verification ALWAYS required; the pause flag is deleted.
- Application cap = 100/day; per-minute/per-hour and signup caps stay OFF.
  GoTrue's 30/hour/IP platform limit stays as is.
- Ban reach = email + phone + verified-identity fingerprint. Refusal message is PLAIN
  to the user ("can't be created, contact support"); FULL detail to admins.
- Test accounts and fixture jobs STAY in prod (still testing).
- Launch switch stays OFF (seed jobs visible) until the owner says.
- Resend webhook secret: not rotated, owner's call.
- Admin credit-mint: not built.

## Questions to hold for morning
Anything that would change product behaviour in a way the owner has not already
decided. Write them here rather than stopping.

## Rules for every lane tonight
- LOOK AT IT: screenshot, then look. Measure second.
- Re-measure the finding's own number after the fix; a diff is not a fix.
- `git commit --only <paths>`, never `git add -A`; rebase --autostash; push.
- Never `git stash pop` in the shared tree.
- Shots go to the lane's own dir, never the shared scratchpad.
- The lead owns `npm run typecheck` / `vitest`; lanes use `node scripts/parsecheck.mjs`.
