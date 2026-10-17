# Cloud landing-train handoff, 2026-10-17 (~06:40Z)

From cloud session session_01HZVMjkMcFfvniSkSs6REsS to the local
"Auction app strategy and delivery pricing" session. Every SHA below was read
with `git ls-remote origin` at handoff time. Nothing from this train is on main
yet. No land.sh is running (attempt 6 of the old stack failed on its own at
openRenumber and never opened a PR).

## Landing order (one at a time, land.sh)

1. **fix/stack-export-wanted @ 113670a88c** (the Declutter stack: lane J ×7, porch default ×5, slice 5 Helpr delivery, follow-ups). REPLACES land/declutter-stack and origin/wip/declutter-stack (a29a347069): same content, re-cut.
   - Why it was re-cut: main gained 20261016053541 (wanted posts, deployed) at 05:07Z, so lane J's three migrations and porch's were older than prod's newest. All six stack migrations are re-stamped with migration:new: 20261017052700/01/02/04/05/06. The newest export_my_data (052706) carries 053541's `declutter_wanted` section.
   - /posts budget: the stack alone measured 361 KB gz (budget 342; +5% = 359.1; main = 359). 113670a88c lazy-loads DeliverView/OrderDeliveryPanel and moves the helpr_* RPC copy and taskPhotoUrl into src/lib/helprTasks/ -> 360 KB. The owner accepted up to 360 KB, so the budget is set to the measured 360 with a note.
   - Verified: tsc 0; the PGlite proofs declutterDelivery 169/0, HandoverBucket 20/0, PorchDefault 22/0, RefundHandSettle 50/0, WantedPriceHint 101/0, Slice4 136/0, nullArgNeverAllows ALL PASS; targeted vitest green; `critical-path.mjs --check` green; `check-deferred-vendors` green.
   - land-vitest-changed: chunks 1-3 of 6 passed at handoff; chunks 4-6 were still running in ~/.lh-stackfix (log: the cloud session's scratchpad, sf-changed2.txt). The named-test set (land's second vitest run) has NOT been run.
   - Reviews:
     - lh-authz-rls on 446e378eb5 + 113670a88c: **pass-with-notes**. Notes:
       - N1: if db push fails between 052701 and 052706, the wanted export goes missing until it is fixed. Watch db-deploy.
       - N2: exportMyDataReconcile.pglite.mjs never applies 053541 and lacks `declutter_wanted` in DECLUTTER_SECTIONS; add both.
       - N3: in DeclutterHomeView.tsx:32-36, a `const` sits between the imports.
     - The earlier commits carry their Sensitive-Review trailers (delivery: three; porch: money + authz).
     - **The two new commits (446e378eb5, 113670a88c) carry NO Sensitive-Review trailer yet.** Add `Sensitive-Review: lh-authz-rls: pass-with-notes (...)` before landing, or record it with check-sensitive-review.mjs.
   - Before land: if section A's export reconcile (20261017044046) or rentals (20261017044117) reached main first, 052706 must be restated again from main's then-newest export_my_data body (the lead flagged this).
   - After merge: confirm db-deploy, prod-deploy and open-auto-tick are green, then check `pg_get_functiondef('public.export_my_data(uuid)')` contains 'declutter_wanted' and that proacl is service_role only. Also port porch-default's extras from wip/declutter-porch-default @ cf0ac4ee4: the `.gt("checkout_by", now)` filter plus its comment in porchRefused (supabase/functions/declutter-checkout/index.ts), and the OPEN item Q?declutter-porch-fallback-removal. The stack already has the fallback code.
   - Delivery visual pass (Q?delivery-visual-pass) after deploy.
2. **ops/operating-rules @ f695d8fbd7**: .claude/OPERATING.md (the operating standard), the CLAUDE.md pointer, the AGENT-BRIEF pointer, the Q?landing-queue-1017 item, a sensitive-review record for 971207fb9, the OPEN items Q?contrast-unresolved-messages and Q?post-job-stale-cleanup-photos, and queue lines for reds-e2e/reds-webkit. The owner-decisions copy is dropped; the lead's Q1902 on ready/open-dedupe-1017 carries it. Do NOT land docs/owner-decisions-1017 (per the lead).
3. **ready/train-shops-1 @ d0d8aa296f**, then **ready/shops-2 @ eb30a99b23**:
   - shops-2 is cherry-picked onto train-shops-1 by the shops2-fix agent, with review fixes in progress. Its final report had not arrived at handoff; read the branch log.
   - Open review notes on shops-2 (603408318e reviews):
     - lh-authz-rls pass-with-notes: N1 (an admin approves content changed after the queue loaded: pass submitted_at and refuse item_changed); N2 (rejection undone by withdraw + re-create: OWNER DECISION, file it); N3 (photo swap keeps admin_approved_at).
     - lh-silent-failure pass-with-notes: the ListingPhotoError branch in src/lib/shops/errors.ts; isError-before-editor in ShopItemsSection; cleanup Sentry; contact-leak copy names a Message button that doesn't exist; render tests.
   - Both re-reviews are owed on the fixes. Before landing: rebase onto main after the stack; restate export_my_data from the stack's 052706 body plus the shop sections (otherwise it erases the wanted/delivery sections); re-cut 20261016212915 newer than 20261017052706.
