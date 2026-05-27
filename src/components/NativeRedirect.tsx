import { Navigate } from "react-router-dom";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { RouteSuspenseFallback } from "@/components/RouteSuspenseFallback";

/**
 * Native-only redirect for the marketing landing route. Lives in its own
 * lazy chunk so the web build never pulls Supabase into the Index entry
 * (Supabase was the largest unused-JS chunk on the LCP critical path).
 */
const NativeRedirect = () => {
  // `isLoading` here means "auth state has not yet been determined" — either
  // the Capacitor Preferences hydrate hasn't resolved or the supabase auth
  // INITIAL_SESSION event hasn't fired. Without this guard, signed-in users
  // get redirected to /browse on cold launch because `user` is briefly null
  // before the persisted session lands.
  const { user, isLoading } = useCurrentUser();
  if (isLoading) return <RouteSuspenseFallback />;
  return <Navigate to={user ? "/dashboard" : "/browse"} replace />;
};

export default NativeRedirect;
