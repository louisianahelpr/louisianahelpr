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
import { useRef, useState, useEffect, useCallback } from "react";
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
 * `h-7`/`px-2.5` (not `h-9`/`px-3`) — trimmed 2026-08-30 so a 12-option row
 * (Category) wraps to fewer lines without hiding anything off-screen; every
 * section shrank with it rather than introducing a second, smaller chip
 * size for one row.
 *
 * `!min-h-0` is load-bearing, not decoration: index.css sets a bare
 * `button { min-height: 44px }` for the HIG touch minimum, which otherwise
 * silently wins over `h-7`/`h-8` (they set height, not the min-height floor
 * that's actually constraining it) — the same trap already documented on
 * the toast close button and the search-bar close button. Without this the
 * chip's real rendered height stayed 44px no matter what `h-*` said.
 */
const chipBase =
  "inline-flex items-center gap-1.5 px-2.5 rounded-ds-md text-ds-11 font-semibold tracking-tight whitespace-nowrap transition-all duration-200 btn-press squircle border !min-h-0 h-7";

/** The one row layout, paired with `chipBase`. Wrapping and content-sized:
 *  no empty grid cells at any option count, no hidden off-screen options, and
 *  every chip is exactly as wide as its own label. */
const chipRow = "flex flex-wrap gap-1.5";
// Selected = a decisive olive TINT — owner rejected the solid olive fill
// (2026-08-24: "olive-filled chips" was the one thing disliked in the brand
// pass) and the original 12% tint read gray-on-gray. 18% with a 55% border
// is the middle: unmistakably chosen, still light on the parchment sheet.
const chipActive =
  "bg-[hsl(var(--bark)/0.18)] text-[hsl(var(--bark))] border-[hsl(var(--bark)/0.55)]";
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

// Scroll position → a 3-segment dot indicator (not one dot per chip — 12
// categories would be 12 dots, its own kind of clutter). Coarse "left /
// middle / right" is enough to say "there's more" without pretending to be
// a precise pager.
function useScrollDots(count = 3) {
  const ref = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  const [scrollable, setScrollable] = useState(false);

  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    setScrollable(max > 4);
    if (max <= 0) { setActive(0); return; }
    const ratio = el.scrollLeft / max;
    setActive(Math.min(count - 1, Math.round(ratio * (count - 1))));
  }, [count]);

  useEffect(() => {
    measure();
    const el = ref.current;
    if (!el) return;
    el.addEventListener("scroll", measure, { passive: true });
    window.addEventListener("resize", measure);
    return () => {
      el.removeEventListener("scroll", measure);
      window.removeEventListener("resize", measure);
    };
  }, [measure]);

  // Mouse drag-to-scroll — touch devices already pan the row natively, but a
  // desktop mouse has no way to move an `overflow-x-auto` strip with
  // `scrollbar-hide` (no visible scrollbar to grab, and no wheel binding to
  // the horizontal axis on a vertical mouse wheel). Without this the row was
  // "styled scrollable" — the fade + dots implying there's more — but
  // desktop pointer users had no actual way to reach it.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let isDown = false;
    let startX = 0;
    let startScrollLeft = 0;
    let moved = false;

    const onPointerDown = (e: PointerEvent) => {
      if (e.pointerType === "touch") return; // native touch scroll handles this
      isDown = true;
      moved = false;
      startX = e.clientX;
      startScrollLeft = el.scrollLeft;
      el.setPointerCapture(e.pointerId);
    };
    const onPointerMove = (e: PointerEvent) => {
      if (!isDown) return;
      const dx = e.clientX - startX;
      if (Math.abs(dx) > 3) moved = true;
      el.scrollLeft = startScrollLeft - dx;
    };
    const endDrag = (e: PointerEvent) => {
      if (!isDown) return;
      isDown = false;
      try { el.releasePointerCapture(e.pointerId); } catch { /* already released */ }
      // Swallow the trailing click on a real drag so a chip under the
      // cursor doesn't get toggled by the mouseup that ends the drag.
      if (moved) {
        const swallowClick = (ce: MouseEvent) => { ce.stopPropagation(); ce.preventDefault(); };
        el.addEventListener("click", swallowClick, { capture: true, once: true });
        setTimeout(() => el.removeEventListener("click", swallowClick, { capture: true }), 0);
      }
    };

    el.addEventListener("pointerdown", onPointerDown);
    el.addEventListener("pointermove", onPointerMove);
    el.addEventListener("pointerup", endDrag);
    el.addEventListener("pointercancel", endDrag);
    return () => {
      el.removeEventListener("pointerdown", onPointerDown);
      el.removeEventListener("pointermove", onPointerMove);
      el.removeEventListener("pointerup", endDrag);
      el.removeEventListener("pointercancel", endDrag);
    };
  }, []);

  return { ref, active, scrollable, remeasure: measure };
}

