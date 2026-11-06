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
import { categoryLabels } from "@/components/job-card/activityConstants";
import { JOB_CATEGORY_GROUPS, categoryFilterLabel, isJobCategoryGroupId } from "@/lib/jobCategoryGroups";
import { GROUP_EMOJI } from "@/lib/categoryEmoji";
import { hapticLight } from "@/lib/haptics";
import { X } from "lucide-react";
import { JOB_WHEN_OPTIONS } from "@/lib/jobWhenFilter";
import { FilterChip, FILTER_CHIP, FILTER_CHIP_ON, FILTER_CHIP_OFF } from "@/components/ui/FilterChip";

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
 *
 * The chip itself is the shared FilterChip (src/components/ui/FilterChip.tsx,
 * Q2709): its size, selected gloss and idle look live there.
 */
/** The one row layout, paired with the chip. Wrapping and content-sized:
 *  no empty grid cells at any option count, no hidden off-screen options, and
 *  every chip is exactly as wide as its own label. */
const chipRow = "flex flex-wrap gap-2";

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



// ---------------- Reusable filter content blocks ----------------
//
// These content blocks are consumed by the shared <FilterSheet>
// (src/components/dashboard/FilterSheet.tsx), which stacks them as
// vertical sections inside a bottom sheet. Every filter surface — the
// signed-in browse toolbar and the signed-out /jobs board — builds its
// sheet from these, so the controls can't drift apart between surfaces.

// The chip strings for the one non-Jobs caller still drawing its own chips (Homes' RentBrowse; not launched).
export const chipStyles = { chipBase: FILTER_CHIP, chipActive: FILTER_CHIP_ON, chipIdle: FILTER_CHIP_OFF, chipRow };

/*
 * Every row WRAPS. Sort and Category used to render through a horizontal
 * scroll strip (`ScrollChipRow`: hidden scrollbar, edge fades, a three-dot
 * pager, mouse drag-to-scroll). It was tried to keep those two rows one line
 * tall, and it is gone because of what it looked like: a "carousel" dot
 * indicator under SORT BY and CATEGORY, and the last chip sliced at the row
 * edge ("Ending soo…") at every width — a phone strip stretched across a
 * desktop panel, and a cut-off label on the phone (external QA, 2026-09). A
 * wrapping row has no clip and nothing to page; the panel already scrolls
 * vertically when the sections outgrow it.
 */

export const SortContent = ({
  sortBy, setSortBy, onSelect,
}: { sortBy: string; setSortBy: (v: string) => void; onSelect?: () => void }) => (
  <div role="group" aria-label="Sort results" className={chipRow}>
    {sortOptions.map((opt) => (
      <FilterChip
        key={opt.value}
        pressed={sortBy === opt.value}
        onClick={() => { hapticLight(); setSortBy(opt.value); onSelect?.(); }}
      >
        {opt.label}
      </FilterChip>
    ))}
  </div>
);

/**
 * Category = the 8 GROUPS Post a job opens on (owner 2026-10-21: "show ONLY
 * the 8 main groups, from the same shared list, in sentence case. No
 * subcategories in the filter"), so the group a poster picks is the group a
 * Helpr filters by. One list, JOB_CATEGORY_GROUPS, and the group emoji Post a
 * job draws (GROUP_EMOJI). The stored value is the group id; the list, the map
 * and the server count all widen it to the group's categories
 * (categoryFilterMatches / categoriesForFilter).
 *
 * A single category still applied from before the groups (an old `?cat=`
 * link, a saved search) shows as one lit chip with an x, the same pattern as
 * When's legacy "Closes within", so an active filter is never invisible.
 */
export const CategoryContent = ({
  selectedCategory, setSelectedCategory, onSelect,
}: { selectedCategory: string | null; setSelectedCategory: (v: string | null) => void; onSelect?: () => void }) => {
  const legacy = selectedCategory && !isJobCategoryGroupId(selectedCategory) ? selectedCategory : null;
  return (
    <div role="group" aria-label="Filter by category" className={chipRow}>
      {JOB_CATEGORY_GROUPS.map((g) => {
        const isActive = selectedCategory === g.id;
        return (
          <FilterChip
            pressed={isActive}
            key={g.id}
            data-category-group={g.id}
            onClick={() => { hapticLight(); setSelectedCategory(isActive ? null : g.id); onSelect?.(); }}
          >
            <span aria-hidden className="text-ds-14 leading-none">{GROUP_EMOJI[g.id]}</span>
            {g.label}
          </FilterChip>
        );
      })}
      {legacy && (
        <FilterChip
          pressed
          onClick={() => { hapticLight(); setSelectedCategory(null); onSelect?.(); }}
        >
          {categoryFilterLabel(legacy)}
          <X className="w-3.5 h-3.5" aria-hidden />
          <span className="sr-only">, remove</span>
        </FilterChip>
      )}
    </div>
  );
};

const radiusOptions = [5, 10, 25, 50];
// Five chips (Any + four radii) on one line at 375 (lead, board 24 r2): the tight FilterChip (px-3, not px-4).

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
        <FilterChip
          size="tight"
          pressed={current === null}
          onClick={() => { hapticLight(); setLocationFilter(""); onSelect?.(); }}
        >
          Any
        </FilterChip>
        {radiusOptions.map((mi) => {
          const active = current === mi;
          return (
            <FilterChip
              key={mi}
              size="tight"
              pressed={active}
              onClick={() => { hapticLight(); setLocationFilter(active ? "" : `nearby:${mi}`); onSelect?.(); }}
            >
              {mi} mi
            </FilterChip>
          );
        })}
      </div>
      {current !== null && status === "loading" && (
        <p className="text-ds-11 text-muted-foreground mt-2">Getting your location…</p>
      )}
      {current !== null && status === "error" && (
        <p className="text-ds-11 text-[hsl(var(--destructive-ink))] mt-2">{message || "Couldn't get your location"}</p>
      )}
      {current !== null && status === "ready" && (
        <p className="text-ds-11 text-muted-foreground mt-2">Showing jobs within {current} miles of you</p>
      )}
    </div>
  );
};

/** Board 24 "When": which day the job is on. The legacy listing-expiry window
 *  (`?exp=`, no longer offered) shows here as one lit chip while it is still
 *  applied from an old link, so an active filter is never invisible. */
export const WhenContent = ({
  jobWhen, setJobWhen, expiresWithin, setExpiresWithin,
}: { jobWhen: string; setJobWhen: (v: string) => void; expiresWithin: string; setExpiresWithin: (v: string) => void }) => (
  <div role="group" aria-label="Filter by job day" className={chipRow}>
    {JOB_WHEN_OPTIONS.map((opt) => (
      <FilterChip
        key={opt.value}
        pressed={jobWhen === opt.value}
        onClick={() => { hapticLight(); setJobWhen(jobWhen === opt.value ? "" : opt.value); }}
      >
        {opt.label}
      </FilterChip>
    ))}
    {expiresWithin && (
      <FilterChip
        pressed
        onClick={() => { hapticLight(); setExpiresWithin(""); }}
      >
        Closes within {expiresOptions.find((o) => o.value === expiresWithin)?.label ?? expiresWithin}
        <X className="w-3.5 h-3.5" aria-hidden />
        <span className="sr-only">, remove</span>
      </FilterChip>
    )}
  </div>
);
