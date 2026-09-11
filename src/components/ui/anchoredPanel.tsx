import * as React from "react";
import { X } from "lucide-react";
import { SegmentedControl } from "@/components/ui/SegmentedControl";

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
 * Below the desktop web breakpoint (phone width, and the native app — see
 * `useIsWebDesktop`), a panel is a SCREEN-ANCHORED BAND, not a floating card:
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
 * ON DESKTOP WEB (`html.web-desktop`, ≥900px, never the native app) a panel is
 * instead a NORMAL ANCHORED DROPDOWN — real rounded corners, a real border and
 * shadow, sized to its content, docked under the trigger that opened it. See
 * the comment above `measureScreenPanelBand`'s desktop branch for the bug this
 * replaced and why.
 *
 * Mount the panel with `modal` on `<Popover>`. That is deliberately KEPT even
 * though the scrim is gone: it is what locks page scroll behind the panel (so
 * the panel's own list scrolls, not the feed), traps focus inside the panel,
 * and returns focus to the trigger on close. None of those depended on the
 * scrim's paint; all three would be lost by going non-modal. True on both
 * breakpoints — the dropdown treatment did not change this.
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

/**
 * DESKTOP WEB IS NO LONGER A NARROWER BAND — IT IS A NORMAL ANCHORED DROPDOWN.
 *
 * Fixed 2026-09-11 (owner report): both panels rendered on desktop web as a
 * FULL-BLEED BAND across the content column — `PopoverContent` carried an
 * inline `width` equal to the whole page-panel/app-shell-frame rect (measured
 * live: 1048px for Notifications, 1576px for Filters), with the real content
 * stranded in its own `max-w-lg`/`max-w-3xl mx-auto` inner wrapper — a giant
 * empty band on both sides of a narrow column. That inline `width` is what
 * `DESKTOP_PANEL_SELECTOR` used to compute (the page panel's rect), narrowing
 * the band from the viewport to the content column but never all the way
 * down to the trigger. `DESKTOP_PANEL_SELECTOR` is gone with it.
 *
 * Desktop web now skips the screen-band geometry entirely and anchors to the
 * TRIGGER's own rect — `side="bottom" align="end"`, `avoidCollisions: true` —
 * the same way any ordinary Radix dropdown (see `dropdown-menu.tsx`, which
 * sets no width at all) sizes itself: shrink-to-fit around its content, which
 * is exactly what a `PopoverContent` with no forced `width` and a
 * `position: absolute` Radix wrapper already does. The existing content caps
 * (`max-w-lg` for Notifications, `max-w-lg lg:max-w-3xl` for Filters) still
 * cap how wide that shrink-to-fit box can grow — they were never the bug.
 *
 * Phone width and the native app are UNCHANGED — `measureScreenPanelBand`
 * only takes this branch when `html.web-desktop` is present, which per
 * `useIsWebDesktop` is never true below 900px and never true in the native
 * shell. Below that width the full-bleed screen-band treatment this file's
 * header comment describes is exactly as it was.
 */

/** Breathing room under the trigger when no header bar could be identified,
 *  and — on desktop web — the gap kept between the trigger and the dropdown
 *  that now anchors directly to it. */
const TRIGGER_FALLBACK_GAP = 8;

/** Gap kept between the panel's bottom edge and the dock (or the screen). */
const PANEL_BOTTOM_GAP = 12;

/** Smallest panel worth showing, however cramped the viewport. */
const PANEL_MIN_HEIGHT = 160;

export interface ScreenPanelBand {
  /** Viewport x of the band's left edge: 0 on a phone (the band starts at
   *  the screen edge); on desktop web, the trigger's own left edge. */
  left: number;
  /** Viewport y of the panel's top edge: the header's bottom on a phone; on
   *  desktop web, the trigger's own bottom edge (a small `sideOffset` in
   *  `screenPanelContentProps` supplies the gap under it). */
  top: number;
  /** `documentElement.clientWidth` on a phone (the scrollbar is excluded on
   *  purpose, so a full-bleed panel can never itself create horizontal
   *  overflow). On desktop web this is the trigger's own width — it only
   *  feeds the virtual anchor's rect for `align="end"` to read off of; it is
   *  NOT applied as the panel's width there (see `desktop` below). */
  width: number;
  /** Height budget: everything from `top` down to the dock, less a gap. */
  maxHeight: number;
  /** True on desktop web (`html.web-desktop`, ≥900px, never the native app).
   *  `screenPanelContentProps`/`screenPanelContentClass` key off this to
   *  render a content-sized anchored dropdown instead of a full-bleed band —
   *  see the comment above this function's desktop branch. */
  desktop: boolean;
}

const EMPTY_BAND: ScreenPanelBand = { left: 0, top: 0, width: 0, maxHeight: 0, desktop: false };

/**
 * DESKTOP WEB: an anchored dropdown under the trigger, not a band.
 *
 * Bug (owner report, 2026-09-11): on desktop web both panels rendered as a
 * full-bleed band the width of the content column beside the rail (measured
 * live: 1048px for Notifications, 1576px for Filters) — an inline `width` on
 * `PopoverContent` computed from `trigger.closest(".page-panel,
 * .app-shell-frame")`'s rect, the same header-band geometry the phone
 * treatment uses. The content itself was already correctly capped by its own
 * `max-w-lg`/`max-w-3xl mx-auto` inner wrapper, so the visible result was that
 * capped content marooned in the middle of a much wider, chrome-stripped band
 * (`rounded-none border-0 shadow-none` from `screenPanelContentClass`).
 *
 * Fix: on desktop web, skip the band geometry and hand Radix the TRIGGER's
 * own rect as the anchor, with `align="end"` (both triggers sit at the
 * trailing edge of their row — the bell in `DesktopTopNav`, the Filters
 * button in `BrowseTasksActions`) and `avoidCollisions: true` in
 * `screenPanelContentProps`. With no forced `width`, `PopoverContent` sizes
 * itself the same way any other Radix dropdown in this app does (see
 * `dropdown-menu.tsx`, which sets no width at all) — shrink-to-fit around its
 * content, still capped by that same `max-w-lg`/`max-w-3xl` inner wrapper.
 * `screenPanelContentClass` gives it back real corners, border and shadow for
 * this breakpoint only.
 *
 * Phone and native are untouched: this whole branch is gated on
 * `doc.classList.contains("web-desktop")`, which `useIsWebDesktop` never sets
 * below 900px or inside the native shell.
 */
function measureScreenPanelBand(
  trigger: HTMLElement | null,
  extraBottomInset: number,
): ScreenPanelBand {
  if (typeof document === "undefined") return EMPTY_BAND;
  const doc = document.documentElement;
  const viewportHeight = doc.clientHeight;
  const isDesktop = doc.classList.contains("web-desktop");

  // The dock is a FIXED bar floating over the viewport, so the viewport's own
  // height does not account for it. Measure the real thing rather than
  // subtracting `--bottom-nav-h`'s 96px fallback everywhere: that fallback is
  // also what a desktop viewport (where `.mobile-nav-frame` is
  // `display: none`) would subtract, stranding 96px of empty screen under
  // every desktop panel. (On desktop web this is always 0 — the dock is
  // phone/native chrome — but the measurement is cheap and shared.)
  const dock = document.querySelector<HTMLElement>(".mobile-nav-frame");
  let bottomInset = 0;
  if (dock && window.getComputedStyle(dock).display !== "none") {
    bottomInset = Math.max(0, viewportHeight - dock.getBoundingClientRect().top);
  }
  // `max`, not `+`: the software keyboard occupies the SAME strip of screen as
  // the dock, so adding them would shrink the panel by roughly twice what is
  // actually covered.
  bottomInset = Math.max(bottomInset, extraBottomInset);

  if (isDesktop && trigger) {
    const triggerRect = trigger.getBoundingClientRect();
    const maxHeight = Math.max(
      PANEL_MIN_HEIGHT,
      viewportHeight - triggerRect.bottom - TRIGGER_FALLBACK_GAP - bottomInset - PANEL_BOTTOM_GAP,
    );
    return {
      left: Math.round(triggerRect.left),
      top: Math.round(triggerRect.bottom),
      width: Math.round(triggerRect.width),
      maxHeight: Math.round(maxHeight),
      desktop: true,
    };
  }

  const left = 0;
  const width = doc.clientWidth;
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

  const maxHeight = Math.max(
    PANEL_MIN_HEIGHT,
    viewportHeight - top - bottomInset - PANEL_BOTTOM_GAP,
  );

  return { left, top: Math.round(top), width, maxHeight: Math.round(maxHeight), desktop: false };
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
 * `avoidCollisions={false}` is deliberate on the phone/native path: collision
 * handling exists to keep a floating card on screen, and this panel is
 * already sized and placed against the screen. Left on, `shift` would slide a
 * full-viewport-width panel sideways to "fit" it and reintroduce the side
 * margins.
 *
 * On desktop web (`band.desktop`) this is the opposite panel — a normal
 * anchored dropdown docked under the trigger, `align="end"` (both triggers
 * sit at the trailing edge of their row) with collision avoidance back ON, the
 * same as any other Radix dropdown in the app, so it slides to stay on screen
 * rather than running off the right edge near a narrow viewport.
 */
export function screenPanelContentProps(band: ScreenPanelBand): {
  side: "bottom";
  align: "center" | "end";
  sideOffset: number;
  alignOffset: number;
  avoidCollisions: boolean;
  style: React.CSSProperties;
} {
  if (band.desktop) {
    return {
      side: "bottom" as const,
      align: "end" as const,
      sideOffset: TRIGGER_FALLBACK_GAP,
      alignOffset: 0,
      avoidCollisions: true,
      style: {
        // NO forced width here — this is the whole fix. Left to `width: auto`
        // (Radix's Popper wrapper is `position: absolute`, so an unconstrained
        // child shrink-wraps exactly like `dropdown-menu.tsx`'s content does),
        // the panel sizes itself to its content, which is still capped by that
        // content's own `max-w-lg`/`max-w-3xl mx-auto` inner wrapper.
        maxHeight: band.maxHeight || undefined,
        ...desktopPanelSurfaceStyle,
      },
    };
  }
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
    },
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

/**
 * The desktop-web dropdown's surface — a real card: opaque `--background`,
 * a full border, a rounded-lg radius (the app's standard card radius token)
 * and `--elev-sheet`'s floating-surface shadow (same recipe named
 * `--shadow-elevated` elsewhere). No `--tw-enter-scale` override here, unlike
 * `screenPanelSurfaceStyle` above — that override existed only to stop a
 * 1440px-wide band from visibly stretching sideways on open; a content-sized
 * dropdown is exactly the size a small `zoom-in-95` pop is meant for.
 */
const desktopPanelSurfaceStyle = {
  background: "hsl(var(--background))",
  border: "1px solid hsl(var(--olivewood) / 0.14)",
  boxShadow: "var(--elev-sheet)",
} as React.CSSProperties;

/** Layout classes for a screen-anchored panel's `PopoverContent` — full-bleed
 *  band on phone/native, real card on desktop web. Takes the band rather than
 *  a bare boolean so a call site never has to import `ScreenPanelBand` just to
 *  pass this through. */
export function screenPanelContentClass(band: ScreenPanelBand): string {
  return band.desktop
    ? "flex flex-col w-auto p-0 gap-0 rounded-lg outline-none overflow-hidden"
    : "flex flex-col w-auto max-w-none p-0 gap-0 border-0 rounded-none bg-transparent shadow-none outline-none overflow-hidden";
}

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
 * A thin adapter over the app's shared <SegmentedControl />, kept because the
 * panel header wants a specific top margin and the call sites already speak
 * `{ key, label, count }`. Everything visual — the track, the glossy selected
 * segment, the count pill, the 44px row, the arrow-key handling — comes from
 * the shared component, so this cannot drift from Analytics and Earnings the
 * way the four hand-rolled copies did.
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
  /** The panel's counts are backlogs (unread), not populations. */
  onChange: (v: T) => void;
}) {
  return (
    <SegmentedControl
      ariaLabel={label}
      className="mt-2"
      options={options.map((o) => ({
        value: o.key,
        label: o.label,
        count: o.count,
        countTone: "attention" as const,
      }))}
      value={value}
      onChange={onChange}
    />
  );
}
