import {
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { X } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHero,
} from "@/components/ui/sheet";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverPortal,
  PopoverDismissLayer,
} from "@/components/ui/popover";
import {
  screenPanelContentClass,
  screenPanelContentProps,
  useScreenPanelBand,
} from "@/components/ui/anchoredPanel";
import { useKeyboardInset } from "@/hooks/useKeyboardInset";
import { useIsWebDesktop } from "@/hooks/useIsWebDesktop";
import { hapticLight } from "@/lib/haptics";
import { SHEET_HERO_TITLE_CLASS, SHEET_HERO_TITLE_STYLE } from "@/components/ui/sheetHeroTitle";
import { FilterSheetFooter } from "@/components/dashboard/filterSheet/FilterSheetFooter";

/**
 * FilterSheet — the ONE filter presentation used across the app.
 *
 * When the caller supplies `anchorRef` (the Browse feed does), this renders
 * as a Popover docked below the Filters button, at every width — no dimmed
 * backdrop, results stay visible and update live as you pick. Without an
 * `anchorRef`, it falls back to the shared modal `Sheet` primitive (fade/
 * zoom, focus trap, esc/backdrop dismiss — no drag-to-dismiss, removed
 * app-wide when `side="bottom"` stopped being a floor-anchored sheet).
 * Either way it stacks filter controls as titled vertical sections. Every
 * surface that needs filters (Browse / Dashboard, Activity, Guest) opens
 * this same component so the UX is identical everywhere.
 *
 * It's section-agnostic: each surface passes the `sections` it supports and
 * the sheet renders only those. The job surfaces build theirs with
 * `buildJobFilterSections` (filterSheet/jobFilterSections.tsx).
 *
 * Board 24: a sticky footer on both presentations, "Clear all" (olive text
 * link) on the left and one primary "Show jobs" on the right that closes the
 * panel. The button carries a number ONLY when the caller passes an exact
 * count for the whole filtered set (`resultCount`); a count of loaded pages
 * is never shown.
 */

export interface FilterSheetSection {
  /** Stable key for React. */
  key: string;
  /** Uppercase section eyebrow, e.g. "Sort by". */
  title: string;
  /** The section's controls. */
  content: ReactNode;
  /**
   * Optional compact control rendered on the SAME line as the eyebrow,
   * right-aligned — for a mode switch that belongs with a section but does
   * not earn a section of its own (Browse mounts the List⇄Map toggle here,
   * on Sort by). Keep it to one small control; anything taller than the
   * eyebrow line belongs in `content`.
   */
  trailing?: ReactNode;
}

interface FilterSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Sections to render, top to bottom. */
  sections: FilterSheetSection[];
  /** Count of currently-active filters — drives the header subtitle. */
  activeFilterCount: number;
  /** Clears every filter this sheet controls ("Clear all" in the footer). */
  onClearAll?: () => void;
  /** Heading, e.g. "Filter jobs". */
  title?: string;
  /** Exact size of the whole filtered set, or null/undefined when it is not
   *  known exactly (more pages to load, still loading): the button then
   *  reads "Show jobs" with no number. */
  resultCount?: number | null;
  /** [singular, plural] noun for the button, e.g. ["job", "jobs"]. */
  resultNoun?: readonly [string, string];
  /**
   * The button that opens this panel. Supply it and this renders a popover
   * anchored to that button, at every width, instead of a modal sheet; omit
   * it and this falls back to the plain modal sheet, for a caller with no
   * single fixed trigger to anchor against.
   *
   * Why a ref rather than a <PopoverTrigger>: on the Browse feed the button
   * (BrowseTasksActions, mounted in Dashboard's title card) and this panel
   * (BrowseTasksToolbar) live in different components, so they cannot be
   * wrapped in one Popover subtree. `virtualRef` is Radix Popper's supported
   * way to anchor against an element the popover does not own.
   */
  anchorRef?: RefObject<HTMLElement | null>;
  /** Action rows rendered after the last section, above the footer —
   *  for rows that OPEN something (Saved Searches) rather than filter. */
  footer?: ReactNode;
}

