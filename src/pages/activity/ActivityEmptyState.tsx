import { Search, Send } from "lucide-react";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { BarkPillButton } from "@/components/ui/BarkPillButton";
import type { Tab } from "@/components/activity/activityConstants";

/**
 * ActivityEmptyState — the empty / error / no-matches panel shown when the
 * active tab has no visible cards. A failed fetch (loadError) takes
 * precedence over the "nothing yet" empty state.
 */
export interface ActivityEmptyStateProps {
  tab: Tab;
  loadError: boolean;
  postedJobsCount: number;
  appliedAppsCount: number;
  onRetry: () => void;
  onNavigate: (to: string) => void;
}

export function ActivityEmptyState({
  tab,
  loadError,
  postedJobsCount,
  appliedAppsCount,
  onRetry,
  onNavigate,
}: ActivityEmptyStateProps) {
  // A failed fetch leaves both lists empty — show a recoverable
  // ErrorState rather than a misleading "nothing posted yet".
  if (loadError && postedJobsCount === 0 && appliedAppsCount === 0) {
    return (
      <div className="flex-1 min-h-full flex">
        <ErrorState onRetry={onRetry} />
      </div>
    );
  }
  const isPosted = tab === "posted";
  const totalCount = isPosted ? postedJobsCount : appliedAppsCount;
  const eyebrow = totalCount === 0 ? "Nothing yet" : "No matches";
  const title = totalCount === 0
    ? (isPosted ? "Nothing posted yet." : "No applications yet.")
    : "No tasks in this view.";
  const body = totalCount === 0
    ? (isPosted
        ? "Post your first task and your local helprs will see it instantly."
        : "Browse open tasks near you and apply — your applications will land here.")
    : "Try a different filter — there might be tasks in another status.";
  const ctaLabel = isPosted ? "Post a Job" : "Browse tasks";
  const ctaTo = isPosted ? "/post-job" : "/dashboard";
  const Icon = isPosted ? Search : Send;
  return (
    <div className="flex-1 min-h-full flex">
      <EmptyState
        icon={Icon}
        eyebrow={eyebrow}
        title={title}
        body={body}
        action={
          <BarkPillButton onClick={() => onNavigate(ctaTo)}>
            {ctaLabel}
          </BarkPillButton>
        }
      />
    </div>
  );
}
