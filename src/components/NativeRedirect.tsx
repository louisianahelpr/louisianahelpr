import { Navigate } from "react-router-dom";
import { useCurrentUser } from "@/hooks/useCurrentUser";

/**
 * Native-only redirect for the marketing landing route. Lives in its own
 * lazy chunk so the web build never pulls Supabase into the Index entry
 * (Supabase was the largest unused-JS chunk on the LCP critical path).
 */
const NativeRedirect = () => {
  const { user } = useCurrentUser();
  return <Navigate to={user ? "/dashboard" : "/browse"} replace />;
};

export default NativeRedirect;
