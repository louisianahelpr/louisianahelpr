import { Search, Send, Wrench } from "lucide-react";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { BarkPillButton } from "@/components/ui/BarkPillButton";
import type { Tab } from "@/components/activity/activityConstants";

/**
 * ActivityEmptyState — the empty / error / no-matches panel shown when the
 * active tab has no visible cards. A failed fetch (loadError) takes
 * precedence over the "nothing yet" empty state.
 *
 * Every account in Helpr can both post AND do jobs (the app is never
 * role-based — see memory `app-is-never-role-based`). So when a user has
 * posted nothing yet, the most useful nudge is "go browse jobs and
 * apply" — the helper side may be where they get their first win. And
 * vice-versa: when they haven't applied to anything, "post a job"
 * surfaces the other half of the marketplace they may not have tried.
 * Cross-tab CTAs intentionally swap the suggestion: posted-empty points
 * at /dashboard (Apply), applied-empty points at /post-job (Post).
 */
export interface ActivityEmptyStateProps {
  tab: Tab;
  loadError: boolean;
  postedJobsCount: number;
  appliedAppsCount: number;
  /** Active status filter — drives the "no matches" copy. */
  statusFilter: string;
  /** Whether a search query is currently narrowing the list. */
  hasSearch: boolean;
  /**
   * Per-status counts for the active tab, plus the filter labels, so the
   * filtered-empty copy can name WHERE the hidden items actually are instead
   * of telling the user to go hunting through the filter menu themselves.
   */
  statusCounts?: Record<string, number>;
  statusLabels?: { key: string; label: string }[];
  onRetry: () => void;
  onNavigate: (to: string) => void;
}

export function ActivityEmptyState({
  tab,
  loadError,
  postedJobsCount,
  appliedAppsCount,
  statusFilter,
  hasSearch,
  statusCounts,
  statusLabels,
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
  const isTrulyEmpty = totalCount === 0;
  // No eyebrow: "Nothing yet" / "No matches" said exactly what the title
  // below it already says ("Nothing posted yet" / "No jobs in this view"),
  // so it read as the same sentence twice in two type sizes.
  const title = isTrulyEmpty
    ? (isPosted ? "Nothing posted yet" : "No applications yet")
    : "No jobs in this view";
  // Cross-tab nudge: posted-empty hints at the helper side, applied-empty
  // hints at posting. For the filtered-but-empty case the copy depends on
  // *why* it's empty — a search with no hits, an "all" filter (no other
  // status to try), or a specific status filter that's hiding the rest.
  // "Try a different filter — there might be jobs in another status" makes the
  // user go and look. When we already know exactly which buckets hold their
  // items, say so: "Nothing under active — but you have 3 in Closed."
  //
  // This is the same failure the /my-jobs default-filter bug produced — items
  // present, screen blank, the explanation one menu away — so the empty state
  // should point at them rather than shrug.
  const activeLabel =
    statusLabels?.find((f) => f.key === statusFilter)?.label ?? "this view";
  const elsewhere = (statusLabels ?? [])
    .filter((f) => f.key !== statusFilter && f.key !== "all" && (statusCounts?.[f.key] ?? 0) > 0)
    .map((f) => `${statusCounts?.[f.key]} in ${f.label}`);
  const filteredElsewhere =
    elsewhere.length === 0
      ? null
      : elsewhere.length === 1
        ? elsewhere[0]
        : `${elsewhere.slice(0, -1).join(", ")} and ${elsewhere[elsewhere.length - 1]}`;
  const body = isTrulyEmpty
    ? (isPosted
        ? "While you wait for the right moment to post, you can earn by helping — browse open jobs near you and apply."
        : "While you scout for the right job, post one of your own — your neighbors might be the perfect match.")
    : hasSearch
      ? "No jobs match your search — try a different term."
      : statusFilter === "all"
        ? "No jobs match the current view."
        : filteredElsewhere
          ? `Nothing under ${activeLabel.toLowerCase()} — but you have ${filteredElsewhere}.`
          : "Try a different filter — there might be jobs in another status.";
  // Swap the CTAs on the empty state so each tab promotes the OTHER side
  // of the marketplace. When the user has data ("no matches" view) we
  // keep them on the same side they're filtering.
  const isCrossTabSuggestion = isTrulyEmpty;
  // "job", not "task" — the nav, the feed heading and the Messages empty
  // state all say job, and these four labels were the last holdouts.
  const ctaLabel = isCrossTabSuggestion
    ? (isPosted ? "Browse Jobs" : "Post a Job")
    : (isPosted ? "Post a Job" : "Browse Jobs");
  const ctaTo = isCrossTabSuggestion
    ? (isPosted ? "/dashboard" : "/post-job")
    : (isPosted ? "/post-job" : "/dashboard");
  // Icon mirrors the CTA target so the eye lands on the matching glyph.
  const Icon = isCrossTabSuggestion
    ? (isPosted ? Send : Wrench)
    : (isPosted ? Search : Send);
  return (
    <div className="flex-1 min-h-full flex">
      <EmptyState
        icon={Icon}
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
