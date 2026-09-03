/**
 * THE ONE POPUP FOOTER. Dialog and Sheet both build their footer
 * from these three constants — not from three literals a test has to keep in
 * agreement.
 *
 * ─── WHY IT LOOKS LIKE THIS ────────────────────────────────────────────────
 *
 * The owner put five popups side by side (2026-08-31) and found five different
 * footers. The secondary action alone shipped three ways in that one set — a
 * white card, ghost text at full width, and a small right-aligned link — plus,
 * across the rest of the app, a bordered `outline` button (6 dialogs) and a
 * hand-styled burnt-sienna slab. Shown those variants, the owner picked:
 *
 *     "Small, I feel like left aligned makes more sense than right."
 *
 * So the canonical dismiss is the COMPACT treatment (the "Report Job" one),
 * moved to the LEFT. Only one dialog in the app was close to that, so this is
 * a real conversion of the set rather than a majority rubber-stamp.
 *
 * ─── THE SHAPE, AND WHY IT IS NOT ONE ROW ON A PHONE ───────────────────────
 *
 * DESKTOP (`sm` and up): one row — small ghost dismiss hard-left, commit hard-
 * right. Exactly the picture the owner described.
 *
 * PHONE: the commit is a full-width bar and the small dismiss sits BELOW it,
 * hard-left. This was not the first answer. "One row at every width" was
 * built first, because a single shape everywhere is obviously the stronger
 * reading of "globally the same" — and then measured in Chrome, which killed
 * it:
 *
 *   at 375 the card is 343px, so after the card's 16px padding each side and
 *   the 12px gap, a commit sharing the row with an 81px "Cancel" gets 218px.
 *   "Yes, I Confirm" measured 216px. "Confirm No-Show" measured 216px.
 *   "Boost — Free This Month" measured 253px, "Send Re-Upload Request" and
 *   "Cancel · pay $150" similar. At 320 the budget drops to 162px and most
 *   commits miss it.
 *
 * So a one-row footer does not produce one shape on a phone: roughly a third
 * of the app's real commit labels wrap, and a wrapped row renders the dismiss
 * ABOVE the commit — a third shape, arrived at by accident, varying with how
 * long a button's words happen to be. Shrinking the padding was measured too
 * and does not close the gap (px-6 → px-4 buys 16px against a 35px shortfall).
 * Truncating a money label is not on the table.
 *
 * A full-width commit with the small dismiss under it is therefore the shape
 * that is ACTUALLY identical for every dialog on every phone, which is what
 * was being asked for. It also keeps the commit at the full bleed the owner
 * already has and did not complain about; the only thing that changes on a
 * phone is that the dismiss underneath it stops being a full-width slab and
 * becomes the small left-aligned control they asked for.
 *
 * ─── ORDER: dismiss first in the DOM ───────────────────────────────────────
 *
 * DOM order is [dismiss, commit] — unchanged from the ~50 footers that already
 * wrote it that way, and from the confirm actions it replaced.
 *
 * It cannot match visual order at BOTH breakpoints, and that is inherent, not
 * an oversight: the visual order genuinely differs (commit-above-dismiss in a
 * column, dismiss-left-of-commit in a row), so any responsive footer picks one
 * to match. `flex-col-reverse` matches the desktop row and inverts the phone
 * column — the arrangement this codebase has always used. The alternative
 * (DOM [commit, dismiss] with `sm:flex-row-reverse`) just moves the WCAG 2.4.3
 * mismatch onto desktop and rewrites 50 call sites to get there.
 *
 * What the chosen order does buy, everywhere: the commit is LAST in the tab
 * sequence, so reaching a destructive commit (Report No-Show's red "Confirm
 * No-Show") by keyboard means passing the dismiss and never the reverse. The
 * destructive also stays FLAT red while the primary is glossy (button.tsx:
 * "keep red flat-looking so it doesn't get accidentally pressed"), so the two
 * commits never look alike, and on a phone the dismiss is now a small control
 * rather than a full-width slab directly under a red one.
 *
 * ─── THE FOUR SHAPES, from these two constants and nothing else ────────────
 *
 *   dismiss + commit    phone: full-width commit, small dismiss under it left
 *                       desktop: dismiss left · commit right
 *   commit only         phone: full-width. desktop: `sm:ml-auto` puts it right
 *   dismiss only        small ghost, hard-left, both widths — see below
 *   destructive+dismiss identical to the first, flat red instead of glossy
 *
 * A LONE DISMISS STAYS SMALL AND LEFT. It is the same object in the same
 * place whether or not something sits beside it, which is the whole point.
 * Every dialog whose only footer action is "Close" / "Never Mind" / "Maybe
 * Later" (the dispute Timeline, Saved Searches, the cancel survey, two
 * completion prompts) is a READ-ONLY or opt-out surface: it has nothing to
 * commit, and every dialog in the app already carries a corner X that does
 * the same job. Enlarging that button would say "this is the thing to do
 * here", which is false. Quiet is the correct weight — and it is the one
 * judgement call in this standard the owner may want to look at, so it is
 * written down here rather than buried as an exception.
 *
 * ─── NO WRAPPING, BY CONSTRUCTION ──────────────────────────────────────────
 *
 * Because the phone layout is a column, the commit always has the full card
 * width for its label and never wraps, shrinks or truncates — at 320 as well
 * as 375. That is the property the one-row version could not give, and the
 * reason this shape won.
 */

