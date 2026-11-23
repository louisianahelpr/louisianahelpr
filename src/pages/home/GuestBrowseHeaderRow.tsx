import type { Ref } from "react";
import { BrowseSearchBar } from "@/components/dashboard/browseTasksToolbar/BrowseSearchBar";
import { BrowseTasksActions } from "@/components/dashboard/browseTasksToolbar/BrowseTasksActions";
import type { useDashboardFilters } from "@/hooks/useDashboardFilters";
import { GUEST_JOBS_LIMIT } from "@/lib/guestJobsQuery";
import { wordInLang } from "@/lib/i18n/inLang";

/**
 * "N open jobs" for the guest feed, or null while there is nothing exact to say (the bones, an error, offline).
 * The guest read takes the newest GUEST_JOBS_LIMIT rows, so a full read says "N+" rather than claim a total it did
 * not count.
 */
export function guestOpenJobsLabel({ listedCount, readCount, ready }: { listedCount: number; readCount: number; ready: boolean }): string | null {
  if (!ready) return null;
  if (readCount >= GUEST_JOBS_LIMIT) return wordInLang("g.openJobs", `${listedCount}+ open jobs`, { n: `${listedCount}+` });
  if (listedCount === 1) return wordInLang("g.openJob", "1 open job");
  return wordInLang("g.openJobs", `${listedCount} open jobs`, { n: listedCount });
}

/**
 * G1 (whole-app audit 1123, repeat of 1122 #1 High): guest Jobs on the web gets member Browse's header row: the count,
 * then the SAME search icon and Filters button (BrowseTasksActions), driving the SAME filter state and sheet. While
 * search is open the field takes the count's place. Nothing here is a signed-in action (no saved jobs, no saved
 * searches: the page's BrowseTasksToolbar gets user={null}). Guard: src/test/guestBrowseWebHeaderRow.test.tsx.
 */
export function GuestBrowseHeaderRow({ filters, filtersButtonRef, countLabel, autoFocusSearch }: {
  filters: ReturnType<typeof useDashboardFilters>;
  filtersButtonRef: Ref<HTMLButtonElement>;
  countLabel: string | null;
  /** False for a visit that arrived with ?q= (F070: the field holds the word, unfocused). */
  autoFocusSearch: boolean;
}) {
  return (
    <div data-guest-browse-header="" className="mb-3 flex min-h-11 items-center gap-2">
      {filters.searchOpen ? (
        <BrowseSearchBar filters={filters} autoFocus={autoFocusSearch} className="!w-full min-w-0 flex-1" />
      ) : (
        <p className="min-w-0 flex-1 font-sans text-ds-13 tabular-nums text-muted-foreground" data-guest-browse-count="" aria-live="polite">
          {countLabel}
        </p>
      )}
      <div className="flex shrink-0 items-center gap-1">
        <BrowseTasksActions filters={filters} filtersButtonRef={filtersButtonRef} />
      </div>
    </div>
  );
}
