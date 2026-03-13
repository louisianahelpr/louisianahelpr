import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useCurrentUser } from "@/hooks/useCurrentUser";

export const useAdminAuth = () => {
  const navigate = useNavigate();
  const { user, isAdmin, isLoading } = useCurrentUser();

  useEffect(() => {
    if (isLoading) return;
    if (!user) { navigate("/login"); return; }
    if (!isAdmin) { navigate("/dashboard"); return; }
  }, [user, isAdmin, isLoading, navigate]);

  return { user, isAdmin, loading: isLoading };
};
