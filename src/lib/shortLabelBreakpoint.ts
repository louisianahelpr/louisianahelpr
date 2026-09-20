/**
 * THE WIDTH BELOW WHICH `UnderlineTab.shortLabel` REPLACES `label`.
 *
 * A LEAF MODULE, for the same reason `src/lib/searchFieldFloor.ts` is one:
 * the browser check that reads the painted word off the screen
 * (`e2e/prod-audit/activity-tabs-visible.spec.ts`) has to compare it against
 * the SAME number the component swaps on, and importing UnderlineTabs itself
 * would drag haptics, accessibility and safeStorage into the e2e tsconfig.
 * `UnderlineTabs` re-exports it, so that is still where a reader of the
 * control will find it.
 *
 * ── WHY 390, MEASURED RATHER THAN CHOSEN ───────────────────────────────────
 * The five long words at `tight` density (11px labels, 12px gaps) measure
 * 333px of content — down from 372px at the 12px/16px the row shipped with.
 * The scroller they sit in is the title card bled to its edges, so it clears
 * `viewport - 42px`: 278px at 320, 333px at 375, 372px at 414.
 *
 * 333 into 333 is a fit with ZERO margin, and the scroller's own trailing
 * padding eats it — which is why 375 takes the short words even though the
 * arithmetic says the long ones "fit". One Dynamic Type step, a second digit
 * in a count, or a longer future word would each erase it again. 414 clears
 * the long words by 39px and keeps them.
 *
 * 390 is the phone width between those two (iPhone 14/15/16 at 390, SE at
 * 375), so the rule reads as a device rule: SE-class and Android-360/320
 * phones take the short words, everything from a modern iPhone up keeps the
 * owner's five.
 *
 * ── AND IT IS ONLY A BREAKPOINT IF IT COMPILES ─────────────────────────────
 * Measured on the rendered DOM 2026-09-20: at 414, 500 and 600 the row still
 * painted "You / Soon / Cancel". Nothing was wrong with this number — the two
 * Tailwind classes built from it emitted no CSS rule at all, so the long
 * labels stayed `display: none` at every width. See `shortVariantClass` in
 * src/test/activityTabLabelsFitAPhone.test.ts.
 */
export const SHORT_LABEL_BELOW_PX = 390;
