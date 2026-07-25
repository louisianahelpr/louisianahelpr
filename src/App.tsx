import { lazy, Suspense, forwardRef, useEffect, useState, type ReactElement } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes, Navigate, useLocation } from "react-router-dom";
import { SpeedInsights } from "@vercel/speed-insights/react";
import { Analytics } from "@vercel/analytics/react";

import { persistOptions } from "@/lib/queryPersister";
// Shared singleton so the SIGNED_OUT handler in main.tsx can wipe the
// same cache the provider wraps. See src/lib/queryClient.ts.
import { queryClient } from "@/lib/queryClient";

import ErrorBoundary from "@/components/ErrorBoundary";
import RouteErrorBoundary from "@/components/RouteErrorBoundary";
import RouteSuspenseFallback from "@/components/RouteSuspenseFallback";
import GuestBrowseSkeleton from "@/components/GuestBrowseSkeleton";
// OfflineBanner statically imports WifiOff from lucide-react, which would
// otherwise pull the entire lucide chunk onto the critical initial load path.
// It's only ever visible when the network drops (rare), so lazy-loading is safe.
const OfflineBanner = lazy(() => import("@/components/OfflineBanner"));
import { OfflineBannerLayoutProvider } from "@/lib/offlineBannerLayout";
import { useSessionTimeout } from "@/hooks/useSessionTimeout";
import { useLoginTracking } from "@/hooks/useLoginTracking";
import { useNativePushSetup } from "@/lib/nativePush";
import { useDynamicTypeSync, OS_LARGE_TEXT_THRESHOLD } from "@/lib/accessibility";
import { useCppVariantRouter } from "@/lib/cppRouting";
import NativeLaunchRouter from "@/components/NativeLaunchRouter";
import { useAppShellViewport } from "@/hooks/useAppShellViewport";
import { useStatusBarStyle } from "@/hooks/useStatusBarStyle";
import { useAppLifecycle } from "@/lib/appLifecycle";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useDarkMode } from "@/hooks/useDarkMode";

// Toaster, Sonner and TooltipProvider pull in sonner + @radix-ui/react-toast +
// @radix-ui/react-tooltip + @floating-ui (~14 KB gzipped of
// otherwise-unused JS on the landing page where no toast fires and no tooltip
// is visible). Lazy-loading them keeps the libs out of the critical entry
// bundle — they hydrate after first paint when the wrappers actually mount.
const Toaster = lazy(() =>
  import("@/components/ui/toaster").then((m) => ({ default: m.Toaster }))
);
const Sonner = lazy(() =>
  import("@/components/ui/sonner").then((m) => ({ default: m.Toaster }))
);
// Global host for the imperative SuccessMoment overlay (job posted /
// applicant hired / job completed). Lazy + deferred for the same
// critical-path reason as the toasters above — framer-motion isn't on
// the landing-page hot path.
const SuccessMomentHost = lazy(() => import("@/components/feedback/SuccessMomentHost"));
// PageTransition and ScrollToTop both import framer-motion. Lazy-loading
// them breaks the static App.tsx → framer-motion import chain so the
// "motion" chunk stays off the synchronous critical path.
const PageTransition = lazy(() => import("@/components/PageTransition"));
const ScrollToTop = lazy(() => import("@/components/ScrollToTop"));
const MobileNav = lazy(() => import("./components/MobileNav"));
const DesktopSidebarNav = lazy(() => import("./components/DesktopSidebarNav"));
const PermissionRationaleDialog = lazy(() =>
  import("@/components/PermissionRationaleDialog").then((m) => ({ default: m.PermissionRationaleDialog }))
);
// Fires when the authed user's terms_version_accepted is older than
// LATEST_TERMS_VERSION. Lazy — the dialog chunk is only fetched when a
// version bump actually needs it (which is rare and out of the hot path).
const TermsReconsentDialog = lazy(() =>
  import("@/components/TermsReconsentDialog").then((m) => ({ default: m.TermsReconsentDialog }))
);

// Lazy load all pages including landing
const Index = lazy(() => import("./pages/Index"));

