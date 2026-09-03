// NOTE FOR WHOEVER ADDS THE NEXT IMPORT FROM `src/`: `tsconfig.e2e.json` is a
// COMPOSITE project, so every src file an e2e spec imports has to be named in its
// `include` array. Miss one and `npm run typecheck` fails with TS6307 while the
// spec itself runs perfectly under Playwright — a green local run and a red gate.
// The four entries this file needs (utils, button, popupFooter, popupFooterLabels)
// are already listed there. That file allows no comments, which is why this one
// lives here instead: an explanatory key inside a JSON config is how `vercel.json`
// took production down three times.
import { test, expect } from "./fixtures";
import { cn } from "../../src/lib/utils";
import { buttonVariants } from "../../src/components/ui/button";
import {
  POPUP_FOOTER_ROW,
  POPUP_SECONDARY_CLS,
  POPUP_COMMIT_CLS,
} from "../../src/components/ui/popupFooter";
import { collectFooterLabels } from "../../src/test/popupFooterLabels";

/**
 * EVERY POPUP FOOTER FITS, AT EVERY WIDTH, FOR EVERY LABEL THE APP CAN RENDER.
 *
 * ─── WHY THIS FILE EXISTS ──────────────────────────────────────────────────
 *
 * Two footer bugs have now shipped past a fully green suite, and they are the
 * same bug twice:
 *
 *   1. `POPUP_SECONDARY_CLS` carried `min-w-0` AND `shrink-0`. That is a
 *      contradiction and `shrink-0` wins, so a dismiss longer than "Cancel"
 *      could not shrink and overflowed its card. Thirteen dialogs rendered
 *      "Keep Accoun" and "tay Signed I" on a real phone.
 *   2. The fix made both actions `flex-1 min-w-0` — "equal width". They were
 *      not equal: `flex-1` is `flex: 1 1 0%`, and under `box-sizing: border-box`
 *      a flex-basis of 0 floors at padding+border, so the commit's `px-6` made
 *      it exactly 48px wider than the `px-0` dismiss at every viewport while
 *      both declared the same flex. Worse, after its own padding the commit had
 *      the SAME text room as the button that says "Cancel", and `Button` is
 *      `whitespace-nowrap` with `overflow: visible`, so 45 real labels across 29
 *      files spilled over the dismiss on the left and were clipped by
 *      `DialogContent`'s `overflow-y-auto` on the right.
 *
 * Every existing test passed through both, because every existing test asserts
 * that a CLASS IS PRESENT — and in both cases the class WAS the bug. This file
 * therefore asserts nothing about class names. It measures the rendered boxes.
 *
 * ─── AND WHY IT DERIVES ITS LABELS ─────────────────────────────────────────
 *
 * The labels come from `collectFooterLabels()`, which walks the TypeScript AST
 * of every tracked `.tsx` under `src/` and reads what the real
 * Dialog/Sheet action elements render. They are deliberately NOT a list in this
 * file. A hand-written array is both the test's input and its definition of
 * correctness, so it cannot fail for a label it has never heard of — add a
 * dialog whose commit is longer than anything here and the suite stays green,
 * which is exactly how (2) shipped. Add a long label anywhere in `src/` and this
 * spec picks it up on the next run with no edit here.
 *
 * ─── WHAT IT ASSERTS, AND WHY THESE FOUR ───────────────────────────────────
 *
 * The footer is allowed to solve a long label however it likes — it currently
 * wraps to a stacked column, and that is a design decision that may change. So
 * the assertions are about the OUTCOME, not the mechanism:
 *
 *   A. `min-width` computes to `max-content`.  The one mechanism assertion, and
 *      it earns its place: see the note on `!min-w-max` in popupFooter.ts. A
 *      plain `min-w-max` is emitted into the stylesheet and still never applies
 *      to a `<button>`, because index.css's HIG tap-target rule
 *      `button:not([role=checkbox]):not([role=radio]):not([role=switch])` is
 *      (0,3,1) against the utility's (0,1,0). Reading the class would pass;
 *      reading the computed value is what catches it.
 *   B. The two actions never overlap.
 *   C. Neither action escapes the footer's content box, or the card.
 *   D. When the row wraps, the COMMIT is the one on top.
 *
 * ─── WHY PLAYWRIGHT AND NOT VITEST ─────────────────────────────────────────
 *
 * jsdom does no layout; every width it reports is 0. `apply-dialog-fit.spec.ts`
 * is here for the same reason.
 *
 * ─── WHAT THIS FILE DOES NOT COVER ─────────────────────────────────────────
 *
 * It builds the footer from the class strings the real modules export, composed
 * through the real `cn()` — so a change to `popupFooter.ts` or to `button.tsx`
 * changes what is measured here. It does NOT prove that `DialogPrimaryAction`
 * still hands those constants to `Button`: `dialogShell.test.ts` already asserts
 * exactly that (`variant="primary" className={POPUP_COMMIT_CLS}` and its ghost
 * and destructive twins), so duplicating it here through a multi-step navigation
 * would add fixture fragility and no coverage.
 *
 * It also does not open a real popup. That is deliberate. Reaching one means
 * seeding a session, mocking Supabase and clicking through a feed, and the
 * property under test — how a footer of a given width lays out a label of a
 * given width — is fully determined by the class strings and the stylesheet,
 * both of which are real here. Trading 87 labels × 5 widths of real coverage for
 * one navigable dialog would be a worse test.
 */

