import {
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from "react";
import { useNavigate } from "react-router-dom";
import { ArrowUpRight, Bookmark, Clock, Rocket, X, Zap, type LucideIcon } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHero,
} from "@/components/ui/sheet";
import {
  Popover,
  PopoverAnchor,
  PopoverArrow,
  PopoverContent,
  PopoverPortal,
  PopoverScrim,
} from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { useKeyboardInset } from "@/hooks/useKeyboardInset";
import { hapticLight } from "@/lib/haptics";
import {
  SortContent,
  CategoryContent,
  NearbyContent,
  ExpiresContent,
} from "@/components/dashboard/JobFilters";

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
 * `buildJobFilterSections` below (Category / Budget / [Pricing] / [Distance] /
 * When / Show only / Sort by); Activity passes a single Status section.
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
  /** Clears every filter this sheet controls. Rendered as a footer button
   *  only when at least one filter is active. */
  onClearAll?: () => void;
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
  /** Action rows rendered after the last section, beside Clear All —
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
function PanelScroller({ children }: { children: ReactNode }) {
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
      <div ref={ref} className="min-h-0 flex-1 overflow-y-auto overscroll-contain pt-3">
        {children}
      </div>
      {/* Positioned against the card (which is `relative`), not against the
          scroller — a fade inside the scroller would scroll away with it. */}
      {more && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 bottom-0 h-8"
          style={{
            background: "linear-gradient(to bottom, transparent, hsl(var(--background)) 92%)",
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
  activeFilterCount,
  onClearAll,
  footer,
}: Pick<FilterSheetProps, "sections" | "activeFilterCount" | "onClearAll" | "footer">) {
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
          Clear All — the actions live together at the end, after every
          control, instead of one wearing a filter section's clothes. */}
      {footer && <div className="px-5 pb-2">{footer}</div>}

      {onClearAll && activeFilterCount > 0 && (
        <div className="px-5 pb-2">
          <button
            type="button"
            onClick={() => {
              hapticLight();
              onClearAll();
            }}
            className="w-full inline-flex items-center justify-center gap-1.5 h-11 rounded-ds-md text-ds-13 font-semibold btn-press"
            style={{
              color: "hsl(var(--burnt-sienna))",
              background: "hsl(var(--burnt-sienna) / 0.10)",
              border: "0.5px solid hsl(var(--burnt-sienna) / 0.22)",
            }}
          >
            <X className="w-4 h-4" strokeWidth={2.25} /> Clear All
          </button>
        </div>
      )}
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
}: FilterSheetProps) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  // The panel is positioned against `window.innerHeight`, which on iOS does
  // NOT shrink when the software keyboard comes up — so a panel sized to the
  // full screen keeps its height and the keyboard simply covers its lower
  // half. Cap it against the keyboard too. `BrowseSearchBar` separately
  // scrolls the focused field into view; this is what gives it somewhere to
  // scroll to. 0 whenever no keyboard is up (and always on web).
  const keyboardInset = useKeyboardInset();

  // A panel hanging off the Filters button, not a centered modal — at ANY
  // width, not just desktop (owner, 2026-08-30: reviewed a centered-modal /
  // inset-sheet / anchored-panel comparison and picked anchored for Filters
  // specifically). Anchored, but a LAYER: it carries the app's shared scrim
  // and the shared `.glass-modal` surface.
  //
  // It used to be non-modal and unscrimmed, on the reasoning that the board
  // should stay lit and visibly re-filter behind you as you pick. The owner
  // rejected that on device (2026-08-31: "how can we improve notifications or
  // anchored filters so they stand out better") — with the feed at full
  // contrast directly below and beside it, on a surface a shade off the page's
  // own, the panel read as one more band of the page rather than something
  // that had opened over it. `modal` also buys the three things the bare
  // popover lacked: a focus trap, `aria-hidden` on the page behind, and a
  // scroll lock, so the feed can't scroll under an open filter panel.
  //
  // NotificationPanel gets the identical treatment (same `PopoverScrim`, same
  // `.glass-modal`, same notch) — the two anchored panels in the header must
  // not be two different objects.
  if (anchorRef) {
    return (
      <Popover open={open} onOpenChange={onOpenChange} modal>
        <PopoverAnchor virtualRef={anchorRef} />
        {/* Scrim FIRST, in its own portal, so it stacks under the panel the
            same way SheetOverlay stacks under SheetContent. */}
        <PopoverPortal>
          <PopoverScrim />
        </PopoverPortal>
        <PopoverContent
          ref={panelRef}
          align="end"
          sideOffset={10}
          // The trigger sits at the far right of the window; without this the
          // panel would hang off the edge. It also feeds Radix's
          // `--radix-popover-content-available-height`, which the inner card
          // caps itself with below.
          collisionPadding={16}
          aria-labelledby={titleId}
          // NO AUTOFOCUS ON THE SEARCH FIELD.
          //
          // Nothing in this tree ever asked for it: there is no `autoFocus`
          // prop and no `.focus()` call. It was Radix's FocusScope default —
          // on mount it focuses the first tabbable descendant, and on phone
          // the first section is Search, so the first tabbable descendant is
          // the "Search jobs…" input. On iOS that threw the software keyboard
          // up the instant the sliders icon was tapped, covering the bottom
          // half of the panel (owner: "opens in search bar which opens the
          // keyboard. not correct") — so DISTANCE, WHEN and everything below
          // were buried behind a keyboard nobody asked for, on a panel people
          // open to tap a chip, not to type.
          //
          // Park focus on the panel container instead — the same fix
          // `DialogContent` already carries app-wide. No field is focused so
          // no keyboard rises, but focus is INSIDE the panel: a screen reader
          // announces the dialog and its "Refine Your Search" heading, Tab
          // starts at the close button and walks the sections in order, and
          // Escape still closes. Dropping focus on <body> would have done
          // none of that. Radix's FocusScope gives Content `tabIndex={-1}`,
          // so the container accepts focus.
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
          // (Tapping outside closes the panel WITHOUT also opening the job
          // card under your finger — that is the scrim's `pointer-events-auto`
          // doing the work, see `PopoverScrim`. Radix defers this dismiss to
          // the click, so nothing here can swallow it after the fact; the
          // scrim has to be what receives the click in the first place.)
          // The Content box itself is now just the positioner: no padding, no
          // border, no background, no clipping — the visible card is the inner
          // div, and the notch (`PopoverArrow`) hangs OUTSIDE that card, so
          // Content must not clip its own children.
          className="w-[400px] max-w-[calc(100vw-2rem)] p-0 border-0 bg-transparent shadow-none"
        >
          {/* The notch that points back at the sliders icon — says "this
              opened from THAT button", and that the panel is anchored rather
              than floating free. Solid fill, not the card's translucency: an
              SVG cannot inherit a backdrop-filter. */}
          <PopoverArrow
            width={16}
            height={8}
            className="fill-[hsl(var(--background))] drop-shadow-none"
          />
          <div
            className="glass-modal relative flex flex-col overflow-hidden rounded-ds-lg"
            style={{
              // The panel must never run under the bottom nav — the owner's
              // screenshot had the Saved Searches row sheared mid-word by the
              // panel edge with a job card and the dock still visible below
              // it. Radix's available-height already stops it at the viewport;
              // subtract the dock and the home-indicator inset on top of that,
              // with a floor so a very short viewport still gets a usable
              // panel rather than a sliver.
              //
              // `max(dock, keyboard)` rather than dock + keyboard: the two
              // occupy the SAME strip of screen — when the keyboard is up it
              // sits over the dock — so adding them would shrink the panel by
              // roughly twice what is actually covered.
              maxHeight: `max(220px, calc(var(--radix-popover-content-available-height, 70vh) - max(var(--bottom-nav-h, 96px), ${keyboardInset}px) - var(--safe-area-bottom, 0px)))`,
              // The scrolling chip rows fade against the panel's OWN surface,
              // not the page's — see `--filter-surface` in JobFilters.tsx.
              "--filter-surface": "var(--background)",
            } as CSSProperties}
          >
            {/* Panel header — a title and an unmistakable way out. There was
                neither before: the only ✕ on screen belonged to the search
                INPUT, so that is what people reached for to close the panel
                (owner: "the x in search also doesn't close it"). */}
            <div className="shrink-0 flex items-center justify-between gap-3 px-5 pt-4 pb-3 border-b border-[hsl(var(--bark)/0.12)]">
              <h2 id={titleId} className="font-serif italic text-ds-17 font-bold text-foreground">
                Refine Your Search
              </h2>
              <button
                type="button"
                onClick={() => { hapticLight(); onOpenChange(false); }}
                aria-label="Close filters"
                // Bare olivewood glyph in a 40x40 box, exactly like
                // SheetCloseButton — the panel paints its own surface, so the
                // frosted disc that primitive dropped is not wanted here
                // either. The global 44px button floor supplies the tap target.
                className="-mr-2 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-ds-md btn-press transition-colors hover:bg-[hsl(var(--bark)/0.08)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
                style={{ color: "hsl(var(--olivewood))" }}
              >
                <X className="h-5 w-5" strokeWidth={2} />
              </button>
            </div>

            {/* The sections scroll INSIDE the card, under a pinned header, so
                the last row is always reachable and never sheared by the
                panel edge. */}
            <PanelScroller>
              <FilterBody
                sections={sections}
                activeFilterCount={activeFilterCount}
                onClearAll={onClearAll}
                footer={footer}
              />
            </PanelScroller>
          </div>
        </PopoverContent>
      </Popover>
    );
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
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
        <SheetHero className="px-5 pt-1 pb-2.5" title="Refine Your Search" />

        <FilterBody
          sections={sections}
          activeFilterCount={activeFilterCount}
          onClearAll={onClearAll}
          footer={footer}
        />
      </SheetContent>
    </Sheet>
  );
}

