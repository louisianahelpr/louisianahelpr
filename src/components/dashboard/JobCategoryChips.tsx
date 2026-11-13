/**
 * Jobs Browse's category chips (design audit A J1, owner approved 11-08: "same pattern Jobs/Shops/Homes/Dashboard",
 * row 2 under the search bar). The same row as Declutter's (DeclutterCategoryChips): "All" first, then EVERY one of the
 * 8 category groups a poster picks from on Post a job (JOB_CATEGORY_GROUPS), in that canonical order, as one
 * horizontal scroll row.
 *
 * Owner 11-13 ("Where are the other categories from post a job?"): the row used to show only the groups with a job in
 * the feed, busiest first ("never opens an empty list"). That hid most categories, and it counted the feed in hand,
 * which still holds the viewer's OWN jobs that Browse hides, so a chip could open an empty list anyway. Now the row is
 * fixed: all 8, always, in Post a job's order, even when the feed is empty, and it reads no jobs at all (so the
 * viewer's own jobs cannot count toward it). A group with nothing in it opens a helpful empty state
 * ("No Yard jobs near you yet." with Post a job + Notify me, BrowseTasksFeed / browseEmptyCopy.ts), never a blank list.
 * A chip sets the same value the filter sheet's Category sets (one value, so the sheet, the saved search, ?cat= and
 * the server count agree); tapping the chosen chip again shows everything. Labels are Post a job's own words,
 * t("postJob.group.<id>"), so Spanish matches the tiles.
 *
 * Chips are the shared FilterChip; icons are lucide at the app's one weight (owner 11-04), not the filter sheet's emoji.
 * Guard: src/test/jobsCategoryChipsRow.test.tsx.
 *
 * F107 (owner UI audit 11-09; owner pick 11-09: filters inside the existing tabs): a "Saved" chip after "All", the
 * feed's own "Only saved jobs" filter (Dashboard's savedOnly, the same one the filter sheet and the desktop cluster
 * toggle), so a job you saved has a home on Browse. Shown once you have saved a job, or while it is on.
 * Guard: src/test/jobsWorkingChipsAndSaved.test.tsx.
 */
import { useEffect } from "react";
import { useLanguage } from "@/lib/i18n/language";
import type { MsgKey } from "@/lib/i18n/en";
import "@/lib/i18n/enSections";
import { noteJobChipsRow } from "@/lib/jobChipsSeen";
import { Bookmark, Car, Hammer, Home, Leaf, PartyPopper, PawPrint, Sparkles, Truck, type LucideIcon } from "lucide-react";
import { FilterChip } from "@/components/ui/FilterChip";
import { JOB_CATEGORY_GROUPS, groupTileLabel, type JobCategoryGroupId } from "@/lib/jobCategoryGroups";

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

/**
 * A chip's words: Post a job's tile title, t("postJob.group.<id>") (Spanish in es.ts). The English tile words live in
 * enPostJob.ts, a chunk Browse does not load, so until they are registered t() hands back the key and the chip uses the
 * same English groupTileLabel gives (identical words, "Moving & errands").
 */
export function jobGroupChipLabel(g: { id: JobCategoryGroupId; label: string }, t: (k: MsgKey) => string): string {
  const key = `postJob.group.${g.id}` as MsgKey;
  const w = t(key);
  return w && w !== key ? w : groupTileLabel(g);
}

export function JobCategoryChips({ value, onChange, saved }: {
  /** F107: the "Only saved jobs" filter as a chip; `count` = jobs saved (no chip at 0 unless it is on). */
  saved?: { on: boolean; count: number; onToggle: () => void };
  /** The filter's value: a group id, a legacy single category (then no chip is lit but "All" is not either), or null. */
  value: string | null;
  onChange: (value: string | null) => void;
}) {
  const { t } = useLanguage();
  const savedChip = !!saved && (saved.on || saved.count > 0);
  // The row always draws now (owner 11-13): tell the next loading skeleton to draw the chips bone (jobChipsSeen.ts).
  useEffect(() => { noteJobChipsRow(true); }, []);
  return (
    <div role="group" aria-label="Categories" data-chip-row="job-categories" className="flex min-w-0 gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <FilterChip pressed={value === null && !saved?.on} onClick={() => { onChange(null); if (saved?.on) saved.onToggle(); }} className="shrink-0" data-category-chip="all">{t("section.chipAll")}</FilterChip>
      {savedChip && (
        <FilterChip pressed={saved!.on} onClick={saved!.onToggle} className="shrink-0" data-category-chip="saved">
          <Bookmark className="h-4 w-4 shrink-0" aria-hidden />
          {t("section.chipSaved")}
        </FilterChip>
      )}
      {JOB_CATEGORY_GROUPS.map((g) => {
        const Icon = GROUP_ICON[g.id];
        return (
          <FilterChip key={g.id} pressed={value === g.id} onClick={() => onChange(value === g.id ? null : g.id)} className="shrink-0" data-category-chip={g.id}>
            <Icon className="h-4 w-4 shrink-0" aria-hidden />
            {jobGroupChipLabel(g, t)}
          </FilterChip>
        );
      })}
    </div>
  );
}
