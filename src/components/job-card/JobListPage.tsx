import { useEffect, useRef, useState, useCallback, lazy, Suspense } from "react";
import { EmbeddedActivityHeader, EmbeddedActivityLoading, boxLabelledFilters, type EmbeddedHeader } from "@/components/job-card/embeddedActivity";
import { deepLinkReady, useActivitySettled } from "./deepLinkWait";
import { useIsWebDesktop } from "@/hooks/useIsWebDesktop";
import { usePullToRefresh } from "@/hooks/usePullToRefresh";
import PullToRefreshWrapper from "@/components/PullToRefreshWrapper";
import { useNavigate, useSearchParams } from "react-router-dom";
import { PageScaffold } from "@/components/ui/PageScaffold";
import { ActivityCardSkeleton } from "@/components/SkeletonLoaders";
import { ApplicationCardSkeleton } from "@/components/ui/skeletons/ApplicationCardSkeleton";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { usePageTitle } from "@/hooks/usePageTitle";
import { useActivityData } from "@/hooks/useActivityData";
import { ActivityDialogs } from "@/components/job-card/ActivityDialogs";
import { ActivityOfferDialogs } from "@/components/job-card/ActivityOfferDialogs";
import { notOnPostedCopy, onPostedList, useManageDeepLink, useOpenWorkingDeepLink, useReviewApplicantsDeepLink } from "./useManageDeepLink";
import { useToastClearance } from "@/hooks/useToastClearance";
import { RecurringVisitPayments } from "@/pages/posts/postedJobs/RecurringVisitPayments";
import { PendingBankPayments } from "@/pages/posts/postedJobs/PendingBankPayments";
import { type Tab } from "@/components/job-card/activityConstants";

// Tab content is lazy-split so the initial Activity chunk only contains the
// shell (header, filters, skeleton fallbacks). The per-tab bundles are fetched
// once the data is ready and the correct tab is about to be rendered.
const PostedJobsTab = lazy(() =>
  import("@/pages/posts/PostedJobsTab").then((m) => ({ default: m.PostedJobsTab })),
);
const AppliedJobsTab = lazy(() =>
  import("@/pages/jobs/AppliedJobsTab").then((m) => ({ default: m.AppliedJobsTab })),
);

// Dialogs mount only on a user action, so lazy-loading keeps their subtrees
// out of the initial chunk entirely (the offer pop-ups: ActivityOfferDialogs).
// Same "Report" surface Browse uses (Dashboard.tsx) — a Done-tab job on
// My Posts gets the identical dialog, reportedType="job".
const ReportDialog = lazy(() => import("@/components/ReportDialog"));
import { useActivityActions } from "@/components/job-card/useActivityActions";
import {
  POSTED_STATUS_FILTERS,
  APPLIED_STATUS_FILTERS,
  useActivityFilters,
  postedActivityBucket,
  appliedActivityBucket,
  jobIsUnfundedDraft,
} from "@/components/job-card/activityFilters";
import { ActivityEmptyState } from "@/components/job-card/ActivityEmptyState";
import { usePushPermissionNudge } from "@/lib/pushPermissionNudge";
import { useSearchParamMirror } from "@/hooks/useSearchParamMirror";
import { JobListQuotesSlot } from "@/components/quotes/JobListQuotesSlot";
import { toast } from "sonner";
import { recheckUnverifiedArrival } from "@/components/job-card/recheckUnverifiedArrival";
import SectionBoundary from "@/components/SectionBoundary";
import { PAGE_COLUMN } from "@/lib/pageColumn";

/** Jobs > Posted / Working (owner, 2026-10-19; embeddedActivity.tsx). `embeddedHeader` is the section's top bar +
 *  tabs; the status boxes sit under it. The old standalone My Posts / My Jobs headers (PostsHeader / JobsHeader,
 *  with their own search field) are gone: no route rendered them once /jobs became the Jobs section (Q2205). */
