import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes, Navigate } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
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
import ProtectedRoute from "./components/ProtectedRoute";

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
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Index />} />
          <Route path="/login" element={<Login />} />
          <Route path="/signup" element={<Signup />} />
          <Route path="/signup-pending" element={<SignupPending />} />
          <Route path="/account-pending" element={<AccountPending />} />
          <Route path="/account-denied" element={<AccountDenied />} />
          <Route path="/forgot-password" element={<ForgotPassword />} />
          <Route path="/reset-password" element={<ResetPassword />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/profile" element={<Profile />} />
          <Route path="/post-job" element={<PostJob />} />
          <Route path="/browse-jobs" element={<Navigate to="/dashboard" replace />} />
          <Route path="/my-jobs" element={<Navigate to="/activity" replace />} />
          <Route path="/payment-success" element={<PaymentSuccess />} />
          <Route path="/user/:userId" element={<UserProfile />} />
          <Route path="/admin" element={<Admin />} />
          <Route path="/activity" element={<Activity />} />
          <Route path="/earnings" element={<Navigate to="/profile" replace />} />
          <Route path="/messages" element={<Messages />} />
          <Route path="/support" element={<Support />} />
          <Route path="/favorites" element={<FavoriteHelpers />} />
          <Route path="/terms" element={<TermsOfService />} />
          <Route path="/privacy" element={<PrivacyPolicy />} />
          <Route path="/schedule" element={<Navigate to="/profile" replace />} />
          <Route path="/job-history" element={<Navigate to="/profile" replace />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
        <MobileNav />
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