/**
 * The footer: A ROW THAT STACKS ONLY WHEN THE LABELS DO NOT FIT.
 *
 * The owner chose the row on 2026-09-02 from rendered comparisons, over a
 * full-width column, and the reason holds: a popup that rearranges its buttons
 * at a BREAKPOINT is two designs, and the person who sees both is the one
 * testing on a phone and a laptop — the owner.
 *
 * This is not that. There is one rule at every width — side by side if both
 * labels fit in half the card, stacked full-width if either does not — and it
 * is keyed on the CONTENT, not on the viewport. That is also literally what a
 * two-action UIAlertController does, which is what "however Apple does them"
 * (owner, 2026-09-03) asks for: equal halves with the dismiss on the LEFT, and
 * a vertical stack the moment a title is too long for its half.
 *
 * HOW, in three classes and no JavaScript:
 *
 *   flex-wrap-reverse         wraps when the line overflows; `-reverse` puts
 *                             the SECOND line on top, so a stacked footer
 *                             reads commit-above-dismiss (Apple's stacked
 *                             alert, and the DOM order stays [dismiss, commit])
 *   basis-[calc(50%-6px)]     an exact half, less half the 12px gap:
 *                             2·(50% − 6px) + 12px = 100%. Equal by
 *                             construction, and NOT floored by padding —
 *                             see the bug below
 *   min-w-max                 a button may not be laid out narrower than its
 *                             own label, so a label that will not fit its half
 *                             forces the wrap instead of spilling out
 *
 * ─── THE BUG THIS REPLACES, because it is the SECOND one in this row ───────
 *
 * The first fix (2026-09-03) set both actions to `flex-1 min-w-0`, called it
 * "equal width, which is what Apple does", and moved the clipping from the
 * dismiss to the commit rather than removing it. `flex-1` is `flex: 1 1 0%`,
 * and under `box-sizing: border-box` a flex-basis of ZERO floors at
 * padding + border. The dismiss carried `px-0` and the commit the Button's
 * default `px-6`, so their hypothetical sizes were 0px and 48px, the free
 * space was then split evenly, and the commit came out exactly 48px WIDER at
 * every viewport — measured 133.5 vs 181.5 at 393, 205 vs 253 at 1440. Both
 * said `flex: 1 1 0%`. Neither was equal.
 *
 * The consequence was worse than the asymmetry: after its own 48px of padding
 * the commit had the SAME 133.5px of text room as the button reading "Cancel",
 * and `Button` is `whitespace-nowrap` with `overflow: visible`, so the label
 * could not wrap, shrink or truncate. It spilled out of the pill on both
 * sides — the left spill landing ON TOP of the Cancel button, the right spill
 * clipped by DialogContent's `overflow-y-auto`. Seven labels at 393 ("Send
 * Re-Upload Request", "Boost — Free This Month", "Send Revision Request",
 * "Confirm Withdrawal", "Delete Permanently", "Confirm No-Show", "Issue (No
 * Escalation)"), fifteen at 375, forty-five at 320 — including "Save Changes"
 * and "Submit Review". Not admin-only: the boost sheet, withdraw, revision
 * request, no-show and block flows are all core loop.
 *
 * A percentage basis has no such floor, which is why this one is equal for
 * real. `px-4` on the dismiss is now cosmetic rather than load-bearing.
 *
 * ─── WHAT MADE BOTH BUGS INVISIBLE ────────────────────────────────────────
 *
 * Every test in this repo asserts that a CLASS IS PRESENT, and in both cases
 * the class was present — the class WAS the bug. Nothing measured a rendered
 * width, so `dialogShell.test.ts` passed on a footer whose buttons overlapped.
 * `popupFooterFit.spec.ts` is the answer: it renders every real label in a
 * browser and asserts the boxes do not overlap and nothing exceeds its parent.
 * A class-name assertion cannot replace it.
 */