// ---------------- Job-filter section builder ----------------

interface JobFilterSectionsArgs {
  selectedCategory: string | null;
  setSelectedCategory: (v: string | null) => void;
  sortBy: string;
  setSortBy: (v: string) => void;
  expiresWithin: string;
  setExpiresWithin: (v: string) => void;
  boostedOnly: boolean;
  setBoostedOnly: (v: boolean) => void;
  urgentOnly: boolean;
  setUrgentOnly: (v: boolean) => void;
  /* ---- Nearby-radius section (omit together with showNearby={false}) ---- */
  locationFilter?: string;
  setLocationFilter?: (v: string) => void;
  userLocStatus?: "idle" | "loading" | "ready" | "error";
  userLocMessage?: string;
  /* ---- "Only my hours" row (omit together with showAvailability={false}) ---- */
  matchAvailability?: boolean;
  setMatchAvailability?: (v: boolean) => void;
  hasAvailability?: boolean;
  /** Hide the "Only my hours" availability row (guests have no schedule). */
  showAvailability?: boolean;
  /* ---- "Only Saved Jobs" row (omit on surfaces without saves, e.g. guest) ---- */
  savedOnly?: boolean;
  onToggleSavedOnly?: () => void;
  savedCount?: number;
  /**
   * Hide the "Nearby radius" section. The guest browse feed comes from
   * `get_ranked_open_jobs`, whose rows carry no latitude/longitude (the server
   * masks each address down to "City, ST"), and a signed-out visitor has no
   * saved profile location or parish to fall back on — so every radius chip
   * would be a control that provably cannot change the results. Hidden rather
   * than shipped as a no-op.
   */
  showNearby?: boolean;
  /**
   * "Saved Searches" row, rendered at the end of the "Show only" section —
   * an action rather than a filter, but it used to sit alone in the sheet
   * footer, disconnected from every section above it. Folded in here so it
   * reads as part of the sheet instead of a stray extra control tacked on
   * at the bottom. Omit on surfaces with no saved-search feature (guest).
   */
  savedSearchesButton?: ReactNode;
}

