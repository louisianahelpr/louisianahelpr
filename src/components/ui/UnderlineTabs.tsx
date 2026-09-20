import { useEffect, useRef } from "react";
import { hapticLight } from "@/lib/haptics";

/**
 * UnderlineTabs — the app's ONE list-filter control.
 *
 * My Posts / My Jobs express "which slice of this list am I looking at" as a
 * row of sans labels with a rule under the live one and a small
 * count beside it. Messages needed the same control, and copying the markup
 * across is exactly how two screens end up a size and a weight apart, so the
 * markup lives here and both screens render it.
 *
 * UNDERLINE, not filled pills (owner: "make smaller", "could looked better in
 * this space"). Bordered pills in a tinted track put four rectangles of chrome
 * above the cards to express one choice; the same choice reads at a glance as
 * the screen's own type, and it costs a third of the height. It also
 * stops the filter competing with the content for weight — the cards are the
 * content, this is a caption on them.
 *
 * The row is `shrink-0` and each label is `whitespace-nowrap`: on the desktop
 * website this sits inside a header row beside the screen name, and on phone it
 * sits on its own line inside a horizontal scroller. Either way a tab label is
 * a name, and a name does not wrap — "Needs you" broken across two lines put
 * the active underline under "you" alone, which read as a typo rather than a
 * selected tab.
 */
export interface UnderlineTab {
  key: string;
  label: string;
  /**
   * A SHORTER WORD FOR THE SAME TAB, shown only on the narrowest phones.
   *
   * Opt-in per tab and per call site: a tab with no `shortLabel` wears `label`
   * at every width, which is every tab on every screen but Activity's five
   * buckets. See `SHORT_LABEL_BELOW_PX` for the width it swaps at and why the
   * swap is CSS rather than JS.
   *
   * The accessible name follows the eye: the hidden variant is `display: none`
   * and so is out of the accessibility tree, which means the button is named
   * by whichever word is actually painted. That is what keeps WCAG 2.5.3
   * (label in name) true at every width without an `aria-label` — a voice
   * user can always say the word they can see.
   */
  shortLabel?: string;
  /** Rendered beside the label. Omitted (not rendered as "0") at zero. */
  count?: number;
}

/* The breakpoint lives in its own leaf module so the browser check can import
   the same number without dragging this component's runtime deps into the e2e
   tsconfig — see src/lib/shortLabelBreakpoint.ts for the measurements behind
   390 and for what happened when the classes built from it compiled to
   nothing. Re-exported here because this is where a reader of the control
   will look for it. */
export { SHORT_LABEL_BELOW_PX } from "@/lib/shortLabelBreakpoint";

/* The two halves of that swap, written out so Tailwind's scanner can see
   them. They are LITERALS, not built from SHORT_LABEL_BELOW_PX: Tailwind reads
   this file as text and generates nothing for a class it cannot see spelled
   out. A `min-` glued to a bracketed INTERPOLATION rather than a literal pixel
   value is worse than useless: it compiles to nothing AND it takes every
   other arbitrary min-width class in the app down with it, project-wide, in
   silence. That is not hypothetical — it shipped on 2026-09-20 from a
   template literal in this row's own guard. The short word then showed at
   EVERY width. src/test/activityTabLabelsFitAPhone.test.ts now checks the
   compiled stylesheet, not the class name. */
const SHORT_ONLY_CLASS = "min-[390px]:hidden";
const LONG_ONLY_CLASS = "hidden min-[390px]:inline";

