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
import PageTransition from "@/components/PageTransition";
import OfflineBanner from "@/components/OfflineBanner";
import { OfflineBannerLayoutProvider } from "@/lib/offlineBannerLayout";
import { useSessionTimeout } from "@/hooks/useSessionTimeout";
import { useLoginTracking } from "@/hooks/useLoginTracking";
import { useNativePushSetup } from "@/lib/nativePush";
import { useAppLifecycle } from "@/lib/appLifecycle";
import { useDynamicTypeSync } from "@/lib/accessibility";
import { useCppVariantRouter } from "@/lib/cppRouting";
import NativeLaunchRouter from "@/components/NativeLaunchRouter";
import ScrollToTop from "@/components/ScrollToTop";
import ImpersonationBanner from "@/components/ImpersonationBanner";
import { useAppShellViewport } from "@/hooks/useAppShellViewport";
import { useStatusBarStyle } from "@/hooks/useStatusBarStyle";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useVersionCheck } from "@/hooks/useVersionCheck";
import { useSoftUpdatePrompt } from "@/hooks/useSoftUpdatePrompt";
const ForceUpdate = lazy(() => import("@/components/ForceUpdate"));

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
const MobileNav = lazy(() => import("./components/MobileNav"));
const PermissionRationaleDialog = lazy(() =>
  import("@/components/PermissionRationaleDialog").then((m) => ({ default: m.PermissionRationaleDialog }))
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
const DashboardGuest = lazy(() => import("./pages/DashboardGuest"));

const VerifyHelper = lazy(() => import("./pages/VerifyHelper"));
const LocalPricingGuide = lazy(() => import("./pages/LocalPricingGuide"));

const ForBusiness = lazy(() => import("./pages/ForBusiness"));
const Community = lazy(() => import("./pages/Community"));
const ParishPage = lazy(() => import("./pages/ParishPage"));
const ParishesPage = lazy(() => import("./pages/ParishesPage"));
const HelprWrapped = lazy(() => import("./pages/HelprWrapped"));
const BusinessTeam = lazy(() => import("./pages/BusinessTeam"));
const BusinessBilling = lazy(() => import("./pages/business/BusinessBilling"));
const BusinessApi = lazy(() => import("./pages/business/BusinessApi"));
const BusinessContracts = lazy(() => import("./pages/business/BusinessContracts"));
const BusinessExports = lazy(() => import("./pages/business/BusinessExports"));
const BusinessOnboarding = lazy(() => import("./pages/business/BusinessOnboarding"));
const BusinessReports = lazy(() => import("./pages/business/BusinessReports"));
const SubscriptionPage = lazy(() => import("./pages/SubscriptionPage"));
const StrSettings = lazy(() => import("./pages/StrSettings"));
const PayItForward = lazy(() => import("./pages/PayItForward"));
const ImpactPage = lazy(() => import("./pages/ImpactPage"));
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
const routeEl = (node: ReactElement) => (
  <Suspense fallback={<RouteSuspenseFallback />}>{node}</Suspense>
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
      <Route path="/support" element={<Navigate to="/profile?tab=support" replace />} />

      {/* Public trust + discovery pages — no auth required */}
      <Route path="/verify/:helperId" element={<RouteErrorBoundary>{routeEl(<PageTransition><VerifyHelper /></PageTransition>)}</RouteErrorBoundary>} />
      <Route path="/local-guide" element={<RouteErrorBoundary>{routeEl(<PageTransition><LocalPricingGuide /></PageTransition>)}</RouteErrorBoundary>} />

      <Route path="/legal" element={<RouteErrorBoundary>{routeEl(<PageTransition><Legal /></PageTransition>)}</RouteErrorBoundary>} />
      <Route path="/terms" element={<Navigate to="/legal?tab=terms" replace />} />
      <Route path="/privacy" element={<Navigate to="/legal?tab=privacy" replace />} />
      <Route path="/data-rights" element={<RouteErrorBoundary>{routeEl(<PageTransition><DataRights /></PageTransition>)}</RouteErrorBoundary>} />

      {/* Public, indexable jobs landing — Jobs.tsx reads anon job data
          (get_ranked_open_jobs, granted to anon) and renders guest
          "Sign up to apply" cards, so it must be reachable WITHOUT auth.
          It was previously behind ProtectedRoute, which redirected the
          exact guests it targets to /login. /browse remains the in-app
          (AppShell) guest experience; this is its marketing-page sibling. */}
      <Route path="/jobs" element={<RouteErrorBoundary>{routeEl(<PageTransition><Jobs /></PageTransition>)}</RouteErrorBoundary>} />
      {/* Guest "home dashboard" — what iOS native users see before signing up.
          Mirrors /dashboard's chrome and JobCard rendering, but every action
          routes to /signup. Public web visitors can hit it too if they want
          a no-account preview, though the marketing landing remains canonical. */}
      <Route path="/browse" element={<RouteErrorBoundary>{routeEl(<PageTransition><DashboardGuest /></PageTransition>)}</RouteErrorBoundary>} />
      <Route path="/rules" element={<Navigate to="/legal?tab=community" replace />} />
      {/* Community feed — before/after photos, milestone posts, helper spotlights. */}
      <Route path="/community" element={<RouteErrorBoundary>{routeEl(<Community />)}</RouteErrorBoundary>} />

      {/* Settings-style pages live inside the Profile shell so the
          shared back button + safe-area top padding stay consistent.
          Standalone routes redirect into the Profile tab system so
          deep links (notifications, push opens, share URLs) still land
          where the user expects. */}
      <Route path="/schedule" element={<Navigate to="/profile?tab=schedule" replace />} />
      <Route path="/availability" element={<Navigate to="/profile?tab=availability" replace />} />
      <Route path="/saved-helpers" element={<Navigate to="/profile?tab=saved_helpers" replace />} />
      <Route path="/subscription" element={<RouteErrorBoundary>{routeEl(<ProtectedRoute><SubscriptionPage /></ProtectedRoute>)}</RouteErrorBoundary>} />
      <Route path="/str-settings" element={<RouteErrorBoundary>{routeEl(<ProtectedRoute><StrSettings /></ProtectedRoute>)}</RouteErrorBoundary>} />
      {/* Pay It Forward — community credit marketplace */}
      <Route path="/pay-it-forward" element={<RouteErrorBoundary>{routeEl(<ProtectedRoute><PayItForward /></ProtectedRoute>)}</RouteErrorBoundary>} />
      <Route path="/family" element={<RouteErrorBoundary>{routeEl(<ProtectedRoute><FamilyDashboard /></ProtectedRoute>)}</RouteErrorBoundary>} />
      <Route path="/family/accept/:token" element={<RouteErrorBoundary>{routeEl(<PageTransition><FamilyAcceptPage /></PageTransition>)}</RouteErrorBoundary>} />
      <Route path="/for-business" element={<RouteErrorBoundary>{routeEl(<PageTransition><ForBusiness /></PageTransition>)}</RouteErrorBoundary>} />
      <Route path="/business/team" element={<RouteErrorBoundary>{routeEl(<ProtectedRoute><BusinessTeam /></ProtectedRoute>)}</RouteErrorBoundary>} />
      <Route path="/business/billing" element={<RouteErrorBoundary>{routeEl(<ProtectedRoute><BusinessBilling /></ProtectedRoute>)}</RouteErrorBoundary>} />
      <Route path="/business/api" element={<RouteErrorBoundary>{routeEl(<ProtectedRoute><BusinessApi /></ProtectedRoute>)}</RouteErrorBoundary>} />
      <Route path="/business/contracts" element={<RouteErrorBoundary>{routeEl(<ProtectedRoute><BusinessContracts /></ProtectedRoute>)}</RouteErrorBoundary>} />
      <Route path="/business/exports" element={<RouteErrorBoundary>{routeEl(<ProtectedRoute><BusinessExports /></ProtectedRoute>)}</RouteErrorBoundary>} />
      <Route path="/business/onboarding" element={<RouteErrorBoundary>{routeEl(<ProtectedRoute><BusinessOnboarding /></ProtectedRoute>)}</RouteErrorBoundary>} />
      <Route path="/business/reports" element={<RouteErrorBoundary>{routeEl(<ProtectedRoute><BusinessReports /></ProtectedRoute>)}</RouteErrorBoundary>} />

      <Route path="/job-history" element={<Navigate to="/profile" replace />} />

      {/* Community discovery — public, document-scroll, SEO-indexable */}
      {/* Public impact transparency page — no auth required */}
      <Route path="/impact" element={<RouteErrorBoundary>{routeEl(<PageTransition><ImpactPage /></PageTransition>)}</RouteErrorBoundary>} />
      <Route path="/parishes" element={<RouteErrorBoundary>{routeEl(<PageTransition><ParishesPage /></PageTransition>)}</RouteErrorBoundary>} />
      <Route path="/parish/:slug" element={<RouteErrorBoundary>{routeEl(<PageTransition><ParishPage /></PageTransition>)}</RouteErrorBoundary>} />
      {/* Helpr Wrapped — auth-gated, HelprWrapped handles the redirect */}
      <Route path="/wrapped" element={<RouteErrorBoundary>{routeEl(<HelprWrapped />)}</RouteErrorBoundary>} />
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
  useSoftUpdatePrompt();
  useAppLifecycle();
  useDynamicTypeSync();
  useCppVariantRouter();
  useAppShellViewport();
  useStatusBarStyle();

  // Apply senior-mode CSS class on <html> whenever the loaded profile
  // has senior_mode enabled (e.g. after sign-in or a page refresh).
  const { profile } = useCurrentUser();
  useEffect(() => {
    const enabled = !!(profile as unknown as { senior_mode?: boolean })?.senior_mode;
    document.documentElement.classList.toggle("senior-mode", enabled);
  }, [profile]);

  return null;
};

/**
 * Top-level gate: when the installed native binary is older than the
 * minimum supported build, render the full-screen `<ForceUpdate />`
 * instead of the app. The check is a no-op on web and when
 * `MIN_SUPPORTED_BUILD` is still its default of 0 (see useVersionCheck).
 * Lives inside BrowserRouter so the children of the gate still see the
 * router (the blocker itself does not need it).
 */
const ForceUpdateGate = ({ children }: { children: ReactElement }) => {
  const { forceUpdate } = useVersionCheck();
  if (forceUpdate) {
    return (
      <Suspense fallback={null}>
        <ForceUpdate />
      </Suspense>
    );
  }
  return children;
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
          <ForceUpdateGate>
          <>
          <ScrollToTop />
          <SessionManager />
          <NativeLaunchRouter />
          <OfflineBanner />
          <ImpersonationBanner />
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
            <PermissionRationaleDialog />
          </Suspense>
          <SpeedInsightsRouted />
          </>
          </ForceUpdateGate>
        </OfflineBannerLayoutProvider>
      </BrowserRouter>
      <Analytics />
    </QueryClientProvider>
  </ErrorBoundary>
);

export default App;