const CARD_SELECTOR = "[data-footer-fit-card]";

/**
 * The widths the app actually ships to: 320 (iPhone SE 1st gen, the narrowest
 * supported), 375 (SE 2/3, 12/13 mini), 393 (15/16 base), 430 (Pro Max), and
 * 1440 desktop, where `sm:max-w-lg` caps the card at 512px and the footer has
 * the most room. 320 is not academic — it is where the previous shape failed
 * for 45 of 87 labels.
 */
const WIDTHS = [320, 375, 393, 430, 1440];

/**
 * The dismiss labels each commit is paired against. Not the full cross product
 * (87 × 14 × 5 × 2 is minutes of wall clock for no extra signal): "Cancel" is
 * the majority label at 38 of the call sites, and the longest dismiss in the app
 * is the tightest real pairing any commit can be asked to survive. Both are
 * derived, so a new longest dismiss is picked up automatically.
 */
function dismissPairings(all: ReturnType<typeof collectFooterLabels>): string[] {
  const dismisses = [...new Set(all.filter((l) => l.role === "dismiss").map((l) => l.label))];
  const longest = dismisses.sort((a, b) => b.length - a.length)[0];
  return [...new Set(["Cancel", longest])];
}

test.describe("popup footer fits every label at every width", () => {
  const ALL = collectFooterLabels();
  const COMMITS = [...new Set(ALL.filter((l) => l.role === "commit").map((l) => l.label))];
  const DISMISSES = dismissPairings(ALL);
  /** file:line for each label, so a failure names the dialog to fix rather than just the string. */
  const ORIGIN = new Map(ALL.map((l) => [l.label, `${l.file}:${l.line}`]));

  test("the label set is actually derived, not empty", () => {
    // A silently empty derivation would make every assertion below vacuous — the
    // failure mode this whole file exists to avoid. These floors are well under
    // the real counts (87 commit labels across 50 files at time of writing) and
    // exist only to catch the extractor returning nothing.
    expect(COMMITS.length, "no commit labels derived from src/ — did the AST walk break?").toBeGreaterThan(40);
    expect(DISMISSES.length).toBeGreaterThan(1);
    expect(COMMITS).toContain("Save Changes");
  });

  for (const width of WIDTHS) {
    test(`no clipping, overlap or escape at ${width}px`, async ({ page }) => {
      // 87 commit labels × 2 dismiss pairings, each measured after its own layout
      // pass. Only the `primary` commit variant is built: `DialogPrimaryAction`
      // and `DialogDestructiveAction` hand Button the SAME `POPUP_COMMIT_CLS`
      // and differ only in fill colour, so they are the same box.
      test.slow();
      await page.setViewportSize({ width, height: 900 });

      // Any app route: we need the real stylesheet, fonts and theme tokens, not
      // a particular screen. `/login` is the cheapest — no session, no mocks, no
      // data fetch to settle.
      await page.goto("/login");
      await page.waitForLoadState("networkidle");

      const commitCls = cn(buttonVariants({ variant: "primary" }), POPUP_COMMIT_CLS);
      const dismissCls = cn(buttonVariants({ variant: "ghost" }), POPUP_SECONDARY_CLS);

      // A stand-in for DialogContent's box: same width tokens, same padding, same
      // `overflow-y-auto` (which is what computes overflow-x to auto and does the
      // clipping). Kept in sync by the CARD_CLS assertion in dialogShell.test.ts.
      await page.evaluate(
        ({ footerCls, commitCls, dismissCls, sel }) => {
          const card = document.createElement("div");
          card.setAttribute(sel.replace(/[[\]]/g, ""), "true");
          card.className =
            "fixed left-1/2 top-1/2 z-50 grid w-[calc(100vw-2rem)] max-w-[calc(100vw-2rem)] " +
            "sm:w-full sm:max-w-lg max-h-[86vh] overflow-y-auto gap-3 p-4 sm:p-5";
          card.style.translate = "-50% -50%";
          const footer = document.createElement("div");
          footer.className = footerCls;
          const dismiss = document.createElement("button");
          dismiss.type = "button";
          dismiss.className = dismissCls;
          dismiss.setAttribute("data-role", "dismiss");
          const commit = document.createElement("button");
          commit.type = "button";
          commit.className = commitCls;
          commit.setAttribute("data-role", "commit");
          // DOM order is [dismiss, commit] at every call site in the app.
          footer.append(dismiss, commit);
          card.append(footer);
          document.body.append(card);
        },
        { footerCls: POPUP_FOOTER_ROW, commitCls, dismissCls, sel: CARD_SELECTOR },
      );

      // A: the mechanism assertion. Read the COMPUTED value, never the class.
      const minWidths = await page.evaluate((sel) => {
        const card = document.querySelector(sel)!;
        return [...card.querySelectorAll("button")].map((b) => getComputedStyle(b).minWidth);
      }, CARD_SELECTOR);
      for (const mw of minWidths) {
        expect(
          mw,
          "min-width must compute to max-content. A plain `min-w-max` is emitted but " +
            "never applies to a <button>: index.css's HIG tap-target selector is (0,3,1) " +
            "against the utility's (0,1,0), so it wins on specificity and pins every " +
            "action to 44px. The `!` in `!min-w-max` is what makes it stick.",
        ).toBe("max-content");
      }

      const failures = await page.evaluate(
        async ({ commits, dismisses, sel }) => {
          const card = document.querySelector(sel)!;
          const dismiss = card.querySelector('[data-role="dismiss"]') as HTMLElement;
          const commit = card.querySelector('[data-role="commit"]') as HTMLElement;
          const footer = commit.parentElement!;
          // Two frames: one for style recalc, one for the layout that follows it.
          const settle = () =>
            new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
          const out: { commit: string; dismiss: string; problems: string[] }[] = [];

          for (const c of commits) {
            for (const d of dismisses) {
              dismiss.textContent = d;
              commit.textContent = c;
              await settle();

              const cardBox = card.getBoundingClientRect();
              const cardCs = getComputedStyle(card);
              const footBox = footer.getBoundingClientRect();
              const footCs = getComputedStyle(footer);
              const innerLeft = footBox.left + parseFloat(footCs.paddingLeft);
              const innerRight = footBox.right - parseFloat(footCs.paddingRight);
              const cardInnerRight = cardBox.right - parseFloat(cardCs.paddingRight);
              const a = dismiss.getBoundingClientRect();
              const z = commit.getBoundingClientRect();

              // Does the label still fit the box, after the box has done whatever
              // it is going to do about it? This is the check the two shipped bugs
              // both failed, and it is NOT `scrollWidth`: a nowrap inline-flex
              // button reports scrollWidth === clientWidth while its centered
              // label spills out of both sides.
              const textRoom = (el: HTMLElement) => {
                const cs = getComputedStyle(el);
                const probe = document.createElement("span");
                probe.style.cssText =
                  `position:absolute;left:-9999px;white-space:nowrap;` +
                  `font:${cs.font};letter-spacing:${cs.letterSpacing}`;
                probe.textContent = el.textContent;
                document.body.append(probe);
                const need = probe.getBoundingClientRect().width;
                probe.remove();
                const r = el.getBoundingClientRect();
                return need - (r.width - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight));
              };

              const overlapX = Math.min(a.right, z.right) - Math.max(a.left, z.left);
              const overlapY = Math.min(a.bottom, z.bottom) - Math.max(a.top, z.top);
              const stacked = Math.abs(a.top - z.top) > 2;
              const problems: string[] = [];

              // 1px of tolerance throughout: sub-pixel layout puts a full-width
              // action's right edge within a rounding error of its container's.
              if (overlapX > 1 && overlapY > 1) problems.push(`actions overlap by ${Math.min(overlapX, overlapY).toFixed(1)}px`);
              if (Math.max(a.right, z.right) - innerRight > 1) problems.push(`escapes the footer's right edge by ${(Math.max(a.right, z.right) - innerRight).toFixed(1)}px`);
              if (innerLeft - Math.min(a.left, z.left) > 1) problems.push(`escapes the footer's left edge by ${(innerLeft - Math.min(a.left, z.left)).toFixed(1)}px`);
              if (Math.max(a.right, z.right) - cardInnerRight > 1) problems.push(`runs past the card's content edge by ${(Math.max(a.right, z.right) - cardInnerRight).toFixed(1)}px`);
              if (stacked && z.top > a.top) problems.push("wrapped, but the DISMISS is on top — the commit must be the upper row");
              const dClip = textRoom(dismiss);
              const cClip = textRoom(commit);
              if (dClip > 1) problems.push(`dismiss label is clipped by ${dClip.toFixed(1)}px`);
              if (cClip > 1) problems.push(`commit label is clipped by ${cClip.toFixed(1)}px`);
              if (document.documentElement.scrollWidth > document.documentElement.clientWidth) problems.push("the document scrolls horizontally");

              if (problems.length) out.push({ commit: c, dismiss: d, problems });
            }
          }
          return out;
        },
        { commits: COMMITS, dismisses: DISMISSES, sel: CARD_SELECTOR },
      );

      const report = failures
        .map((f) => `  "${f.commit}" (${ORIGIN.get(f.commit) ?? "?"}) beside "${f.dismiss}": ${f.problems.join("; ")}`)
        .join("\n");
      expect(
        failures,
        failures.length
          ? `${failures.length} of ${COMMITS.length * DISMISSES.length} label pairings do not fit at ${width}px:\n${report}`
          : "",
      ).toEqual([]);
    });
  }
});
