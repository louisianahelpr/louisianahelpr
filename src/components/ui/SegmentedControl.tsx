import { useRef, type KeyboardEvent, type ReactNode } from "react";
import { hapticLight } from "@/lib/haptics";
import { cn } from "@/lib/utils";

/**
 * SegmentedControl — the app's ONE "pick one of N" control.
 *
 * WHY IT EXISTS. Four different visual languages answered the same question,
 * measured on a production bundle 2026-09-02:
 *
 *   Analytics "12 months"        olive gloss   9999px   text-ds-11/600
 *   Earnings range toggle        olive gloss   9999px   text-ds-11/600
 *
 * THE SIZES IN THE SWEEP THAT FOUND THIS WERE SENIOR-MODE SIZES. The audit
 * account has Senior Mode on, so `html.senior-mode` was active in all 188
 * measured cells and index.css remaps `.text-ds-11` from its declared 11px to
 * 14px there. The table above therefore reads in CLASSES, not pixels: writing
 * `text-[14px]` would bake the senior size in as the default and opt this
 * control out of Dynamic Type entirely — the opposite of what the finding
 * asked for. Copy the class list, never the measurement.
 *   Accessibility "Light/Auto/Dark"  flat 12% bark tint   0px   (label 13px)
 *   Earnings view switcher       hsl(var(--parchment))    8px   15px/600
 *
 * The last one is the reason this got escalated rather than filed: parchment
 * IS the page canvas, so the selected quarter of the Earnings tab was painted
 * the same colour as the paper behind it and did not read as selected at all.
 * And the Earnings tab shipped two of the four languages within one scroll —
 * the view switcher at the top, the range toggle 140px below it.
 *
 * The canonical treatment is the one two of the four already wore and is NOT
 * new work: the shared `.btn-grad-primary` olive gloss, a full pill, a 44px
 * row. It lives in `src/index.css` as `.segmented-track` /
 * `.segmented-option` / `.segmented-option-selected` — see the long comment
 * there for why the paint is CSS and not utilities at the call site.
 *
 * ONE HEIGHT, AND IT IS 44px. Several of the controls this replaces declared
 * `h-7` or `h-8` and rendered at 44 anyway, because index.css puts a bare
 * `button { min-height: 44px }` on everything that is not a Radix
 * checkbox/radio/switch. The ones that genuinely were shorter were the ones
 * using `role="radio"`, which that selector excludes — so "dense" was never a
 * real second size, it was a declaration the browser ignored in one half of
 * the set and honoured in the other. This declares the height that actually
 * renders, for both semantics.
 *
 * SEMANTICS. Call sites legitimately differ, so this takes a `semantics`
 * prop, but the VISUAL result is identical either way:
 *   - "radio" (default) — a setting. `role="radiogroup"` / `role="radio"` +
 *     `aria-checked`. Most call sites.
 *   - "tab" — the control also swaps a panel. `role="tablist"` /
 *     `role="tab"` + `aria-selected`. Pass `panelIdPrefix` to wire
 *     `aria-controls`.
 *
 * NOT IN SCOPE: `UnderlineTabs` (a different control — display-italic labels
 * with a rule under the live one, deliberately weightless), Radix `Tabs`, and
 * free-floating chip rows with no track. A chip row is a filter strip; this is
 * a switch.
 */

export interface SegmentedOption<T extends string | number> {
  value: T;
  /** The visible label. */
  label: ReactNode;
  /** Rendered before the label, or above it when `iconPosition="top"`. */
  icon?: ReactNode;
  /** A count pill after the label. Not rendered at 0 or undefined. */
  count?: number;
  /**
   * What the count MEANS, which is not the same question at every call site
   * and is why this is a prop rather than one colour.
   *   "neutral" (default) — a population. AdminUsers' six tabs are "how many
   *     rows are in this tab"; they shipped in the alarm colour once already
   *     and read as six red warnings over a healthy user base.
   *   "attention" — a backlog the reader is meant to act on, e.g. the unread
   *     count in the notification panel.
   */
  countTone?: "neutral" | "attention";
  /** Spoken form of the count, e.g. "22 users". The digits are then
   *  `aria-hidden`, so the number is announced once and named. */
  countLabel?: string;
  /** Accessible name, when the visible label is abbreviated to fit the track. */
  ariaLabel?: string;
}

