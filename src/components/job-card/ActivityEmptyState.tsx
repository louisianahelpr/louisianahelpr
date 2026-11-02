import { navIconFor } from "@/components/mobileNav/mobileNavHelpers";
import { EmptyState, MAIN_TAB_EMPTY_BODY_LINES } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { BarkPillButton } from "@/components/ui/BarkPillButton";
import type { Tab } from "@/components/job-card/activityConstants";
import { useAgeGate } from "@/hooks/useAgeGate";

/**
 * ActivityEmptyState — the empty / error / no-matches panel shown when the
 * active tab has no visible cards. A failed fetch (loadError) takes
 * precedence over the "nothing yet" empty state.
 *
 * Each tab's empty state offers that tab's own next step (Jobs audit 1102b
 * rows 23-24, Q2609/Q2610): an empty Posted says "Post a job", an empty
 * Working says "Browse jobs". The old cross-tab swap sent a poster with
 * nothing posted off to earn ("browse open jobs near you and apply") with no
 * Post a job button on the Posted tab at all. Every account still does both;
 * the other tab is one tap away.
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
  /** Per-bucket counts of SEARCH MATCHES (empty without a query). On a search
   *  miss these, not `statusCounts`, say where to look: a jump to a bucket
   *  that holds matches lands on them with the query still applied. */
  searchMatchCounts?: Record<string, number>;
  onRetry: () => void;
  onNavigate: (to: string) => void;
  /** Switches the active status filter — lets the "your items are over
   *  there" line actually take the reader there. */
  onSelectStatusFilter?: (key: string) => void;
  /** Clears the search query — the only useful action on a search miss. */
  onClearSearch?: () => void;
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
  searchMatchCounts,
  onRetry,
  onNavigate,
  onSelectStatusFilter,
  onClearSearch,
}: ActivityEmptyStateProps) {
  // Q1586(c): the "Post a Job" pointer is greyed out under 18; a tap says why.
  const { gate: ageGate, gatedProps: ageGatedProps } = useAgeGate();
  const isPosted = tab === "posted";
  const totalCount = isPosted ? postedJobsCount : appliedAppsCount;
  // A failed fetch of THIS tab shows a recoverable ErrorState rather than a
  // misleading "nothing posted yet". Gated on the ACTIVE tab's count only:
  // `loadError` is the active tab's query, and the other tab is warmed on idle
  // the moment this one settles (errors included), so requiring BOTH counts to
  // be zero let a poster's posts hide a failed My Jobs read behind "No
  // applications yet" (ActivityEmptyState.loadError.test.tsx).
  if (loadError && totalCount === 0) {
    return (
      <div className="flex-1 min-h-full flex">
        <ErrorState onRetry={onRetry} />
      </div>
    );
  }
  const isTrulyEmpty = totalCount === 0;
  // Q2609: "All" is empty and nothing narrows it, so there is nothing live to show, even if a bucket All leaves out
  // (Not picked) holds a row. That is an empty tab, not a filtered one: "No jobs match the current view" read as if a
  // filter hid the jobs, and the only button sent the Helpr to the jobs they lost.
  const isLiveEmpty = isTrulyEmpty || (statusFilter === "all" && !hasSearch);
  // No eyebrow: "Nothing yet" / "No matches" said exactly what the title
  // below it already says ("Nothing posted yet" / "No jobs in this view"),
  // so it read as the same sentence twice in two type sizes.
  const title = isLiveEmpty
    ? (isPosted ? "Nothing posted yet" : "No jobs yet")
    : "No jobs in this view";
  // Cross-tab nudge: posted-empty hints at the helper side, applied-empty
  // hints at posting. For the filtered-but-empty case the copy depends on
  // *why* it's empty — a search with no hits, an "all" filter (no other
  // status to try), or a specific status filter that's hiding the rest.
  // "Try a different filter — there might be jobs in another status" makes the
  // user go and look. When we already know exactly which buckets hold their
  // items, the button offers the first of them (the status boxes above the
  // list already show every count, so the sentence does not repeat them).
  //
  // This is the same failure the /jobs default-filter bug produced — items
  // present, screen blank, the explanation one menu away — so the empty state
  // should point at them rather than shrug.
  const activeLabel =
    statusLabels?.find((f) => f.key === statusFilter)?.label ?? "this view";
  /* THE BUCKET TO OFFER: every other filter holding
     items. "Needs you" wins whenever it holds anything — it is the bucket
     whose whole point is that something is waiting on this person — and only
     then does the fullest one decide. It used to be fullest-only, and a
     poster whose helper had just marked the work done, standing on an empty
     Scheduled view, read "you have 2 in Needs You and 3 in Waiting" above a
     single button that said "Show Waiting (3)": the sentence named the
     approval that was waiting on them and the control walked past it
     (measured 2026-09-07 on /posts as Audit Weblane). */
  const jumpTo = (statusLabels ?? [])
    // TAB ORDER, not fullest (owner, 2026-10-08, the rule the page opens by:
    // needs you, then waiting, then scheduled...). Fullest offered "Show
    // Cancelled (4)" over 2 in Waiting on prod at 390 (helper-e2e).
    .filter((f) => f.key !== statusFilter && f.key !== "all" && (statusCounts?.[f.key] ?? 0) > 0)[0];
  /* WHERE THE MATCHES ARE. A search only narrows the bucket on screen, so
     "No jobs match your search" was false whenever the job sat in another
     bucket: the user read that it did not exist (OPEN.md, "My Posts search
     only searches the active status tab"). Name the buckets that hold
     matches, and offer the one to jump to; same Needs-you-first order. */
  const searchElsewhere = (statusLabels ?? [])
    .filter((f) => f.key !== statusFilter && f.key !== "all" && (searchMatchCounts?.[f.key] ?? 0) > 0);
  const searchJumpTo = searchElsewhere[0];
  const searchElsewhereText = searchElsewhere.map((f) => `${searchMatchCounts?.[f.key]} in ${f.label}`);
  const searchElsewhereLine =
    searchElsewhereText.length <= 1
      ? searchElsewhereText[0]
      : `${searchElsewhereText.slice(0, -1).join(", ")} and ${searchElsewhereText[searchElsewhereText.length - 1]}`;
  const body = isLiveEmpty
    ? (isPosted
        ? "Post a job and Helprs near you can apply."
        : "Apply to jobs near you.")
    : hasSearch
      ? (searchElsewhereLine
          ? `No matches under ${activeLabel.toLowerCase()} — ${searchElsewhereLine} ${
              searchElsewhere.length === 1 && searchMatchCounts?.[searchElsewhere[0].key] === 1 ? "matches" : "match"
            } your search.`
          : "No jobs match your search — try a different term.")
      // An empty "All" with no search is isLiveEmpty above (Q2609).
      : (
        // H4 (Cowork audit 2026-10-20): "Nothing under scheduled — but you
        // have 14 in Needs You, 2 in Waiting…" restated the status boxes right
        // above it, with an old label. Say what is empty, in the box's word;
        // the button below still jumps to where the jobs are.
        `Nothing in ${activeLabel} right now.`);
  // Each tab's own next step (Q2610): Posted -> Post a job, Working -> Browse jobs.
  // "job", not "task" — the nav, the feed heading and the Messages empty
  // state all say job.
  const ctaLabel = isPosted ? "Post a job" : "Browse jobs";
  const ctaTo = isPosted ? "/post-job" : "/home";
  const ctaButton = (
    <BarkPillButton
      onClick={ctaTo === "/post-job" ? ageGate("post", () => onNavigate(ctaTo)) : () => onNavigate(ctaTo)}
      {...(ctaTo === "/post-job" ? ageGatedProps("post") : {})}
    >
      {ctaLabel}
    </BarkPillButton>
  );
  // The page's own nav icon (owner, 2026-10-08, Q1558: "make sure the icon
  // matches that page"), the same circle on every empty page.
  const Icon = navIconFor(isPosted ? "/posts" : "/jobs");
  return (
    <div className="flex-1 min-h-full flex">
      <EmptyState
        icon={Icon}
        title={title}
        body={body}
        bodyLines={MAIN_TAB_EMPTY_BODY_LINES}
        footnote={
          /* Q2609: on an empty All, the bucket All leaves out (Not picked) is a quiet link under the
             tab's own button, never the only way on. */
          isLiveEmpty && !isTrulyEmpty && jumpTo && onSelectStatusFilter ? (
            <button type="button" data-empty-jump="" className="text-ds-14 underline underline-offset-2 text-muted-foreground" onClick={() => onSelectStatusFilter(jumpTo.key)}>
              Show {jumpTo.label} ({statusCounts?.[jumpTo.key] ?? 0})
            </button>
          ) : undefined
        }
        action={
          /* WHEN WE KNOW WHERE THE ITEMS ARE, GO THERE.
             The body line has named them since this component was written
             ("Nothing under needs you — but you have 3 in Scheduled") but the
             only button on the panel pointed the other way, at Post a Job — so
             a reader was told exactly where their work was and handed a
             control that went somewhere else. Naming a place is not the same
             as offering it.

             The page now OPENS on the first bucket with items (owner,
             2026-10-08; JobListPage), so this pointer covers a bucket that
             empties later, or a link that named an empty one. */
          /* A SEARCH MISS IS NOT A BUCKET MISS. With a query active the body
             says "no jobs match your search", but the jump button below read
             the PRE-search bucket counts and offered "Show Waiting (2)" —
             tapping it switched bucket with the query still applied, landed
             on another zero, and offered the next bucket: a treadmill that
             never reaches the two jobs it promised (measured 2026-09-07 on
             /posts?q=zzz-nomatch). The one action that ends a search miss
             is clearing the search. */
          /* With matches in another bucket the jump is safe again: it reads
             the SEARCH counts, so it lands on the matches it names. */
          hasSearch && searchJumpTo && onSelectStatusFilter ? (
            <BarkPillButton onClick={() => onSelectStatusFilter(searchJumpTo.key)}>
              Show {searchJumpTo.label} ({searchMatchCounts?.[searchJumpTo.key] ?? 0})
            </BarkPillButton>
          ) : hasSearch && onClearSearch ? (
            <BarkPillButton onClick={onClearSearch}>Clear search</BarkPillButton>
          ) : !isLiveEmpty && jumpTo && onSelectStatusFilter ? (
            <BarkPillButton onClick={() => onSelectStatusFilter(jumpTo.key)}>
              Show {jumpTo.label} ({statusCounts?.[jumpTo.key] ?? 0})
            </BarkPillButton>
          ) : (
            ctaButton
          )
        }
      />
    </div>
  );
}
