import * as React from "react";
import { X } from "lucide-react";

/**
 * anchoredPanel — the ONE treatment every panel that hangs off a header
 * button wears (Notifications off the bell, Browse Filters off the Filters
 * button).
 *
 * WHAT THESE PANELS ARE NOW (owner, 2026-08-31, on the Filters panel: "This
 * blur is not correct it should be anchored to screen remove the blur"; on
 * Notifications: "Same for this. No blur"; and, asked whether the two should
 * match: "Yes — both the same").
 *
 * A panel is a SCREEN-ANCHORED BAND, not a floating card:
 *
 *   1. No scrim.              The page behind is neither dimmed nor blurred.
 *                             `ui/popover.tsx` still portals a
 *                             `PopoverDismissLayer` — a full-bleed sheet that
 *                             paints NOTHING — because that element is what
 *                             receives the tap-outside; see its comment for
 *                             why removing it (rather than its paint)
 *                             reintroduces the tap-through bug.
 *   2. Full-bleed.            Edge to edge, x = 0 to the viewport width, top
 *                             flush with the bottom of the header the trigger
 *                             sits in. No side margins, no caret, no floating
 *                             rounded card — `useScreenPanelBand` measures the
 *                             band and `screenPanelContentProps` feeds it to
 *                             Radix.
 *   3. Opaque surface.        `screenPanelSurfaceStyle`, not `.glass-modal`:
 *                             a solid `--background` with a hairline bottom
 *                             edge and a soft downward shadow. A full-bleed
 *                             band separates from the page by its EDGE, and a
 *                             translucent blurred one would be exactly the
 *                             blur the owner asked to remove.
 *   4. `AnchoredPanelHeader`. Title + an unambiguous 44px close control.
 *                             Tap-outside and Escape still dismiss (Radix
 *                             `DismissableLayer`); the X is the visible,
 *                             touch-discoverable equivalent.
 *
 * Mount the panel with `modal` on `<Popover>`. That is deliberately KEPT even
 * though the scrim is gone: it is what locks page scroll behind the panel (so
 * the panel's own list scrolls, not the feed), traps focus inside the panel,
 * and returns focus to the trigger on close. None of those depended on the
 * scrim's paint; all three would be lost by going non-modal.
 */

/* ─────────────────────────────────────────────────────────────────────────
   SCREEN-ANCHORED GEOMETRY
   ─────────────────────────────────────────────────────────────────────────
   Radix positions a popover against its anchor with Floating UI, and the
   positioner it renders (`[data-radix-popper-content-wrapper]`) carries a
   `transform` — which makes it the containing block for any `position: fixed`
   descendant. So a panel CANNOT opt out of Radix's placement by declaring
   itself fixed and full-bleed: it would be fixed to the wrapper, i.e. right
   back where Radix put it.

   The way out is to give Radix an anchor whose rect IS the band we want. A
   zero-height rect spanning the viewport at the header's bottom edge, plus
   `side="bottom" align="center" sideOffset={0}` and a content width equal to
   that rect's width, resolves to exactly x = 0, y = header bottom. No CSS
   overrides, no `!important`, no fighting the positioner. */

/** Ancestors that count as "the header this panel hangs under". */
const PANEL_HEADER_SELECTOR =
  ".glass-nav, .glass-header, header, [data-app-shell-header], .liquid-glass";

/**
 * A header is a BAR. `.liquid-glass` is also the app's general card surface,
 * and on the desktop website the Filters button lives inside a full-height
 * `.liquid-glass` content card whose bottom edge is the bottom of the page —
 * anchoring to that would drop the panel off-screen. Anything taller than a
 * plausible bar is not the header, so keep walking.
 */
const MAX_HEADER_HEIGHT = 200;

/** Breathing room under the trigger when no header bar could be identified. */
const TRIGGER_FALLBACK_GAP = 8;

/** Gap kept between the panel's bottom edge and the dock (or the screen). */
const PANEL_BOTTOM_GAP = 12;

/** Smallest panel worth showing, however cramped the viewport. */
const PANEL_MIN_HEIGHT = 160;

export interface ScreenPanelBand {
  /** Always 0 — the band starts at the left edge of the screen. */
  left: number;
  /** Viewport y of the panel's top edge (the header's bottom). */
  top: number;
  /** `documentElement.clientWidth` — the scrollbar is excluded on purpose, so
   *  a full-bleed panel can never itself create horizontal overflow. */
  width: number;
  /** Height budget: everything from `top` down to the dock, less a gap. */
  maxHeight: number;
}