export const POPUP_FOOTER_ROW =
  "flex flex-wrap-reverse items-center gap-3 pt-2";

/* `pt-2` — the actions need MORE air above them than the body copy has between
   its own lines. DialogContent lays its children out on a uniform `gap-3`
   (12px), which reads correctly between a title and a paragraph and too tight
   between a paragraph and a button you are about to press: the commit ends up
   the same distance from the sentence as the sentence is from the heading, so
   nothing separates "what this is" from "what you are about to do". 12 + 8 =
   20px above the commit, unchanged 12px between the two actions, so the pair
   still reads as one group. Owner, 2026-09-02, from the rendered screen. */

/**
 * The dismiss: 44px tall (the HIG tap-target floor), a clear step down from the
 * commit's 56px, and on a phone a FULL-WIDTH SOFT CHIP sitting under the commit.
 *
 * It was `self-start` — left-aligned and only as wide as its label — on the
 * reasoning that a full-width dismiss would be "another full-width slab". The
 * owner looked at the rendered result and made the opposite call, for a reason
 * the earlier note missed: the problem was never the WIDTH, it was that both
 * controls were drawn as buttons of equal weight, so a confirm card read as a
 * wall of buttons with no hierarchy. A 78px left-aligned outline against a
 * 327px filled slab is not a hierarchy either — it is two unrelated shapes.
 *
 * So: same width as the commit, deliberately DIFFERENT WEIGHT. A tinted fill
 * with no border and no elevation recedes against the commit's gradient and
 * shadow, which is what makes it read as the quiet option while still being
 * obviously tappable. `sm:w-auto` hands the row back its natural width on
 * desktop, where the two sit side by side and `items-center` aligns them.
 *
 * The tint is `--olivewood` at 6%, not a grey: a neutral chip on this
 * parchment canvas reads as disabled.
 */
export const POPUP_SECONDARY_CLS =
  "basis-[calc(50%-6px)] grow !min-w-max px-4 border-0 shadow-none " +
  "bg-[hsl(var(--olivewood)/0.06)] hover:bg-[hsl(var(--olivewood)/0.11)] " +
  "text-[hsl(var(--olivewood))]";

/**
 * The commit, primary or destructive. Full width at every size, matching the
 * dismiss beneath it. The `sm:w-auto sm:ml-auto` that used to shrink it and
 * push it right went with the row layout above.
 */
// The commit takes the same exact half as the dismiss. Hierarchy comes from
// COLOUR AND WEIGHT, not width — the commit is the glossy or destructive fill,
// the dismiss a flat tint — exactly as on iOS.
//
// This was `flex-[3]`, a deliberate 1:3 ratio chosen from rendered comparisons
// so width would carry the hierarchy. Sound reasoning, wrong ratio, for a
// reason the renders could not show: a quarter-width slot only holds a short
// word, so the moment a dialog needed a real sentence the ratio had to break —
// and `shrink-0` made it break by overflowing rather than by wrapping.
//
// A note the previous version of this comment got WRONG, and it matters
// because it was the stated justification for a fixed ratio: the dismiss
// labels are NOT all "Cancel". Counted across every call site — 38 "Cancel",
// and then "Maybe Later", "Not Now", "Skip", "Keep the Job", "Keep It On",
// "No Thanks", "Close", and a bare back-chevron. Nine distinct labels. Any
// rule here has to hold for the longest of them, not for the common one.
export const POPUP_COMMIT_CLS = "basis-[calc(50%-6px)] grow !min-w-max";