export function UnderlineTabs({
  tabs,
  value,
  onChange,
  ariaLabel,
  className,
  dense = false,
  tight = false,
}: {
  tabs: UnderlineTab[];
  value: string;
  onChange: (key: string) => void;
  ariaLabel: string;
  className?: string;
  /**
   * PHONE DENSITY: 11px labels and a 12px gap instead of 12px and 16px.
   *
   * Opt-in, because this control is also the Messages inbox filter and that
   * row is three short words with room to spare — tightening it would cost
   * legibility to solve a problem it does not have. Activity's row is five
   * words and a title on a 320px screen, which is the only place in the app
   * where the type has to give something back.
   *
   * It is the FIRST of three layers, and the cheapest: it costs one type step
   * and 16px of total gap, and it buys ~41px. `shortLabel` (second) and the
   * scroller's edge fade (third) pick up what it cannot.
   */
  tight?: boolean;
  /**
   * Inline in a header row beside the screen name — the desktop placement,
   * where the row is already 44px tall for its icon buttons and a tab that
   * added its own 44px would double the row's height.
   *
   * Left false (the default) the tabs are on their OWN line, which is the phone
   * placement, and there they are a primary control being hit with a thumb: the
   * label alone measures 22px tall, half the 44px floor index.css puts on every
   * other button in the app and short even of WCAG 2.5.8's 24px. The padding
   * below is what carries the hit area; the underline sits under the label
   * either way, so nothing moves visually except the row's height.
   */
  dense?: boolean;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  // The selected tab must be ON SCREEN. On phone this row lives in a
  // horizontal scroller and five labels do not fit 375, so a tab chosen from
  // outside the row — `?filter=cancelled` from a deep link, or the
  // empty-bucket "Show Done" button — could be the live filter while its
  // underline sat 50px past the card's edge, and the row read as "nothing
  // selected". `inline: "nearest"` scrolls only as far as it must and only
  // along this row; `block: "nearest"` keeps it from also yanking the page.
  // (Optional-called: jsdom has no scrollIntoView, and the test renders of
  // this component would otherwise throw on mount.)
  useEffect(() => {
    const active = rootRef.current?.querySelector<HTMLElement>('[aria-pressed="true"]');
    active?.scrollIntoView?.({ inline: "nearest", block: "nearest" });
  }, [value]);
  return (
    <div
      ref={rootRef}
      role="group"
      aria-label={ariaLabel}
      className={`flex items-baseline ${tight ? "gap-3" : "gap-4"} shrink-0 min-w-max${className ? ` ${className}` : ""}`}
    >
      {tabs.map((t) => {
        const isActive = value === t.key;
        return (
          <button
            key={t.key}
            type="button"
            aria-pressed={isActive}
            onClick={() => {
              hapticLight();
              onChange(t.key);
            }}
            className={`group inline-flex shrink-0 items-baseline gap-1 !min-h-0 !min-w-0 transition-colors ${
              dense ? "py-0.5" : "py-[13px]"
            }`}
            style={{
              // Selected reads BLACK, not bark green (owner). --ink-deep is the
              // app's near-black body ink, so the live tab now matches the
              // headings beside it instead of tinting toward the brand olive.
              //
              // Idle is 0.70, not 0.65. This one component is the single
              // largest source of contrast failures in the app: 128 of the 292
              // the five-leg sweep found, because it appears on every admin
              // screen and across activity/messages/my-posts. 0.65 measured
              // 4.46:1 against the 4.5:1 required — a 0.04 miss that reads as
              // "basically fine" and is not. 0.70 measures 5.18 light / 5.74
              // dark.
              color: isActive ? "hsl(var(--ink-deep))" : "hsl(var(--olivewood) / 0.7)",
            }}
          >
            <span
              className={`font-sans ${tight ? "text-ds-11" : "text-ds-12"} leading-none whitespace-nowrap`}
              style={{
                fontWeight: isActive ? 700 : 600,
                borderBottom: isActive
                  ? "1.5px solid hsl(var(--ink-deep))"
                  : "1.5px solid transparent",
                paddingBottom: "3px",
              }}
            >
              {/* THE SWAP IS CSS, NOT JS. Both words are in the DOM and a
                  media query decides which one has a box, so the right word is
                  painted on the FIRST frame at every width — a JS width branch
                  would paint the long word, measure, and swap, which is the
                  visible reflow this row already suffers from enough. It also
                  keeps the two variants impossible to disagree about: there is
                  no state that can be stale.
                  `display: none` also removes the hidden one from the
                  accessibility tree, so the button's name is always the word on
                  screen (see `shortLabel`). */}
              {t.shortLabel ? (
                <>
                  <span className={SHORT_ONLY_CLASS}>{t.shortLabel}</span>
                  <span className={LONG_ONLY_CLASS}>{t.label}</span>
                </>
              ) : (
                t.label
              )}
            </span>
            {/* The count is 9px — the smallest text in the app — and it was
                the faintest: 0.45 idle measured 2.59:1 and 0.55 active 3.66:1.
                Both now clear AA (idle 5.18/5.74, active 4.97/5.69). The idle
                count deliberately matches the idle LABEL's alpha rather than
                sitting below it: there is no alpha quieter than the label that
                also clears 4.5:1 at this size, and the 9px-vs-13px size
                difference already carries the hierarchy. */}
            {!!t.count && t.count > 0 && (
              <span
                className="font-sans tabular-nums text-ds-9 leading-none"
                style={{
                  color: isActive
                    ? "hsl(var(--ink-deep) / 0.65)"
                    : "hsl(var(--olivewood) / 0.7)",
                }}
              >
                {t.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
