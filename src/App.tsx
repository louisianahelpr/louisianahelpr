import { lazy, Suspense, forwardRef } from "react";
import { QueryClient } from "@tanstack/react-query";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { BrowserRouter, Route, Routes, Navigate, useLocation } from "react-router-dom";
import { SpeedInsights } from "@vercel/speed-insights/react";
import { Analytics } from "@vercel/analytics/react";

import { persistOptions, PERSIST_MAX_AGE_MS } from "@/lib/queryPersister";

import ErrorBoundary from "@/components/ErrorBoundary";
import RouteErrorBoundary from "@/components/RouteErrorBoundary";
import PageTransition from "@/components/PageTransition";
import OfflineBanner from "@/components/OfflineBanner";
import { useSessionTimeout } from "@/hooks/useSessionTimeout";
import { useLoginTracking } from "@/hooks/useLoginTracking";
import { useNativePushSetup } from "@/lib/nativePush";
import { useDynamicTypeSync } from "@/lib/accessibility";
import { useCppVariantRouter } from "@/lib/cppRouting";
import NativeLaunchRouter from "@/components/NativeLaunchRouter";
import ScrollToTop from "@/components/ScrollToTop";
import { useAppShellViewport } from "@/hooks/useAppShellViewport";

// Toaster, Sonner and TooltipProvider pull in sonner + @radix-ui/react-toast +
// @radix-ui/react-tooltip + @floating-ui + next-themes (~14 KB gzipped of
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

const ForBusiness = lazy(() => import("./pages/ForBusiness"));
const BusinessTeam = lazy(() => import("./pages/BusinessTeam"));


// Lazy load less-critical global components

const StrikeBanner = lazy(() => import("./components/StrikeBanner"));

// Lazy load route wrappers
const ProtectedRoute = lazy(() => import("./components/ProtectedRoute"));
const AdminRoute = lazy(() => import("./components/AdminRoute"));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Keep data considered fresh for 60s — short enough that refocusing
      // after a brief context switch triggers a background refetch, long
      // enough to avoid hammering Supabase on rapid remounts.
      staleTime: 60 * 1000,
      // Match the persisted-cache max age. `gcTime` MUST be >= the
      // persister's maxAge or TanStack drops entries on hydrate, defeating
      // the whole point of disk persistence. See src/lib/queryPersister.ts.
      gcTime: PERSIST_MAX_AGE_MS,
      // Only retry transient/server errors. Client errors (401/403/404/etc.)
      // won't be fixed by retrying — the token's invalid, the row doesn't
      // exist, or RLS blocked it. Retrying just wastes a round-trip.
      retry: (failureCount, error: unknown) => {
        const status =
          (error as { status?: number; statusCode?: number; code?: number | string })?.status ??
          (error as { statusCode?: number })?.statusCode ??
          Number((error as { code?: number | string })?.code);
        if (typeof status === "number" && status >= 400 && status < 500) return false;
        return failureCount < 2;
      },
      // Re-enable: in a live marketplace, returning to the app should
      // surface jobs that may have been claimed/cancelled while away.
      refetchOnWindowFocus: true,
    },
  },
});

const PageFallback = () => (
  <div className="fixed inset-0 overflow-hidden bg-background flex items-center justify-center" aria-hidden="true">
    <div className="w-8 h-8 rounded-full border-2 border-primary/20 border-t-primary animate-spin" />
  </div>
);