/** Uppercase eyebrow + content, the standard section shell. The eyebrow is
 *  brand olive rather than gray — the section labels are the sheet's skeleton,
 *  and painting them in the brand's structural color is what makes this
 *  surface read as OURS instead of unstyled Radix (see the density &
 *  brand-surface-fit block in the audit standard). */
function Section({ title, trailing, children }: { title: string; trailing?: ReactNode; children: ReactNode }) {
  return (
    <div className="pt-2.5 first:pt-0 border-t border-[hsl(var(--bark)/0.10)] first:border-t-0">
      <div className="flex items-center justify-between gap-3 mb-1">
        {/* Quiet gray sans eyebrow — owner's explicit pick (2026-08-24) over
            both the olive sans and the sienna-serif variants tried in the
            brand pass. The sheet's brand voice lives in the chips, switches
            and surface; the labels stay quiet. */}
        <p className="text-ds-10 font-semibold text-muted-foreground uppercase tracking-widest">
          {title}
        </p>
        {trailing}
      </div>
      {children}
    </div>
  );
}

/**
 * The anchored panel's scroll area, with a bottom fade while there is more
 * below.
 *
 * Without it the panel's own edge shears whatever row happens to land there —
 * the owner's screenshot had "Saved Searches" cut through the middle of the
 * word, which reads as a broken layout rather than as "scroll for more" (and
 * a job card plus the dock visible below it made it worse). The card's
 * max-height already keeps it clear of the bottom nav; this is the cue that
 * the cut is a scroll, not a crop.
 *
 * Live on both edges of the condition: the fade disappears at the end of the
 * list, so it never claims content that isn't there. Same rule as the chip
 * rows' horizontal fades in JobFilters.
 */
function PanelScroller({ children, desktop = false }: { children: ReactNode; desktop?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const [more, setMore] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      setMore(el.scrollTop + el.clientHeight < el.scrollHeight - 2);
    };
    measure();
    el.addEventListener("scroll", measure, { passive: true });
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    // Sections mount/unmount as filters change (the Distance hint line, the
    // Clear-all footer), so watch the content too, not just the box.
    const mo = new MutationObserver(measure);
    mo.observe(el, { childList: true, subtree: true });
    return () => {
      el.removeEventListener("scroll", measure);
      ro.disconnect();
      mo.disconnect();
    };
  }, []);

  return (
    <>
      {/* The scroller IS the flex child — no `h-full` wrapper around it. A
          percentage height resolved against a `flex-1` parent came out as the
          content height here, which silently turned the scroll area into an
          overflowing block that the card's `overflow-hidden` then CROPPED:
          nothing below the fold was reachable at all. `min-h-0` is what lets
          a flex child shrink below its content and actually scroll. */}
      {/* `pb-8` clears the fade below: without it the last section's final row
          came to rest UNDER the gradient, so the thing you scrolled to the
          bottom to read was the one thing still half-erased.

          DESKTOP DROPDOWN: `pb-1` instead (owner, 2026-09-14, VN-8: "too much
          space below saved searches"). On the content-sized desktop card the
          32px clearance plus FilterBody's own `pb-3` left ~44px of blank card
          under the last row whenever the list did not need to scroll — which
          at desktop heights is the usual case. The card now ends snugly after
          "Saved Searches" with ordinary padding (pb-3 + pb-1 ≈ the header's
          pt-4). The fade is gone at the end of the list (`more` is false), so
          the last row is still fully readable when scrolled to the bottom.
          Phone/native band keeps `pb-8`. */}
      <div ref={ref} className={`min-h-0 flex-1 overflow-y-auto overscroll-contain pt-3 ${desktop ? "pb-1" : "pb-8"}`}>
        {children}
      </div>
      {/* Positioned against the card (which is `relative`), not against the
          scroller — a fade inside the scroller would scroll away with it.

          TALLER AND STRONGER THAN A HAIRLINE FADE (h-14, ramping from 55%).
          The panel is now a full-bleed band with a hard bottom edge, and a
          32px whisper of a fade left the row straddling that edge looking
          SHEARED rather than scrolled — which is the exact complaint the owner
          raised about "Only Saved Jobs" being cut mid-item. A list that is
          longer than its box will always cut a row somewhere; the fix is that
          the cut reads as "there is more below", so the whole partially
          visible row dissolves instead of being sliced. */}
      {more && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 bottom-0 h-14"
          style={{
            background:
              "linear-gradient(to bottom, transparent 0%, hsl(var(--background) / 0.82) 55%, hsl(var(--background)) 92%)",
          }}
        />
      )}
    </>
  );
}

