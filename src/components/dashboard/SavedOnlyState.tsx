import { Bookmark } from "lucide-react";
import { EmptyState, MAIN_TAB_EMPTY_BODY_LINES } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";

/** The saved-ids read, as the saved-only feed needs it (Q1701). */
export interface SavedRead {
  /** The read failed and nothing was read, so "no saved ids" means nothing. */
  failed: boolean;
  /** Re-reads the saved ids (not a React Query `retry` rule: queryRetryPolicy). */
  onRetry: () => void;
  /** The re-read is in flight: the retry button is disabled meanwhile. */
  retrying: boolean;
  /**
   * How many jobs the viewer has saved, shown or not (Q1739). Above zero with
   * an empty list means every saved job is closed, filled, applied to or
   * passed on: "Nothing saved yet" would be false.
   */
  total?: number;
}

/**
 * What the saved-only browse feed shows when it has no saved job to list.
 * Moved out of BrowseTasksFeed (component-size ratchet).
 */
export function SavedOnlyState({ savedRead }: { savedRead?: SavedRead }) {
  if (!savedRead?.failed) {
    /* Nothing saved: before the generic empty state, whose
       `filters.filteredJobs` is full (jobs exist, none saved). EmptyState,
       never ErrorState (Q1644): ErrorState said "Hiccup on our end" and
       reported each showing as an error screen for a correct empty list.
       A main-tab empty page (Q1558): no wrapper padding and the shared body
       and action rows, so its circle, title and text sit where My Posts',
       My Jobs' and Messages' do (it sat 38px lower at 375 on prod,
       2026-10-13: the wrapper's pt-4 plus no button row). */
    const noneOpen = (savedRead?.total ?? 0) > 0;
    return (
      <div className="flex-1 min-h-0 flex">
        <EmptyState icon={Bookmark}
          title={noneOpen ? "None of your saved jobs are open" : "Nothing saved yet"}
          body={noneOpen
            ? "Each one was filled or closed, or is one you applied to or passed on. Tap the bookmark on a job to keep it here."
            : "Tap the bookmark on a job to keep it here. Saved jobs stay put until you unsave them or they're filled."}
          bodyLines={MAIN_TAB_EMPTY_BODY_LINES}
        />
      </div>
    );
  }
  /* Q1701: the saved ids were never read, so an empty list here is a
     failure, not "Nothing saved yet". */
  return (
    <div className="px-3 pt-4 flex-1 min-h-0 flex">
      <ErrorState
        title="We couldn't load your saved jobs."
        body="Tap Try again. If it sticks, our end is having a hiccup — not yours."
        onRetry={savedRead.onRetry}
        retryDisabled={savedRead.retrying}
      />
    </div>
  );
}
