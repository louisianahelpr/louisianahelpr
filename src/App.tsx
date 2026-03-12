import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes, Navigate } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import ErrorBoundary from "@/components/ErrorBoundary";
import Index from "./pages/Index";
import Login from "./pages/Login";
import Signup from "./pages/Signup";
import SignupPending from "./pages/SignupPending";
import AccountPending from "./pages/AccountPending";
import AccountDenied from "./pages/AccountDenied";
import ForgotPassword from "./pages/ForgotPassword";
import ResetPassword from "./pages/ResetPassword";
import Dashboard from "./pages/Dashboard";
import Profile from "./pages/Profile";
import PostJob from "./pages/PostJob";
import PaymentSuccess from "./pages/PaymentSuccess";
import UserProfile from "./pages/UserProfile";
import Admin from "./pages/Admin";
import Activity from "./pages/Activity";
import Messages from "./pages/Messages";
import Support from "./pages/Support";
import MobileNav from "./components/MobileNav";
import NotFound from "./pages/NotFound";
import FavoriteHelpers from "./pages/FavoriteHelpers";
import TermsOfService from "./pages/TermsOfService";
import PrivacyPolicy from "./pages/PrivacyPolicy";
import Community from "./pages/Community";
import ProtectedRoute from "./components/ProtectedRoute";
import InstallPrompt from "./components/InstallPrompt";

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
          <div id="main-content">
        <Routes>
          <Route path="/" element={<Index />} />
          <Route path="/login" element={<Login />} />
          <Route path="/signup" element={<Signup />} />
          <Route path="/signup-pending" element={<SignupPending />} />
          <Route path="/account-pending" element={<AccountPending />} />
          <Route path="/account-denied" element={<AccountDenied />} />
          <Route path="/forgot-password" element={<ForgotPassword />} />
          <Route path="/reset-password" element={<ResetPassword />} />
          <Route path="/dashboard" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
          <Route path="/profile" element={<ProtectedRoute><Profile /></ProtectedRoute>} />
          <Route path="/post-job" element={<ProtectedRoute><PostJob /></ProtectedRoute>} />
          <Route path="/browse-jobs" element={<Navigate to="/dashboard" replace />} />
          <Route path="/my-jobs" element={<Navigate to="/activity" replace />} />
          <Route path="/payment-success" element={<ProtectedRoute><PaymentSuccess /></ProtectedRoute>} />
          <Route path="/user/:userId" element={<ProtectedRoute><UserProfile /></ProtectedRoute>} />
          <Route path="/admin" element={<ProtectedRoute><Admin /></ProtectedRoute>} />
          <Route path="/activity" element={<ProtectedRoute><Activity /></ProtectedRoute>} />
          <Route path="/earnings" element={<Navigate to="/profile" replace />} />
          <Route path="/messages" element={<ProtectedRoute><Messages /></ProtectedRoute>} />
          <Route path="/support" element={<ProtectedRoute><Support /></ProtectedRoute>} />
          <Route path="/favorites" element={<ProtectedRoute><FavoriteHelpers /></ProtectedRoute>} />
          <Route path="/terms" element={<TermsOfService />} />
          <Route path="/privacy" element={<PrivacyPolicy />} />
          <Route path="/community" element={<Community />} />
          <Route path="/schedule" element={<Navigate to="/profile" replace />} />
          <Route path="/job-history" element={<Navigate to="/profile" replace />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
          </div>
          <MobileNav />
          <InstallPrompt />
        </BrowserRouter>
      </TooltipProvider>
    </QueryClientProvider>
  </ErrorBoundary>
);

export default App;