/** The panel's contents — the titled sections and the Clear-all footer.
 *  Shared verbatim by the sheet and the desktop popover so the two
 *  presentations cannot drift into two different filter sets. */
function FilterBody({
  sections,
  footer,
}: Pick<FilterSheetProps, "sections" | "footer">) {
  return (
    <>
      <div className="px-5 pb-3 space-y-2.5">
        {sections.map((s) => (
          <Section key={s.key} title={s.title} trailing={s.trailing}>
            {s.content}
          </Section>
        ))}
      </div>

      {/* Action rows (open-a-dialog things like Saved Searches) sit here with
          the footer — the actions live together at the end, after every
          control, instead of one wearing a filter section's clothes. */}
      {footer && <div className="px-5 pb-2">{footer}</div>}

    </>
  );
}

export function FilterSheet({
  open,
  onOpenChange,
  sections,
  activeFilterCount,
  onClearAll,
  anchorRef,
  footer,
  title = "Filters",
  resultCount,
  resultNoun = ["result", "results"],
}: FilterSheetProps) {
  const footerBar = (
    <FilterSheetFooter
      activeFilterCount={activeFilterCount}
      onClearAll={onClearAll}
      onDone={() => onOpenChange(false)}
      resultCount={resultCount}
      resultNoun={resultNoun}
    />
  );
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  // The panel is positioned against `window.innerHeight`, which on iOS does
  // NOT shrink when the software keyboard comes up — so a panel sized to the
  // full screen keeps its height and the keyboard simply covers its lower
  // half. Cap it against the keyboard too. `BrowseSearchBar` separately
  // scrolls the focused field into view; this is what gives it somewhere to
  // scroll to. 0 whenever no keyboard is up (and always on web).
  const keyboardInset = useKeyboardInset();
  const webDesktop = useIsWebDesktop();
  /* The panel is placed against a measured SCREEN BAND — a zero-height rect
     spanning the viewport at the bottom of the header the Filters button sits
     in — not against the button itself. `anchorRef` is still what identifies
     the button (for the measurement, and for the outside-press guard below).
     The keyboard inset is folded into the band's height budget so a panel that
     is already sized to the screen shrinks when the software keyboard covers
     the bottom of it. */
  // A stable stand-in for the sheet-fallback path (no `anchorRef` prop). It
  // must be a real ref, not `{ current: null }` inline: a fresh object every
  // render would change the hook's `measure` identity every render, which
  // would tear down and re-register its resize listeners on every render.
  const noTriggerRef = useRef<HTMLElement>(null);
  const { anchorRef: screenAnchorRef, band } = useScreenPanelBand(
    open,
    anchorRef ?? noTriggerRef,
    keyboardInset,
  );

  // A panel ANCHORED TO THE SCREEN, not a centered modal and not a floating
  // card off the Filters button — on phone/native (owner, 2026-08-30:
  // reviewed a centered-modal / inset-sheet / anchored-panel comparison and
  // picked anchored for Filters specifically; then 2026-08-31, seeing it on
  // device: "This blur is not correct it should be anchored to screen remove
  // the blur"). So there: full-bleed under the header, no scrim, no caret, no
  // side margins, opaque surface.
  //
  // Desktop web is the one exception to "at any width" (2026-09-11 fix): it
  // IS the floating card off the Filters button that the line above says this
  // isn't — see `screenPanelContentProps`'s desktop branch in
  // `anchoredPanel.tsx` for why a full-bleed band on that breakpoint was a
  // bug, not this decision reversed. `modal`, no scrim, and the dismiss layer
  // all still apply there too — only the geometry and the chrome flip.
  //
  // `modal` STAYS. It is not what produced the blur — it is what buys the
  // focus trap, `aria-hidden` on the page behind, and the scroll lock that
  // stops the feed scrolling under an open filter panel. Dropping it to remove
  // the scrim would have thrown away three things nobody complained about.
  //
  // NotificationPanel gets the identical treatment (same band geometry, same
  // dismiss layer, same surface) — the two anchored panels in the header must
  // not be two different objects. Owner, asked whether they should match:
  // "Yes — both the same".
  //
  // Phone + native app (owner 2026-10-18, tweak 6 "slide-up filter sheet"):
  // the anchored band gave way to the bottom sheet below (grab handle, glued
  // to the bottom edge). Desktop web keeps the dropdown off the button.
  if (anchorRef && webDesktop) {
    return (
      <Popover open={open} onOpenChange={onOpenChange} modal>
        <PopoverAnchor virtualRef={screenAnchorRef} />
        {/* NO SCRIM. What is mounted here paints NOTHING — it is a full-bleed
            layer whose only job is to receive the tap that dismisses the
            panel. Radix defers the outside-dismiss to the `click`, so without
            something to catch it that same click lands on the job card under
            your finger and opens it. See `PopoverDismissLayer` in
            `ui/popover.tsx`. Its own portal, first, so it stacks under the
            panel the way SheetOverlay stacks under SheetContent. */}
        <PopoverPortal>
          <PopoverDismissLayer />
        </PopoverPortal>
        <PopoverContent
          ref={panelRef}
          {...screenPanelContentProps(band, { roundTopCorners: true })}
          aria-labelledby={titleId}
          // NO AUTOFOCUS ON THE SEARCH FIELD. Radix's FocusScope focused the first tabbable
          // descendant (the "Search jobs…" input), throwing up the iOS keyboard over the chips
          // (owner: "opens in search bar which opens the keyboard. not correct"). Park focus on
          // the panel instead, as DialogContent does app-wide: a screen reader still announces
          // the dialog and its heading, Tab starts at close, Escape still closes.
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            panelRef.current?.focus({ preventScroll: true });
          }}
          // The Filters button is OUTSIDE the popover, so Radix counts a press
          // on it as an outside-dismiss — which would close the panel and then
          // let the button's own handler toggle it straight back. Let the
          // button keep sole ownership of the toggle. (Largely belt-and-braces
          // now that `modal` disables outside pointer events, but the press
          // still reaches the document, so the guard still earns its place.)
          onInteractOutside={(e) => {
            const target = e.target as Node | null;
            if (target && anchorRef.current?.contains(target)) e.preventDefault();
          }}
          // RETURN FOCUS TO THE FILTERS BUTTON.
          //
          // Radix restores focus to the element that opened the popover — but
          // only when that element is a `<PopoverTrigger>`. This panel is
          // opened by a button OUTSIDE the popover subtree and positioned
          // against a virtual anchor, so Radix has no trigger to hand focus
          // back to: measured on 2026-08-31, pressing Escape closed the panel
          // and left `document.activeElement` on `<body>`, which drops a
          // keyboard user back at the top of the document and announces
          // nothing. The notifications panel does not have this problem
          // because its bell IS a `PopoverTrigger`.
          //
          // Guarded on `event.defaultPrevented` so a future handler can still
          // opt out, and on the ref being live in case the button unmounted
          // while the panel was open.
          onCloseAutoFocus={(event) => {
            if (event.defaultPrevented) return;
            const button = anchorRef.current;
            if (!button) return;
            event.preventDefault();
            button.focus({ preventScroll: true });
          }}
          // (Tapping outside closes the panel WITHOUT also opening the job
          // card under your finger — that is `PopoverDismissLayer`'s
          // `pointer-events-auto` doing the work. Radix defers this dismiss to
          // the click, so nothing here can swallow it after the fact; the
          // layer has to be what receives the click in the first place.)
          //
          // The Content box carries the band's own width and height budget
          // (from `screenPanelContentProps`) plus the opaque full-bleed
          // surface; the inner div below is only the flex column that holds
          // the header and the scroller.
          className={screenPanelContentClass(band)}
        >
          {/* No notch on phone/native — a band that reaches both screen edges
              is not pointing at anything, and the owner asked for it anchored
              to the screen rather than to the sliders icon. Desktop web does
              not carry this caret either; a content-sized dropdown docked
              under the Filters button reads as anchored without one. */}
          <div
            // `mx-auto max-w-*` is a CONTENT measure, not a side margin — on
            // phone/native the band's SURFACE still reaches both edges of the
            // header it hangs under, and below 512px this changes nothing. At
            // `lg` (the `web-desktop` gate, 900px) it opens to max-w-3xl so
            // Sort's five chips and Category's twelve sit in wrapping rows
            // instead of a phone column in the middle of the band.
            //
            // On desktop web (2026-09-11 fix) this max-w-3xl is what caps the
            // whole PANEL's width now, not just this inner column's — see
            // `screenPanelContentProps`'s desktop branch in
            // `anchoredPanel.tsx`: `PopoverContent` carries no forced width
            // there, so it shrinks to fit this wrapper instead of the 1576px
            // content-column band it used to stretch to.
            className="relative flex min-h-0 w-full max-w-lg lg:max-w-3xl flex-1 mx-auto flex-col overflow-hidden"
          >
            {/* Panel header — a title and, on phone/native, an unmistakable
                way out. There was neither before: the only ✕ on screen
                belonged to the search INPUT, so that is what people reached
                for to close the panel (owner: "the x in search also doesn't
                close it").

                NO ✕ ON THE DESKTOP DROPDOWN (owner, 2026-09-14, VN-7: "no x
                needed in the refine search tab. you tap the filter button
                again or out the box to close it"). On desktop web
                (`band.desktop`) the Filters button toggles it, the dismiss
                layer closes it on an outside click, and Escape still closes
                it (Radix DismissableLayer) with focus returned to the Filters
                button by `onCloseAutoFocus` above. The phone/native band keeps
                its ✕. */}
            <div className="shrink-0 flex items-center justify-between gap-3 px-5 pt-4 pb-3 border-b border-[hsl(var(--bark)/0.12)]">
              {/* SheetHero's title look (Q237): the phone sheet below already
                  uses SheetHero; this band cannot (it is a Popover, not a
                  Radix Sheet), so it reads the same shared tokens. */}
              <h2 id={titleId} className={SHEET_HERO_TITLE_CLASS} style={SHEET_HERO_TITLE_STYLE}>
                {title}
              </h2>
              {!band.desktop && (
              <button
                type="button"
                onClick={() => { hapticLight(); onOpenChange(false); }}
                aria-label="Close filters"
                // Bare olivewood glyph in a 40x40 box, exactly like
                // SheetCloseButton — the panel paints its own surface, so the
                // frosted disc that primitive dropped is not wanted here
                // either. The global 44px button floor supplies the tap target.
                className="-mr-2 inline-flex h-10 w-10 shrink-0 items-center justify-center ctl-exit btn-press transition-colors hover:bg-[hsl(var(--bark)/0.08)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
                style={{ color: "hsl(var(--olivewood))" }}
              >
                <X className="h-5 w-5" strokeWidth={2} />
              </button>
              )}
            </div>

            {/* The sections scroll INSIDE the card, under a pinned header, so
                the last row is always reachable and never sheared by the
                panel edge. */}
            <PanelScroller desktop={band.desktop}>
              <FilterBody sections={sections} footer={footer} />
            </PanelScroller>
            {footerBar}
          </div>
        </PopoverContent>
      </Popover>
    );
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        floor
        // A max height so a tall section list scrolls
        // inside the sheet rather than pushing the dock off-screen.
        className="max-h-[85dvh] overflow-y-auto overscroll-contain p-0 gap-0 bg-premium-page"
      >
        {/* Title ONLY — no eyebrow, no subtitle. This header used to stack
            "FILTERS" / "Refine your search" / "Narrow your results", which is
            the same sentence three times in three type sizes. Nothing is lost:
            the active-filter count still shows as a badge on the Filters button
            that opens this sheet, and an active filter still surfaces the
            "Clear all" footer below. */}
        <SheetHero title={title} />

        <FilterBody sections={sections} footer={footer} />
        {footerBar}
      </SheetContent>
    </Sheet>
  );
}
