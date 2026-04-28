import { lazy, Suspense, forwardRef } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes, Navigate, useLocation } from "react-router-dom";

import ErrorBoundary from "@/components/ErrorBoundary";
import PageTransition from "@/components/PageTransition";
import MobileNav from "./components/MobileNav";
import OfflineBanner from "@/components/OfflineBanner";
import { PermissionRationaleDialog } from "@/components/PermissionRationaleDialog";
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
const TooltipProvider = lazy(() =>
  import("@/components/ui/tooltip").then((m) => ({ default: m.TooltipProvider }))
);

// Lazy load all pages including landing
const Index = lazy(() => import("./pages/Index"));

// Lazy load all other pages
const Schedule = lazy(() => import("./pages/Schedule"));
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
const Support = lazy(() => import("./pages/Support"));

const TermsOfService = lazy(() => import("./pages/TermsOfService"));
const PrivacyPolicy = lazy(() => import("./pages/PrivacyPolicy"));
const DataRights = lazy(() => import("./pages/DataRights"));
const Community = lazy(() => import("./pages/Community"));
const PlatformRules = lazy(() => import("./pages/PlatformRules"));
const NotFound = lazy(() => import("./pages/NotFound"));
const Jobs = lazy(() => import("./pages/Jobs"));
const DashboardGuest = lazy(() => import("./pages/DashboardGuest"));
const Heroes = lazy(() => import("./pages/Heroes"));
const SavedHelpers = lazy(() => import("./pages/SavedHelpers"));
const ForBusiness = lazy(() => import("./pages/ForBusiness"));
const BusinessTeam = lazy(() => import("./pages/BusinessTeam"));
const Features = lazy(() => import("./pages/Features"));

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
      gcTime: 10 * 60 * 1000,
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

// Route-level loading fallback — matches the native/web launch screen.
const PageFallback = () => (
  <div className="min-h-screen bg-background flex items-center justify-center">
    <img
      src="/helpr-splash-icon.png"
      alt="Helpr"
      className="h-28 w-28 object-contain"
      aria-hidden="true"
    />
  </div>
);



const AnimatedRoutes = forwardRef<HTMLDivElement>((_props, _ref) => {
  const location = useLocation();
  return (
    <Routes location={location}>
      <Route path="/" element={<Index />} />
      <Route path="/login" element={<PageTransition><Login /></PageTransition>} />
      <Route path="/signup" element={<PageTransition><Signup /></PageTransition>} />
      <Route path="/signup-pending" element={<PageTransition><SignupPending /></PageTransition>} />
      <Route path="/complete-profile" element={<ProtectedRoute allowUnapproved><CompleteProfile /></ProtectedRoute>} />
      <Route path="/account-pending" element={<PageTransition><AccountPending /></PageTransition>} />
      <Route path="/account-denied" element={<PageTransition><AccountDenied /></PageTransition>} />
      <Route path="/account-banned" element={<PageTransition><AccountBanned /></PageTransition>} />
      <Route path="/forgot-password" element={<PageTransition><ForgotPassword /></PageTransition>} />
      <Route path="/reset-password" element={<PageTransition><ResetPassword /></PageTransition>} />
      <Route path="/dashboard" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
      <Route path="/profile" element={<ProtectedRoute allowUnapproved><Profile /></ProtectedRoute>} />
      <Route path="/post-job" element={<ProtectedRoute><PostJob /></ProtectedRoute>} />
      <Route path="/browse-jobs" element={<Navigate to="/dashboard" replace />} />
      <Route path="/my-jobs" element={<ProtectedRoute><Activity defaultTab="applied" /></ProtectedRoute>} />
      <Route path="/my-posts" element={<ProtectedRoute><Activity defaultTab="posted" /></ProtectedRoute>} />
      <Route path="/payment-success" element={<ProtectedRoute><PaymentSuccess /></ProtectedRoute>} />
      <Route path="/user/:userId" element={<ProtectedRoute><UserProfile /></ProtectedRoute>} />
      <Route path="/admin" element={<ProtectedRoute><AdminRoute><Admin /></AdminRoute></ProtectedRoute>} />
      <Route path="/activity" element={<Navigate to="/my-posts" replace />} />
      <Route path="/earnings" element={<Navigate to="/profile" replace />} />
      <Route path="/messages" element={<ProtectedRoute><Messages /></ProtectedRoute>} />
      <Route path="/support" element={<PageTransition><Support /></PageTransition>} />
      
      <Route path="/terms" element={<PageTransition><TermsOfService /></PageTransition>} />
      <Route path="/privacy" element={<PageTransition><PrivacyPolicy /></PageTransition>} />
      <Route path="/data-rights" element={<PageTransition><DataRights /></PageTransition>} />
      <Route path="/community" element={<PageTransition><Community /></PageTransition>} />
      <Route path="/jobs" element={<PageTransition><Jobs /></PageTransition>} />
      {/* Guest "home dashboard" — what iOS native users see before signing up.
          Mirrors /dashboard's chrome and JobCard rendering, but every action
          routes to /signup. Public web visitors can hit it too if they want
          a no-account preview, though the marketing landing remains canonical. */}
      <Route path="/browse" element={<PageTransition><DashboardGuest /></PageTransition>} />
      <Route path="/rules" element={<PageTransition><PlatformRules /></PageTransition>} />
      <Route path="/heroes" element={<PageTransition><Heroes /></PageTransition>} />
      <Route path="/schedule" element={<ProtectedRoute><Schedule /></ProtectedRoute>} />
      <Route path="/saved-helpers" element={<ProtectedRoute><SavedHelpers /></ProtectedRoute>} />
      <Route path="/for-business" element={<PageTransition><ForBusiness /></PageTransition>} />
      <Route path="/business/team" element={<ProtectedRoute><BusinessTeam /></ProtectedRoute>} />
      <Route path="/features" element={<PageTransition><Features /></PageTransition>} />
      <Route path="/job-history" element={<Navigate to="/profile" replace />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
});
AnimatedRoutes.displayName = "AnimatedRoutes";

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
    <QueryClientProvider client={queryClient}>
      <Suspense fallback={null}>
        <TooltipProvider>
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
              className="w-full max-w-full app-shell-scroll no-scrollbar"
            >
              <Suspense fallback={<PageFallback />}>
                <AnimatedRoutes />
              </Suspense>
            </main>
            <MobileNav />
            <PermissionRationaleDialog />
          </BrowserRouter>
        </TooltipProvider>
      </Suspense>
    </QueryClientProvider>
  </ErrorBoundary>
);

export default App;