const EMPTY_BAND: ScreenPanelBand = { left: 0, top: 0, width: 0, maxHeight: 0 };

function measureScreenPanelBand(
  trigger: HTMLElement | null,
  extraBottomInset: number,
): ScreenPanelBand {
  if (typeof document === "undefined") return EMPTY_BAND;
  const doc = document.documentElement;
  const width = doc.clientWidth;
  const viewportHeight = doc.clientHeight;

  let top = 0;
  if (trigger) {
    const triggerRect = trigger.getBoundingClientRect();
    top = triggerRect.bottom + TRIGGER_FALLBACK_GAP;
    for (let el: HTMLElement | null = trigger.parentElement; el; el = el.parentElement) {
      if (!el.matches(PANEL_HEADER_SELECTOR)) continue;
      const rect = el.getBoundingClientRect();
      if (rect.height > MAX_HEADER_HEIGHT) continue;
      if (rect.bottom < triggerRect.bottom) continue;
      top = rect.bottom;
      break;
    }
  }

  // The dock is a FIXED bar floating over the viewport, so the viewport's own
  // height does not account for it. Measure the real thing rather than
  // subtracting `--bottom-nav-h`'s 96px fallback everywhere: that fallback is
  // also what a desktop viewport (where `.mobile-nav-frame` is
  // `display: none`) would subtract, stranding 96px of empty screen under
  // every desktop panel.
  const dock = document.querySelector<HTMLElement>(".mobile-nav-frame");
  let bottomInset = 0;
  if (dock && window.getComputedStyle(dock).display !== "none") {
    bottomInset = Math.max(0, viewportHeight - dock.getBoundingClientRect().top);
  }
  // `max`, not `+`: the software keyboard occupies the SAME strip of screen as
  // the dock, so adding them would shrink the panel by roughly twice what is
  // actually covered.
  bottomInset = Math.max(bottomInset, extraBottomInset);

  const maxHeight = Math.max(
    PANEL_MIN_HEIGHT,
    viewportHeight - top - bottomInset - PANEL_BOTTOM_GAP,
  );

  return { left: 0, top: Math.round(top), width, maxHeight: Math.round(maxHeight) };
}

/**
 * Measures the screen band a panel should occupy and hands back the virtual
 * anchor that puts Radix there.
 *
 * `anchorRef.current.getBoundingClientRect` reads the LIVE band rather than a
 * snapshot, so every reposition Floating UI runs (its own resize/scroll
 * listeners, plus the ResizeObserver on the content) picks up the current
 * numbers without this hook having to force one.
 *
 * @param open              whether the panel is open — nothing is measured or
 *                          listened for while it is closed.
 * @param triggerRef        the button the panel hangs off; its nearest header
 *                          bar decides the band's top edge.
 * @param extraBottomInset  additional bottom occlusion, e.g. the software
 *                          keyboard (`useKeyboardInset`).
 */
export function useScreenPanelBand(
  open: boolean,
  triggerRef: React.RefObject<HTMLElement | null>,
  extraBottomInset = 0,
): { anchorRef: React.RefObject<{ getBoundingClientRect: () => DOMRect }>; band: ScreenPanelBand } {
  const [band, setBand] = React.useState<ScreenPanelBand>(EMPTY_BAND);
  const bandRef = React.useRef<ScreenPanelBand>(EMPTY_BAND);
  const insetRef = React.useRef(extraBottomInset);
  insetRef.current = extraBottomInset;

  const measure = React.useCallback(() => {
    const next = measureScreenPanelBand(triggerRef.current, insetRef.current);
    bandRef.current = next;
    setBand((prev) =>
      prev.top === next.top && prev.width === next.width && prev.maxHeight === next.maxHeight
        ? prev
        : next,
    );
  }, [triggerRef]);

  // Layout effect, not effect: this runs in the same commit that mounts the
  // panel, so the measured width/height land BEFORE paint and the panel never
  // flashes at zero width.
  React.useLayoutEffect(() => {
    if (!open) return;
    measure();
    // A second pass on the next frame: the trigger's row can still be settling
    // (web fonts, a badge appearing) in the commit that opens the panel.
    const raf = requestAnimationFrame(measure);
    const vv = window.visualViewport;
    window.addEventListener("resize", measure);
    window.addEventListener("orientationchange", measure);
    vv?.addEventListener("resize", measure);
    vv?.addEventListener("scroll", measure);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", measure);
      window.removeEventListener("orientationchange", measure);
      vv?.removeEventListener("resize", measure);
      vv?.removeEventListener("scroll", measure);
    };
  }, [open, measure]);

  // The keyboard can rise and fall while the panel stays open.
  React.useEffect(() => {
    if (open) measure();
  }, [open, extraBottomInset, measure]);

  const anchorRef = React.useRef<{ getBoundingClientRect: () => DOMRect }>({
    getBoundingClientRect: () => {
      const b = bandRef.current;
      return new DOMRect(b.left, b.top, b.width, 0);
    },
  });

  return { anchorRef, band };
}

