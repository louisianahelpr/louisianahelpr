import { lazy, Suspense, useState, type ReactNode } from "react";
import { hasPersistedAuthToken } from "@/lib/persistedAuthToken";
// Already in the entry graph (main.tsx imports nativeInit for initNative),
// so reading this constant costs nothing extra.
import { isNativePlatform } from "@/lib/nativeInit";

// MUST stay lazy. This is the only Supabase-touching thing on the marketing
// routes; a static import here would land `@supabase/supabase-js` (~53 KiB
// gzipped) in the App entry chunk and back onto the landing page's LCP path.
const SignedInRedirect = lazy(() => import("@/components/SignedInRedirect"));

interface MarketingRedirectProps {
  children: ReactNode;
  /** Where a signed-in visitor is sent. */
  to?: string;
}

/**
 * Route wrapper for the PURELY PROMOTIONAL landing page (`/`):
 * a signed-in visitor is sent into the app, a guest gets the page.
 *
 * Owner decision: once someone is signed in, there should be no references
 * back to the landing site — everything they need is inside the app.
 *
 * ── WEB ONLY. The native shell is untouched ───────────────────────────────
 * This is a no-op inside the iOS/Android WebView, by explicit requirement:
 * native must behave exactly as it does today. It already has its own signed-in
 * redirect — `<NativeRedirect>` behind `if (isNative)` in Index.tsx — and
 * layering a second one on top would mean two components racing to decide the
 * same thing, on the delicate cold-launch path, for no behavioural gain. It
 * `NativeRedirect` itself is not modified, imported, or reached from here.
 *
 * This gate is about AUTH STATE, never viewport: phone-width web is web and
 * gets the same redirect a desktop browser gets, per the "phone web IS the
 * app surface" rule — the split here is native-vs-web, not narrow-vs-wide.
 *
 * ── Why the two-stage gate ────────────────────────────────────────────────
 * The naive version — always mount the auth check and render the page under
 * it — fetches the Supabase chunk on the first render tick for EVERY visitor,
 * including the guests the landing page exists to convert. (React kicks a
 * `lazy()` import the moment the element renders; see the DeferredToasters
 * note in App.tsx for the same trap.) The equally naive fix — hold the page
 * until the auth check resolves — is worse: it blocks the guest's LCP on a
 * 53 KiB chunk plus an auth round-trip.
 *
 * So: a synchronous localStorage probe first. No token → this is a guest,
 * render the page immediately, download nothing. Token present → hold the
 * calm placeholder and load the real check, so a signed-in visitor never
 * flashes the marketing page on their way to the dashboard.
 *
 * The probe is read ONCE, at mount (`useState` initialiser), so the branch
 * cannot flip mid-life and unmount the page's subtree from under its hooks.
 *
 * The probe is a hint, not an authorization decision — a stale or revoked
 * token resolves to `user: null` inside <SignedInRedirect>, which then renders
 * `children` exactly as if the probe had said no. Nothing is gated on it.
 *
 * ── Where this is NOT used, and why ───────────────────────────────────────
 * Routes deliberately left alone (verified against the live components, not
 * assumed — full reasoning in the route table in App.tsx):
 *   • /legal, /terms, /privacy, /rules — the policy TEXT lives here and
 *     nowhere else. The in-app Legal tab (/profile?tab=legal) is a directory
 *     that links INTO these routes, so redirecting them at someone reading
 *     Terms would bounce them to a page whose own links point right back —
 *     a loop that never shows Terms. Legally these must stay reachable: they
 *     are what the signup consent checkboxes link to.
 *   • /help, /support — support has to be reachable from anywhere. /help is
 *     already the in-app help screen (PublicLayout swaps to AppShell on
 *     native), and /support is the appeal route linked from AccountBanned;
 *     sending it into the Profile shell would bounce a banned user straight
 *     back out again.
 *   • /login, /signup and the rest of the auth family — they carry their own
 *     already-signed-in bounce.
 *   • /jobs, /browse, /jobs/:id — each already redirects authenticated users
 *     itself, with deep-link handling this wrapper doesn't have.
 */
const MarketingRedirect = ({ children, to = "/dashboard" }: MarketingRedirectProps) => {
  const [maybeSignedIn] = useState(() => !isNativePlatform && hasPersistedAuthToken());

  // Two ways to land here: a guest (the overwhelmingly common case on the
  // marketing routes) or native. Either way — zero extra bytes, zero delay,
  // and no redirect can flash, because none is mounted.
  if (!maybeSignedIn) return <>{children}</>;

  return (
    <Suspense fallback={<div className="min-h-screen bg-premium-page" />}>
      <SignedInRedirect to={to}>{children}</SignedInRedirect>
    </Suspense>
  );
};

export default MarketingRedirect;
