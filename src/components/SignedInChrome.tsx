import { useEffect, type ReactNode } from "react";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useStoredSessionHint } from "@/hooks/useStoredSessionHint";

/**
 * The components App.tsx mounts beside every page but only ever draws for
 * someone signed in (dock, desktop rail and top bar, To-do badge, Terms and ID
 * sheets, strike banner). Each is a lazy chunk, and a lazy chunk is fetched as
 * soon as it RENDERS, even when it then returns null. So a signed-out /browse
 * downloaded signed-in-shared, signed-in-deep and Sentry (which signed-in-shared
 * imports) to draw nothing: 24 extra files and ~200 KB gzip in the same window
 * as the page's own content (Lighthouse run 41080594282, 2026-10-30).
 *
 * Same rule as MobileNav's isGuest: `useStoredSessionHint` answers on the first
 * frame. No stored token means a guest, so nothing is fetched; a token is a
 * "maybe", which is enough to start the chunks while auth resolves.
 *
 * Guard: src/test/guestLoadsNoSignedInChrome.test.tsx.
 */
function useMaybeSignedIn(): boolean {
  const { user, isLoading } = useCurrentUser();
  const maybeSignedIn = useStoredSessionHint();
  return !!user || (isLoading && maybeSignedIn);
}

export function SignedInOnly({ children }: { children: ReactNode }) {
  return useMaybeSignedIn() ? <>{children}</> : null;
}

/**
 * SignedInOnly, plus the one thing MobileNav did for a guest: `no-bottom-nav`
 * zeroes `--bottom-nav-h`, so no page reserves room for a dock that is not
 * drawn. With MobileNav mounted, it owns that class (a signed-in person can
 * still be on a no-dock page), so this only sets it while MobileNav is absent.
 */
export function SignedInChrome({ children }: { children: ReactNode }) {
  const show = useMaybeSignedIn();
  useEffect(() => {
    if (show) return;
    document.documentElement.classList.add("no-bottom-nav");
    return () => document.documentElement.classList.remove("no-bottom-nav");
  }, [show]);
  return show ? <>{children}</> : null;
}
