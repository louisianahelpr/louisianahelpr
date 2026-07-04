import { type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowUpRight, Clock, Rocket, X } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHero,
} from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { hapticLight } from "@/lib/haptics";
import {
  SortContent,
  CategoryContent,
  NearbyContent,
  ExpiresContent,
  BudgetContent,
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
 * the sheet renders only those. The dashboard passes Sort / Category /
 * Nearby / Budget / When / Boosted; Activity passes a single Status section.
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
}

/** Uppercase eyebrow + content, the standard section shell. */
function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <p className="text-ds-10 font-semibold text-muted-foreground uppercase tracking-widest mb-2">
        {title}
      </p>
      {children}
    </div>
  );
}

export function FilterSheet({
  open,
  onOpenChange,
  sections,
  activeFilterCount,
  onClearAll,
}: FilterSheetProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        // Rounded top corners + a max height so a tall section list scrolls
        // inside the sheet rather than pushing the dock off-screen.
        className="rounded-t-2xl max-h-[85dvh] overflow-y-auto overscroll-contain p-0 gap-0"
      >
        {/* Grab handle — the familiar "this sheet drags down" affordance. */}
        <div className="flex justify-center pt-3 pb-1" aria-hidden>
          <span className="h-1 w-9 rounded-full bg-[hsl(var(--olivewood)/0.25)]" />
        </div>
        <SheetHero
          className="px-5 pt-2 pb-3"
          eyebrow="Filters"
          title="Refine your search"
          subtitle={
            activeFilterCount > 0
              ? `${activeFilterCount} filter${activeFilterCount === 1 ? "" : "s"} active`
              : "Narrow your results"
          }
        />

        <div className="px-5 pb-4 space-y-5">
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
              <X className="w-4 h-4" strokeWidth={2.25} /> Clear all
            </button>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

// ---------------- Job-filter section builder ----------------

interface JobFilterSectionsArgs {
  selectedCategory: string | null;
  setSelectedCategory: (v: string | null) => void;
  minBudget: string;
  setMinBudget: (v: string) => void;
  maxBudget: string;
  setMaxBudget: (v: string) => void;
  locationFilter: string;
  setLocationFilter: (v: string) => void;
  sortBy: string;
  setSortBy: (v: string) => void;
  expiresWithin: string;
  setExpiresWithin: (v: string) => void;
  matchAvailability: boolean;
  setMatchAvailability: (v: boolean) => void;
  hasAvailability: boolean;
  boostedOnly: boolean;
  setBoostedOnly: (v: boolean) => void;
  userLocStatus?: "idle" | "loading" | "ready" | "error";
  userLocMessage?: string;
  /** Hide the "Only my hours" availability row (guests have no schedule). */
  showAvailability?: boolean;
}

/** Inline "Only my hours" availability row, lifted from JobFilters so the
 *  sheet renders the identical control. */
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
    <div className="flex items-center justify-between gap-3 w-full">
      <div className="flex items-center gap-2 min-w-0 flex-1">
        <Clock className="w-3.5 h-3.5 shrink-0 text-primary" strokeWidth={2.25} />
        <div className="min-w-0">
          <p className="text-ds-12 font-semibold text-foreground leading-snug">Only my hours</p>
          {!hasAvailability && (
            <button
              type="button"
              onClick={() => navigate("/availability")}
              className="inline-flex items-center gap-0.5 text-ds-11 font-semibold text-primary hover:text-primary/80 transition-colors btn-press"
            >
              Set hours
              <ArrowUpRight className="w-2.5 h-2.5" />
            </button>
          )}
        </div>
      </div>
      <Switch
        checked={matchAvailability}
        onCheckedChange={setMatchAvailability}
        disabled={!hasAvailability}
        aria-label="Match my availability"
        className="shrink-0"
      />
    </div>
  );
}

/**
 * Builds the standard stacked job-filter sections (Sort, Category, Nearby,
 * Budget, When, Boosted) for the FilterSheet. Reuses the exact content
 * blocks from JobFilters so the controls match the legacy inline panel.
 */
export function buildJobFilterSections(args: JobFilterSectionsArgs): FilterSheetSection[] {
  const {
    selectedCategory, setSelectedCategory,
    minBudget, setMinBudget,
    maxBudget, setMaxBudget,
    locationFilter, setLocationFilter,
    sortBy, setSortBy,
    expiresWithin, setExpiresWithin,
    matchAvailability, setMatchAvailability, hasAvailability,
    boostedOnly, setBoostedOnly,
    userLocStatus, userLocMessage,
    showAvailability = true,
  } = args;

  return [
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
    {
      key: "nearby",
      title: "Location",
      content: (
        <NearbyContent
          locationFilter={locationFilter}
          setLocationFilter={setLocationFilter}
          status={userLocStatus}
          message={userLocMessage}
        />
      ),
    },
    {
      key: "budget",
      title: "Budget range",
      content: (
        <BudgetContent
          minBudget={minBudget}
          maxBudget={maxBudget}
          setMinBudget={setMinBudget}
          setMaxBudget={setMaxBudget}
        />
      ),
    },
    {
      key: "when",
      title: "When",
      content: (
        <div className="space-y-3">
          <ExpiresContent expiresWithin={expiresWithin} setExpiresWithin={setExpiresWithin} />
          {showAvailability && (
            <AvailabilityRow
              matchAvailability={matchAvailability}
              setMatchAvailability={setMatchAvailability}
              hasAvailability={hasAvailability}
            />
          )}
        </div>
      ),
    },
    {
      key: "boosted",
      title: "Boosted",
      content: (
        <button
          type="button"
          onClick={() => { hapticLight(); setBoostedOnly(!boostedOnly); }}
          aria-pressed={boostedOnly}
          className="inline-flex items-center justify-center gap-1.5 h-9 px-4 rounded-ds-md text-ds-12 font-semibold tracking-tight btn-press squircle border"
          style={
            boostedOnly
              ? {
                  background: "linear-gradient(90deg, hsl(var(--gold-warm) / 0.92), hsl(var(--burnt-sienna)))",
                  borderColor: "hsl(var(--gold-warm) / 0.6)",
                  color: "white",
                  boxShadow: "0 4px 14px -4px hsl(var(--gold-warm) / 0.45)",
                }
              : { borderColor: "hsl(var(--border) / 0.6)" }
          }
        >
          <Rocket className="w-3 h-3 shrink-0" strokeWidth={2.25} />
          Boosted only
        </button>
      ),
    },
  ];
}
