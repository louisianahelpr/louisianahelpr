import { lazy, Suspense, forwardRef } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes, Navigate, useLocation } from "react-router-dom";

import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import ErrorBoundary from "@/components/ErrorBoundary";
import PageTransition from "@/components/PageTransition";
import MobileNav from "./components/MobileNav";
import { useSessionTimeout } from "@/hooks/useSessionTimeout";
import { useLoginTracking } from "@/hooks/useLoginTracking";

// Lazy load all pages including landing
const Index = lazy(() => import("./pages/Index"));

// Lazy load all other pages
const Schedule = lazy(() => import("./pages/Schedule"));
const Login = lazy(() => import("./pages/Login"));
const Signup = lazy(() => import("./pages/Signup"));
const SignupPending = lazy(() => import("./pages/SignupPending"));
const AccountPending = lazy(() => import("./pages/AccountPending"));
const AccountDenied = lazy(() => import("./pages/AccountDenied"));
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
const Community = lazy(() => import("./pages/Community"));
const PlatformRules = lazy(() => import("./pages/PlatformRules"));
const NotFound = lazy(() => import("./pages/NotFound"));
const Jobs = lazy(() => import("./pages/Jobs"));

// Lazy load less-critical global components
const InstallPrompt = lazy(() => import("./components/InstallPrompt"));

// Lazy load route wrappers
const ProtectedRoute = lazy(() => import("./components/ProtectedRoute"));
const AdminRoute = lazy(() => import("./components/AdminRoute"));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,
      gcTime: 10 * 60 * 1000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

const PageFallback = () => (
  <div className="flex flex-col items-center justify-center min-h-screen bg-background">
    <h1 className="text-3xl font-bold text-primary font-serif mb-4">Helpr</h1>
    <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
    <p className="mt-4 text-sm text-muted-foreground">Loading...</p>
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
      <Route path="/account-pending" element={<PageTransition><AccountPending /></PageTransition>} />
      <Route path="/account-denied" element={<PageTransition><AccountDenied /></PageTransition>} />
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
      <Route path="/community" element={<PageTransition><Community /></PageTransition>} />
      <Route path="/jobs" element={<PageTransition><Jobs /></PageTransition>} />
      <Route path="/rules" element={<PageTransition><PlatformRules /></PageTransition>} />
      <Route path="/schedule" element={<ProtectedRoute><Schedule /></ProtectedRoute>} />
      <Route path="/job-history" element={<Navigate to="/profile" replace />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
});
AnimatedRoutes.displayName = "AnimatedRoutes";

const SessionManager = () => {
  useSessionTimeout();
  useLoginTracking();
  return null;
};

const App = () => (
  <ErrorBoundary>
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <a href="#main-content" className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-50 focus:px-4 focus:py-2 focus:bg-primary focus:text-primary-foreground focus:rounded-md">
          Skip to content
        </a>
        <BrowserRouter>
          <SessionManager />
          <div id="main-content">
            <Suspense fallback={<PageFallback />}>
              <AnimatedRoutes />
            </Suspense>
          </div>
          <MobileNav />
          <Suspense fallback={null}>
            <InstallPrompt />
          </Suspense>
        </BrowserRouter>
      </TooltipProvider>
    </QueryClientProvider>
  </ErrorBoundary>
);

export default App;