export interface SegmentedControlProps<T extends string | number> {
  options: readonly SegmentedOption<T>[];
  /** `null` = nothing chosen yet. Legal, and the arrow keys still enter the
   *  set at the first option from there. */
  value: T | null;
  onChange: (value: T) => void;
  /** Names the group for assistive tech. Required — a switch with no name is
   *  announced as a row of anonymous buttons. */
  ariaLabel: string;
  semantics?: "radio" | "tab";
  /**
   * How the segments flow.
   *   "row"  — one line, equal segments, full-pill track. The default.
   *   "wrap" — segments wrap to a second line when the track is too narrow.
   *   "grid" — a fixed column count, passed as `gridClassName`.
   *
   * "wrap" and "grid" round the TRACK to `rounded-2xl` rather than a full
   * pill, because a two-row capsule reads as a broken one. The segments stay
   * `rounded-full` either way, so the selected state is the same shape in
   * every layout.
   */
  layout?: "row" | "wrap" | "grid";
  /** Tailwind grid-template class for `layout="grid"`, e.g. `"grid-cols-3"`. */
  gridClassName?: string;
  /** Where `option.icon` sits relative to the label. */
  iconPosition?: "start" | "top";
  /** With `semantics="tab"`, emits `id` + `aria-controls` for panel wiring. */
  panelIdPrefix?: string;
  /** Extra classes on the track. Layout/overflow only — never paint. */
  className?: string;
  /** Extra classes on each segment. Layout only — never paint. */
  optionClassName?: string;
  /** Light haptic on change. On by default; off where the control is not a
   *  primary touch target (admin console). */
  haptic?: boolean;
  /** Disables every segment (the whole control is unavailable, not one
   *  option — a segmented control with one dead cell is a different design). */
  disabled?: boolean;
}

