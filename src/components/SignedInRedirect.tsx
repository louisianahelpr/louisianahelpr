import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useCurrentUser } from "@/hooks/useCurrentUser";

interface SignedInRedirectProps {
  /** Where an authenticated visitor is sent. */
  to: string;
  /** What a signed-OUT visitor gets instead — the page itself. */
  children?: ReactNode;
}

/**
 * Sends an authenticated visitor to `to`; renders `children` for a guest.
 *
 * Lives in its OWN lazy chunk, and must keep living in one: it is the only
 * thing on the marketing routes that touches `useCurrentUser`, which pulls
 * `@supabase/supabase-js` (~53 KiB gzipped). Importing it eagerly from
 * `Index`, `ForBusiness`, or `App` puts Supabase back on the landing page's
 * LCP critical path. It is reached through `<MarketingRedirect>`, which only
 * renders it when a persisted auth token actually exists — see that file.
 *
 * Same shape as the older `NativeRedirect` (which does this for the native
 * shell, where a guest goes to /browse rather than seeing a page).
 */
const SignedInRedirect = ({ to, children }: SignedInRedirectProps) => {
  // `isLoading` here means "auth state has not yet been determined" — the
  // supabase auth INITIAL_SESSION event hasn't fired (or, on native, the
  // Preferences hydrate hasn't resolved). Without this guard a signed-in
  // visitor gets the signed-out branch on cold load, because `user` is briefly
  // null before the persisted session lands — i.e. the exact person we are
  // redirecting would be shown the marketing page and left there.
  const { user, isLoading } = useCurrentUser();

  // A PLAIN surface, not RouteSuspenseFallback's content skeleton, and the
  // same one <MarketingRedirect>'s Suspense fallback uses. At this point we do
  // not yet know whether this render ends in a redirect or in the landing
  // page, so any content-shaped bones would be guessing at a layout — and
  // matching the Suspense fallback exactly means the chunk-download and
  // auth-resolve phases are indistinguishable: one calm surface that holds
  // until the real destination paints its own skeleton.
  if (isLoading) return <div className="min-h-screen bg-premium-page" />;

  if (user) return <Navigate to={to} replace />;

  return <>{children}</>;
};

export default SignedInRedirect;