// Lazy load all other pages
const Login = lazy(() => import("./pages/Login"));
const Signup = lazy(() => import("./pages/Signup"));
const SignupPending = lazy(() => import("./pages/SignupPending"));
const CompleteProfile = lazy(() => import("./pages/CompleteProfile"));
const AccountPending = lazy(() => import("./pages/AccountPending"));
const AccountDenied = lazy(() => import("./pages/AccountDenied"));
const AccountBanned = lazy(() => import("./pages/AccountBanned"));
const ForgotPassword = lazy(() => import("./pages/ForgotPassword"));
const ResetPassword = lazy(() => import("./pages/ResetPassword"));
const Dashboard = lazy(() => import("./pages/Dashboard"));
const Profile = lazy(() => import("./pages/Profile"));
const PostJob = lazy(() => import("./pages/PostJob"));
const PaymentSuccess = lazy(() => import("./pages/PaymentSuccess"));
const UserProfile = lazy(() => import("./pages/UserProfile"));
const Admin = lazy(() => import("./pages/Admin"));
const Activity = lazy(() => import("./pages/Activity"));
const Messages = lazy(() => import("./pages/Messages"));

const Legal = lazy(() => import("./pages/Legal"));
const DataRights = lazy(() => import("./pages/DataRights"));
const NotFound = lazy(() => import("./pages/NotFound"));
const Jobs = lazy(() => import("./pages/Jobs"));
const JobDetail = lazy(() => import("./pages/JobDetail"));
const DashboardGuest = lazy(() => import("./pages/DashboardGuest"));

const DischargeConcierge = lazy(() => import("./pages/DischargeConcierge"));
const InsuranceClaim = lazy(() => import("./pages/InsuranceClaim"));
const ForBusiness = lazy(() => import("./pages/ForBusiness"));
const HelperAnalytics = lazy(() => import("./pages/HelperAnalytics"));
const BusinessTeam = lazy(() => import("./pages/BusinessTeam"));
const HelprWrapped = lazy(() => import("./pages/HelprWrapped"));
const BusinessBilling = lazy(() => import("./pages/business/BusinessBilling"));
const BusinessApi = lazy(() => import("./pages/business/BusinessApi"));
const BusinessContracts = lazy(() => import("./pages/business/BusinessContracts"));
const BusinessExports = lazy(() => import("./pages/business/BusinessExports"));
const BusinessOnboarding = lazy(() => import("./pages/business/BusinessOnboarding"));
const BusinessReports = lazy(() => import("./pages/business/BusinessReports"));
const SubscriptionPage = lazy(() => import("./pages/SubscriptionPage"));
const StrSettings = lazy(() => import("./pages/StrSettings"));
const PayItForward = lazy(() => import("./pages/PayItForward"));
const HelpCenter = lazy(() => import("./pages/HelpCenter"));
const HomeHistory = lazy(() => import("./pages/HomeHistory"));
const WorkRecord = lazy(() => import("./pages/WorkRecord"));
const PetProfiles = lazy(() => import("./pages/PetProfiles"));
const BenefitsPage = lazy(() => import("./pages/BenefitsPage"));

// Lazy load less-critical global components

const FamilyDashboard = lazy(() => import("./pages/FamilyDashboard"));
const FamilyAcceptPage = lazy(() => import("./pages/FamilyAcceptPage"));

const StrikeBanner = lazy(() => import("./components/StrikeBanner"));

// Lazy load route wrappers
const ProtectedRoute = lazy(() => import("./components/ProtectedRoute"));
const AdminRoute = lazy(() => import("./components/AdminRoute"));

/**
 * Wraps a single route's lazy content in its own `<Suspense>` with a
 * branded parchment fallback so navigating between routes doesn't blank
 * the persistent shell (header, banners, mobile nav). Each route gets its
 * own independent Suspense boundary — the fallback renders in place of
 * THAT route only.
 *
 * Composes inside `RouteErrorBoundary` (`<RouteErrorBoundary>{routeEl(...)}
 * </RouteErrorBoundary>`) so a lazy-chunk fetch failure still surfaces
 * the branded route-error UI instead of suspending forever.
 */
const routeEl = (node: ReactElement, fallback: ReactElement = <RouteSuspenseFallback />) => (
  <Suspense fallback={fallback}>{node}</Suspense>
);