/**
 * Horizontal-scroll chip strip + right-edge fade + 3-dot position indicator
 * — the ONE scrolling-row treatment, shared by Sort and Category so a
 * second row long enough to need it doesn't invent its own variant. Wraps
 * `useScrollDots` (which owns the ref + scroll math) with the fade/dot
 * chrome around whatever chip buttons the caller renders as `children`.
 *
 * This was tried as a plain scroll strip once before (Category, pre-2026-08-30)
 * and reverted for hiding options with NO affordance that more existed — the
 * fade + dots here are the fix for that specific complaint, not a redo of
 * the old strip.
 */
function ScrollChipRow({
  ariaLabel, remeasureKey, children,
}: { ariaLabel: string; remeasureKey: unknown; children: React.ReactNode }) {
  const { ref, active, scrollable, remeasure } = useScrollDots();
  useEffect(() => { remeasure(); }, [remeasureKey, remeasure]);

  return (
    <div>
      <div className="relative">
        <div
          ref={ref}
          role="group"
          aria-label={ariaLabel}
          className="flex gap-1.5 overflow-x-auto scrollbar-hide pr-6 snap-x snap-proximity cursor-grab active:cursor-grabbing select-none"
          style={{ touchAction: "pan-x" }}
        >
          {children}
        </div>
        {/* Right-edge fade — the affordance the old strip didn't have.
            `pr-6` on the row above keeps the last chip from sitting fully
            under it at rest. */}
        {scrollable && (
          <div
            aria-hidden
            className="pointer-events-none absolute right-0 top-0 bottom-0 w-8"
            style={{
              background: "linear-gradient(to right, transparent, hsl(var(--premium-page)) 85%)",
            }}
          />
        )}
      </div>
      {scrollable && (
        <div className="flex items-center justify-center gap-1 pt-1.5" aria-hidden>
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className="h-1 rounded-full transition-all duration-150"
              style={{
                width: active === i ? 12 : 4,
                background: active === i ? "hsl(var(--bark))" : "hsl(var(--bark) / 0.25)",
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export const SortContent = ({
  sortBy, setSortBy, onSelect,
}: { sortBy: string; setSortBy: (v: string) => void; onSelect?: () => void }) => (
  <ScrollChipRow ariaLabel="Sort results" remeasureKey={sortBy}>
    {sortOptions.map((opt) => (
      <button
        key={opt.value}
        type="button"
        aria-pressed={sortBy === opt.value}
        onClick={() => { hapticLight(); setSortBy(opt.value); onSelect?.(); }}
        className={`shrink-0 snap-start ${chipBase} ${sortBy === opt.value ? chipActive : chipIdle}`}
      >
        {opt.label}
      </button>
    ))}
  </ScrollChipRow>
);

export const CategoryContent = ({
  selectedCategory, setSelectedCategory, onSelect,
}: { selectedCategory: string | null; setSelectedCategory: (v: string | null) => void; onSelect?: () => void }) => (
  <ScrollChipRow ariaLabel="Filter by category" remeasureKey={selectedCategory}>
    {Object.entries(categoryLabels).map(([key, label]) => {
      const isActive = selectedCategory === key;
      const titleColor = (categoryColors[key] || categoryColors.other).title;
      return (
        <button
          key={key}
          onClick={() => { hapticLight(); setSelectedCategory(isActive ? null : key); onSelect?.(); }}
          className={`shrink-0 snap-start ${chipBase} ${isActive ? chipActive : chipIdle}`}
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
  </ScrollChipRow>
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

