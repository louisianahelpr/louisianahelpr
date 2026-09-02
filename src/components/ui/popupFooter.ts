/**
 * THE ONE POPUP FOOTER. Dialog, AlertDialog and Sheet all build their footer
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
 * wrote it that way, and from AlertDialogCancel/AlertDialogAction.
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
 * The footer itself: a column on a phone (reversed, so the commit is on top),
 * a right-aligned row from `sm` up.
 */
export const POPUP_FOOTER_ROW = "flex flex-col-reverse gap-3 sm:flex-row sm:items-center";

/**
 * The dismiss: ghost, `size="sm"` — 44px tall, the HIG tap-target floor and a
 * clear step down from the commit's 56px, which is what makes it read as
 * "small".
 *
 * `self-start` is what makes it SMALL on a phone: a flex column stretches its
 * children by default, so without it the dismiss would be another full-width
 * slab — which is exactly the treatment being replaced. `sm:self-auto` hands
 * vertical alignment back to the row's `items-center`.
 */
export const POPUP_SECONDARY_CLS = "self-start shrink-0 sm:self-auto";

/**
 * The commit, primary or destructive. Full-width on a phone — the bleed it
 * already had — and its natural width hard-right from `sm` up. `sm:ml-auto`
 * is what puts it right even when it is the ONLY action in the footer, so a
 * commit-only dialog does not sit oddly on the left.
 */
export const POPUP_COMMIT_CLS = "w-full sm:w-auto sm:ml-auto";