const AnimatedRoutes = forwardRef<HTMLDivElement>((_props, _ref) => {
  const location = useLocation();
  return (
    <Routes location={location}>
      <Route path="/" element={<RouteErrorBoundary>{routeEl(<Index />)}</RouteErrorBoundary>} />
      <Route path="/login" element={<RouteErrorBoundary>{routeEl(<PageTransition><Login /></PageTransition>)}</RouteErrorBoundary>} />
      <Route path="/signup" element={<RouteErrorBoundary>{routeEl(<PageTransition><Signup /></PageTransition>)}</RouteErrorBoundary>} />
      <Route path="/signup-pending" element={<RouteErrorBoundary>{routeEl(<PageTransition><SignupPending /></PageTransition>)}</RouteErrorBoundary>} />
      <Route path="/complete-profile" element={<RouteErrorBoundary>{routeEl(<ProtectedRoute allowUnapproved><CompleteProfile /></ProtectedRoute>)}</RouteErrorBoundary>} />
      <Route path="/account-pending" element={<RouteErrorBoundary>{routeEl(<PageTransition><AccountPending /></PageTransition>)}</RouteErrorBoundary>} />
      <Route path="/account-denied" element={<RouteErrorBoundary>{routeEl(<PageTransition><AccountDenied /></PageTransition>)}</RouteErrorBoundary>} />
      <Route path="/account-banned" element={<RouteErrorBoundary>{routeEl(<PageTransition><AccountBanned /></PageTransition>)}</RouteErrorBoundary>} />
      <Route path="/forgot-password" element={<RouteErrorBoundary>{routeEl(<PageTransition><ForgotPassword /></PageTransition>)}</RouteErrorBoundary>} />
      <Route path="/reset-password" element={<RouteErrorBoundary>{routeEl(<PageTransition><ResetPassword /></PageTransition>)}</RouteErrorBoundary>} />
      {/* Progressive activation: pending/unverified users can browse, save
          and apply while they wait on review. Verification still gates the
          moments that require it (accept, payout) inside the components.
          `denied`/banned users are still redirected — see ProtectedRoute. */}
      <Route path="/dashboard" element={<RouteErrorBoundary>{routeEl(<ProtectedRoute allowPending><Dashboard /></ProtectedRoute>)}</RouteErrorBoundary>} />
      <Route path="/profile" element={<RouteErrorBoundary>{routeEl(<ProtectedRoute allowUnapproved><Profile /></ProtectedRoute>)}</RouteErrorBoundary>} />
      <Route path="/post-job" element={<RouteErrorBoundary>{routeEl(<ProtectedRoute><PostJob /></ProtectedRoute>)}</RouteErrorBoundary>} />
      <Route path="/browse-jobs" element={<Navigate to="/dashboard" replace />} />
      <Route path="/my-jobs" element={<RouteErrorBoundary>{routeEl(<ProtectedRoute allowPending><Activity defaultTab="applied" /></ProtectedRoute>)}</RouteErrorBoundary>} />
      <Route path="/my-posts" element={<RouteErrorBoundary>{routeEl(<ProtectedRoute allowPending><Activity defaultTab="posted" /></ProtectedRoute>)}</RouteErrorBoundary>} />
      <Route path="/payment-success" element={<RouteErrorBoundary>{routeEl(<ProtectedRoute><PaymentSuccess /></ProtectedRoute>)}</RouteErrorBoundary>} />
      <Route path="/user/:userId" element={<RouteErrorBoundary>{routeEl(<ProtectedRoute><UserProfile /></ProtectedRoute>)}</RouteErrorBoundary>} />
      <Route path="/admin" element={<RouteErrorBoundary>{routeEl(<ProtectedRoute><AdminRoute><Admin /></AdminRoute></ProtectedRoute>)}</RouteErrorBoundary>} />
      <Route path="/activity" element={<Navigate to="/my-posts" replace />} />
      <Route path="/earnings" element={<Navigate to="/profile" replace />} />
      <Route path="/messages" element={<RouteErrorBoundary>{routeEl(<ProtectedRoute allowPending><Messages /></ProtectedRoute>)}</RouteErrorBoundary>} />
      {/* /support is linked from the public marketing footer, so it must
          resolve WITHOUT auth. The old target (/profile?tab=support) forced
          a sign-in. /help (HelpCenter) is the public contact surface — email,
          hours, FAQ — reachable by guests and signed-in users alike. Authed
          users still get the in-app support tab from inside Profile. */}
      <Route path="/support" element={<Navigate to="/help" replace />} />

      {/* Marketing routes intentionally skip PageTransition — its
          motion.div sets `will-change: transform`, which establishes
          a CSS containing block that pins the marketing Navbar's
          `position: fixed` to the wrapper (so the nav scrolls away
          with the page instead of staying fixed to the viewport).
          Landing (/) also skips PageTransition for the same reason;
          this preserves the same fixed-nav behaviour on /legal,
          /for-business, /help, /subscription. */}
      <Route path="/legal" element={<RouteErrorBoundary>{routeEl(<Legal />)}</RouteErrorBoundary>} />
      <Route path="/terms" element={<Navigate to="/legal?tab=terms" replace />} />
      <Route path="/privacy" element={<Navigate to="/legal?tab=privacy" replace />} />
      <Route path="/data-rights" element={<RouteErrorBoundary>{routeEl(<ProtectedRoute><PageTransition><DataRights /></PageTransition></ProtectedRoute>)}</RouteErrorBoundary>} />

      {/* Public, indexable jobs landing — Jobs.tsx reads anon job data
          (get_ranked_open_jobs, granted to anon) and renders guest
          "Sign up to apply" cards, so it must be reachable WITHOUT auth.
          It was previously behind ProtectedRoute, which redirected the
          exact guests it targets to /login. /browse remains the in-app
          (AppShell) guest experience; this is its marketing-page sibling. */}
      <Route path="/jobs" element={<RouteErrorBoundary>{routeEl(<PageTransition><Jobs /></PageTransition>)}</RouteErrorBoundary>} />
      {/* Public, deep-linkable job preview. Shared links (ShareJobButton →
          /jobs/{id}?ref=share) land here: guests get a read-only preview,
          signed-in users are redirected into the dashboard apply flow. */}
      <Route path="/jobs/:id" element={<RouteErrorBoundary>{routeEl(<PageTransition><JobDetail /></PageTransition>)}</RouteErrorBoundary>} />
      {/* Guest "home dashboard" — what iOS native users see before signing up.
          Mirrors /dashboard's chrome and JobCard rendering, but every action
          routes to /signup. Public web visitors can hit it too if they want
          a no-account preview, though the marketing landing remains canonical. */}
      <Route path="/browse" element={<RouteErrorBoundary>{routeEl(<PageTransition><DashboardGuest /></PageTransition>, <GuestBrowseSkeleton />)}</RouteErrorBoundary>} />
      <Route path="/rules" element={<Navigate to="/legal?tab=community" replace />} />
      {/* The Community page was removed; keep old links landing somewhere sane. */}
      <Route path="/community" element={<Navigate to="/" replace />} />

      {/* Settings-style pages live inside the Profile shell so the
          shared back button + safe-area top padding stay consistent.
          Standalone routes redirect into the Profile tab system so
          deep links (notifications, push opens, share URLs) still land
          where the user expects. */}
      <Route path="/schedule" element={<Navigate to="/profile?tab=schedule" replace />} />
      <Route path="/availability" element={<Navigate to="/profile?tab=availability" replace />} />
      <Route path="/saved-helpers" element={<Navigate to="/profile?tab=saved_helpers" replace />} />
      {/* Public so the footer "Plans" link and marketing CTAs resolve for
          logged-out visitors. The page renders read-only for guests (current
          plan shows Free); tapping Upgrade routes them to sign in first. */}
      <Route path="/subscription" element={<RouteErrorBoundary>{routeEl(<SubscriptionPage />)}</RouteErrorBoundary>} />
      <Route path="/str-settings" element={<RouteErrorBoundary>{routeEl(<ProtectedRoute><StrSettings /></ProtectedRoute>)}</RouteErrorBoundary>} />
      {/* Gift Card — send a gift card to a Helpr (renamed from Pay It Forward) */}
      <Route path="/gift-card" element={<RouteErrorBoundary>{routeEl(<ProtectedRoute><PayItForward /></ProtectedRoute>)}</RouteErrorBoundary>} />
      {/* Legacy /pay-it-forward → /gift-card (feature renamed). */}
      <Route path="/pay-it-forward" element={<Navigate to="/gift-card" replace />} />
      <Route path="/family" element={<RouteErrorBoundary>{routeEl(<ProtectedRoute><FamilyDashboard /></ProtectedRoute>)}</RouteErrorBoundary>} />
      <Route path="/family/accept/:token" element={<RouteErrorBoundary>{routeEl(<PageTransition><FamilyAcceptPage /></PageTransition>)}</RouteErrorBoundary>} />
      <Route path="/for-business" element={<RouteErrorBoundary>{routeEl(<ForBusiness />)}</RouteErrorBoundary>} />
      <Route path="/analytics" element={<RouteErrorBoundary>{routeEl(<ProtectedRoute><HelperAnalytics /></ProtectedRoute>)}</RouteErrorBoundary>} />
      <Route path="/business/team" element={<RouteErrorBoundary>{routeEl(<ProtectedRoute><BusinessTeam /></ProtectedRoute>)}</RouteErrorBoundary>} />
      <Route path="/business/billing" element={<RouteErrorBoundary>{routeEl(<ProtectedRoute><BusinessBilling /></ProtectedRoute>)}</RouteErrorBoundary>} />
      <Route path="/business/api" element={<RouteErrorBoundary>{routeEl(<ProtectedRoute><BusinessApi /></ProtectedRoute>)}</RouteErrorBoundary>} />
      <Route path="/business/contracts" element={<RouteErrorBoundary>{routeEl(<ProtectedRoute><BusinessContracts /></ProtectedRoute>)}</RouteErrorBoundary>} />
      <Route path="/business/exports" element={<RouteErrorBoundary>{routeEl(<ProtectedRoute><BusinessExports /></ProtectedRoute>)}</RouteErrorBoundary>} />
      <Route path="/business/onboarding" element={<RouteErrorBoundary>{routeEl(<ProtectedRoute><BusinessOnboarding /></ProtectedRoute>)}</RouteErrorBoundary>} />
      <Route path="/business/reports" element={<RouteErrorBoundary>{routeEl(<ProtectedRoute><BusinessReports /></ProtectedRoute>)}</RouteErrorBoundary>} />
      {/* Public vertical landing pages */}
      <Route path="/discharge" element={<RouteErrorBoundary>{routeEl(<PageTransition><DischargeConcierge /></PageTransition>)}</RouteErrorBoundary>} />
      <Route path="/insurance-claim" element={<RouteErrorBoundary>{routeEl(<PageTransition><InsuranceClaim /></PageTransition>)}</RouteErrorBoundary>} />

      <Route path="/home-history" element={<RouteErrorBoundary>{routeEl(<ProtectedRoute><HomeHistory /></ProtectedRoute>)}</RouteErrorBoundary>} />
      <Route path="/work-record" element={<RouteErrorBoundary>{routeEl(<ProtectedRoute><WorkRecord /></ProtectedRoute>)}</RouteErrorBoundary>} />
      <Route path="/job-history" element={<Navigate to="/profile" replace />} />

      {/* Growth / business-development pages — no auth required */}
      {/* /become-a-partner retired: partner === business. Redirect legacy links. */}
      <Route path="/become-a-partner" element={<Navigate to="/for-business" replace />} />
      {/* /enterprise retired until we're bigger — the industry verticals now
          live under Business. Redirect legacy links so they don't 404. */}
      <Route path="/enterprise" element={<Navigate to="/for-business" replace />} />
      {/* The standalone How It Works page was folded into the landing section
          (poster/Helpr toggle) — keep old links landing on that anchor. */}
      <Route path="/how-it-works" element={<Navigate to="/#how-it-works" replace />} />
      <Route path="/help" element={<RouteErrorBoundary>{routeEl(<HelpCenter />)}</RouteErrorBoundary>} />
      {/* Retired public discovery pages — redirect legacy links.
          Jobs are discovered via the landing strip + /jobs; parish/impact/
          pricing-guide standalone pages were removed. */}
      <Route path="/impact" element={<Navigate to="/" replace />} />
      <Route path="/local-guide" element={<Navigate to="/help" replace />} />
      <Route path="/parishes" element={<Navigate to="/jobs" replace />} />
      <Route path="/parish/:slug" element={<Navigate to="/jobs" replace />} />
      {/* Helpr Wrapped — auth-gated at the route level so a logged-out
          visitor never sees a flash of authed chrome (HelprWrapped's own
          useEffect redirect used to fire only after the first paint). */}
      <Route path="/wrapped" element={<RouteErrorBoundary>{routeEl(<ProtectedRoute><HelprWrapped /></ProtectedRoute>)}</RouteErrorBoundary>} />
      {/* Benefits marketplace — partner perks for helpers */}
      <Route path="/benefits" element={<RouteErrorBoundary>{routeEl(<ProtectedRoute><BenefitsPage /></ProtectedRoute>)}</RouteErrorBoundary>} />
      {/* Pet care — manage pet profiles and vet notes */}
      <Route path="/pets" element={<RouteErrorBoundary>{routeEl(<ProtectedRoute><PetProfiles /></ProtectedRoute>)}</RouteErrorBoundary>} />
      {/* /evacuation page removed — redirect old bookmarks/links to pets. */}
      <Route path="/evacuation" element={<Navigate to="/pets" replace />} />
      {/* Legacy paths surfaced by 404s in error_logs (external links, old
          bookmarks, search-engine indexes) — redirect to their modern
          equivalents instead of dumping users on the NotFound page. */}
      <Route path="/dashboard/post-login" element={<Navigate to="/dashboard" replace />} />
      <Route path="/settings/profile" element={<Navigate to="/profile" replace />} />
      <Route path="/settings" element={<Navigate to="/profile" replace />} />
      <Route path="*" element={<RouteErrorBoundary>{routeEl(<NotFound />)}</RouteErrorBoundary>} />
    </Routes>
  );
});
AnimatedRoutes.displayName = "AnimatedRoutes";

