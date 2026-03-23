import { Navigate } from "react-router-dom";
import { useCurrentUser } from "@/hooks/useCurrentUser";

interface ProtectedRouteProps {
  children: React.ReactNode;
  allowUnapproved?: boolean;
}

const ProtectedRoute = ({ children, allowUnapproved = false }: ProtectedRouteProps) => {
  const { user, profile, isLoading } = useCurrentUser();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  // Banned users (temp or permanent)
  if (profile?.ban_status && ["banned", "temp_banned", "permanently_banned"].includes(profile.ban_status)) {
    return <Navigate to="/login" replace />;
  }

  if (!allowUnapproved) {
    if (profile?.approval_status === "pending") {
      return <Navigate to="/account-pending" replace />;
    }
    if (profile?.approval_status === "denied") {
      return <Navigate to="/account-denied" replace />;
    }
  }

  return <>{children}</>;
};

export default ProtectedRoute;
