/**
 * Job-filter control blocks — the shared building pieces every filter
 * surface renders, and nothing else.
 *
 * This module intentionally exports NO filter component of its own. It used
 * to also own an inline horizontal pill row (`JobFilters`, built on Radix
 * Popover dropdowns); <FilterSheet> replaced that presentation on every
 * surface, so the pill row and its popover machinery were removed and only
 * the reusable content blocks below survive.
 */
import { X } from "lucide-react";
import {
  categoryLabels, categoryColors,
} from "@/components/activity/activityConstants";
import { CategoryIcon } from "@/components/job/CategoryIcon";
import { budgetChipLabel } from "@/components/dashboard/browseTasksToolbar/constants";
import { hapticLight } from "@/lib/haptics";

export { categoryLabels };

/**
 * THE one chip recipe. Every option in the filter sheet — Sort, Category,
 * Pricing, Distance, When — renders through this, at this size, in a wrapping
 * row. Nothing may opt out with `w-full`, a `grid`, or its own height.
 *
 * The sheet previously ran three different control languages at once, which is
 * what made it read as incoherent: Sort/Pricing were content-sized wrapping
 * chips; Category was a sideways-scrolling `w-max` strip (so half its options
 * were off-screen with no affordance); When/Distance were `grid-cols-4/5` with
 * `w-full`, which stretched four short labels across the full sheet width and
 * made "Any time" a 240px slab sitting directly above a 60px "Cleaning" chip.
 * Same component, same purpose, three sizes.
 *
 * `whitespace-nowrap` because a two-part label ("Highest pay", "$150 – $300")
 * must break BETWEEN chips, not inside one — the height is fixed, so an
 * internal line break overflows the chip instead of growing it.
 */
const chipBase =
  "inline-flex items-center gap-1.5 px-3 rounded-ds-md text-ds-11 font-semibold tracking-tight whitespace-nowrap transition-all duration-200 btn-press squircle border h-9";

/** The one row layout, paired with `chipBase`. Wrapping and content-sized:
 *  no empty grid cells at any option count, no hidden off-screen options, and
 *  every chip is exactly as wide as its own label. */
const chipRow = "flex flex-wrap gap-1.5";
const chipActive =
  "bg-[hsl(var(--bark)/0.12)] text-[hsl(var(--bark))] border-[hsl(var(--bark)/0.38)]";
const chipIdle =
  "bg-white/70 dark:bg-card/60 backdrop-blur text-foreground border-border/60 hover:border-primary/50 hover:bg-white/90 dark:hover:bg-card/90";

const sortOptions = [
  // "Best match" (value "smart") is the default — a composite recency +
  // budget + urgency + proximity score. See src/lib/smartSort.ts. The
  // user-facing label avoids the opaque "Smart" jargon.
  { value: "smart", label: "Best match" },
  { value: "newest", label: "Newest" },
  { value: "highest_pay", label: "Highest pay" },
  { value: "lowest_pay", label: "Lowest pay" },
  { value: "ending_soon", label: "Ending soon" },
];

const expiresOptions = [
  { value: "", label: "Any time" },
  { value: "24h", label: "24 hours" },
  { value: "3d", label: "3 days" },
  { value: "7d", label: "7 days" },
];

/**
 * Budget presets, expressed in the SAME "" = unset dollar-string pair the
 * feeds already read (`useDashboardFilters` and `useOpenJobsFeed` both do
 * `budget < parseFloat(min)` / `budget > parseFloat(max)` and skip the test
 * entirely when the string is empty). Nothing downstream changes.
 *
 * Why bands and not the old dual-thumb $0–$500 slider:
 *   - two 10px thumbs at opposite ends of a track is the least thumb-friendly
 *     control in the sheet, and the only one that isn't a chip;
 *   - at rest the slider filled its whole track and read "$0 – $500+" — a
 *     control that LOOKS maxed-out and active while filtering nothing;
 *   - "$0 – $500+" plus a "Any budget" caption said the same thing twice;
 *   - the $500 ceiling was arbitrary on a board where jobs run past it, and
 *     `budgetToRange` silently clamped any stored max above $500 back down to
 *     the top of the track — so a restored saved search capped at $800 drew
 *     as "no cap" while still hiding every $801+ job.
 *
 * The top band is deliberately open-ended (`max: ""` → no cap), so no job is
 * ever hidden by a ceiling the user didn't choose.
 */