// Page-level error boundary, re-keyed by route. A render crash on one
// page shows the fallback inside <main> only — the header, nav, and
// banners stay mounted — and navigating elsewhere clears it. The root
// ErrorBoundary in <App> still backstops crashes in the shell itself.
//
// No outer <Suspense> here on purpose: every lazy route element brings
// its own per-route Suspense (see `routeEl()` above). A single shared
// Suspense at this level would tear down the active route's UI during a
// nav transition — by scoping the fallback per route, the previous
// route's content stays mounted until the next chunk resolves, so the
// persistent shell never flashes blank between pages.
const RoutedBoundary = () => {
  const location = useLocation();
  return (
    <ErrorBoundary resetKey={location.pathname}>
      <AnimatedRoutes />
    </ErrorBoundary>
  );
};

// Vercel Speed Insights mounted INSIDE BrowserRouter so it can read the
// current location. Without this, the package can't see React Router's
// state and buckets every visit under "Unknown" in the dashboard, which
// makes per-route slicing of LCP/INP/CLS impossible.
//
// We pass `route` as the route *pattern* (e.g. `/user/:userId`) rather
// than the literal pathname so visits to `/user/abc` and `/user/xyz`
// aggregate into one row instead of one-per-userId. Only one dynamic
// segment exists in the route table today — keep this normalizer in sync
// if more are added (see AnimatedRoutes above).
const SpeedInsightsRouted = () => {
  const location = useLocation();
  let route = location.pathname;
  if (route.startsWith("/user/")) route = "/user/:userId";
  return <SpeedInsights route={route} />;
};

