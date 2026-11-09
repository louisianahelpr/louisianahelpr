/**
 * Jobs Browse's category chips (design audit A J1, owner approved 11-08: "same pattern Jobs/Shops/Homes/Dashboard",
 * row 2 under the search bar). The same row as Declutter's (DeclutterCategoryChips): "All" first, then the category
 * GROUPS (the 8 a poster picks from on Post a job, JOB_CATEGORY_GROUPS) that have a job in the feed in hand, busiest
 * first, so a chip never opens an empty list; the chosen one stays even when it has nothing. A chip sets the same value
 * the filter sheet's Category sets (one value, so the sheet, the saved search, ?cat= and the server count agree);
 * tapping the chosen chip again shows everything.
 *
 * Built from the jobs the feed already holds: no read of its own. Chips are the shared FilterChip; icons are lucide at
 * the app's one weight (owner 11-04), not the filter sheet's emoji.
 * Guard: src/test/jobsCategoryChipsRow.test.tsx.
 *
 * F107 (owner UI audit 11-09; owner pick 11-09: filters inside the existing tabs): a "Saved" chip after "All", the
 * feed's own "Only saved jobs" filter (Dashboard's savedOnly, the same one the filter sheet and the desktop cluster
 * toggle), so a job you saved has a home on Browse. Shown once you have saved a job, or while it is on.
 * Guard: src/test/jobsWorkingChipsAndSaved.test.tsx.
 */
import { useEffect, useMemo } from "react";
import { noteJobChipsRow } from "@/lib/jobChipsSeen";
import { Bookmark, Car, Hammer, Home, Leaf, PartyPopper, PawPrint, Sparkles, Truck, type LucideIcon } from "lucide-react";
import { FilterChip } from "@/components/ui/FilterChip";
import { JOB_CATEGORY_GROUPS, groupTileLabel, isJobCategoryGroupId, jobCategoryGroupOf, type JobCategoryGroupId } from "@/lib/jobCategoryGroups";

const GROUP_ICON: Record<JobCategoryGroupId, LucideIcon> = {
  home: Home,
  yard: Leaf,
  moving_errands: Truck,
  auto: Car,
  pets: PawPrint,
  events: PartyPopper,
  trades: Hammer,
  other: Sparkles,
};

export function JobCategoryChips({ jobs, value, onChange, saved }: {
  jobs: readonly { category?: string | null }[];
  /** F107: the "Only saved jobs" filter as a chip; `count` = jobs saved (no chip at 0 unless it is on). */
  saved?: { on: boolean; count: number; onToggle: () => void };
  /** The filter's value: a group id, a legacy single category (then no chip is lit but "All" is not either), or null. */
  value: string | null;
  onChange: (value: string | null) => void;
}) {
  const groups = useMemo(() => {
    const n = new Map<JobCategoryGroupId, number>();
    for (const j of jobs) {
      const g = j.category ? jobCategoryGroupOf(j.category) : null;
      if (g) n.set(g, (n.get(g) ?? 0) + 1);
    }
    const order = new Map(JOB_CATEGORY_GROUPS.map((g, i) => [g.id, i]));
    const ids = [...n.keys()];
    if (isJobCategoryGroupId(value) && !n.has(value)) ids.push(value);
    return ids
      .sort((a, b) => (n.get(b) ?? 0) - (n.get(a) ?? 0) || (order.get(a) ?? 99) - (order.get(b) ?? 99))
      .map((id) => JOB_CATEGORY_GROUPS.find((g) => g.id === id))
      .filter((g): g is (typeof JOB_CATEGORY_GROUPS)[number] => !!g);
  }, [jobs, value]);
  // One group only and nothing chosen: a row of "All" + the one thing on screen says nothing.
  const shown = !(groups.length < 2 && !value);
  const savedChip = !!saved && (saved.on || saved.count > 0);
  const rowShown = shown || savedChip;
  // Tell the next loading skeleton whether to draw the chips bone (jobChipsSeen.ts).
  useEffect(() => { noteJobChipsRow(rowShown); }, [rowShown]);
  if (!rowShown) return null;
  return (
    <div role="group" aria-label="Categories" data-chip-row="job-categories" className="flex min-w-0 gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <FilterChip pressed={value === null && !saved?.on} onClick={() => { onChange(null); if (saved?.on) saved.onToggle(); }} className="shrink-0" data-category-chip="all">All</FilterChip>
      {savedChip && (
        <FilterChip pressed={saved!.on} onClick={saved!.onToggle} className="shrink-0" data-category-chip="saved">
          <Bookmark className="h-4 w-4 shrink-0" aria-hidden />
          Saved
        </FilterChip>
      )}
      {groups.map((g) => {
        const Icon = GROUP_ICON[g.id];
        return (
          <FilterChip key={g.id} pressed={value === g.id} onClick={() => onChange(value === g.id ? null : g.id)} className="shrink-0" data-category-chip={g.id}>
            <Icon className="h-4 w-4 shrink-0" aria-hidden />
            {groupTileLabel(g)}
          </FilterChip>
        );
      })}
    </div>
  );
}
