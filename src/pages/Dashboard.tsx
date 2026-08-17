import { useState, useCallback, useEffect, useRef, lazy, Suspense } from "react";
import type { FeedDensity } from "@/components/dashboard/feedDensity";

import { usePullToRefresh } from "@/hooks/usePullToRefresh";
import { useNavigate, useSearchParams } from "react-router-dom";
import { signOutWithPushCleanup } from "@/lib/authSignOut";
import { PageScaffold } from "@/components/ui/PageScaffold";
import { toast } from "sonner";
import { DashboardSkeleton } from "@/components/SkeletonLoaders";
import { useRealtimePush } from "@/hooks/useRealtimePush";
import { usePageTitle } from "@/hooks/usePageTitle";
import { DashboardTitleBar } from "@/components/dashboard/DashboardTitleBar";
import DashboardInProgressBadge from "@/components/dashboard/DashboardInProgressBadge";
import { BrowseTasksToolbar } from "@/components/dashboard/BrowseTasksToolbar";
import { BrowseTasksFeed } from "@/components/dashboard/BrowseTasksFeed";
import { useIsWebDesktop } from "@/components/DesktopSidebarNav";
import { Skeleton } from "@/components/ui/skeleton";
import { YourHelpersRow } from "@/components/dashboard/YourHelpersRow";
import BroadcastBanner from "@/components/BroadcastBanner";
import DashboardStatusBanners from "@/components/dashboard/DashboardStatusBanners";
import PayItForwardTeaser from "@/components/dashboard/PayItForwardTeaser";
import { DashboardBannedScreen, DashboardDeniedScreen } from "@/components/dashboard/DashboardBlockedScreen";

// Dialogs and overlays — none are visible on first paint. Each is code-split
// and only the dialogs the user actually opens get fetched, keeping the
// Dashboard route chunk small.
const JobDetailDialog = lazy(() => import("@/components/dashboard/JobDetailDialog"));
const JobQuickActionSheet = lazy(() => import("@/components/dashboard/JobQuickActionSheet").then(m => ({ default: m.JobQuickActionSheet })));
const ApplyConfirmDialog = lazy(() => import("@/components/dashboard/ApplyConfirmDialog").then(m => ({ default: m.ApplyConfirmDialog })));
const ReportDialog = lazy(() => import("@/components/ReportDialog"));
const PayoutSetupDialog = lazy(() => import("@/components/PayoutSetupDialog"));
const OnboardingTour = lazy(() => import("@/components/OnboardingTour"));
const BirthdayPopup = lazy(() => import("@/components/BirthdayPopup"));
const WelcomeModal = lazy(() => import("@/components/dashboard/WelcomeModal"));
// Map column for the web-desktop two-pane (leaflet is heavy — lazy so the
// phone/native feed never pays for it).
const BrowseMap = lazy(() => import("@/components/BrowseMap").then(m => ({ default: m.BrowseMap })));
import SectionBoundary from "@/components/SectionBoundary";
import { useDashboardData } from "@/hooks/useDashboardData";
import { usePrefetchUserData } from "@/hooks/usePrefetchUserData";
import { useDashboardFilters } from "@/hooks/useDashboardFilters";
import { safeStorage } from "@/lib/safeStorage";
import { usePersistedBrowseView } from "@/hooks/usePersistedBrowseView";
import { useJobRef } from "@/hooks/useJobRef";
import type { HelperAvailabilitySlot } from "./dashboard/dashboardTypes";
import { QuickApplyHandler } from "./dashboard/QuickApplyHandler";
import { useDashboardSideQueries } from "./dashboard/useDashboardSideQueries";
import { useSaveJob } from "./dashboard/useSaveJob";
import { useApplyFlow } from "./dashboard/useApplyFlow";
import { useDetailJob } from "./dashboard/useDetailJob";
import { DismissJobDialog } from "./dashboard/DismissJobDialog";


// PageScaffold's title card defaults to `py-4 lg:py-5`, which is sized for a
// two-line greeting block. Home's title card holds a single row of 44px
// controls (emblem + feed actions + bell), so the default padding would leave
// it floating in ~32px of dead space. `!` because both paddings are
// same-specificity utilities — class order in the attribute does not decide
// the winner, stylesheet order does.
const TITLE_BAR_PADDING = "!py-2 lg:!py-2.5";