const SessionManager = () => {
  useSessionTimeout();
  useLoginTracking();
  useNativePushSetup();
  const dynamicTypeScale = useDynamicTypeSync();
  useDarkMode(); // initializes data-theme from localStorage / system preference
  useCppVariantRouter();
  useAppShellViewport();
  useStatusBarStyle();
  // Bridge Capacitor appStateChange → TanStack focusManager and
  // @capacitor/network → onlineManager. Without this, refetchOnWindowFocus
  // is dead inside WKWebView (browser focus events don't fire reliably on
  // iOS) so the dashboard / messages / balances show stale data after the
  // user returns from a context-switch, and offline → online doesn't
  // auto-refetch. No-op on web.
  useAppLifecycle();

  // Apply senior-mode CSS class on <html> when EITHER the loaded profile has
  // senior_mode enabled, OR the OS reports a large accessibility text size
  // (Dynamic Type). The profile flag is a manual opt-in; the Dynamic Type
  // bridge (LH-22) honors the user's system-level text-size choice without
  // them having to flip the in-app toggle. They're OR'd so the two can't
  // clobber each other.
  const { profile } = useCurrentUser();
  useEffect(() => {
    const profileSenior = !!(profile as unknown as { senior_mode?: boolean })?.senior_mode;
    const osLargeText = dynamicTypeScale >= OS_LARGE_TEXT_THRESHOLD;
    document.documentElement.classList.toggle("senior-mode", profileSenior || osLargeText);
  }, [profile, dynamicTypeScale]);


  return null;
};