/**
 * The `PopoverContent` props that pin a panel to a measured band.
 *
 * `avoidCollisions={false}` is deliberate: collision handling exists to keep a
 * floating card on screen, and this panel is already sized and placed against
 * the screen. Left on, `shift` would slide a full-viewport-width panel
 * sideways to "fit" it and reintroduce the side margins.
 */
export function screenPanelContentProps(band: ScreenPanelBand) {
  return {
    side: "bottom" as const,
    align: "center" as const,
    sideOffset: 0,
    alignOffset: 0,
    avoidCollisions: false,
    style: {
      width: band.width || undefined,
      maxHeight: band.maxHeight || undefined,
      ...screenPanelSurfaceStyle,
    } satisfies React.CSSProperties,
  };
}

/**
 * The band's surface. OPAQUE, square, with a hairline bottom edge and a soft
 * downward shadow — the panel separates from the feed by its edge, not by
 * dimming or blurring what is behind it.
 *
 * Not `.glass-modal`: that surface is 95% `--background` over a 40px
 * `backdrop-filter`, which is a blur, which is the thing the owner asked to
 * remove. Its 28px radius is wrong here too — a band that reaches both screen
 * edges has no corners to round on the sides.
 */
const screenPanelSurfaceStyle = {
  background: "hsl(var(--background))",
  borderBottom: "1px solid hsl(var(--olivewood) / 0.14)",
  boxShadow: "0 18px 40px -22px hsl(160 10% 12% / 0.45)",
  // `PopoverContent`'s shared class enters with `zoom-in-95`, which on a
  // 1440px-wide band is a visible sideways stretch rather than the small pop a
  // dropdown gets. tailwindcss-animate drives that scale from a custom
  // property, and tailwind-merge does not know its class names well enough to
  // let a `zoom-in-100` override win reliably — so pin the property itself
  // here, where an inline value beats any class. The `slide-in-from-top-2`
  // drop survives, which is the part that reads as "this came down from the
  // header".
  "--tw-enter-scale": "1",
  "--tw-exit-scale": "1",
} as React.CSSProperties;

/** Layout classes for a screen-anchored panel's `PopoverContent`. */
export const screenPanelContentClass =
  "flex flex-col w-auto max-w-none p-0 gap-0 border-0 rounded-none bg-transparent shadow-none outline-none overflow-hidden";

/*
 * The old exports that made a panel a FLOATING CARD are gone, not deprecated:
 *
 *   `anchoredPanelMaxHeight`   — a CSS `min(72vh, …)` expression built on
 *                                `--radix-popover-content-available-height`.
 *                                A screen-anchored panel knows its own top
 *                                edge, so its height budget is arithmetic, not
 *                                an estimate: `useScreenPanelBand` returns it.
 *   `anchoredPanelContentClass`— `.glass-modal` + `max-w-lg` + a 1.5rem side
 *                                inset. All three said "floating card".
 *   `anchoredPanelBodyClass`   — existed only to clip the 28px corners the
 *                                card had. A full-bleed band has none.
 *   `AnchoredPanelCaret`       — the notch pointing back at the trigger. A
 *                                band that spans the screen is not pointing
 *                                anywhere (owner: "it should be anchored to
 *                                screen").
 *   `AnchoredPanelScrim`       — a second copy of the scrim `ui/popover.tsx`
 *                                already exported. Both are gone; what
 *                                survives there is `PopoverDismissLayer`,
 *                                which paints nothing.
 *
 * Do not reintroduce any of them without the owner asking for a floating card
 * back.
 */

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