const AnimatedRoutes = forwardRef<HTMLDivElement>((_props, _ref) => {
  const location = useLocation();
  return (
    <Routes location={location}>
      <Route path="/" element={<RouteErrorBoundary><Index /></RouteErrorBoundary>} />
      <Route path="/login" element={<RouteErrorBoundary><PageTransition><Login /></PageTransition></RouteErrorBoundary>} />
      <Route path="/signup" element={<RouteErrorBoundary><PageTransition><Signup /></PageTransition></RouteErrorBoundary>} />
      <Route path="/signup-pending" element={<RouteErrorBoundary><PageTransition><SignupPending /></PageTransition></RouteErrorBoundary>} />
      <Route path="/complete-profile" element={<RouteErrorBoundary><ProtectedRoute allowUnapproved><CompleteProfile /></ProtectedRoute></RouteErrorBoundary>} />
      <Route path="/account-pending" element={<RouteErrorBoundary><PageTransition><AccountPending /></PageTransition></RouteErrorBoundary>} />
      <Route path="/account-denied" element={<RouteErrorBoundary><PageTransition><AccountDenied /></PageTransition></RouteErrorBoundary>} />
      <Route path="/account-banned" element={<RouteErrorBoundary><PageTransition><AccountBanned /></PageTransition></RouteErrorBoundary>} />
      <Route path="/forgot-password" element={<RouteErrorBoundary><PageTransition><ForgotPassword /></PageTransition></RouteErrorBoundary>} />
      <Route path="/reset-password" element={<RouteErrorBoundary><PageTransition><ResetPassword /></PageTransition></RouteErrorBoundary>} />
      {/* Progressive activation: pending/unverified users can browse, save
          and apply while they wait on review. Verification still gates the
          moments that require it (accept, payout) inside the components.
          `denied`/banned users are still redirected — see ProtectedRoute. */}
      <Route path="/dashboard" element={<RouteErrorBoundary><ProtectedRoute allowPending><Dashboard /></ProtectedRoute></RouteErrorBoundary>} />
      <Route path="/profile" element={<RouteErrorBoundary><ProtectedRoute allowUnapproved><Profile /></ProtectedRoute></RouteErrorBoundary>} />
      <Route path="/post-job" element={<RouteErrorBoundary><ProtectedRoute><PostJob /></ProtectedRoute></RouteErrorBoundary>} />
      <Route path="/browse-jobs" element={<Navigate to="/dashboard" replace />} />
      <Route path="/my-jobs" element={<RouteErrorBoundary><ProtectedRoute allowPending><Activity defaultTab="applied" /></ProtectedRoute></RouteErrorBoundary>} />
      <Route path="/my-posts" element={<RouteErrorBoundary><ProtectedRoute allowPending><Activity defaultTab="posted" /></ProtectedRoute></RouteErrorBoundary>} />
      <Route path="/payment-success" element={<RouteErrorBoundary><ProtectedRoute><PaymentSuccess /></ProtectedRoute></RouteErrorBoundary>} />
      <Route path="/user/:userId" element={<RouteErrorBoundary><ProtectedRoute><UserProfile /></ProtectedRoute></RouteErrorBoundary>} />
      <Route path="/admin" element={<RouteErrorBoundary><ProtectedRoute><AdminRoute><Admin /></AdminRoute></ProtectedRoute></RouteErrorBoundary>} />
      <Route path="/activity" element={<Navigate to="/my-posts" replace />} />
      <Route path="/earnings" element={<Navigate to="/profile" replace />} />
      <Route path="/messages" element={<RouteErrorBoundary><ProtectedRoute allowPending><Messages /></ProtectedRoute></RouteErrorBoundary>} />
      <Route path="/support" element={<Navigate to="/profile?tab=support" replace />} />

      <Route path="/legal" element={<RouteErrorBoundary><PageTransition><Legal /></PageTransition></RouteErrorBoundary>} />
      <Route path="/terms" element={<Navigate to="/legal?tab=terms" replace />} />
      <Route path="/privacy" element={<Navigate to="/legal?tab=privacy" replace />} />
      <Route path="/data-rights" element={<RouteErrorBoundary><PageTransition><DataRights /></PageTransition></RouteErrorBoundary>} />

      <Route path="/jobs" element={<RouteErrorBoundary><ProtectedRoute allowPending><Jobs /></ProtectedRoute></RouteErrorBoundary>} />
      {/* Guest "home dashboard" — what iOS native users see before signing up.
          Mirrors /dashboard's chrome and JobCard rendering, but every action
          routes to /signup. Public web visitors can hit it too if they want
          a no-account preview, though the marketing landing remains canonical. */}
      <Route path="/browse" element={<RouteErrorBoundary><PageTransition><DashboardGuest /></PageTransition></RouteErrorBoundary>} />
      <Route path="/rules" element={<Navigate to="/legal?tab=community" replace />} />
      {/* /community is a legacy/external-link redirect stub — the content
          lives as a tab inside /legal. Without this redirect, old search
          indexes and external links 404. The sitemap lists the canonical
          /legal URL, not this stub. Mirrors the /rules → /legal?tab=community
          pattern above. */}
      <Route path="/community" element={<Navigate to="/legal?tab=community" replace />} />

      {/* Settings-style pages live inside the Profile shell so the
          shared back button + safe-area top padding stay consistent.
          Standalone routes redirect into the Profile tab system so
          deep links (notifications, push opens, share URLs) still land
          where the user expects. */}
      <Route path="/schedule" element={<Navigate to="/profile?tab=schedule" replace />} />
      <Route path="/availability" element={<Navigate to="/profile?tab=availability" replace />} />
      <Route path="/saved-helpers" element={<Navigate to="/profile?tab=saved_helpers" replace />} />
      <Route path="/for-business" element={<RouteErrorBoundary><PageTransition><ForBusiness /></PageTransition></RouteErrorBoundary>} />
      <Route path="/business/team" element={<RouteErrorBoundary><ProtectedRoute><BusinessTeam /></ProtectedRoute></RouteErrorBoundary>} />

      <Route path="/job-history" element={<Navigate to="/profile" replace />} />
      {/* Legacy paths surfaced by 404s in error_logs (external links, old
          bookmarks, search-engine indexes) — redirect to their modern
          equivalents instead of dumping users on the NotFound page. */}
      <Route path="/dashboard/post-login" element={<Navigate to="/dashboard" replace />} />
      <Route path="/settings/profile" element={<Navigate to="/profile" replace />} />
      <Route path="/settings" element={<Navigate to="/profile" replace />} />
      <Route path="*" element={<RouteErrorBoundary><NotFound /></RouteErrorBoundary>} />
    </Routes>
  );
});
AnimatedRoutes.displayName = "AnimatedRoutes";