export const BUDGET_BANDS = [
  { key: "any", label: "Any", min: "", max: "" },
  { key: "to50", label: "Up to $50", min: "", max: "50" },
  { key: "50to150", label: "$50 – $150", min: "50", max: "150" },
  { key: "150to300", label: "$150 – $300", min: "150", max: "300" },
  { key: "300plus", label: "$300+", min: "300", max: "" },
] as const;

/**
 * Which band the stored pair represents, or `null` when it matches none.
 *
 * `null` is reachable in real use: `SavedSearches` persists an arbitrary
 * `max_budget` number and restores it straight into `maxBudget`, so a search
 * saved under the old slider can hold e.g. 275. Rather than render every chip
 * idle while a filter is quietly applied (exactly the "looks like it isn't
 * filtering" bug we're fixing), `BudgetContent` surfaces that value as its own
 * active, clearable chip.
 */
function matchBudgetBand(minBudget: string, maxBudget: string): string | null {
  return BUDGET_BANDS.find((b) => b.min === minBudget && b.max === maxBudget)?.key ?? null;
}

// ---------------- Reusable filter content blocks ----------------
//
// These content blocks are consumed by the shared <FilterSheet>
// (src/components/dashboard/FilterSheet.tsx), which stacks them as
// vertical sections inside a bottom sheet. Every filter surface — the
// signed-in browse toolbar and the signed-out /jobs board — builds its
// sheet from these, so the controls can't drift apart between surfaces.

export const SORT_OPTIONS = sortOptions;
export const chipStyles = { chipBase, chipActive, chipIdle, chipRow };

// Wrapping chip row, not a 2-column grid: five options in `grid-cols-2` left a
// lone half-width orphan on the last row. A content-sized wrap has no empty
// cells by construction at any option count, and matches the chip idiom every
// other row in the sheet already uses.
export const SortContent = ({
  sortBy, setSortBy, onSelect,
}: { sortBy: string; setSortBy: (v: string) => void; onSelect?: () => void }) => (
  <div role="group" aria-label="Sort results" className={chipRow}>
    {sortOptions.map((opt) => (
      <button
        key={opt.value}
        type="button"
        aria-pressed={sortBy === opt.value}
        onClick={() => { hapticLight(); setSortBy(opt.value); onSelect?.(); }}
        className={`${chipBase} ${sortBy === opt.value ? chipActive : chipIdle}`}
      >
        {opt.label}
      </button>
    ))}
  </div>
);

export const CategoryContent = ({
  selectedCategory, setSelectedCategory, onSelect,
}: { selectedCategory: string | null; setSelectedCategory: (v: string | null) => void; onSelect?: () => void }) => (
  // Wraps like every other row. It used to be a single-line horizontal scroll
  // (`overflow-x-auto` + `w-max`), which hid roughly half the 12 categories
  // off the right edge behind a scrollbar the sheet deliberately styles away
  // (`scrollbar-hide`) — findable only by guessing it could be dragged.
  <div role="group" aria-label="Filter by category" className={chipRow}>
      {Object.entries(categoryLabels).map(([key, label]) => {
        const isActive = selectedCategory === key;
        const titleColor = (categoryColors[key] || categoryColors.other).title;
        return (
          <button
            key={key}
            onClick={() => { hapticLight(); setSelectedCategory(isActive ? null : key); onSelect?.(); }}
            className={`${chipBase} ${isActive ? chipActive : chipIdle}`}
          >
            <CategoryIcon
              category={key}
              aria-hidden
              className={`w-3 h-3 ${isActive ? "" : titleColor}`}
              strokeWidth={2.25}
            />
            {label}
          </button>
        );
      })}
  </div>
);

const radiusOptions = [5, 10, 25, 50];

