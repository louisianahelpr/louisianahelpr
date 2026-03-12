import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";

interface ProtectedRouteProps {
  children: React.ReactNode;
  /** Allow users with pending/denied approval to access this route (e.g. profile, support) */
  allowUnapproved?: boolean;
}

const ProtectedRoute = ({ children, allowUnapproved = false }: ProtectedRouteProps) => {
  const [loading, setLoading] = useState(true);
  const [authenticated, setAuthenticated] = useState(false);
  const [approvalStatus, setApprovalStatus] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    const checkAuth = async (userId: string | undefined) => {
      if (!userId) {
        if (mounted) {
          setAuthenticated(false);
          setLoading(false);
        }
        return;
      }

      // User is authenticated, now check approval status
      const { data: profile } = await supabase
        .from("profiles")
        .select("approval_status, ban_status")
        .eq("user_id", userId)
        .single();

      if (mounted) {
        setAuthenticated(true);

        // Banned users get signed out
        if (profile?.ban_status === "banned") {
          await supabase.auth.signOut();
          setAuthenticated(false);
          setLoading(false);
          return;
        }

        setApprovalStatus(profile?.approval_status ?? "pending");
        setLoading(false);
      }
    };

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        checkAuth(session?.user?.id);
      }
    );

    supabase.auth.getSession().then(({ data: { session } }) => {
      checkAuth(session?.user?.id);
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  if (!authenticated) {
    return <Navigate to="/login" replace />;
  }

  // If this route allows unapproved users (profile editing, support), let them through
  if (!allowUnapproved) {
    if (approvalStatus === "pending") {
      return <Navigate to="/account-pending" replace />;
    }
    if (approvalStatus === "denied") {
      return <Navigate to="/account-denied" replace />;
    }
  }

  return <>{children}</>;
};

export default ProtectedRoute;