/**
 * Kicks off React Query cache hydration from IndexedDB AFTER first paint.
 *
 * The standard `PersistQueryClientProvider` wraps children in an
 * `IsRestoringProvider` that flips `isRestoring: true` until the async IDB
 * read finishes — that pauses every `useQuery` on the page (they sit at
 * `isLoading: true`) and effectively delays the *data* on first paint by
 * ~200-800ms even though the layout renders. By calling
 * `persistQueryClient` ourselves from a post-mount effect, queries fire
 * against the network immediately; cached entries fold in silently once
 * IDB finishes restoring. The worst case is a one-paint flicker on a
 * route that had cached data — still much better than a stalled spinner.
 *
 * The import is dynamic so the persist-client chunk (~3KB + idb-keyval)
 * stays off the entry bundle alongside the persister itself.
 */
const QueryCacheHydrator = () => {
  useEffect(() => {
    let unsubscribe: (() => void) | undefined;
    let cancelled = false;
    void (async () => {
      try {
        const { persistQueryClient } = await import(
          "@tanstack/react-query-persist-client"
        );
        if (cancelled) return;
        const [unsub] = persistQueryClient({
          queryClient,
          ...persistOptions,
        });
        unsubscribe = unsub;
      } catch {
        /* persistence is best-effort — never break the app */
      }
    })();
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, []);
  return null;
};

/**
 * Mounts `<Toaster />` and `<Sonner />` only AFTER first paint.
 *
 * Even though both are `lazy()`-wrapped above, React still asks for their
 * chunks on the same tick as the first render (it kicks the dynamic
 * import the moment a `<lazy>` element is in the tree). On native iOS
 * cold start that adds ~100-300ms of chunk-fetch contention with the
 * route chunk and page chunks that actually matter for first paint.
 *
 * Gating both on a post-mount `useState` flag means React doesn't even
 * see the lazy elements until after the first browser frame has
 * committed, so their chunks queue *after* the chunks that paint the UI
 * the user is waiting for. Toasts triggered during the very first
 * render-to-paint window are vanishingly rare (no API has resolved yet),
 * and the existing Toaster surfaces queued toasts as soon as it mounts.
 */
const DeferredToasters = () => {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    // Schedule on a microtask after commit — React has already painted the
    // first frame by the time this runs, so the toaster chunk-fetch can
    // no longer contend with the critical-path bundles.
    setMounted(true);
  }, []);
  if (!mounted) return null;
  return (
    <Suspense fallback={null}>
      <Toaster />
      <Sonner />
      <SuccessMomentHost />
    </Suspense>
  );
};

