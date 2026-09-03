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
 * The footer: a REVERSED COLUMN AT EVERY WIDTH — commit on top, dismiss beneath
 * it, both full width.
 *
 * It used to become a right-aligned row from `sm` up. The owner chose one
 * layout everywhere (2026-09-02), picked from rendered comparisons rather than
 * a description, and the reason is worth keeping: a popup that rearranges its
 * own buttons at a breakpoint is two designs, and the person who sees both is
 * the one testing on a phone and a laptop — which is the owner. Consistency
 * across the app beat the desktop convention of a right-aligned row.
 *
 * `flex-col-reverse` with a DOM order of [dismiss, commit] is what puts the
 * commit on top. Every call site already writes them in that order.
 */
export const POPUP_FOOTER_ROW = "flex items-center gap-3 pt-2";

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
  // `flex-1 min-w-0`, and NOTHING that stops it shrinking.
  //
  // This read `flex-1 min-w-0 px-0 shrink-0`, which is a contradiction: `min-w-0`
  // says "you may shrink below your content", `shrink-0` says "you may not", and
  // shrink-0 wins. With the word "Cancel" the button is 67px and fits its slot,
  // which is why every measurement taken while building this row passed. With
  // "Keep Account" or "Stay Signed In" it CANNOT shrink, so it overflowed the
  // row and the card clipped it — the label rendered as "Keep Accoun" and
  // "tay Signed I", with the commit button overlapping it.
  //
  // Thirteen dialogs shipped that way. It was invisible to the tests because
  // they assert the CLASS is present, and invisible to my own measurement
  // because I measured the one label that fits.
  "flex-1 min-w-0 px-0 border-0 shadow-none " +
  "bg-[hsl(var(--olivewood)/0.06)] hover:bg-[hsl(var(--olivewood)/0.11)] " +
  "text-[hsl(var(--olivewood))]";

/**
 * The commit, primary or destructive. Full width at every size, matching the
 * dismiss beneath it. The `sm:w-auto sm:ml-auto` that used to shrink it and
 * push it right went with the row layout above.
 */
// EQUAL WIDTH, which is what Apple does — and what makes the row impossible to
// clip. A two-action UIAlertController lays its buttons out side by side at
// equal width, cancel on the LEFT, the preferred action on the right in bold.
//
// This was `flex-[3]`, a deliberate 1:3 chosen from rendered comparisons so
// width would carry the hierarchy. That reasoning was sound and the ratio was
// still wrong, for a reason the renders could not show: a quarter-width slot
// only holds a short word. The moment a dialog needed "Keep Dispute Open" the
// ratio had to break, and `shrink-0` made it break by overflowing rather than
// by wrapping. Equal width cannot overflow, and the labels are all "Cancel"
// now anyway (owner, 2026-09-03), so the hierarchy comes from colour and
// weight — the commit is the glossy or destructive fill, the dismiss is a flat
// tint — exactly as it does on iOS.
export const POPUP_COMMIT_CLS = "flex-1 min-w-0";
