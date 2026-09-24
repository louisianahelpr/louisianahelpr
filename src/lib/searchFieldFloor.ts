/**
 * THE FLOOR FOR AN EXPANDING SEARCH FIELD: a field narrower than this cannot
 * show a word while you type it.
 *
 * Its own module, not a constant inside ScreenHeaderRow, for one reason: the
 * browser check that enforces it (`e2e/prod-audit/expanding-search-geometry`)
 * runs under `tsconfig.e2e.json`, which cannot pull in a `.tsx` component. A
 * literal restated in the spec would be a second source of truth for the one
 * number both sides are arguing about — the same shape of bug as the tab row's
 * own breakpoint. This is a leaf both can import, like `src/lib/consent.ts`
 * and `src/lib/inboxDefault.ts` already are for e2e.
 *
 * ── WHERE 120 COMES FROM ───────────────────────────────────────────────────
 * The field carries the magnifier at `pl-9` and the ✕ at `pr-10`, so 76px of
 * its width is chrome before a character is drawn. 120px leaves ~44px of text
 * — about six characters at the field's 13px — which is the least that can
 * still be read back.
 *
 * What it really guards is the REGRESSION. Measured on 2026-09-19 at 320px,
 * signed in: /posts 76px, /jobs 76px, /messages 42px, with the ✕ drawn
 * ON TOP of the magnifier on all three, and "oak tree" typed into the 375
 * field rendering as "ree". The field is the only flexible item on those rows
 * — title, held-open magnifier slot, icon cluster and gaps are all fixed — so
 * every new claimant's width comes out of it, silently, and neither the
 * overlap check nor the covers-nothing check can see it happen.
 */
export const MIN_TYPABLE_FIELD_PX = 120;