const Activity = ({ defaultTab = "posted", embeddedHeader }: { defaultTab?: "posted" | "applied"; embeddedHeader: EmbeddedHeader }) => {
  usePageTitle("Jobs — Helpr");
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { user } = useCurrentUser();
  const tab = defaultTab as Tab;
  // Jobs > Posted / Working open on EVERY group ("all"), under the status boxes
  // (owner, 2026-10-19): tap a box = only that group, tap it again = all.
  const defaultFilter = "all";
  // Filter + search seed from URL params (deep links, back/forward); local mirror for typing latency.
  const [searchQuery, setSearchQuery] = useState(() => searchParams.get("q") ?? "");
  const [statusFilter, setStatusFilter] = useState<string>(() => searchParams.get("filter") ?? defaultFilter);

  // Deep-link highlight (/jobs?highlight=<applicationId>): read once, pulse the card, then strip it
  // from the URL (replace) so Back doesn't re-trigger the animation.
  const [highlightAppId, setHighlightAppId] = useState<string | null>(() =>
    defaultTab === "applied" ? (searchParams.get("highlight") ?? null) : null,
  );

  // The POSTER-side twin of `highlightAppId`, keyed by JOB id (PostedJobCard is one-per-job): a `?job=` or
  // `?highlight=` link scrolls to and pulses the named card instead of leaving the poster to re-find it by title.
  const [highlightJobId, setHighlightJobId] = useState<string | null>(() =>
    defaultTab === "posted" ? (searchParams.get("highlight") ?? null) : null,
  );
  const manageJobId = defaultTab === "posted" && searchParams.get("manage") === "1" ? searchParams.get("highlight") : null;
  // `&applicants=1` (the job page's "Review N applicants"): open that job's applicants, not just its card.
  const applicantsJobId = defaultTab === "posted" && searchParams.get("applicants") === "1" ? searchParams.get("highlight") : null;

  // Deep-link to ONE JOB — `?job=<jobId>`.
  //
  // This is the param nearly every notification wants to send, and until now
  // nothing on this screen read it. `notify_on_payment_escrowed` has linked
  // "Payment secured in escrow" / "Job funded" to `/posts?job=<id>` and
  // `/jobs?job=<id>` since 20260824070000 — the route resolved, the param
  // was dropped on the floor, and the reader landed on the default "Needs you"
  // bucket, which for a freshly-funded booking is the one bucket the job is
  // NOT in. 79 rows in prod `notifications` carry that shape.
  //
  // A STATIC filter cannot fix that from the producer side: which bucket a job
  // is in depends on the job's live state (whose move is it?), not on which
  // event fired the notification. So resolve it HERE, where the job is already
  // loaded: find the job, ask activityFilters which bucket it lands in right
  // now, and select that bucket. A deep link is then always right, and stays
  // right as the job moves between buckets.
  //
  // Same treatment for `?highlight=<applicationId>`: a "poster viewed your
  // application" notification highlighted a card that the default filter was
  // hiding, because a pending application buckets to `waiting`, not
  // `needs_you`.
  //
  // `?job=` BEATS `?filter=` when a link carries both.
  //
  // This is a reversal, and the reason it reversed is the whole point of
  // 20260901035600. The old rule was "an explicit bucket in the URL is the
  // caller being specific, and it wins" — reasonable when the URL was the only
  // thing a producer could say anything with. It turned out to be the rule
  // that DEFEATED the two sweeps before it: a producer writing a stale
  // `?filter=` alongside a perfectly good `?job=` got the stale bucket, so
  // passing both was strictly worse than passing neither, and the 66 chip-less
  // prod rows are what that cost.
  //
  // Being specific about a BUCKET is a claim about the job's live state frozen
  // at write time, and it goes stale while the row sits unread. Being specific
  // about a JOB is a fact that stays true. So the job wins, and a `?filter=`
  // on its own still works untouched — which is what keeps every pre-job_id
  // row landing where it always did.
  //
  // NotificationPanel already strips `filter` whenever it resolves from a
  // job_id (notificationDestination.ts), so in practice both params only
  // arrive together from a link minted before this change — an old email or a
  // push notification already sitting on someone's phone. Those are exactly
  // the ones that should now resolve properly rather than honour a dead chip.
  const deepLinkJobId = searchParams.get("job");
  const deepLinkHadFilter = searchParams.get("filter") !== null;
  // Keyed on WHICH deep link was resolved, not a bare "have we resolved once".
  //
  // A boolean meant the resolution was one-shot for the LIFETIME of the
  // component, so tapping a second notification while already sitting on
  // Activity stripped its `?job=` and resolved nothing — the reader stayed on
  // whatever bucket they were already looking at. Every other entry point
  // (cold open, push, email) remounts the page and hid it. Keying on the id
  // makes a genuinely new deep link re-resolve while still making re-runs for
  // the same one a no-op, which is what the ref was there for.
  const deepLinkResolvedFor = useRef<string | null>(null);

  // "Report" on a Done-tab My Posts card — same dialog Browse uses.
  const [reportJobId, setReportJobId] = useState<string | null>(null);

  // Remove ?highlight= from the URL after the first paint. We do this
  // in a microtask so the param is still present when the tab mounts
  // and reads it; by the time the Effect fires the card scroll has
  // already been requested.
  useEffect(() => {
    if (!highlightAppId && !highlightJobId) return;
    const next = new URLSearchParams(searchParams);
    next.delete("highlight");
    next.delete("manage");
    next.delete("applicants");
    setSearchParams(next, { replace: true });
    // Run once on mount — both ids are stable here (useState initial values;
    // the posted branch's later setHighlightJobId cannot fire before this).
  }, []);

  // Mirror filter + search into the URL through the SHARED hook.
  //
  // This screen used to hand-roll the same job in three interacting effects,
  // and it is the reason /jobs and /posts kept crashing into the route
  // error boundary. The failure mode is not obvious: `setSearchParams`
  // navigates unconditionally AND its identity churns on every location
  // change, so an effect that both writes it and depends on it re-arms itself.
  // WebKit throws at ~100 replaceState calls in 10s, which unmounts the route.
  // error_logs shows 19 of the last 20 RouteErrorBoundary entries are exactly
  // that message, across /browse, /jobs and /posts.
  //
  // /browse had the identical bug and was cured by moving onto
  // useSearchParamMirror, which decides OUTSIDE the updater (so the navigator
  // is never called on a no-op) and reaches setSearchParams through a ref (so
  // its identity cannot feed back into the deps). /browse has been clean since.
  // Activity was the last screen still hand-rolling it; this converges it.
  //
  // Empty string means "default" to the hook, so the param is DROPPED rather
  // than written when the filter is at its default and the search is blank —
  // preserving the previous behaviour of keeping a pristine view's URL clean.
  // `highlight` is not listed here and is therefore left untouched by the
  // hook; the one-shot effect above still strips it on mount.
  useSearchParamMirror(
    {
      filter: statusFilter === defaultFilter ? "" : statusFilter,
      q: searchQuery.trim(),
    },
    (read) => {
      const nextFilter = read("filter") || defaultFilter;
      if (nextFilter !== statusFilter) setStatusFilter(nextFilter);
      const nextQuery = read("q");
      if (nextQuery !== searchQuery.trim()) setSearchQuery(nextQuery);
    },
    "activity",
  );

  const {
    loading, loadError, postedJobs, appliedApps, applicantCounts, pendingApplicantCounts, closedApplicantSummaries,
    helperNames, helperAvatars, completedJobMeta,
    helperReviewedJobIds, latestTracking, groupHelpersByJob, refresh,
    // Only THIS tab's data blocks the first card. The other tab's core query
    // is warmed on idle inside the hook, so switching still comes out of cache.
  } = useActivityData(user, tab);
  const activitySettled = useActivitySettled(); // a ?job= link waits for it (Q1563, deepLinkWait.ts)

  // Customer-first-bid push nudge — fires the high-intent re-ask the
  // first time this customer sees at least one applicant on a job they
  // posted. `applicantCounts` is keyed by job id and populated by
  // useActivityData on every fetch (including the realtime-driven
  // invalidations), so the moment a bid lands we're in here. The hook
  // self-suppresses on already-granted, already-shown, or
  // recently-dismissed — so this effect is safe to fire on every load.
  const triggerPushNudge = usePushPermissionNudge();
  useEffect(() => {
    if (!user) return;
    const hasAnyBid = Object.values(applicantCounts).some((n) => n > 0);
    if (!hasAnyBid) return;
    void triggerPushNudge("customer-first-bid");
  }, [user, applicantCounts, triggerPushNudge]);

  // Resolve `?job=` / `?highlight=` to the bucket the target is ACTUALLY in.
  //
  // Runs once, after this tab's data has landed (the job has to exist before
  // its bucket can be asked for). If the target isn't in the list at all — a
  // job from the other side of the app, a stale link — we still drop the param
  // and leave the view on its default rather than pinning a bucket that would
  // be empty for a different reason.
  //
  // The `job` param is stripped in the SAME write that sets `filter`, so the
  // mirror's adopt() pass sees the new bucket already in the URL and can't
  // reset it back to the default in between.
  //
  // (Observed: when a `filter` IS written, useSearchParamMirror's own write
  // effect can re-run off the pre-navigation `search` and put `job` back. That
  // is harmless and deliberately not fought — a second writer racing that hook
  // is what caused the replaceState floods it was built to stop. A lingering
  // `?job=` just means a refresh re-lands on the same bucket, which is what
  // the link asked for.)
  useEffect(() => {
    // Which deep link is this? `?job=` names the job, `?highlight=` names an
    // application; either identifies one card. Resolving is idempotent per
    // key, so a re-run for the SAME link is a no-op while a genuinely new one
    // (a second notification tapped without leaving the page) still resolves.
    const deepLinkKey =
      deepLinkJobId ??
      (highlightAppId ? `app:${highlightAppId}` : null) ??
      (highlightJobId ? `job:${highlightJobId}` : null);
    if (!deepLinkKey) return;
    if (deepLinkResolvedFor.current === deepLinkKey) return;
    if (loading) return;
    const named = tab === "posted"
      ? postedJobs.some((j) => j.id === (deepLinkJobId ?? highlightJobId))
      : appliedApps.some((a) => (deepLinkJobId ? a.job_id === deepLinkJobId : a.id === highlightAppId));
    if (!deepLinkReady({ named, settled: activitySettled })) return;
    deepLinkResolvedFor.current = deepLinkKey;

    let bucket: string | null = null;
    let onList = false;
    if (tab === "posted") {
      const job = deepLinkJobId
        ? postedJobs.find((j) => j.id === deepLinkJobId)
        : (highlightJobId ? postedJobs.find((j) => j.id === highlightJobId) : undefined);
      // A never-paid job is in the raw list but in NO bucket (jobIsUnfundedDraft),
      // so for this page it is not on the list either (Q1668).
      if (job && !jobIsUnfundedDraft(job)) {
        onList = true;
        bucket = postedActivityBucket(job, pendingApplicantCounts?.[job.id] ?? 0);
        // Parity with the applied branch below: name the card, don't just pick
        // the bucket it lives in.
        if (!highlightJobId) setHighlightJobId(job.id);
      }
    } else {
      // `?job=` names the JOB; `?highlight=` names the APPLICATION. Either one
      // identifies the same card on this tab.
      const app =
        (deepLinkJobId ? appliedApps.find((a) => a.job_id === deepLinkJobId) : undefined) ??
        (highlightAppId ? appliedApps.find((a) => a.id === highlightAppId) : undefined);
      if (app) {
        onList = true;
        bucket = appliedActivityBucket(app);
        // Pulse the card we just navigated to, even when the link only knew
        // the job id.
        if (!highlightAppId) setHighlightAppId(app.id);
      }
    }

    // A `?filter=` only wins when the link named NO job — see the note on
    // `deepLinkHadFilter`. With a job in hand the live bucket is the better
    // answer, and honouring a frozen one is what defeated the last two sweeps.
    if (deepLinkHadFilter && !deepLinkJobId) bucket = null;

    // THE LINKED JOB IS NOT ON THIS LIST (Q1668, e2e-journeys 38181872855: a
    // notification about poster-e2e's cancelled, never-paid job opened My Posts
    // on an empty "Needs You" with nothing said, while Waiting held a job).
    // Say so, and set no bucket: the open-on-the-first-bucket rule below
    // waits while a `?job=` link is unresolved, and once `job` leaves the URL
    // it chooses exactly as it does for a plain open.
    if (deepLinkJobId && !onList) {
      toast(`That job is no longer in ${tab === "posted" ? "Posted" : "Working"}.`);
    } else if (tab === "posted" && highlightJobId && !onList) {
      toast(notOnPostedCopy(postedJobs.find((j) => j.id === highlightJobId)));
    }
    const next = new URLSearchParams(searchParams);
    const hadJobParam = next.has("job");
    if (hadJobParam) ["job", "open"].forEach((k) => next.delete(k));
    if (bucket) {
      setStatusFilter(bucket);
      // Mirror it into the URL only when it differs from the default, matching
      // useSearchParamMirror's "empty means default, so drop the param" rule.
      if (bucket === defaultFilter) next.delete("filter");
      else next.set("filter", bucket);
    }
    if (hadJobParam || bucket) setSearchParams(next, { replace: true });
    // Guarded by `deepLinkResolvedFor`, so the churn of `searchParams` and the
    // two lists can't re-run the same resolution. `deepLinkJobId` IS a dep —
    // without it a notification tapped while Activity is already mounted never
    // reaches this effect at all, because none of the data deps change. It
    // cannot loop: the branch above deletes `job` from the URL, which sets
    // `deepLinkJobId` to null and the next run returns on the null key.
  }, [loading, postedJobs, appliedApps, pendingApplicantCounts, deepLinkJobId, activitySettled]);

  // Data-loading + action handlers + dialog/UI state (extracted hook).
  const actions = useActivityActions({
    user,
    postedJobs,
    appliedApps,
    refresh,
    setStatusFilter,
    helperNames,
    completedJobMeta,
  });

  useManageDeepLink(manageJobId, postedJobs, actions);
  useOpenWorkingDeepLink(defaultTab === "applied" ? searchParams : null, appliedApps, actions);
  useReviewApplicantsDeepLink(applicantsJobId, postedJobs, actions.loadApplications, onPostedList);
  const toastClearance = useToastClearance();

  // Status-filter definitions + memoized list/count derivations.
  const { filteredPostedJobs, filteredAppliedApps, appliedCounts, postedCounts, postedSearchCounts, appliedSearchCounts } =
    useActivityFilters({
      postedJobs,
      appliedApps,
      statusFilter,
      searchQuery,
      userId: user?.id,
      pendingApplicantCounts,
    });

  // Pull-to-refresh — refetches this tab's core + detail queries only (the
  // other tab has its own keys and its own idle warm), and each Activity
  // instance ("/posts" vs "/jobs") tracks its own pull-state so one
  // tab's refresh never leaks into the other.
  const tabRefresh = useCallback(async () => {
    // The gesture also re-checks an unverified arrival; not awaited (see recheckUnverifiedArrival.ts).
    if (tab === "applied" && user?.id) recheckUnverifiedArrival(appliedApps, user.id, refresh);
    await refresh();
  }, [refresh, tab, user?.id, appliedApps]);
  const { containerRef, pullDistance, refreshing, isPulling, canTrigger } = usePullToRefresh({
    onRefresh: tabRefresh,
  });

  // On a status-filter change the filtered list shrinks/changes, but the
  // internal scroll container keeps its old offset — landing the user
  // mid-list on results that should start at the top. Reset to the top so
  // the new filter reads from row one.
  useEffect(() => {
    containerRef.current?.scrollTo(0, 0);
  }, [statusFilter, containerRef]);

  // H4 (Cowork audit 2026-10-20): the empty state named the buckets with the
  // old filter labels ("Nothing under scheduled") while the status boxes above
  // it say Upcoming / Booked / Not picked. One name per bucket: the box's.
  const activeStatusFilters = boxLabelledFilters(tab, tab === "posted" ? POSTED_STATUS_FILTERS : APPLIED_STATUS_FILTERS);
  const activeCounts = tab === "posted" ? postedCounts : appliedCounts;

  /* No auto-switch on open. The old My Posts / My Jobs pages opened on the
     first bucket that held anything (owner, 2026-10-08); the Jobs section
     opens on EVERY group instead (owner, 2026-10-19), so there is nothing to
     pick: a link that names a filter or a job keeps what it named. */

  /* "Truly empty" — the underlying list has zero items, not merely filtered
     down to none — USED TO STRIP THE HEADER'S CONTROLS. It no longer strips
     anything; see the note on `activeStatusFilters` below for the screen that
     produced. The distinction itself still matters to the empty-state copy
     (ActivityEmptyState already takes both counts and works it out), so
     nothing here needs to hold it any more. */

  const isWebDesktop = useIsWebDesktop();
  const skeletonShownRef = useRef(false);

  // The entrance animation is for arriving on a page that is already there.
  // After a skeleton it replayed as a fade-to-empty + 8px rise between the
  // skeleton and the cards — one more visible jump (VN-32).
  if (loading) skeletonShownRef.current = true;
  if (loading) return <EmbeddedActivityLoading header={embeddedHeader} tab={tab === "posted" ? "posted" : "applied"} />;

  // The header renders ALWAYS — including on an empty list. It used to be
  // replaced by null, which took the page title down with the filter tabs and
  // left the empty view headless: the panel appeared to lose its identity the
  // moment data resolved to zero, and Activity/Messages both "changed the
  // view of the screen" after load. Owner: the title should still be there.
  //
  // What is genuinely dead on an empty list is the CONTROLS — status tabs and
  // a "0 tasks" count have nothing to act on — so those are what drop out, by
  // passing an empty filter list. Title stays, controls go, layout is stable
  // from first paint whether the list has items or not.
  // One source of truth for "this tab has nothing to list" — the scroll
  // wrapper's padding and the empty-state branch must agree, or the empty
  // card gets inset inside the panel card and doubles the frame.
  const showEmptyState =
    (tab === "posted" && filteredPostedJobs.length === 0) ||
    (tab === "applied" && filteredAppliedApps.length === 0);

  const headerEl = (
    <EmbeddedActivityHeader header={embeddedHeader} tab={tab} statusFilter={statusFilter} counts={activeCounts} onFilter={setStatusFilter} search={searchQuery} onSearch={setSearchQuery} />
  );

  return (
    <>
      {/* ONE BOX on the desktop website (owner: "merge into 1"). The header
          used to be the scaffold's own floating title card, so the screen was
          two stacked liquid-glass boxes with a gap between them saying one
          thing between them. On desktop it is now the panel's first child,
          under a hairline, so the count + controls sit directly on top of the
          cards they describe.

          Phone and native keep the two-card stack: there the header carries
          the VISIBLE page name (no app bar exists to carry it), and that name
          reads as chrome rather than as a row of the list. */}
      <PageScaffold
        animate={!skeletonShownRef.current}
        titleCard={isWebDesktop ? undefined : headerEl}
        titleCardClassName="" oneBlur
      >
          {isWebDesktop && (
            <div
              className="shrink-0 -ml-px -mt-px pb-1"
              style={{ borderBottom: "1px solid hsl(var(--olivewood) / 0.12)" }}
            >
              {headerEl}
            </div>
          )}
          {/* No sr-only <h1> here: the page header's h1 renders on the empty
              list too, so a second one would give the document TWO h1s. */}

          <PullToRefreshWrapper
            ref={containerRef}
            pullDistance={pullDistance}
            refreshing={refreshing}
            isPulling={isPulling}
            canTrigger={canTrigger}
            // Side padding for the list only: the EMPTY state's own `dock` card inset 16px drew TWO
            // nested rounded frames a few px apart (on device, My Jobs / My Posts).
            className={showEmptyState ? "flex-1 min-h-0 pb-0" : "flex-1 min-h-0 px-0 lg:px-4 pt-1 lg:pt-3 pb-0"}
          >
          {showEmptyState ? (
            <>
            {/* Q1465: a $300+ recurring visit awaiting payment shows even on an empty bucket (it lived only in PostedJobsTab, which this branch replaces). */}
            {tab === "posted" && user && <RecurringVisitPayments userId={user.id} className="mx-4 mt-3" />}
            {/* A job whose bank payment is on its way is not a post (no bucket, no count); with nothing else posted its poster lands here (owner, 2026-10-17). */}
            {tab === "posted" && <PendingBankPayments jobs={postedJobs} className="mx-4 mt-3" />}
            <JobListQuotesSlot tab={tab} className="mx-4 mt-3" />
            {/* Empty state — a liquid-glass card that fills the panel and bleeds beneath the
                dock (flat bottom, no hard edge), matching the Dashboard / Messages pattern. */}
            <ActivityEmptyState
              tab={tab}
              loadError={!!loadError}
              postedJobsCount={postedCounts.all}
              appliedAppsCount={appliedApps.length}
              statusFilter={statusFilter}
              hasSearch={!!searchQuery.trim()}
              statusCounts={activeCounts}
              searchMatchCounts={tab === "posted" ? postedSearchCounts : appliedSearchCounts}
              statusLabels={activeStatusFilters}
              onRetry={refresh}
              onNavigate={navigate}
              onSelectStatusFilter={setStatusFilter}
              onClearSearch={() => setSearchQuery("")}
            />
            </>
          ) : (
            /* `min-h-full flex flex-col` so a SHORT list can fill the panel.
               PageScaffold's panel is a fixed-height liquid-glass card, so a
               one-card view left ~426px of blank card stock above the nav at
               375 — measured, and the owner's "roughly half the screen empty".
               Giving this wrapper the panel's full height lets the tab's
               end-of-list block take the slack with `mt-auto`/`flex-1` instead
               of the void taking it (`min-h-`, so a full list still grows). */
            /* The one page column (owner 2026-10-21: the list as wide as the Jobs header); a live toast never covers a card (lead 10-20). */
            <div
              className={`min-h-full flex flex-col ${PAGE_COLUMN}`}
              style={{ paddingBottom: `calc(var(--safe-area-bottom, 0px) + var(--bottom-nav-h, 96px) + ${toastClearance}px)` }}
            >
          <JobListQuotesSlot tab={tab} />{/* the member's quotes, behind the 'quotes' switch (owner 2026-10-19) */}
          {/* Jobs waiting for the poster's bank payment: shown, never bucketed. */}
          {tab === "posted" && <PendingBankPayments jobs={postedJobs} className="mb-3" />}
          {tab === "posted" && (
            /* `space-y-list` (12px, Q213a), which is what PostedJobsTab and the grouped
               ActivitySectionedView both use. It said `space-y-2.5` — 10px
               against the real 12px — the same 2px-per-row drift
               ActivityPageSkeleton was fixed for on 2026-09-21; a gap is part
               of the reservation. */
            <Suspense fallback={
              <div className="px-0 space-y-list">
                {[1, 2, 3, 4].map((i) => <ActivityCardSkeleton key={i} />)}
              </div>
            }>
            <SectionBoundary label="your posts">
            <PostedJobsTab
              groupByStatus={statusFilter === "all"}
              jobs={filteredPostedJobs}
              highlightJobId={highlightJobId}
              applicantCounts={applicantCounts}
              pendingApplicantCounts={pendingApplicantCounts} closedApplicantSummaries={closedApplicantSummaries}
              expandedJobIds={actions.expandedJobIds}
              toggleExpandedJobId={actions.toggleExpandedJobId}
              helperNames={helperNames}
              helperAvatars={helperAvatars}
              completedJobMeta={completedJobMeta}
              latestTracking={latestTracking}
              groupHelpersByJob={groupHelpersByJob}
              userId={user!.id}
              onBoost={actions.setBoostJobId}
              onEdit={actions.setEditJob}
              onCancel={actions.tryCancelJob}
              onComplete={actions.completeJob}
              completingJobId={actions.completingJobId}
              onNoShow={actions.setNoShowJobId}
              onTip={actions.tip.open}
              onReview={actions.openReviewForPosted}
              onDispute={actions.setDisputeJob}
              onReport={(job) => setReportJobId(job.id)}
              onViewDispute={actions.setViewDisputeJob}
              onConfirmArrival={actions.confirmArrival}
              confirmingArrivalJobId={actions.confirmingArrivalJobId}
              onConfirmWorking={actions.confirmWorking}
              confirmingWorkingJobId={actions.confirmingWorkingJobId}
              onLoadApplications={actions.loadApplications}
              selectedJob={actions.selectedJob}
              setSelectedJob={actions.setSelectedJob}
              applications={actions.applications}
              applicationsLoading={actions.applicationsLoading}
              applicationsError={actions.applicationsError}
              onAcceptApplication={actions.acceptApplication}
              onDeclineApplication={actions.declineApplication}
              onLoadInlineApplicants={actions.loadInlineApplicants}
              inlineApplicants={actions.inlineApplicants}
              loadingApplicants={actions.loadingApplicants}
              applicantErrors={actions.applicantErrors}
              onActionComplete={refresh}
            />
            </SectionBoundary>
            </Suspense>
          )}

          {tab === "applied" && (
            /* `space-y-list` (12px, Q213a), as AppliedJobsTab and the grouped view (the 2px drift fixed above). */
            <Suspense fallback={
              <div className="px-0 space-y-list">
                {[1, 2, 3, 4].map((i) => <ApplicationCardSkeleton key={i} />)}
              </div>
            }>
            <SectionBoundary label="your jobs">
            <AppliedJobsTab
              groupByStatus={statusFilter === "all"}
              apps={filteredAppliedApps}
              highlightAppId={highlightAppId}
              expandedJobIds={actions.expandedJobIds}
              toggleExpandedJobId={actions.toggleExpandedJobId}
              helperReviewedJobIds={helperReviewedJobIds}
              latestTracking={latestTracking}
              userId={user!.id}
              onHelperResponse={actions.handleHelperResponse}
              respondingHelperAppId={actions.respondingHelperAppId}
              onComplete={actions.completeJob}
              completingJobId={actions.completingJobId}
              onResolveRevision={actions.resolveRevision}
              onHelperReview={(jobId, posterId, posterName) => actions.setHelperReviewJob({ jobId, posterId, posterName })}
              onDispute={actions.setDisputeJob}
              onViewDispute={actions.setViewDisputeJob}
              onRefresh={refresh}
            />
            </SectionBoundary>
            </Suspense>
          )}
            </div>
          )}
          </PullToRefreshWrapper>
      </PageScaffold>

      <ActivityDialogs
        user={user ? { id: user.id } : null}
        editJob={actions.editJob}
        setEditJob={actions.setEditJob}
        boostJobId={actions.boostJobId}
        setBoostJobId={actions.setBoostJobId}
        tip={actions.tip}
        noShowJobId={actions.noShowJobId}
        setNoShowJobId={actions.setNoShowJobId}
        onNoShow={actions.handleNoShow}
        reportingNoShow={actions.reportingNoShow}
        cancelDialogJob={actions.cancelDialogJob}
        setCancelDialogJob={actions.setCancelDialogJob}
        completionPromptJob={actions.completionPromptJob}
        setCompletionPromptJob={actions.setCompletionPromptJob}
        deadlineDialogApp={actions.deadlineDialogApp}
        setDeadlineDialogApp={actions.setDeadlineDialogApp}
        onDeadlineConfirm={actions.confirmAcceptWithDeadline}
        deadlineJob={actions.selectedJob}
        disputeJob={actions.disputeJob}
        setDisputeJob={actions.setDisputeJob}
        viewDisputeJob={actions.viewDisputeJob}
        setViewDisputeJob={actions.setViewDisputeJob}
        reviewJob={actions.reviewJob}
        reviewTarget={actions.reviewTarget}
        setReviewJob={actions.setReviewJob}
        setReviewTarget={actions.setReviewTarget}
        helperReviewJob={actions.helperReviewJob}
        setHelperReviewJob={actions.setHelperReviewJob}
        groupHelpersByJob={groupHelpersByJob}
        helperNames={helperNames}
        onRefresh={refresh}
      />
      <ActivityOfferDialogs actions={actions} />
      {reportJobId && (
        <Suspense fallback={null}>
          <ReportDialog
            open={!!reportJobId}
            onClose={() => setReportJobId(null)}
            reportedType="job"
            reportedId={reportJobId}
          />
        </Suspense>
      )}
    </>
  );
};

export default Activity;
