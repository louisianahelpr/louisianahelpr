import { Fragment, lazy, Suspense, useCallback, useRef, useEffect, useState } from "react";
import type { Dispatch, Ref, SetStateAction } from "react";
import { useNavigate } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import type { User as SupaUser } from "@supabase/supabase-js";
import { Star, Search, Bell, Plus, MapPin, Users, RefreshCw, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useReducedMotion } from "@/lib/accessibility";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { BarkPillButton } from "@/components/ui/BarkPillButton";
import PullToRefreshWrapper from "@/components/PullToRefreshWrapper";
import SwipeableJobCard from "@/components/dashboard/SwipeableJobCard";
import { VirtualizedJobList } from "@/components/dashboard/VirtualizedJobList";
import type { EnrichedJob } from "@/components/dashboard/types";
import type { useDashboardFilters } from "@/hooks/useDashboardFilters";
import type { usePullToRefresh } from "@/hooks/usePullToRefresh";

// Lazy-load BrowseMap so the ~45KB leaflet bundle only ships when an
// authenticated user toggles to map view. List view stays cheap.
const BrowseMap = lazy(() =>
  import("@/components/BrowseMap").then((m) => ({ default: m.BrowseMap })),
);

type PullToRefresh = ReturnType<typeof usePullToRefresh>;

interface BrowseTasksFeedProps {
  /** List vs Map view — selects which body renders. */
  view: "list" | "map";
  /** Dashboard filter state (from useDashboardFilters). */
  filters: ReturnType<typeof useDashboardFilters>;
  user: SupaUser | null;
  /** User's home parish (from profile) — used to localize the quiet-board
   *  landing headline ("No jobs in {area} right now"). Null falls back to
   *  "your area". */
  areaLabel: string | null;
  /** Full loaded feed — only `.length` is read, for the error-state guard. */
  allJobs: EnrichedJob[];
  /** True once the open-jobs fetch has failed. */
  loadError: boolean;
  /** Retries the feed fetch (ErrorState's retry handler). */
  refresh: () => void;
  recommendedJobs: EnrichedJob[];
  dismissedJobIds: Set<string>;
  /** Platform commission percentage, forwarded to each job card. */
  effectiveFee: number;
  handleApplyRequest: (jobId: string) => void;
  handleDismissRequest: (jobId: string) => void;
  handleToggleSave: (jobId: string, saved: boolean) => void;
  confirmDismissJobId: string | null;
  expandedCardId: string | null;
  setExpandedCardId: Dispatch<SetStateAction<string | null>>;
  savedJobIds: Set<string>;
  setReportJobId: Dispatch<SetStateAction<string | null>>;
  setDetailJob: Dispatch<SetStateAction<EnrichedJob | null>>;
  /** Pull-to-refresh wiring, owned by the page's usePullToRefresh hook. */
  containerRef: PullToRefresh["containerRef"];
  pullDistance: PullToRefresh["pullDistance"];
  refreshing: PullToRefresh["refreshing"];
  isPulling: PullToRefresh["isPulling"];
  /** Infinite-scroll sentinel — observed by the page's IntersectionObserver. */
  loadMoreRef: Ref<HTMLDivElement>;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  fetchNextPage: () => void;
}

/**
 * BrowseTasksFeed — the Dashboard feed body: the Map view, and the
 * pull-to-refresh job list (error / empty states, the "Picked for you"
 * + "Everything else" sections, and the infinite-scroll sentinel).
 *
 * Extracted verbatim from Dashboard.tsx (a step in splitting that
 * file) — the JSX is unchanged and every value it reads is now a prop.
 */
