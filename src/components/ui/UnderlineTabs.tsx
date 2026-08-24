import { hapticLight } from "@/lib/haptics";

/**
 * UnderlineTabs — the app's ONE list-filter control.
 *
 * My Posts / My Jobs express "which slice of this list am I looking at" as a
 * row of display-italic labels with a rule under the live one and a small
 * count beside it. Messages needed the same control, and copying the markup
 * across is exactly how two screens end up a size and a weight apart, so the
 * markup lives here and both screens render it.
 *
 * UNDERLINE, not filled pills (owner: "make smaller", "could looked better in
 * this space"). Bordered pills in a tinted track put four rectangles of chrome
 * above the cards to express one choice; the same choice reads at a glance as
 * the screen's own display italic, and it costs a third of the height. It also
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
  /** Rendered beside the label. Omitted (not rendered as "0") at zero. */
  count?: number;
}

export function UnderlineTabs({
  tabs,
  value,
  onChange,
  ariaLabel,
  className,
  dense = false,
}: {
  tabs: UnderlineTab[];
  value: string;
  onChange: (key: string) => void;
  ariaLabel: string;
  className?: string;
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
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className={`flex items-baseline gap-4 shrink-0${className ? ` ${className}` : ""}`}
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
            className={`group inline-flex items-baseline gap-1 !min-h-0 !min-w-0 transition-colors ${
              dense ? "py-0.5" : "py-[13px]"
            }`}
            style={{
              // Selected reads BLACK, not bark green (owner). --ink-deep is the
              // app's near-black body ink, so the live tab now matches the
              // headings beside it instead of tinting toward the brand olive.
              color: isActive ? "hsl(var(--ink-deep))" : "hsl(var(--olivewood) / 0.65)",
            }}
          >
            <span
              className="font-display italic text-ds-13 leading-none whitespace-nowrap"
              style={{
                fontWeight: isActive ? 700 : 500,
                borderBottom: isActive
                  ? "1.5px solid hsl(var(--ink-deep))"
                  : "1.5px solid transparent",
                paddingBottom: "3px",
              }}
            >
              {t.label}
            </span>
            {!!t.count && t.count > 0 && (
              <span
                className="font-sans tabular-nums text-ds-9 leading-none"
                style={{
                  color: isActive
                    ? "hsl(var(--ink-deep) / 0.55)"
                    : "hsl(var(--olivewood) / 0.45)",
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

export default UnderlineTabs;