// Page-level error boundary, re-keyed by route. A render crash on one
// page shows the fallback inside <main> only — the header, nav, and
// banners stay mounted — and navigating elsewhere clears it. The root
// ErrorBoundary in <App> still backstops crashes in the shell itself.
const RoutedBoundary = () => {
  const location = useLocation();
  return (
    <ErrorBoundary resetKey={location.pathname}>
      <Suspense fallback={<PageFallback />}>
        <AnimatedRoutes />
      </Suspense>
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
  useDynamicTypeSync();
  useCppVariantRouter();
  useAppShellViewport();
  return null;
};

const App = () => (
  <ErrorBoundary>
    {/* PersistQueryClientProvider hydrates the cache from IndexedDB before
        the first render that depends on it — returning users see their
        last-known dashboard/jobs/messages instantly while React Query
        revalidates in the background. See src/lib/queryPersister.ts. */}
    <PersistQueryClientProvider client={queryClient} persistOptions={persistOptions}>
      <Suspense fallback={null}>
        <Toaster />
        <Sonner />
      </Suspense>
      <a href="#main-content" className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-50 focus:px-4 focus:py-2 focus:bg-primary focus:text-primary-foreground focus:rounded-md">
        Skip to content
      </a>
      <BrowserRouter>
        <ScrollToTop />
        <SessionManager />
        <NativeLaunchRouter />
        <OfflineBanner />
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
      </BrowserRouter>
      <Analytics />
    </PersistQueryClientProvider>
  </ErrorBoundary>
);

export default App;