const App = () => (
  <ErrorBoundary>
    {/* Plain QueryClientProvider — see QueryCacheHydrator below for why we
        don't use PersistQueryClientProvider. Returning users still see
        last-known dashboard/jobs/messages once IDB hydrates, but queries
        no longer wait on IDB before firing against the network. See
        src/lib/queryPersister.ts. */}
    <QueryClientProvider client={queryClient}>
      <QueryCacheHydrator />
      {/* Toasters mount AFTER first paint via DeferredToasters — see comment
          on that component. The lazy() wrappers above are still required so
          the chunks aren't pulled into the entry bundle. */}
      <DeferredToasters />
      <a href="#main-content" className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-50 focus:px-4 focus:py-2 focus:bg-primary focus:text-primary-foreground focus:rounded-md">
        Skip to content
      </a>
      <BrowserRouter>
        {/* Provider wraps the banner (publisher of its measured height) and
            the page content (AppShell reads the offset to reserve space).
            See src/lib/offlineBannerLayout.tsx. */}
        <OfflineBannerLayoutProvider>
          <Suspense fallback={null}><ScrollToTop /></Suspense>
          <SessionManager />
          <NativeLaunchRouter />
          <Suspense fallback={null}><OfflineBanner /></Suspense>
          <Suspense fallback={null}>
            <StrikeBanner />
          </Suspense>
          <main
            id="main-content"
            className="w-full max-w-full no-scrollbar"
          >
            <RoutedBoundary />
          </main>
          <Suspense fallback={null}>
            <MobileNav />
            <DesktopSidebarNav />
            <PermissionRationaleDialog />
            <TermsReconsentDialog />
          </Suspense>
          <SpeedInsightsRouted />
        </OfflineBannerLayoutProvider>
      </BrowserRouter>
      <Analytics />
    </QueryClientProvider>
  </ErrorBoundary>
);

export default App;
