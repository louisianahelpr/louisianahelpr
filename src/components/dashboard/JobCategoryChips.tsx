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
 */
import { useEffect, useMemo } from "react";
import { noteJobChipsRow } from "@/lib/jobChipsSeen";
import { Car, Hammer, Home, Leaf, PartyPopper, PawPrint, Sparkles, Truck, type LucideIcon } from "lucide-react";
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

export function JobCategoryChips({ jobs, value, onChange }: {
  jobs: readonly { category?: string | null }[];
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
  // Tell the next loading skeleton whether to draw the chips bone (jobChipsSeen.ts).
  useEffect(() => { noteJobChipsRow(shown); }, [shown]);
  if (!shown) return null;
  return (
    <div role="group" aria-label="Categories" data-chip-row="job-categories" className="flex min-w-0 gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <FilterChip pressed={value === null} onClick={() => onChange(null)} className="shrink-0" data-category-chip="all">All</FilterChip>
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
