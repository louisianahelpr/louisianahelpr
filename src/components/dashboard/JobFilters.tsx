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
import {
  categoryLabels, categoryColors,
} from "@/components/activity/activityConstants";
import { CategoryIcon } from "@/components/job/CategoryIcon";
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
 *
 * `h-11` (44px) — a REAL 44px touch target, the HIG minimum, drawn at full
 * size rather than faked.
 *
 * These chips used to be `h-7` (28px) with `!min-h-0` explicitly overriding
 * index.css's global `button { min-height: 44px }` floor, so 28px of drawn
 * box was also 28px of tap target — 36% under the minimum, on the control
 * this whole panel exists to operate. The height was trimmed for density (a
 * 12-option Category row wrapping to fewer lines); the answer to that is the
 * panel's own vertical scroll — not shrinking everyone's tap target.
 *
 * Bleeding the hit area past a smaller drawn box with an `::after` was tried
 * and rejected here: measured in Chrome, the bleed lost the hit test to the
 * scroll container's own clip edge and to the following section, so chips
 * came out at 36–40px anyway. A real 44px box is the version that survives
 * measurement.
 *
 * NO `!min-h-0`: `h-11` and the global floor now agree at 44px, so the
 * override that used to be needed to escape that floor is gone. (Keep them
 * agreeing — drop below 44 and index.css silently wins again, the trap
 * documented on the toast close button and the search-bar close button.)
 */
const chipBase =
  "inline-flex items-center gap-1.5 px-3 rounded-ds-md text-ds-12 font-semibold tracking-tight whitespace-nowrap transition-all duration-200 btn-press squircle border h-11";

/** The one row layout, paired with `chipBase`. Wrapping and content-sized:
 *  no empty grid cells at any option count, no hidden off-screen options, and
 *  every chip is exactly as wide as its own label. */
const chipRow = "flex flex-wrap gap-2";
// Selected = the app's GLOSSY primary surface (`btn-grad-primary`), never a
// flat fill. Standing project rule: every green/bark primary button and every
// selected/active control wears the gloss — flat bark reads cheap and has been
// corrected every time it has appeared. This chip was the last flat one: an
// 18% bark TINT, which is what "Best match / List / Any / Any time" rendering
// as flat grey-green was.
//
// (The 2026-08-24 note that the owner "rejected olive-filled chips" was about
// a flat solid olive block. The gloss is the treatment that was asked for in
// its place, and it is what every other selected control in the app uses.)
//
// `[&_*]` pins the CategoryIcon inside an active chip to parchment too —
// otherwise it keeps its per-category tint and disappears into the gradient.
const chipActive =
  "btn-grad-primary !text-[hsl(var(--parchment))] [&_*]:!text-[hsl(var(--parchment))] " +
  "border-[hsl(var(--bark-deep)/0.55)] " +
  "shadow-[inset_0_1px_0_hsl(var(--parchment)/0.22),0_2px_8px_-3px_hsl(var(--bark)/0.55)]";
const chipIdle =
  "bg-white/70 dark:bg-card/60 backdrop-blur text-foreground border-[hsl(var(--bark)/0.22)] hover:border-[hsl(var(--bark)/0.45)] hover:bg-white/90 dark:hover:bg-card/90";

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

export const chipStyles = { chipBase, chipActive, chipIdle, chipRow };

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
            className={`w-3.5 h-3.5 ${isActive ? "" : titleColor}`}
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
        <p className="text-ds-11 text-[hsl(var(--destructive-ink))] mt-2">{message || "Couldn't get your location"}</p>
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