const Dashboard = () => {
  const navigate = useNavigate();
  usePageTitle("Dashboard — Helpr");
  const [searchParams, setSearchParams] = useSearchParams();
  // Capture ?ref= attribution from deep-links (push notifications, share
  // links, etc.) so analytics can attribute which surface drove the open.
  useJobRef();

  const {
    user, profile, isAdmin, loading, helprTier, allJobs, platformFee,
    helperAvailability, recommendedJobs, refresh, loadError,
    fetchNextPage, hasNextPage, isFetchingNextPage,
  } = useDashboardData();

  // Sentinel for infinite scroll — fires fetchNextPage when ~80% of the list is in view.
  const loadMoreRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const node = loadMoreRef.current;
    if (!node || !hasNextPage || isFetchingNextPage) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) fetchNextPage();
      },
      // rootMargin pulls the trigger ~20% of viewport early (~80% scroll point)
      { root: null, rootMargin: "0px 0px 20% 0px", threshold: 0 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage, allJobs.length]);

  const { containerRef, pullDistance, refreshing, isPulling } = usePullToRefresh({
    onRefresh: refresh,
  });

  useRealtimePush(user?.id ?? null);
  // Warm Referral / Activity / Jobs caches in the background — makes the next tap feel instant.
  usePrefetchUserData(user?.id);

  const filters = useDashboardFilters({
    allJobs, userId: user?.id, profile, helprTier, helperAvailability: helperAvailability as HelperAvailabilitySlot[],
  });

  // The greeting card's "stat of the day" line was removed — it added a
  // third line to the title card and pushed the job feed down. The
  // headline job count it surfaced still shows in the date eyebrow.

  // First-run welcome modal — shown once for accounts < 7 days old that
  // haven't dismissed it yet. Computed lazily from localStorage + profile
  // so it's stable after the first render; profile?.created_at is checked
  // below in a separate effect to re-evaluate once the profile loads.
  const [showWelcome, setShowWelcome] = useState(false);
  useEffect(() => {
    if (loading) return; // wait for profile to resolve
    if (typeof window === "undefined") return;
    if (localStorage.getItem("helpr_welcomed")) return;
    if (!profile?.created_at) return;
    const ageDays =
      (Date.now() - new Date(profile.created_at).getTime()) / 86_400_000;
    if (ageDays < 7) setShowWelcome(true);
  }, [loading, profile?.created_at]);

  const handleWelcomeDismiss = useCallback(() => {
    try { localStorage.setItem("helpr_welcomed", "1"); } catch { /* private-browsing / quota — ignore */ }
    setShowWelcome(false);
  }, []);

  const [reportJobId, setReportJobId] = useState<string | null>(null);
  // Detail-dialog open/close lifecycle (which job, feed-scroll restore, and
  // ?job=<id> URL mirroring) lives in useDetailJob.
  const { detailJob, openDetailJob, closeDetailJob } = useDetailJob({
    containerRef, searchParams, setSearchParams, allJobs,
  });
  // Quick-action sheet — opened by a long-press on a JobCard. Lets the
  // helpr save / hide / share / report without committing to opening
  // the full detail dialog. Null = sheet closed.
  const [quickActionJobId, setQuickActionJobId] = useState<string | null>(null);
  const [expandedCardId, setExpandedCardId] = useState<string | null>(null);
  // List vs Map view. The map shows the same open jobs as the list,
  // pinned to neighborhood-rounded coords (privacy via the
  // get_open_jobs_for_map RPC). Toggle persists for the session only —
  // resetting to "list" on next mount matches user expectation that
  // the default landing surface is the curated feed.
  const [view, setView] = usePersistedBrowseView("list");

  // Web desktop (≥1024px, non-native) composes the feed and the map
  // side by side, so the list/map toggle is meaningless there and the
  // feed is locked to "list" — the map always occupies its own column.
  const isWebDesktop = useIsWebDesktop();

  // Feed density — comfortable (full cards) or compact (48px rows). Read from
  // any persisted preference; the in-toolbar toggle was removed for a cleaner
  // Browse Tasks header, so this is now read-only (defaults to comfortable).
  const [density] = useState<FeedDensity>(() => {
    try {
      const stored = window.localStorage.getItem("job-feed-density");
      return stored === "compact" || stored === "comfortable" ? stored : "comfortable";
    } catch { return "comfortable"; }
  });

  // Desktop split-screen hover sync — hovering a list card scales up the
  // corresponding map pin. null = no card hovered.
  const [hoveredJobId, setHoveredJobId] = useState<string | null>(null);

  const [payoutSetupDialogOpen, setPayoutSetupDialogOpen] = useState(false);
  const [confirmDismissJobId, setConfirmDismissJobId] = useState<string | null>(null);
  const confirmDismissJob = allJobs.find((j) => j.id === confirmDismissJobId) || null;

  // Pay It Forward — count of available credits in the user's parish.
  // Shown as a teaser banner above the community teaser when > 0.
  // PGRST202-safe: table may not be on prod yet between merge + db push.
  const userParish = profile?.parish ?? null;

  const {
    pifCount, upcomingJob,
    savedJobIds, setSavedJobIds, dismissedJobIds, setDismissedJobIds,
  } = useDashboardSideQueries({ userId: user?.id, userParish, allJobs });

  // Profile-completion is no longer nudged on the home feed — the full
  // "Finish your profile" card pushed the job feed below the fold. The
  // completion checklist / progress meter lives on the Profile landing
  // screen instead (ProfileLanding's completion meter), which is the
  // surface the user navigates to in order to act on it.

  const effectiveFee = platformFee;

  const { handleToggleSave } = useSaveJob({ user, savedJobIds, setSavedJobIds });

  const {
    confirmApplyJobId, setConfirmApplyJobId, confirmApplyJob,
    applyMessage, setApplyMessage, applyLoading, applyFiles, setApplyFiles,
    bidPrice, setBidPrice,
    handleApplyRequest, handleApplyConfirm,
  } = useApplyFlow({ user, allJobs });

  const handleDismissRequest = useCallback((jobId: string) => {
    setConfirmDismissJobId(jobId);
  }, []);

  const handleLongPressCard = useCallback((jobId: string) => {
    setQuickActionJobId(jobId);
  }, []);

  const handleDismissConfirm = useCallback(() => {
    if (!confirmDismissJobId) return;
    setDismissedJobIds(prev => {
      const next = new Set(prev);
      next.add(confirmDismissJobId);
      safeStorage.setItem("helpr_dismissed_jobs", JSON.stringify([...next]));
      return next;
    });
    toast.success("Job removed from your feed.");
    setConfirmDismissJobId(null);
  }, [confirmDismissJobId, setDismissedJobIds]);

  if (loading) {
    // Loading state mirrors the *exact* loaded layout: the same
    // PageScaffold two-card shell (brand title card over a raised panel)
    // with a skeleton body, not a bare AppShell + stack of cards.
    // Sharing the scaffold means the title card and panel keep their
    // size and position, so when the data resolves the feed settles in
    // place instead of popping in and shoving everything down. The title
    // bar is the REAL one rather than a skeleton: it is static chrome
    // (emblem + bell) that needs none of the pending data, so rendering
    // the placeholder would only make it flicker into itself.
    return (
      <PageScaffold
        animate
        panelElevation="raised"
        titleCard={
          <DashboardTitleBar
            filters={filters}
            user={user}
            view={isWebDesktop ? "list" : view}
            setView={setView}
            hideViewToggle={isWebDesktop}
          />
        }
        titleCardClassName={TITLE_BAR_PADDING}
      >
        <DashboardSkeleton />
      </PageScaffold>
    );
  }

  // Prefer the profile's stored full name, then auth metadata, then the email
  // local-part — never fall back to the literal word "User" in greetings.
  const rawName =
    (profile?.full_name && profile.full_name.trim()) ||
    (user?.user_metadata?.full_name && String(user.user_metadata.full_name).trim()) ||
    (user?.user_metadata?.name && String(user.user_metadata.name).trim()) ||
    "";
  const emailLocal = user?.email ? user.email.split("@")[0] : "";
  const firstName = (rawName || emailLocal || "there").split(" ")[0];
  const approvalStatus = profile?.approval_status;
  const banStatus = profile?.ban_status || "active";

  // Block banned users
  if (!isAdmin && (banStatus === "permanently_banned" || banStatus === "temp_banned")) {
    return <DashboardBannedScreen banStatus={banStatus} />;
  }

  // Progressive activation: a `pending` user is NOT walled out of the
  // dashboard. They can browse, save and apply while review runs — the
  // verification gate fires only at the moments that genuinely need it
  // (IDV-before-accept in Activity.tsx, payout setup). A non-blocking
  // "under review" banner is rendered in `beforePanel` below instead.
  //
  // `denied` is still a hard stop here as defense-in-depth — ProtectedRoute
  // already redirects denied users to /account-denied before this renders,
  // but if that ever fails to fire we must not leak the feed to them.
  if (!isAdmin && profile && approvalStatus === "denied") {
    const handleSignOut = async () => {
      await signOutWithPushCleanup();
      navigate("/login", { replace: true });
    };
    return <DashboardDeniedScreen onSignOut={handleSignOut} />;
  }

  const isPendingReview = !isAdmin && !!profile && approvalStatus === "pending";



  return (
    <>
    <PageScaffold
      animate
      panelElevation="raised"
      // No `header` — Home carries no app bar, matching Messages / My Jobs /
      // My Posts. The brand emblem and the bell moved into the title card
      // below; the page's own name is the toolbar's "Browse jobs" h1 inside
      // the panel. PageScaffold takes on the top safe-area inset itself when
      // no header is passed.
      titleCard={
        <DashboardTitleBar
          filters={filters}
          user={user}
          view={isWebDesktop ? "list" : view}
          setView={setView}
          hideViewToggle={isWebDesktop}
        />
      }
      titleCardClassName={TITLE_BAR_PADDING}
      aboveTitle={<BroadcastBanner />}
      beforePanel={
        <>
          <DashboardStatusBanners
            isPendingReview={isPendingReview}
            onPendingClick={() => navigate("/account-pending")}
          />

          {/* Quick-rebook strip — the customer's saved helprs, one tap
              from a direct offer. Self-hides when there are none.
              Wrapped in a SectionBoundary so a flaky `saved_helpers`
              query can't red-screen the whole Dashboard tab. */}
          <SectionBoundary label="your helpers">
            <YourHelpersRow />
          </SectionBoundary>
          {/* The "Finish your profile" completion nudge used to render
              here. It moved off the home feed onto the Profile landing
              screen (ProfileLanding's completion meter) so the job feed
              is no longer pushed below the fold. */}

          {/* Promo/nudge banner slot intentionally empty — the home screen
              shows the greeting, the saved-helpers row, "For you", and the
              job feed with no marketing/upsell cards in between. */}
        </>
      }
    >
            {/* The standalone "For you" carousel was removed: it duplicated
                the job feed (same jobs as Browse at low inventory) and ate a
                whole horizontal band. Personalization now lives in the single
                Browse feed as ORDER — the "Picked for you" group surfaces
                relevance-ranked jobs at the top, then "Everything else". One
                clean, personalized, vertical list; no duplication. */}

            <BrowseTasksToolbar
              filters={filters}
              user={user}
              helperAvailability={helperAvailability}
              view={view}
              setView={setView}
              hideViewToggle={isWebDesktop}
              // The icon cluster lives one row up, in the title card, beside
              // the emblem and the bell — so this row carries only the large
              // "Browse jobs" h1 (and the live-job pill opposite it).
              hideActions
              titleRowTrailing={
                <DashboardInProgressBadge
                  job={upcomingJob}
                  // An in-progress job is one the user is DOING, so this
                  // belongs on the applied/"My Jobs" side. It previously
                  // pointed at `/activity?tab=myjobs` — a redirect that drops
                  // the query string, to a tab name that never existed
                  // (Activity only accepts "posted" | "applied") — so it
                  // always landed on My Posts.
                  onView={() => navigate("/my-jobs")}
                />
              }
              onClearAllFilters={() => {
                // After clearing filters, snap the feed back to the top
                // so the user lands on the fresh unfiltered head of the
                // list rather than mid-scroll where the old filter ended.
                const el = containerRef.current;
                if (el) el.scrollTo({ top: 0, behavior: "smooth" });
              }}
            />

            {/* Browse-tasks feed is the main scroll surface of the
                dashboard. Wrap so a render error in any job card (rare,
                but cheap insurance) shows an inline retry banner inside
                the panel rather than blanking the entire route. The
                page-level ErrorBoundary above still catches anything
                that escapes this. */}
            <SectionBoundary label="the job feed">
              {/* The job feed fills the frame. The map is reached via the
                  toolbar list/map toggle (BrowseMap inside BrowseTasksFeed),
                  not a side panel — a fixed split-screen map clipped at the
                  edge of the centered phone-width frame. */}
              <div className="flex flex-1 min-h-0 overflow-hidden">
                <div className="flex-1 min-w-0 overflow-hidden flex flex-col">
                  <BrowseTasksFeed
                    view={isWebDesktop ? "list" : view}
                    density={density}
                    filters={filters}
                    user={user}
                    allJobs={allJobs}
                    loadError={loadError}
                    refresh={refresh}
                    recommendedJobs={recommendedJobs}
                    // Reserve the "Picked for you" slot with skeletons only while a
                    // pull-to-refresh re-derives recommendations and no picks exist
                    // yet, so the empty→filled swap doesn't shove the list down (CLS).
                    // NOT keyed on isFetchingNextPage: the recommended section belongs
                    // to the first page only, so infinite-scroll pagination would
                    // otherwise flash two placeholder cards at the top of the feed
                    // every time the next page loads with zero recommendations.
                    recommendedLoading={refreshing}
                    dismissedJobIds={dismissedJobIds}
                    effectiveFee={effectiveFee}
                    handleApplyRequest={handleApplyRequest}
                    handleDismissRequest={handleDismissRequest}
                    handleToggleSave={handleToggleSave}
                    handleLongPressCard={handleLongPressCard}
                    confirmDismissJobId={confirmDismissJobId}
                    expandedCardId={expandedCardId}
                    setExpandedCardId={setExpandedCardId}
                    savedJobIds={savedJobIds}
                    setReportJobId={setReportJobId}
                    setDetailJob={openDetailJob}
                    containerRef={containerRef}
                    pullDistance={pullDistance}
                    refreshing={refreshing}
                    isPulling={isPulling}
                    loadMoreRef={loadMoreRef}
                    hasNextPage={hasNextPage}
                    isFetchingNextPage={isFetchingNextPage}
                    fetchNextPage={fetchNextPage}
                    hoveredJobId={hoveredJobId}
                    setHoveredJobId={setHoveredJobId}
                  />
                </div>
                {/* Web-desktop only: the map rides alongside the feed in its
                    own column rather than hiding behind a toggle. The page
                    frame is full-width here (PageScaffold desktop), so the
                    map has real room and doesn't clip at a phone-width edge
                    the way the old side-map did (#12). */}
                {isWebDesktop && (
                  <div
                    className="w-[48%] shrink-0 min-h-0 flex flex-col pl-3 pt-2"
                    style={{ borderLeft: "1px solid hsl(var(--olivewood) / 0.12)" }}
                  >
                    <Suspense fallback={<Skeleton className="h-full w-full rounded-2xl" />}>
                      <BrowseMap
                        onJobAction={handleApplyRequest}
                        ctaLabel="Apply"
                        currentUserId={user?.id}
                      />
                    </Suspense>
                  </div>
                )}
              </div>
            </SectionBoundary>

            {/* Pay It Forward teaser — only shown when credits exist in the user's parish */}
            <PayItForwardTeaser pifCount={pifCount} />

    </PageScaffold>

      {/* Dialog chunks load on demand — only mounted once the user opens
          them, so the Dashboard route chunk doesn't carry them. */}
      {detailJob && (
        <Suspense fallback={null}>
          <JobDetailDialog
            job={detailJob}
            effectiveFee={effectiveFee}
            allJobs={allJobs}
            isSaved={detailJob ? savedJobIds.has(detailJob.id) : false}
            onToggleSave={handleToggleSave}
            userLat={filters.userLoc?.status === "ready" ? filters.userLoc.lat : null}
            userLng={filters.userLoc?.status === "ready" ? filters.userLoc.lng : null}
            onClose={closeDetailJob}
            onApply={handleApplyRequest}
            onReport={setReportJobId}
            onSelect={openDetailJob}
          />
        </Suspense>
      )}

      {reportJobId && (
        <Suspense fallback={null}>
          <ReportDialog open={!!reportJobId} onClose={() => setReportJobId(null)} reportedType="job" reportedId={reportJobId} />
        </Suspense>
      )}

      {/* Long-press quick-action sheet. Lazy-loaded so the small extra
          bundle only ships once a helpr actually long-presses a card. */}
      {quickActionJobId && (() => {
        const qaJob = allJobs.find((j) => j.id === quickActionJobId);
        if (!qaJob) return null;
        return (
          <Suspense fallback={null}>
            <JobQuickActionSheet
              job={{ id: qaJob.id, title: qaJob.title, budget: qaJob.budget, category: qaJob.category }}
              isSaved={savedJobIds.has(qaJob.id)}
              onClose={() => setQuickActionJobId(null)}
              onToggleSave={handleToggleSave}
              onHide={handleDismissRequest}
              onReport={setReportJobId}
            />
          </Suspense>
        );
      })()}

      {/* Birthday greeting — a popup, not chrome. It used to be mounted as a
          sibling of the (now removed) app bar inside PageScaffold's `header`
          slot; it lives with the other overlays now. Still mounted on every
          Dashboard render — it self-hides unless today is the user's birthday. */}
      <Suspense fallback={null}>
        <BirthdayPopup dateOfBirth={profile?.date_of_birth} firstName={firstName} />
      </Suspense>

      <Suspense fallback={null}>
        <OnboardingTour profileCreatedAt={profile?.created_at} />
      </Suspense>
      <QuickApplyHandler searchParams={searchParams} user={user} allJobs={allJobs} onApply={handleApplyRequest} />


      {confirmApplyJobId && (
        <Suspense fallback={null}>
          <ApplyConfirmDialog
            open={!!confirmApplyJobId}
            onClose={() => setConfirmApplyJobId(null)}
            confirmApplyJob={confirmApplyJob}
            platformFee={platformFee}
            applyMessage={applyMessage}
            setApplyMessage={setApplyMessage}
            applyFiles={applyFiles}
            setApplyFiles={setApplyFiles}
            applyLoading={applyLoading}
            bidPrice={bidPrice}
            setBidPrice={setBidPrice}
            handleApplyConfirm={handleApplyConfirm}
          />
        </Suspense>
      )}

      <DismissJobDialog
        confirmDismissJobId={confirmDismissJobId}
        confirmDismissJob={confirmDismissJob}
        onOpenChange={(open) => { if (!open) setConfirmDismissJobId(null); }}
        onConfirm={handleDismissConfirm}
      />
      {payoutSetupDialogOpen && (
        <Suspense fallback={null}>
          <PayoutSetupDialog open={payoutSetupDialogOpen} onOpenChange={setPayoutSetupDialogOpen} />
        </Suspense>
      )}

      {/* Floating-FAB removed — MobileNav already renders a Post FAB at the
          right edge of the bottom dock. Two FABs at the same screen corner
          was the "stacked plus buttons" bug visible in TestFlight build
          screenshots. Desktop surfaces the CTA in the header (md:flex)
          so no desktop replacement is needed. */}

      {/* First-run welcome modal — lazy-loaded; only mounts for new users
          (accounts < 7 days) who haven't dismissed it yet. Dismissed state
          persists to localStorage so it never shows again after first close. */}
      {showWelcome && (
        <Suspense fallback={null}>
          <WelcomeModal open={showWelcome} onDismiss={handleWelcomeDismiss} />
        </Suspense>
      )}
    </>
  );
};

export default Dashboard;