export function BrowseTasksFeed({
  view,
  filters,
  user,
  areaLabel,
  allJobs,
  loadError,
  refresh,
  recommendedJobs,
  dismissedJobIds,
  effectiveFee,
  handleApplyRequest,
  handleDismissRequest,
  handleToggleSave,
  confirmDismissJobId,
  expandedCardId,
  setExpandedCardId,
  savedJobIds,
  setReportJobId,
  setDetailJob,
  containerRef,
  pullDistance,
  refreshing,
  isPulling,
  loadMoreRef,
  hasNextPage,
  isFetchingNextPage,
  fetchNextPage,
}: BrowseTasksFeedProps) {
  const navigate = useNavigate();
  const reducedMotion = useReducedMotion();

  // Stable per-card expand toggle. Previously an inline arrow was created
  // for every card on every render — that defeated SwipeableJobCard's
  // React.memo, since each card got a fresh `onToggleExpand` reference.
  // The functional setState form keeps this callback free of an
  // `expandedCardId` dependency, so it never changes identity.
  const handleToggleExpand = useCallback(
    (id: string) => {
      setExpandedCardId((current) => (current === id ? null : id));
    },
    [setExpandedCardId],
  );

  // Track previous job count to announce newly appended pages to screen
  // readers via an aria-live="polite" region, without moving focus.
  const prevJobCountRef = useRef(filters.filteredJobs.length);
  const [infiniteScrollMsg, setInfiniteScrollMsg] = useState("");

  useEffect(() => {
    const prev = prevJobCountRef.current;
    const next = filters.filteredJobs.length;
    if (next > prev && !isFetchingNextPage) {
      const added = next - prev;
      setInfiniteScrollMsg(`${added} more job${added === 1 ? "" : "s"} loaded`);
    }
    prevJobCountRef.current = next;
  }, [filters.filteredJobs.length, isFetchingNextPage]);

  return (
    <>
      {/* Visually hidden aria-live region — announces newly loaded page
          of jobs to screen readers after infinite scroll without moving
          focus or interrupting the user mid-scroll. */}
      <p
        className="sr-only"
        aria-live="polite"
        aria-atomic="true"
      >
        {infiniteScrollMsg}
      </p>

      {view === "map" && (
        <div className="flex-1 min-h-0 px-3 pt-2 pb-0">
          <Suspense fallback={<div className="h-full w-full rounded-t-2xl bg-muted/30 animate-pulse" />}>
            <BrowseMap
              onJobAction={handleApplyRequest}
              ctaLabel="Apply"
              currentUserId={user?.id}
            />
          </Suspense>
        </div>
      )}

      <PullToRefreshWrapper
        ref={containerRef}
        pullDistance={pullDistance}
        refreshing={refreshing}
        isPulling={isPulling}
        className="flex-1 min-h-0 overscroll-contain scrollbar-hide px-3 pt-3 pb-0"
        style={view === "map" ? { display: "none" } : undefined}
      >
        {/* Always-visible elevated content box. Empty state and the
            job list both render INSIDE this box so the dashboard
            never reads as "bare rows on the page" — the box is the
            identity of the Browse Tasks area. Bottom corners
            drop their radius so the box reads as continuing under
            the floating dock. */}
        <div
          className="liquid-glass glass-paper-mesh min-h-full overflow-hidden"
          style={{
            borderBottomLeftRadius: 0,
            borderBottomRightRadius: 0,
            borderBottom: "none",
            boxShadow:
              "inset 0 1px 1px 0 rgba(255, 255, 255, 0.4), " +
              "0 1px 2px hsl(var(--olivewood) / 0.06), " +
              "0 14px 30px -8px hsl(var(--olivewood) / 0.14), " +
              "0 36px 64px -16px hsl(var(--olivewood) / 0.18)",
          }}
        >
      {/* Job list */}
      {loadError && allJobs.length === 0 ? (
      <div className="px-4 pt-4 flex-1 min-h-0 flex">
        <ErrorState
          title="We couldn't load jobs."
          body="Pull down to refresh, or tap Try again. If it sticks, our end is having a hiccup — not yours."
          onRetry={refresh}
        />
      </div>
      ) : filters.filteredJobs.length === 0 ? (
      filters.hasFilters ? (
        // Filtered to nothing — the honest, useful action is to loosen the
        // filters, so keep the compact EmptyState with a single "Clear" CTA.
        <div className="px-4 pt-4 flex-1 min-h-0 flex">
          <EmptyState
            icon={Search}
            eyebrow="No matches"
            title="No jobs match your filters."
            body={
              filters.boostedOnly
                ? "No boosted jobs right now — try clearing the filter to see all open work."
                : "Try widening your parish, raising your budget, or clearing a filter."
            }
            action={
              <Button variant="outline" onClick={filters.clearFilters} className="rounded-ds-md">
                Clear filters
              </Button>
            }
          />
        </div>
      ) : user ? (
        // Genuinely-quiet board for a signed-in user. Rather than a bare
        // "nothing here" card that reads as broken, give the home a real
        // landing: a localized headline, a primary "post a task" action,
        // a few quick actions, and a 3-step explainer so the screen always
        // has somewhere to go.
        <QuietBoardLanding
          areaLabel={areaLabel}
          onPost={() => navigate("/post-job")}
          onAlert={() => window.dispatchEvent(new Event("open-saved-searches"))}
          onInvite={() => navigate("/profile?tab=referral")}
          onRefresh={refresh}
        />
      ) : (
        <div className="px-4 pt-4 flex-1 min-h-0 flex">
          <EmptyState
            icon={Search}
            eyebrow="All quiet — for now"
            title="Nothing today, neighbor."
            body="New jobs post throughout the day — check back soon, or post the first one yourself."
            action={
              <BarkPillButton onClick={() => navigate("/post-job")}>
                Post the first job
              </BarkPillButton>
            }
          />
        </div>
      )
      ) : (() => {
        const visibleJobs = filters.filteredJobs
          .filter(j => !dismissedJobIds.has(j.id))
          .filter(j => {
            // Hide jobs already shown in Recommended or Nearby sections
            if (!filters.hasFilters) {
              const inRecommended = recommendedJobs.some(rj => rj.id === j.id);
              const inNearby = filters.nearbyJobs.some(nj => nj.id === j.id);
              if (inRecommended || inNearby) return false;
            }
            return true;
          })
          // Two-sided liquidity signal — float urgent jobs to the top of
          // the "Everything else" feed so the helpr side sees the work
          // that needs them most (and the bonus that comes with it)
          // first. Stable sort: equal-urgency rows keep the feed's
          // existing order, so this only lifts urgent jobs without
          // reshuffling everything else.
          .slice()
          .sort((a, b) => Number(b.is_urgent ?? false) - Number(a.is_urgent ?? false));
        const recommendedVisible = !filters.hasFilters
          ? recommendedJobs.filter(j => !dismissedJobIds.has(j.id))
          : [];
        return (
          <>
            {recommendedVisible.length > 0 && (
              <>
                <div
                  className="px-4 pt-3 pb-1.5 flex items-center justify-between"
                  style={{ borderBottom: "1px solid hsl(var(--olivewood) / 0.06)" }}
                >
                  <div className="flex items-center gap-2">
                    <Star
                      className="w-3.5 h-3.5"
                      style={{ color: "hsl(var(--burnt-sienna))" }}
                      strokeWidth={2}
                      fill="hsl(var(--burnt-sienna) / 0.2)"
                    />
                    <span
                      className="text-[0.7rem] font-serif italic uppercase tracking-[0.18em]"
                      style={{ color: "hsl(var(--burnt-sienna))" }}
                    >
                      Picked for you
                    </span>
                  </div>
                  <span
                    className="text-[0.7rem] font-sans"
                    style={{ color: "hsl(var(--olivewood) / 0.55)" }}
                  >
                    {recommendedVisible.length}
                  </span>
                </div>
                <div className="px-3 pt-3 pb-1 space-y-2.5 lg:space-y-4 xl:space-y-5">
                  {/* AnimatePresence with initial={false} — only NEW
                      recommended jobs slide in (e.g. when a fresh match
                      arrives or the user dismisses a sibling). The
                      first paint stays static so the section doesn't
                      feel laggy when the dashboard loads. The virtualized
                      "Everything else" list below is intentionally NOT
                      wrapped — animating across an absolute-positioned
                      virtualizer fights its layout math. */}
                  <AnimatePresence initial={false}>
                    {recommendedVisible.map((job, i) => (
                      <motion.div
                        key={`rec-${job.id}`}
                        initial={reducedMotion ? { opacity: 0 } : { opacity: 0, y: -12 }}
                        animate={reducedMotion ? { opacity: 1 } : { opacity: 1, y: 0 }}
                        exit={reducedMotion ? { opacity: 0 } : { opacity: 0, y: -12 }}
                        transition={reducedMotion ? { duration: 0 } : { duration: 0.2, ease: "easeOut" }}
                      >
                        <SwipeableJobCard job={job} effectiveFee={effectiveFee} currentUserId={user?.id} onApply={handleApplyRequest} onReport={setReportJobId} onSelect={setDetailJob} onDismiss={handleDismissRequest} dismissPending={confirmDismissJobId === job.id} index={i} isExpanded={expandedCardId === job.id} onToggleExpand={handleToggleExpand} isSaved={savedJobIds.has(job.id)} onToggleSave={handleToggleSave} />
                      </motion.div>
                    ))}
                  </AnimatePresence>
                </div>
                {visibleJobs.length > 0 && (
                  <div
                    className="px-4 pt-3 pb-1.5"
                    style={{
                      borderTop: "1px solid hsl(var(--olivewood) / 0.06)",
                      borderBottom: "1px solid hsl(var(--olivewood) / 0.06)",
                    }}
                  >
                    <span
                      className="text-[0.7rem] font-serif italic uppercase tracking-[0.18em]"
                      style={{ color: "hsl(var(--burnt-sienna))" }}
                    >
                      Everything else
                    </span>
                  </div>
                )}
              </>
            )}
            {/* Main "Everything else" feed — virtualized. This is the
                only unbounded list on the dashboard (50+ rows after
                infinite scroll, each mounting framer-motion drag state),
                so it scrolls via an element-scroll virtualizer that
                renders just the visible window. The recommended section,
                section headers, and the infinite-scroll sentinel stay as
                normal DOM — recommended is capped at 5 and the rest are
                fixed-size. The outer div keeps the horizontal padding,
                top padding, and dock clearance; per-card vertical spacing
                is baked into each virtualized row so it survives the
                absolute positioning the virtualizer applies. */}
            <div
              className="px-3 pt-3"
              style={{
                // Dock clearance — last jobs scroll *under* the
                // floating bottom nav, so we add safe room below
                // the final card to let the user reach it.
                paddingBottom: "calc(6rem + env(safe-area-inset-bottom, 0px))",
              }}
            >
              <VirtualizedJobList
                items={visibleJobs}
                scrollElementRef={containerRef}
                getKey={(job) => job.id}
                renderItem={(job, i) => (
                  // Gap between cards — `space-y-*` can't apply once the
                  // virtualizer absolutely-positions rows, so the gap is
                  // bottom padding measured as part of the row height.
                  <div className="pb-2.5 lg:pb-4 xl:pb-5">
                    <SwipeableJobCard job={job} effectiveFee={effectiveFee} currentUserId={user?.id} onApply={handleApplyRequest} onReport={setReportJobId} onSelect={setDetailJob} onDismiss={handleDismissRequest} dismissPending={confirmDismissJobId === job.id} index={i} isExpanded={expandedCardId === job.id} onToggleExpand={handleToggleExpand} isSaved={savedJobIds.has(job.id)} onToggleSave={handleToggleSave} />
                  </div>
                )}
              />
            </div>
            {/* Infinite scroll sentinel + manual fallback */}
            {hasNextPage && (
              <div ref={loadMoreRef} className="px-4 py-4 flex justify-center">
                {isFetchingNextPage ? (
                  <span className="text-ds-11 text-muted-foreground inline-flex items-center gap-2">
                    <span className="w-3 h-3 rounded-full border-2 border-primary/30 border-t-primary animate-spin" />
                    Loading more jobs…
                  </span>
                ) : (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => fetchNextPage()}
                    className="text-ds-11 text-muted-foreground hover:text-foreground rounded-ds-md btn-press"
                  >
                    Load more
                  </Button>
                )}
              </div>
            )}
            {!hasNextPage && visibleJobs.length >= 25 && (
              <div className="px-4 py-4 text-center text-ds-11 text-muted-foreground">
                You've reached the end of the feed.
              </div>
            )}
          </>
        );
      })()}
        </div>
      </PullToRefreshWrapper>
    </>
  );
}

