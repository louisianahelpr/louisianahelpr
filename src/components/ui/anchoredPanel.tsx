import * as React from "react";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import { X } from "lucide-react";

/**
 * anchoredPanel — the ONE treatment every panel that hangs off a header
 * button wears (Notifications off the bell, Browse Filters off the Filters
 * button).
 *
 * WHY THIS EXISTS (owner, 2026-08-30: "how can we improve notifications or
 * anchored filters so they stand out better"): both panels used to be bare
 * `PopoverContent`s painted `bg-premium-page` — the SAME surface as the page
 * behind them, with no scrim, no caret and no close control. Dropped over a
 * colourful job feed they read as another section of the page that had pushed
 * the feed down, not as a layer above it. Nothing said "this is temporary,
 * this belongs to that button, here is how you dismiss it".
 *
 * Four parts, and a panel is only wearing the treatment if it has all four:
 *
 *   1. `PopoverScrim`         — dim + blur the page underneath, using the
 *                               EXACT tokens `DialogOverlay` uses, so an
 *                               anchored panel separates from the page the
 *                               same way every modal in the app already does.
 *                               It lives in `ui/popover.tsx`, NOT here: this
 *                               file briefly shipped a second scrim of its own
 *                               (`AnchoredPanelScrim`) that was the same recipe
 *                               at a different z-index, which is the "two
 *                               primitives for one concept" the owner keeps
 *                               rejecting. Mount it as
 *                               `<PopoverPortal><PopoverScrim /></PopoverPortal>`
 *                               immediately before the `PopoverContent`.
 *   2. `anchoredPanelContentClass` — the shared `.glass-modal` surface and
 *                               the shared `max-w-lg` measure (see
 *                               `src/components/ui/dialogShell.test.ts`:
 *                               every popup wears one shell, and `max-w-lg`
 *                               is it). Real elevation, not a flat card.
 *   3. `AnchoredPanelCaret`   — a small notch pointing back at the trigger,
 *                               so it is obvious what opened this and that it
 *                               is anchored rather than floating.
 *   4. `AnchoredPanelHeader`  — title + an unambiguous 44px close control.
 *                               Tap-outside and Escape still dismiss (Radix
 *                               `DismissableLayer`); the X is the visible,
 *                               touch-discoverable equivalent.
 *
 * Mount the panel with `modal` on `<Popover>`: that is what locks page scroll
 * behind the scrim (so the panel's own list scrolls, not the feed), traps
 * focus inside the panel, and returns focus to the trigger on close.
 */

/**
 * Height budget for an anchored panel.
 *
 * `--radix-popover-content-available-height` is the distance from the trigger
 * to the collision boundary, so it already stops the panel running off the
 * bottom of the window — but NOT off the bottom nav, which is a fixed dock
 * floating over the viewport. Subtract the dock the same way every page does
 * (`--bottom-nav-h` + `--safe-area-bottom`, the pair behind Tailwind's
 * `safe-nav`), so the panel's last row can never sit under it.
 *
 * The `min()` with a viewport fraction keeps the panel from becoming a
 * full-height slab on a tall desktop window, where it would stop reading as
 * a dropdown.
 */
export const anchoredPanelMaxHeight =
  "min(72vh, calc(var(--radix-popover-content-available-height, 72vh) - var(--bottom-nav-h, 96px) - var(--safe-area-bottom, 0px) - 0.75rem))";

/**
 * The shared surface + measure for an anchored panel's `PopoverContent`.
 *
 * `.glass-modal` is the app's overlay surface (see `index.css`): near-opaque
 * background, 40px backdrop blur, `border-radius: 28px`, and a real modal
 * shadow. Using it — rather than `bg-premium-page`, which is the PAGE — is
 * what makes the panel read as a layer.
 *
 * `max-w-lg` is the shared popup measure documented by `dialogShell.test.ts`;
 * `w-[calc(100vw-1.5rem)]` lets it shrink to a 320px phone without ever
 * touching the edges.
 *
 * `p-0` because the panel owns its own header/body/footer padding.
 *
 * NOTE it deliberately does NOT clip: `AnchoredPanelCaret` is a child of the
 * content element but is positioned OUTSIDE its box (that is how it pokes out
 * toward the trigger), so `overflow: hidden` here would erase the caret
 * entirely. The clipping that the rounded corners need lives one level in, on
 * `anchoredPanelBodyClass`.
 */
export const anchoredPanelContentClass =
  "glass-modal w-[calc(100vw-1.5rem)] max-w-lg p-0 gap-0 flex flex-col";

/**
 * The clipping wrapper that goes immediately inside the content element and
 * holds the header / scroll area / footer.
 *
 * `rounded-[28px]` matches `.glass-modal`'s own radius exactly — a tinted
 * unread row or a footer button reaching the panel's bottom edge would
 * otherwise square off the corners the surface just rounded.
 */