export function SegmentedControl<T extends string | number>({
  options,
  value,
  onChange,
  ariaLabel,
  semantics = "radio",
  layout = "row",
  gridClassName,
  iconPosition = "start",
  panelIdPrefix,
  className,
  optionClassName,
  haptic = true,
  disabled = false,
}: SegmentedControlProps<T>) {
  const buttonRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const select = (next: T) => {
    if (next === value) return;
    if (haptic) hapticLight();
    onChange(next);
  };

  /**
   * Arrow keys move the selection, Home/End jump to the ends, and the set
   * wraps. This is the same behaviour for both semantics: a radiogroup moves
   * selection with the arrows by definition, and a tablist whose panels are
   * cheap to swap uses automatic activation, which is what every call site
   * here does.
   *
   * Roving tabindex below (`tabIndex={active ? 0 : -1}`) is the other half:
   * without it Tab lands on all four segments in turn, which makes a
   * four-option control four stops in the page's tab order instead of one.
   */
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step =
      event.key === "ArrowRight" || event.key === "ArrowDown"
        ? 1
        : event.key === "ArrowLeft" || event.key === "ArrowUp"
          ? -1
          : 0;
    const current = options.findIndex((o) => o.value === value);
    let next = -1;
    if (step !== 0) next = (current + step + options.length) % options.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = options.length - 1;
    if (disabled || next < 0 || !options[next]) return;
    event.preventDefault();
    select(options[next].value);
    buttonRefs.current[next]?.focus();
  };

  return (
    <div
      role={semantics === "tab" ? "tablist" : "radiogroup"}
      aria-label={ariaLabel}
      onKeyDown={onKeyDown}
      className={cn(
        "segmented-track p-0.5",
        layout === "row" && "flex items-center gap-0.5 rounded-full",
        layout === "wrap" && "flex flex-wrap items-center gap-0.5 rounded-2xl",
        layout === "grid" && ["grid gap-0.5 rounded-2xl", gridClassName ?? "grid-cols-3"],
        className,
      )}
    >
      {options.map((option, index) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            ref={(el) => {
              buttonRefs.current[index] = el;
            }}
            type="button"
            role={semantics === "tab" ? "tab" : "radio"}
            {...(semantics === "tab"
              ? { "aria-selected": active }
              : { "aria-checked": active })}
            {...(panelIdPrefix
              ? {
                  id: `${panelIdPrefix}-tab-${option.value}`,
                  "aria-controls": `${panelIdPrefix}-panel-${option.value}`,
                }
              : {})}
            aria-label={option.ariaLabel}
            disabled={disabled}
            tabIndex={active ? 0 : -1}
            onClick={() => select(option.value)}
            className={cn(
              // `min-h-11` as well as `h-11`: index.css's bare 44px floor
              // skips `[role="radio"]`, so the radio semantics would otherwise
              // be the only variant that could render short.
              // `segmented-option` is on EVERY segment, not just the idle ones.
              // It carries the idle colour (which `.segmented-option-selected`
              // then overrides by source order), and it is also what Simple
              // Mode's 48px floor targets — see the note beside that rule in
              // index.css. Putting it only on the idle branch left the selected
              // segment 4px shorter than its siblings in Simple Mode, which is
              // invisible until you look at a control whose selected cell is
              // the only short one.
              "segmented-option min-w-0 h-11 min-h-11 px-3 rounded-full font-sans text-ds-11 font-semibold",
              "whitespace-nowrap transition-all active:scale-[0.98]",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--bark))]",
              iconPosition === "top"
                ? "flex flex-col items-center justify-center gap-0.5"
                : "inline-flex items-center justify-center gap-1.5",
              // "row" segments share the track equally, but `min-w-fit` stops
              // them shrinking below their label: `flex-1` alone is
              // `flex: 1 1 0%`, so four options in a narrow card truncate to
              // "Insig…" rather than admitting they do not fit. A row that can
              // genuinely outgrow its container passes `overflow-x-auto`
              // through `className` (EarningsViewSwitcher, AdminUsers).
              // "wrap" segments take half a row each on a phone and their
              // natural width from 640px up, which is what keeps a four-option
              // track off a third line.
              layout === "row" && "flex-1 min-w-fit",
              layout === "wrap" && "grow basis-[calc(50%-0.125rem)] sm:basis-auto min-w-fit",
              layout === "grid" && "w-full",
              "disabled:opacity-50 disabled:pointer-events-none",
              // The gradient stays `btn-grad-primary` — the app's one primary
              // surface — and the class is toggled here in JS rather than
              // through a Tailwind variant, which would compile to nothing.
              active && "btn-grad-primary segmented-option-selected",
              optionClassName,
            )}
          >
            {option.icon}
            {/* NOT `truncate`. A segment label is a name, and a name does not
                get cut: `overflow:hidden` zeroes a flex item's automatic
                minimum size, so the span collapsed and took the button's
                `min-w-fit` down with it — measured on the built bundle as
                "Histo…", "Insig…", "Payo…" across the Earnings switcher. The
                button already carries `whitespace-nowrap`; a track that
                genuinely cannot fit its options scrolls (see the
                `overflow-x-auto` its call site passes) rather than lying about
                what the options are called. */}
            <span>{option.label}</span>
            {option.count !== undefined && option.count > 0 && (
              <span
                className={cn(
                  "tabular-nums text-ds-11 font-bold rounded-full px-1.5 min-w-[1.25rem] leading-5",
                  active
                    ? "segmented-count-selected"
                    : option.countTone === "attention"
                      ? "segmented-count-attention"
                      : "segmented-count",
                )}
              >
                <span aria-hidden={option.countLabel ? true : undefined}>{option.count}</span>
                {option.countLabel && <span className="sr-only">{option.countLabel}</span>}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