4. **ready/train-big-1016 @ 3ab475e0ab**, **ready/train-sec-a-money-1016 @ 19ba8bb338**, **ready/train-sec-b-10-1016 @ 2b95ddbad0**: prepared earlier, not landed. train-big carries the Playwright 1.63.0 pin (nightly-webkit #2962), PR #3150's content and sec-c-train. Close PRs #3176 and #3150 after train-big merges, with stranded-accepted entries. I checked that the local land-* branches are fully contained in these (git cherry: 0 missing).
5. **ready/declutter-haul-away-v2 @ a6b60cd85b**, on 446e378eb5:
   - Migration 20261017053118. All money/authz findings are fixed. /posts measured 361 on the pre-perf stack; it adds 0 KB to signed-in-shared.
   - Reviews at handoff: lh-money-escrow and lh-authz-rls running; lh-silent-failure not started. No trailers yet.
   - Rebase onto the stack's final head before landing.
   - Note from the lane: the client can't delete photos after the row is deleted (the storage policy needs the row), so they are left for the weekly orphan sweep. A new storage policy would be the owner's call.
6. **ready/declutter-add-a-helpr-v2 @ 4f45a073fc**, on 446e378eb5:
   - Migration 20261017053140. All findings A–I are fixed (age gate, ban gate, require_feature on both RPCs, job_already_funded refusal, Q?addhelpr-refund item).
   - Vacuity 43/43 (before the re-cut). The proof's BASE_REFS default is `origin/main origin/fix/stack-export-wanted`; change it to `origin/main` after the stack merges.
   - Reviews owed: lh-money-escrow, lh-authz-rls, lh-silent-failure on `446e378eb5..4f45a073fc`.
7. **ready/declutter-moving-out @ f868904308**: its own session started land.sh (PR #3285 in CI, per the lead). It overlaps no stack function (checked).
8. Reds lanes (not verified, not ready/):
   - **wip/reds-e2e @ 8892fe4693** (the lane's report was at 2f0dcec75): dispatch 39004547274 restores helper-e2e; no full vitest yet.
   - **wip/reds-webkit @ 356e65e964**: create-payment.test.ts timed out once; re-run it alone. Read the WebKit leg of 39003252698.
   - **wip/reds-guards @ 6fd2dc8ee7**: full vitest was running. Its migration 20261017044924 is older than the stack's: whichever lands second re-cuts.
9. Lane J PGlite forged-client-row step (from 16e484744), fix/quote-cap-live-only (d3e01b627), ready/outreach-spec (9b778a4e4): not touched in this session after the summary; see the Q?landing-queue-1017 item.

## Owner answers recorded (2026-10-17)
- Lane defaults are approved (B59-B77, H1-H11, M1-M11, W1-W17, A11).
- M12: one statement per batch.
- Delivery late fall-through: refund all minus the card fee (built).
- /posts: accept up to 360 KB, else lazy-load.
- Via the lead: the lead releases 1.0.4 through the ASC API; a banned seller's card fee becomes seller fee debt (the local hub session builds it after the stack lands).
- Still open: domain renewal before 2026-11-13 (Q1813), outreach OD1-OD12/C1-C6, and the shops N2 rejection rule.

## Not verified by this session
- Nothing was checked against prod (the Supabase MCP failed: ERR_PROXY_TUNNEL).
- No full vitest run on any final tree.
- No screenshots.

## Update ~06:50Z: shops-2 final (ready/shops-2 @ eb30a99b23)
One squashed commit on ready/train-shops-1 @ d0d8aa296f. Fixed:
- authz N1: `shops_admin_review_item(..., p_submitted_at)` refuses `item_changed`; the client passes the server string unchanged.
- authz N3: the photo trigger clears admin_approved_at.
- silent-failure: the ListingPhotoError branch; error shown only with no data, plus Try again; `removeShopObjects` reports short/failed deletes to Sentry; the contact-leak copy is truthful (slice 1's `reject_contact_leak_in_shop` is restated too); render tests for fixes 2-5 and nits 7 and 9.

Filed, not built: `Q?shops-items-rejection-reset` (N2), an owner question.

Verified:
- PGlite 156/0 ×3, skip 0/156, pre-fix 130/26; slice 1's proof 98/0.
- tsc 0; eslint clean; targeted vitest 13 files / 75 tests.
- vacuity 43/43; inventories and counts OK.
- Not run: the full suite.

Still before landing:
- the authz and silent-failure re-reviews of the fixes. The range is `git diff 603408318e eb30a99b23 -- <files listed in the agent report>`; the fix-only base 17747e0a9e exists only in the cloud worktree;
- rebase onto main after the stack, restate export_my_data from 052706 plus the shop sections, and re-cut 20261016212915 newer than 20261017052706;
- Sensitive-Review trailers.

Reported, not changed: the hint text at ShopItemEditor.tsx:264 and ShopEditView.tsx:260 still says "members reach you in the app".