export const anchoredPanelBodyClass =
  "flex-1 min-h-0 flex flex-col overflow-hidden rounded-[28px]";

/*
 * The scrim used to live here as `AnchoredPanelScrim`, a second copy of the
 * scrim `ui/popover.tsx` already exported. It is gone: `PopoverScrim` is the
 * one both anchored panels mount, and it is where the z-index reasoning, the
 * `pointer-events-auto` tap-through fix and the `--scrim-tint` / `--scrim-blur`
 * tokens now live. Do not add another one here.
 */

/**
 * The notch pointing back at the trigger. Radix positions it against whichever
 * side the panel ended up on, so it keeps pointing at the button even when a
 * collision flips the panel above the trigger.
 *
 * Filled with the `.glass-modal` background so it reads as part of the panel's
 * surface rather than a separate decoration.
 */
export function AnchoredPanelCaret() {
  return (
    <PopoverPrimitive.Arrow
      width={18}
      height={9}
      style={{ fill: "hsl(var(--background) / 0.95)" }}
    />
  );
}

/**
 * Title row + close control. The close button is a full 44px target (Apple
 * HIG) even though the glyph is small, and it is the ONLY thing in the row's
 * right cluster that is always present, so the title never crowds it.
 *
 * `actions` renders immediately left of the X, inside the same flex row — the
 * same "one row owns the whole cluster" rule `DialogContent`'s `topRightSlot`
 * enforces for dialogs, rather than a second hand-offset element beside it.
 */
export function AnchoredPanelHeader({
  titleId,
  title,
  meta,
  actions,
  onClose,
  children,
}: {
  /** id wired to the panel's `aria-labelledby`. */
  titleId: string;
  title: React.ReactNode;
  /** Small line beside the title — a count, a status. */
  meta?: React.ReactNode;
  /** Icon buttons rendered in the same row, left of the close control. */
  actions?: React.ReactNode;
  onClose: () => void;
  /** Second row — a segmented control, a search field. */
  children?: React.ReactNode;
}) {
  return (
    <div className="shrink-0 px-3 pt-2 pb-2.5 border-b border-[hsl(var(--olivewood)/0.12)]">
      <div className="flex items-center gap-2">
        <div className="flex-1 min-w-0 flex items-baseline gap-2 pl-1">
          <p
            id={titleId}
            className="font-display italic font-bold leading-tight truncate"
            style={{
              fontSize: "clamp(1.2rem, 1.6vw + 0.4rem, 1.45rem)",
              color: "hsl(var(--ink-deep))",
              letterSpacing: "-0.02em",
            }}
          >
            {title}
          </p>
          {meta}
        </div>
        {actions}
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="shrink-0 w-11 h-11 -mr-1 inline-flex items-center justify-center rounded-full transition-colors hover:bg-[hsl(var(--olivewood)/0.08)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--bark))] focus-visible:ring-offset-1"
          style={{ color: "hsl(var(--olivewood))" }}
        >
          <X className="w-[18px] h-[18px]" strokeWidth={2.25} />
        </button>
      </div>
      {children}
    </div>
  );
}

/**
 * Two-or-more-option segmented control for an anchored panel's header.
 *
 * One control, not two loose chips: a single track holds both segments, so
 * "Unread" and "All" read as the two halves of one switch. The SELECTED
 * segment is glossy (`btn-grad-primary` — the app's single primary-CTA
 * surface), never flat: project rule, and the same rule that governs primary
 * buttons and every other selected control in the app.
 */
export function AnchoredPanelSegmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { key: T; label: string; count?: number }[];
  onChange: (v: T) => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="mt-2 flex items-center gap-0.5 p-0.5 rounded-full"
      style={{
        background: "hsl(var(--ivory-sand) / 0.5)",
        border: "0.5px solid hsl(var(--olivewood) / 0.10)",
      }}
    >
      {options.map((opt) => {
        const active = opt.key === value;
        return (
          <button
            key={opt.key}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(opt.key)}
            className={`flex-1 min-w-0 h-11 px-3 rounded-full inline-flex items-center justify-center gap-1.5 text-ds-12 font-sans font-semibold transition-all active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--bark))] ${
              active ? "btn-grad-primary" : ""
            }`}
            style={
              active
                ? { color: "hsl(var(--parchment))", boxShadow: "var(--elev-bark-raised)" }
                : { color: "hsl(var(--olivewood) / 0.85)" }
            }
          >
            <span className="truncate">{opt.label}</span>
            {opt.count !== undefined && opt.count > 0 && (
              <span
                className="tabular-nums text-ds-11 font-bold rounded-full px-1.5 min-w-[1.25rem] leading-5"
                style={
                  active
                    ? {
                        background: "hsl(var(--parchment) / 0.22)",
                        color: "hsl(var(--parchment))",
                      }
                    : {
                        background: "hsl(var(--burnt-sienna) / 0.12)",
                        color: "hsl(var(--burnt-sienna))",
                      }
                }
              >
                {opt.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