/**
 * QuietBoardLanding — the signed-in, no-jobs, no-filters home state.
 *
 * Replaces the old single "Nothing today" card, which left the logged-in
 * home reading as a near-empty void. Instead the screen always has
 * structure and a path forward: a localized headline, a primary
 * "post a task" card, a short list of quick actions, and a 3-step
 * explainer of how Helpr works.
 */
function QuietBoardLanding({
  areaLabel,
  onPost,
  onAlert,
  onInvite,
  onRefresh,
}: {
  areaLabel: string | null;
  onPost: () => void;
  onAlert: () => void;
  onInvite: () => void;
  onRefresh: () => void;
}) {
  const where = areaLabel?.trim() ? areaLabel.trim() : "your area";
  const quickActions = [
    {
      key: "alert",
      icon: Bell,
      label: "Set a job alert",
      sub: "Get pinged the moment matching work lands",
      onClick: onAlert,
    },
    {
      key: "invite",
      icon: Users,
      label: "Invite neighbors",
      sub: "More people nearby means more jobs on the board",
      onClick: onInvite,
    },
    {
      key: "refresh",
      icon: RefreshCw,
      label: "Refresh the board",
      sub: "Check for jobs posted just now",
      onClick: onRefresh,
    },
  ];
  const steps = [
    { n: 1, label: "Post" },
    { n: 2, label: "Match" },
    { n: 3, label: "Get it done" },
  ];

  return (
    <div
      className="px-4 pt-6 flex flex-col gap-5"
      style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 96px + 1.5rem)" }}
    >
      {/* Hero */}
      <div className="flex flex-col items-center text-center gap-3">
        <div
          className="w-16 h-16 rounded-full flex items-center justify-center"
          style={{
            backgroundColor: "hsla(0, 0%, 100%, 0.55)",
            backdropFilter: "blur(16px) saturate(150%)",
            WebkitBackdropFilter: "blur(16px) saturate(150%)",
            border: "1px solid hsl(var(--olivewood) / 0.10)",
            boxShadow:
              "inset 0 1px 1px 0 rgba(255, 255, 255, 0.65), " +
              "0 8px 22px -6px hsl(var(--olivewood) / 0.12)",
          }}
        >
          <MapPin className="w-7 h-7" style={{ color: "hsl(var(--bark))" }} strokeWidth={1.5} />
        </div>
        <div className="space-y-1">
          <p
            className="font-display italic font-bold leading-tight break-words"
            style={{
              fontSize: "clamp(1.15rem, 1.5vw + 0.5rem, 1.4rem)",
              color: "hsl(var(--ink-deep))",
              letterSpacing: "-0.02em",
            }}
          >
            No jobs in {where} right now
          </p>
          <p
            className="font-serif italic text-ds-13 leading-relaxed max-w-xs mx-auto"
            style={{ color: "hsl(var(--olivewood) / 0.7)" }}
          >
            The board's quiet — but it fills up fast. Here's how to get ahead of it.
          </p>
        </div>
      </div>

      {/* Primary action — post a task */}
      <div
        className="rounded-2xl liquid-glass px-4 py-5 flex flex-col items-center text-center gap-3"
        style={{
          backgroundImage:
            "radial-gradient(80% 100% at 50% 0%, hsl(var(--burnt-sienna) / 0.07) 0%, transparent 60%)",
        }}
      >
        <p className="font-sans font-semibold text-ds-13" style={{ color: "hsl(var(--ink-deep))" }}>
          Need something done? Be the first to post.
        </p>
        <BarkPillButton onClick={onPost}>
          <Plus className="w-4 h-4 mr-2" strokeWidth={2.5} aria-hidden="true" />
          Post a task
        </BarkPillButton>
      </div>

      {/* Quick actions */}
      <div className="space-y-2">
        <span className="text-display-eyebrow px-1">Quick actions</span>
        <div className="rounded-2xl liquid-glass overflow-hidden">
          {quickActions.map(({ key, icon: Icon, label, sub, onClick }, i) => (
            <button
              key={key}
              type="button"
              onClick={onClick}
              className="w-full flex items-center gap-3 px-4 py-3 text-left active:bg-[hsl(var(--olivewood)/0.05)] btn-press"
              style={i > 0 ? { borderTop: "1px solid hsl(var(--olivewood) / 0.08)" } : undefined}
            >
              <span
                className="w-9 h-9 rounded-full flex items-center justify-center shrink-0"
                style={{ backgroundColor: "hsl(var(--bark) / 0.10)" }}
              >
                <Icon className="w-4 h-4" style={{ color: "hsl(var(--bark))" }} strokeWidth={2} />
              </span>
              <span className="flex-1 min-w-0">
                <span
                  className="block font-sans font-semibold text-ds-13"
                  style={{ color: "hsl(var(--ink-deep))" }}
                >
                  {label}
                </span>
                <span
                  className="block font-serif italic text-ds-11 truncate"
                  style={{ color: "hsl(var(--olivewood) / 0.65)" }}
                >
                  {sub}
                </span>
              </span>
              <ChevronRight
                className="w-4 h-4 shrink-0"
                style={{ color: "hsl(var(--olivewood) / 0.4)" }}
              />
            </button>
          ))}
        </div>
      </div>

      {/* How Helpr works */}
      <div className="space-y-2">
        <span className="text-display-eyebrow px-1">How Helpr works</span>
        <div className="rounded-2xl liquid-glass px-3 py-4 flex items-center justify-between">
          {steps.map((s, i) => (
            <Fragment key={s.n}>
              <div className="flex flex-col items-center gap-1.5 flex-1">
                <span
                  className="w-7 h-7 rounded-full flex items-center justify-center font-sans font-bold text-ds-12"
                  style={{ backgroundColor: "hsl(var(--bark))", color: "hsl(var(--parchment))" }}
                >
                  {s.n}
                </span>
                <span
                  className="font-sans font-medium text-ds-11"
                  style={{ color: "hsl(var(--ink-deep))" }}
                >
                  {s.label}
                </span>
              </div>
              {i < steps.length - 1 && (
                <ChevronRight
                  className="w-4 h-4 shrink-0"
                  style={{ color: "hsl(var(--olivewood) / 0.3)" }}
                />
              )}
            </Fragment>
          ))}
        </div>
      </div>
    </div>
  );
}
