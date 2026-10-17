# Shops lane K handoff (2026-10-17 ~06:25Z), closed by the lead before finishing

BRANCH: origin/wip/shops-local @ fb94abb99 — NOT LANDED. ready/shops was NOT pushed: nothing on it has been tested.
Worktree: ~/.lh-wt/shops (local branch ready/shops, same sha). node_modules is a symlink.

## Stack of commits (on top of origin/fix/stack-export-wanted @ 113670a88)
- 4c381af1c slice 1 (was 3956d06a2), f2d29c9b8 guards (was d0d8aa296), d012e1739 slice 2 (was eb30a99b2): rebased onto the Declutter stack, with conflicts resolved by hand.
- fb94abb99 WIP: the re-cut, the export restatement, the Q placeholders and two re-review fixes. Its message lists them.

When the stack lands on main: `git rebase --onto origin/main 113670a88` (or whatever the stack's landed sha is, if it was re-cut), then re-check everything below.

## Done
- Re-reviews of the fix range 17747e0a9e..eb30a99b2 (both REVIEW ONLY, opus):
  - lh-authz-rls: **pass-with-notes**, no must-fix.
    - N1 closed (timestamptz round trip measured exact on prod; a NULL p_submitted_at is refused).
    - N3 closed (the trigger fires AFTER INSERT OR DELETE).
    - The restated reject_contact_leak_in_shop differs only in its message.
    - Nits, not built:
      - (1) withdrawing an approved item now drops its approval (stricter);
      - (2) items.ts reviewShopItem sends `submittedAt as string` without a client null guard;
      - (3) shops_set_item_stock still changes stock and lead time while an item is pending.
  - lh-silent-failure: **pass-with-notes**. All five earlier notes are closed.
    - Finding 1 (should-fix): BUILT in fb94abb99. ShopItemsSection shows the load error plus Try again and Back, instead of "isn't available any more", when the list reload failed.
    - Finding 2 (nit): BUILT for ShopItemsSection only. A "Couldn't refresh your items" line with Try again.
    - Two new tests are in shopItemsScreens.test.tsx, with @mutate lines. Not run.
    - Finding 2 is NOT built in ShopItemsList or ShopItemsReviewCard.
    - Finding 3 nits, not built:
      - the item_changed copy says "Reload the list", but the card already reloads;
      - a typed rejection reason survives onto the owner's new version, because the card is keyed by item_id.
  - Suggested trailers for the next real commit:
    - `Sensitive-Review: lh-authz-rls: pass-with-notes (re-review of 17747e0a9e..eb30a99b2; N1 and N3 closed)`
    - `Sensitive-Review: lh-silent-failure: pass-with-notes (re-review of 17747e0a9e..eb30a99b2; finding 1 fixed in fb94abb99)`
- Authz N2 (rejection undone by withdraw + re-create): already in ~/.lh-wt/OWNER-MORNING.md item 2 and in OPEN as Q?shops-items-rejection-reset. Not decided.
- Re-cut: 20261016212915_shops_items.sql is now **20261017060556_shops_items.sql** (minted with `npm run migration:new`). Every reference in the repo was repointed with sed (20 files).
- export_my_data in 060556 is restated from 20261017052706's body verbatim plus the shop block, inserted before RETURN. Body diff against 052706: 0 lines removed, 27 added. It carries 'declutter_wanted' and the helpr_* sections. The dataExportCoversEveryUserTable @mutate lines now point at 060556. crewBlockFeeLedger's export @mutate also points at 060556.
- check-out-of-order-restatements on the committed tree: 0 conflicts against both origin/fix/stack-export-wanted and origin/main.
- Queue numbers: the shop Q1881-Q1890 collided with main's different Q1881 and Q1882.
  - They are now placeholders, which land.sh numbers:
    - Q?shops-export (done, in the archive)
    - Q?shops-message-button, Q?shops-slices-2-4, Q?shops-rentals, Q?shops-boosts
    - Q?shops-business-tools, Q?shops-admin-queue, Q?shops-suggest-quote
    - Q?shops-stripe-id-check, Q?shops-map-pin
  - Code comments now name the item in words instead of a number.

## Left (in order)
1. Wait until the stack (and any section A train) is on main, then rebase.
   - If main's newest export_my_data is newer than 052706, restate it again from THAT body plus the shop block (the extract and restate scripts I used were in my scratchpad; the method: take the last CREATE of export_my_data in the newest file, append the block that starts with "-- Shops slice 1 (20261015123029) and slice 2" before `RETURN v_out;`).
   - If a migration newer than 20261017060556 lands first, re-mint the timestamp.
   - Re-run the restate guard.
2. Heavy checks under the lock, one at a time (lane brief step 3). NONE of them has run on this tree:
   - PGlite: shopsItems, shopsProfiles, nullArgNeverAllows, exportMyDataReconcile. shopsItems.pglite.mjs applies every migration except the two shop files first, then the shop files, so the stack's 0527xx run first.
   - typecheck, then eslint on the changed files, check-race-class, inventories:refresh, check:generated and check:counts.
   - Both land.sh vitest runs, all chunks, then the guards in ~/.lh-tools/ci-only-guards.txt.
3. Commit with the trailers above, then push ready/shops.

## Traps
- **Conflict resolutions to double-check** (made by hand, not tested):
  - userIdForeignKeys is 163. That is 152 from the stack, +5 for slice 1 and +6 for slice 2. The test will say if it is wrong.
  - featureSwitchRegistry keeps only the `"shops",\n] as const;` @mutate, because shops is now the last switch.
  - jobQuotes.test.ts keeps the stack's `"quotes",\n  // Declutter wanted posts` @mutate.
  - In null-arg-validators.sql, the VALUES list was merged: `;` became `,` after helpr_task_vehicle_fits. The fixture steps now include both 'delivery' and 'shop'.
  - docs/audit/form-inventory.md and toast-inventory.json were taken from the stack side. **Regenerate them** with inventories:refresh.
- The stack branch itself still has the authz notes N2 and N3 from its own review, and two commits with no trailers. Those belong to the stack's lane, not to this one.
- The new ShopItemsSection list-refresh button orders its props `size="sm" variant="outline"` on purpose. That keeps the existing first-load Try again @mutate string unique.
- Not done: the hint text at ShopItemEditor.tsx:264 and ShopEditView.tsx:260 ("members reach you in the app"), which was reported earlier and left unchanged.
