import { Navigate } from "react-router-dom";
import { useCurrentUser } from "@/hooks/useCurrentUser";

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
  // A PLAIN surface, not RouteSuspenseFallback's content skeleton.
  //
  // On native cold start the app passed through four visually distinct states
  // before settling: blank parchment (this component's chunk downloading), a
  // generic title-bar-and-cards skeleton (the old fallback here), the
  // destination's own skeleton, then the destination. The middle one is the
  // problem — it is shaped like a page that does not exist and that the user
  // is not going to, so it reads as the app flashing up some other screen and
  // then leaving it. It also cannot be right: at this point we do not yet know
  // whether we are heading to /dashboard or /browse, so any content-shaped
  // bones are guessing at a layout.
  //
  // Matching the Suspense fallback in Index exactly means the chunk-download
  // and auth-resolve phases are indistinguishable — one calm surface that
  // holds until the real destination paints its own skeleton.
  if (isLoading) return <div className="min-h-screen bg-premium-page" />;
  return <Navigate to={user ? "/dashboard" : "/browse"} replace />;
};

export default NativeRedirect;
