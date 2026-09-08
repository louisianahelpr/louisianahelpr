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

## Not done, why

### AdminUsers.loadProfiles — narrow `select("*")` and add a page size (lh-perf-deps)
Scoped follow-up, deliberately NOT done in the perf pass. `src/components/admin/AdminUsers.tsx:156`
does `supabase.from("profiles").select("*")` with no column list and no limit.

Measured cost today: **8 rows / 23 KB**. It is a linear-growth risk at ~2.9 KB per
profile row, not a current bottleneck — nothing is on fire.

Both halves of the obvious fix are unsafe as a drive-by:

- **Narrowing the select** without narrowing the type ships a lie. `Profile` is
  `Database["public"]["Tables"]["profiles"]["Row"]` (`adminUserHelpers.tsx:12`), so
  TypeScript would keep asserting every column is present while the runtime object
  no longer has them. `AdminUserDetailDialog` would render `undefined` with no error
  and no type failure.
- **A page size** is worse. `getTabCounts(profiles, isUnseen)` derives all six tab
  counts from the full in-memory array (`AdminUsers.tsx:252`), so paginating makes
  every tab count silently wrong — a fix that reads correctly in review and is untrue
  on screen.

Doing it properly = thread a narrowed row type through ~8 files and move the tab
counts server-side (a count RPC or a view). That is its own pass with its own
verification, not a perf drive-by.

### /admin?view=people API fan-out — premise withdrawn (lh-perf-deps)
Not a latency fix and was not attempted. A throttled request/response timeline shows
the page is JS-gated, not API-gated: content @ 4867 ms, last JS response @ 3975 ms
(zero JS after content), and the 49-call fan-out is not even ISSUED until 4817 ms —
after content is on screen. Collapsing it into one RPC cannot move content time.
Unthrottled it looks the opposite (queries leave at 638 ms), which is how the premise
arose; always trace throttled.

The wasted-work half of it WAS fixed (`08f2c02eb`): `loadStats` ran its 20 queries on
every admin view, not just home.

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

## Ban evasion — closed 01:10 (ban-evasion, Opus)
- Reach = email + phone + verified Stripe Identity (no IP/device — parity test refuses them). User sees only "This account can't be created. Contact support at admin@louisianahelpr.com." (403, `retained_ban`); admins get the full record via `enforce_retained_ban` itself, one flag per attempt burst. Fraud console headline no longer "Unknown" for refused signups.
- BUG FOUND AND FIXED (lead, verified live): a pardon never released the fingerprint — `retained_bans` was built for deletion and inherited "never release"; a lifted user was re-banned at the next enforcement point. Now a trigger releases on `banned → active` from all three writers (sweep, admin dismissal, direct UPDATE); deletion-retained rows untouched; stranded rows released by the migration. PGlite 69/69; live 1→0 rows, re-check `banned:false`.
- Self-issued bans refused server-side (22023 with hint); 0 legitimate ones existed.
- Commits ededec184, 1b52588b2; db-deploy green; prod restored (0 retained, 0 flags, 0 banned, 0 fixtures).
- Process: this lane's live ban test used the shared admin account and stalled four lanes for ~9 min — lifted by the lead; fixture users only from here (lane memory saved).

### FOR THE OWNER — identity fingerprint backfill (one command)
Already-verified accounts carry no identity fingerprint (it is captured at verification time). Three qualify — lexilombas05@gmail.com and the two 0902 e2e accounts — and `profiles.idv_session_id` is stored, so `scripts/backfill-identity-fingerprints.mjs` can compute them (hash in-DB via `identity_fingerprint`, salt never leaves Postgres; dry-run by default, `--apply` writes). Not run: it needs `STRIPE_SECRET_KEY` locally (edge secret only) and one of the three rows is your own account. Run: `STRIPE_SECRET_KEY=… node scripts/backfill-identity-fingerprints.mjs` (dry run), then `--apply`.