export const NearbyContent = ({
  locationFilter, setLocationFilter, status, message, onSelect,
}: {
  locationFilter: string;
  setLocationFilter: (v: string) => void;
  status?: "idle" | "loading" | "ready" | "error";
  message?: string;
  onSelect?: () => void;
}) => {
  const current = locationFilter.startsWith("nearby:") ? parseFloat(locationFilter.slice(7)) : null;
  return (
    <div>
      {/* No inner eyebrow — the FilterSheet section this renders into already
          carries the "Distance" heading, and stacking a second "Nearby radius"
          label under it was the sheet's only double-titled section. */}
      <div role="group" aria-label="Filter by distance" className={chipRow}>
        {/* Explicit "Any" so the unfiltered state is a lit chip rather than the
            absence of one — same treatment as Budget and When. */}
        <button
          type="button"
          aria-pressed={current === null}
          onClick={() => { hapticLight(); setLocationFilter(""); onSelect?.(); }}
          className={`${chipBase} ${current === null ? chipActive : chipIdle}`}
        >
          Any
        </button>
        {radiusOptions.map((mi) => {
          const active = current === mi;
          return (
            <button
              key={mi}
              type="button"
              aria-pressed={active}
              onClick={() => { hapticLight(); setLocationFilter(active ? "" : `nearby:${mi}`); onSelect?.(); }}
              className={`${chipBase} ${active ? chipActive : chipIdle}`}
            >
              {mi} mi
            </button>
          );
        })}
      </div>
      {current !== null && status === "loading" && (
        <p className="text-ds-11 text-muted-foreground mt-2">Getting your location…</p>
      )}
      {current !== null && status === "error" && (
        <p className="text-ds-11 text-destructive mt-2">{message || "Couldn't get your location"}</p>
      )}
      {current !== null && status === "ready" && (
        <p className="text-ds-11 text-muted-foreground mt-2">Showing jobs within {current} miles of you</p>
      )}
    </div>
  );
};

export const ExpiresContent = ({
  expiresWithin, setExpiresWithin, onSelect,
}: { expiresWithin: string; setExpiresWithin: (v: string) => void; onSelect?: () => void }) => (
  <div role="group" aria-label="Filter by expiry window" className={chipRow}>
    {expiresOptions.map((opt) => (
      <button
        key={opt.value}
        type="button"
        aria-pressed={expiresWithin === opt.value}
        onClick={() => { hapticLight(); setExpiresWithin(expiresWithin === opt.value ? "" : opt.value); onSelect?.(); }}
        className={`${chipBase} ${expiresWithin === opt.value ? chipActive : chipIdle}`}
      >
        {opt.label}
      </button>
    ))}
  </div>
);

export const BudgetContent = ({
  minBudget, maxBudget, setMinBudget, setMaxBudget, onSelect,
}: {
  minBudget: string;
  maxBudget: string;
  setMinBudget: (v: string) => void;
  setMaxBudget: (v: string) => void;
  onSelect?: () => void;
}) => {
  const activeBand = matchBudgetBand(minBudget, maxBudget);
  // A stored pair that matches no preset (a saved search from the slider era)
  // still filters the feed, so it gets its own lit, tap-to-clear chip instead
  // of leaving the row looking untouched.
  const hasCustomRange = activeBand === null && !!(minBudget || maxBudget);
  return (
    <div role="group" aria-label="Filter by budget" className="flex flex-wrap gap-1.5">
      {BUDGET_BANDS.map((band) => {
        const isActive = activeBand === band.key;
        return (
          <button
            key={band.key}
            type="button"
            aria-pressed={isActive}
            onClick={() => {
              hapticLight();
              setMinBudget(band.min);
              setMaxBudget(band.max);
              onSelect?.();
            }}
            className={`${chipBase} ${isActive ? chipActive : chipIdle}`}
          >
            {band.label}
          </button>
        );
      })}
      {hasCustomRange && (
        <button
          type="button"
          aria-pressed
          aria-label={`Clear custom budget filter (${budgetChipLabel(minBudget, maxBudget)})`}
          onClick={() => { hapticLight(); setMinBudget(""); setMaxBudget(""); onSelect?.(); }}
          className={`${chipBase} ${chipActive}`}
        >
          {budgetChipLabel(minBudget, maxBudget)}
          <X className="w-2.5 h-2.5" strokeWidth={2.5} aria-hidden />
        </button>
      )}
    </div>
  );
};