/**
 * Full-width label + Switch row — the "Show only" group's single control
 * shape. Both narrowing booleans (Boosted, my-hours) render through this so
 * they read as one settings group instead of one stray gold pill under its
 * own heading plus one switch buried in the When section.
 */
function ToggleRow({
  icon: Icon,
  iconClassName,
  label,
  hint,
  checked,
  onChange,
  disabled,
  ariaLabel,
}: {
  icon: LucideIcon;
  iconClassName?: string;
  label: string;
  hint?: ReactNode;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  ariaLabel: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3 w-full">
      {/* `items-start` + `mt-0.5` on the icon, not `items-center`: this row
          can carry a 2-line hint (AvailabilityRow's "Add your weekly hours
          first — set hours ↗"), and centering the icon against that full
          block rode it up above the label's own optical center. Aligning to
          the label's cap-height instead reads right whether the hint is one
          line or two. */}
      <div className="flex items-start gap-2 min-w-0 flex-1">
        <Icon
          className={`w-3.5 h-3.5 shrink-0 mt-0.5 ${iconClassName ?? "text-primary"}`}
          strokeWidth={2.25}
          aria-hidden
        />
        <div className="min-w-0">
          <p className="text-ds-12 font-semibold text-foreground leading-snug">{label}</p>
          {hint}
        </div>
      </div>
      <Switch
        checked={checked}
        onCheckedChange={(v) => { hapticLight(); onChange(v); }}
        disabled={disabled}
        // COMPOSED, not substituted. This rendered `ariaLabel` alone, so the
        // switch's accessible name replaced its visible text — a voice-control
        // user saying the words they can see ("Boosted Jobs") hits nothing,
        // WCAG 2.5.3. Today's four call sites happen to contain their label;
        // nothing made the fifth. Prefixing the visible label guarantees it,
        // and the pass-through keeps a caller that already leads with it from
        // saying it twice.
        aria-label={
          ariaLabel.toLowerCase().startsWith(label.toLowerCase())
            ? ariaLabel
            : `${label} — ${ariaLabel}`
        }
        // Sienna, not the global olivewood: on THIS surface the accent color
        // already means "narrowing is on" (Clear All, the Filtered eyebrow,
        // the Boosted/Urgent icons), so the lit switch joins that family.
        className="shrink-0 data-[state=checked]:bg-[hsl(var(--burnt-sienna))]"
      />
    </div>
  );
}

