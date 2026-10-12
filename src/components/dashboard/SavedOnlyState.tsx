import { Bookmark } from "lucide-react";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";

/** The saved-ids read, as the saved-only feed needs it (Q1701). */
export interface SavedRead {
  /** The read failed and nothing was read, so "no saved ids" means nothing. */
  failed: boolean;
  retry: () => void;
  /** The re-read is in flight: the retry button is disabled meanwhile. */
  retrying: boolean;
}

/**
 * What the saved-only browse feed shows when it has no saved job to list.
 * Moved out of BrowseTasksFeed (component-size ratchet).
 */
export function SavedOnlyState({ savedRead }: { savedRead?: SavedRead }) {
  return (
    <div className="px-3 pt-4 flex-1 min-h-0 flex">
      {savedRead?.failed ? (
        /* Q1701: the saved ids were never read, so an empty list here is a
           failure, not "Nothing saved yet". */
        <ErrorState
          title="We couldn't load your saved jobs."
          body="Tap Try again. If it sticks, our end is having a hiccup — not yours."
          onRetry={savedRead.retry}
          retryDisabled={savedRead.retrying}
        />
      ) : (
        /* Nothing saved: before the generic empty state, whose
           `filters.filteredJobs` is full (jobs exist, none saved). EmptyState,
           never ErrorState (Q1644): ErrorState said "Hiccup on our end" and
           reported each showing as an error screen for a correct empty list. */
        <EmptyState icon={Bookmark}
          title="Nothing saved yet"
          body="Tap the bookmark on a job to keep it here. Saved jobs stay put until you unsave them or they're filled."
        />
      )}
    </div>
  );
}
