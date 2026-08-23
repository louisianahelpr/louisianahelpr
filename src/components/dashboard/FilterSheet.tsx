import { type ReactNode, type RefObject } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowUpRight, Clock, Rocket, X, Zap, type LucideIcon } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHero,
} from "@/components/ui/sheet";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { useIsWebDesktop } from "@/hooks/useIsWebDesktop";
import { Switch } from "@/components/ui/switch";
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
 * A bottom sheet (built on the shared Radix Dialog `Sheet` primitive, so
 * it gets the project's standard motion, drag-to-dismiss, focus trap, and
 * esc / backdrop dismiss for free) that stacks filter controls as titled
 * vertical sections. Every surface that needs filters (Browse / Dashboard,
 * Activity, Guest) opens this same sheet so the UX is identical everywhere.
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
   * The button that opens this panel. Supply it and the WEB DESKTOP renders a
   * popover anchored to that button instead of the bottom sheet; omit it and
   * every surface keeps the sheet exactly as before.
   *
   * Why a ref rather than a <PopoverTrigger>: on the Browse feed the button
   * (BrowseTasksActions, mounted in Dashboard's title card) and this panel
   * (BrowseTasksToolbar) live in different components, so they cannot be
   * wrapped in one Popover subtree. `virtualRef` is Radix Popper's supported
   * way to anchor against an element the popover does not own.
   *
   * The native app and phone-width web are untouched — `useIsWebDesktop` is
   * false for both by construction (it is `!isNativePlatform && >=1024px`), so
   * a phone and the iOS shell still get the drag-to-dismiss sheet, which is
   * the right idiom there.
   */
  anchorRef?: RefObject<HTMLElement | null>;
}

/** Uppercase eyebrow + content, the standard section shell. */
function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <p className="text-ds-10 font-semibold text-muted-foreground uppercase tracking-widest mb-1.5">
        {title}
      </p>
      {children}
    </div>
  );
}

/** The panel's contents — the titled sections and the Clear-all footer.
 *  Shared verbatim by the sheet and the desktop popover so the two
 *  presentations cannot drift into two different filter sets. */
function FilterBody({
  sections,
  activeFilterCount,
  onClearAll,
}: Pick<FilterSheetProps, "sections" | "activeFilterCount" | "onClearAll">) {
  return (
    <>
      <div className="px-5 pb-4 space-y-4">
        {sections.map((s) => (
          <Section key={s.key} title={s.title}>
            {s.content}
          </Section>
        ))}
      </div>

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
}: FilterSheetProps) {
  const isWebDesktop = useIsWebDesktop();

  // Desktop web: a popover hanging off the Filters button, not a modal in the
  // middle of the window. The bottom sheet is a phone idiom — at 1440 it
  // resolved to a 448x596 dialog sitting under a full-window scrim, ON TOP of
  // the very job cards it filters, with a vestigial drag handle for a gesture a
  // mouse cannot make. A popover is non-modal by default, so the board stays
  // lit and the results visibly change behind you as you pick.
  if (isWebDesktop && anchorRef) {
    return (
      <Popover open={open} onOpenChange={onOpenChange}>
        <PopoverAnchor virtualRef={anchorRef} />
        <PopoverContent
          align="end"
          sideOffset={8}
          // The trigger sits at the far right of the window; without this the
          // panel would hang off the edge.
          collisionPadding={16}
          aria-label="Refine your search"
          className="w-[400px] max-w-[calc(100vw-2rem)] max-h-[70vh] overflow-y-auto overscroll-contain p-0 pt-4 rounded-ds-lg"
          // The Filters button is OUTSIDE the popover, so Radix counts a click
          // on it as an outside-dismiss — which would close the panel and then
          // let the button's own handler toggle it straight back. Let the
          // button keep sole ownership of the toggle.
          onInteractOutside={(e) => {
            const target = e.target as Node | null;
            if (target && anchorRef.current?.contains(target)) e.preventDefault();
          }}
        >
          <FilterBody
            sections={sections}
            activeFilterCount={activeFilterCount}
            onClearAll={onClearAll}
          />
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
        className="max-h-[85dvh] overflow-y-auto overscroll-contain p-0 gap-0"
      >
        {/* Grab handle — the familiar "this sheet drags down" affordance. */}
        <div className="flex justify-center pt-2.5 pb-0.5" aria-hidden>
          <span className="h-1 w-9 rounded-full bg-[hsl(var(--olivewood)/0.25)]" />
        </div>
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
  /**
   * Hide the "Nearby radius" section. The guest browse feed comes from
   * `get_ranked_open_jobs`, whose rows carry no latitude/longitude (the server
   * masks each address down to "City, ST"), and a signed-out visitor has no
   * saved profile location or parish to fall back on — so every radius chip
   * would be a control that provably cannot change the results. Hidden rather
   * than shipped as a no-op.
   */
  showNearby?: boolean;
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
      <div className="flex items-center gap-2 min-w-0 flex-1">
        <Icon
          className={`w-3.5 h-3.5 shrink-0 ${iconClassName ?? "text-primary"}`}
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
        aria-label={ariaLabel}
        className="shrink-0"
      />
    </div>
  );
}

/** "Only my hours" — a ToggleRow with a "Set hours" shortcut for accounts
 *  that haven't saved a weekly schedule yet (the switch is inert without one). */
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
      label="Jobs during my hours"
      hint={
        !hasAvailability ? (
          <button
            type="button"
            onClick={() => navigate("/availability")}
            className="inline-flex items-center gap-0.5 text-ds-11 font-semibold text-primary hover:text-primary/80 transition-colors btn-press"
          >
            Set Hours
            <ArrowUpRight className="w-2.5 h-2.5" />
          </button>
        ) : undefined
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
    showAvailability = true,
    showNearby = true,
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
        <div className="space-y-3">
          <ToggleRow
            icon={Rocket}
            iconClassName="text-[hsl(var(--burnt-sienna))]"
            label="Boosted jobs"
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
            label="Urgent jobs"
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
        </div>
      ),
    },
  );

  return sections;
}