/**
 * "Jobs during my hours" — the third row of SHOW ONLY, wearing the SAME shape
 * as the two above it.
 *
 * It used to break the group two different ways depending on state. With no
 * saved hours its hint was a bold `text-primary` "Set Hours ↗" button, so the
 * one row whose switch is INERT was also the loudest thing in the section,
 * while its working siblings sat in quiet grey. With hours saved the hint was
 * `undefined`, so the row lost its second line entirely and stood shorter than
 * the other two — the rhythm broke in one direction or the other, always.
 *
 * Now every row is icon + label + one grey `text-ds-11` line. The line says
 * what the filter does once it can work, and what is missing when it cannot;
 * the shortcut rides inside that sentence as an underlined link rather than
 * standing in for the description. Disabled reads as disabled.
 */
function AvailabilityRow({
  matchAvailability,
  setMatchAvailability,
  hasAvailability,
}: {
  matchAvailability: boolean;
  setMatchAvailability: (v: boolean) => void;
  hasAvailability: boolean;
}) {
  const navigate = useNavigate();
  return (
    <ToggleRow
      icon={Clock}
      label="Jobs During My Hours"
      hint={
        hasAvailability ? (
          <p className="text-ds-11 text-muted-foreground leading-snug">
            Only jobs inside your saved hours
          </p>
        ) : (
          // Same grey line as the siblings, with the remedy inside the
          // sentence — not replacing it.
          <p className="text-ds-11 text-muted-foreground leading-snug">
            Add your weekly hours first —{" "}
            <button
              type="button"
              onClick={() => navigate("/availability")}
              className="inline-flex items-center gap-0.5 font-semibold text-primary underline underline-offset-2 hover:text-primary/80 transition-colors btn-press"
            >
              set hours
              <ArrowUpRight className="w-2.5 h-2.5" aria-hidden />
            </button>
          </p>
        )
      }
      checked={matchAvailability}
      onChange={setMatchAvailability}
      disabled={!hasAvailability}
      ariaLabel="Match my availability"
    />
  );
}

/**
 * Builds the standard stacked job-filter sections for the FilterSheet, reusing
 * the exact content blocks from JobFilters.
 *
 * ONE builder serves both the signed-in browse toolbar and the signed-out
 * /jobs board, so the two filter sets can't silently drift apart. A guest
 * passes showNearby / showAvailability = false — those are the only two
 * sections that need account data (see the prop docs above); every other
 * filter runs off fields the public feed already returns.
 *
 * Section order:
 *
 *   1. Sort by    — first, by explicit request. It's the control most likely to
 *                   be touched on a board this size (nobody narrows a 12-job
 *                   feed; they reorder it), and unlike every section below it
 *                   ALWAYS changes what you see, so it earns the top slot.
 *   2. Category   — the everyday filter, and the one a helper opens the sheet for
 *   3. Pricing    — guest-only (open-to-bids vs set-budget)
 *   4. Distance   — authed-only radius chips
 *   5. When       — expiry window
 *   6. Show only  — the narrowing switches, grouped: Boosted + Urgent +
 *                   my-hours. Each used to be marooned (Boosted under a heading
 *                   of its own for a single pill; my-hours tacked onto the end
 *                   of When)
 *
 * Every section renders the SAME chip at the SAME size in a wrapping row — see
 * `chipBase`/`chipRow` in JobFilters.tsx. Do not reintroduce a `grid` or a
 * `w-full` chip for one section; that divergence is what made this sheet read
 * as three different controls stacked together.
 *
 * NO BUDGET SECTION — removed deliberately, on the user's call, after two
 * attempts (a dual-thumb $0–$500+ slider, then preset bands) both read as
 * fussy for what they bought. Amount is already legible on every card and
 * orderable from Sort by (Highest / Lowest pay), which is how people actually
 * shop a board this size. The feed hooks still accept min/max budget — a saved
 * search can carry one — so restoring the section is additive, not a rebuild.
 */
export function buildJobFilterSections(args: JobFilterSectionsArgs): FilterSheetSection[] {
  const {
    selectedCategory, setSelectedCategory,
    locationFilter = "", setLocationFilter,
    sortBy, setSortBy,
    expiresWithin, setExpiresWithin,
    matchAvailability = false, setMatchAvailability, hasAvailability = false,
    boostedOnly, setBoostedOnly,
    urgentOnly, setUrgentOnly,
    userLocStatus, userLocMessage,
    savedOnly = false, onToggleSavedOnly, savedCount = 0,
    showAvailability = true,
    showNearby = true,
    savedSearchesButton,
  } = args;

  const sections: FilterSheetSection[] = [
    {
      key: "sort",
      title: "Sort by",
      content: <SortContent sortBy={sortBy} setSortBy={setSortBy} />,
    },
    {
      key: "category",
      title: "Category",
      content: (
        <CategoryContent
          selectedCategory={selectedCategory}
          setSelectedCategory={setSelectedCategory}
        />
      ),
    },
  ];

  if (showNearby && setLocationFilter) {
    sections.push({
      key: "nearby",
      title: "Distance",
      content: (
        <NearbyContent
          locationFilter={locationFilter}
          setLocationFilter={setLocationFilter}
          status={userLocStatus}
          message={userLocMessage}
        />
      ),
    });
  }

  sections.push(
    {
      key: "when",
      title: "When",
      content: <ExpiresContent expiresWithin={expiresWithin} setExpiresWithin={setExpiresWithin} />,
    },
    {
      key: "show-only",
      title: "Show only",
      content: (
        <div className="space-y-2.5">
          {onToggleSavedOnly && (
            <ToggleRow
              icon={Bookmark}
              label="Only Saved Jobs"
              hint={
                <p className="text-ds-11 text-muted-foreground leading-snug">
                  {savedCount > 0 ? `${savedCount} saved` : "You haven't saved any yet"}
                </p>
              }
              checked={savedOnly}
              onChange={() => onToggleSavedOnly()}
              ariaLabel="Show saved jobs only"
            />
          )}
          <ToggleRow
            icon={Rocket}
            iconClassName="text-[hsl(var(--burnt-sienna))]"
            label="Boosted Jobs"
            hint={
              <p className="text-ds-11 text-muted-foreground leading-snug">
                Promoted by the poster
              </p>
            }
            checked={boostedOnly}
            onChange={setBoostedOnly}
            ariaLabel="Show boosted jobs only"
          />
          {/* Urgent is NOT a synonym for Boosted — different columns, and more
              importantly different meaning to the person reading this sheet.
              Boosted is the poster paying for placement, which buys the helper
              nothing. Urgent is the poster paying `urgent_fee` on top of the
              budget, which the helper actually takes home (JobCard surfaces it
              as a bonus). So it's the one filter here that finds better-paying
              work, and it earned its own row rather than being folded in. */}
          <ToggleRow
            icon={Zap}
            iconClassName="text-[hsl(var(--burnt-sienna))]"
            label="Urgent Jobs"
            hint={
              <p className="text-ds-11 text-muted-foreground leading-snug">
                Pays a bonus on top of the budget
              </p>
            }
            checked={urgentOnly}
            onChange={setUrgentOnly}
            ariaLabel="Show urgent jobs only"
          />
          {showAvailability && setMatchAvailability && (
            <AvailabilityRow
              matchAvailability={matchAvailability}
              setMatchAvailability={setMatchAvailability}
              hasAvailability={hasAvailability}
            />
          )}
          {savedSearchesButton}
        </div>
      ),
    },
  );

  return sections;
}
