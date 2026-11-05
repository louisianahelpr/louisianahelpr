import { useEffect, useState } from "react";
import type { NavigateFunction } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { definitelyGuest } from "@/lib/persistedAuthToken";

/** The guest Browse feed's session check (DashboardGuest): true once we know this visitor has no session. */
export function useGuestSessionCheck(navigate: NavigateFunction): boolean {
  // Bounce already-authenticated users straight to the real dashboard so
  // they never see the guest surface (would confuse anyone with a session).
  //
  // The redirect alone was NOT enough, and the comment above was describing an
  // intent the code did not deliver: getSession() is async, so the guest
  // surface rendered first and only bounced a beat later. A signed-in user
  // watched the logged-out page — "browse as a guest", signup CTAs — flash up
  // before being thrown to the dashboard. Reported as "once I log in it should
  // never redirect me to the guest pages".
  //
  // So the render is now HELD until the session answer is in. Until then this
  // shows the same skeleton the route already uses as its Suspense fallback,
  // so a genuine guest sees no extra delay in kind — just the loading state
  // they were going to see anyway — while a signed-in user never sees the
  // guest surface at all.
  //
  // Fast-path: if localStorage has no auth token we are definitely a guest —
  // resolve synchronously without an async getSession() round-trip.
  // supabase-js always writes a key matching /^sb-.+-auth-token$/ on sign-in,
  // so an absent key is a reliable "no session" signal and avoids a hang when
  // getSession() stalls during internal initialisation.
  // In the app, an evicted localStorage reads empty until the Keychain
  // restore lands, so the fast path waits for that (Q1463): definitelyGuest()
  // is false until then, and the async check below (getSession() waits for
  // the restore) decides.
  const [sessionChecked, setSessionChecked] = useState(definitelyGuest);
  useEffect(() => {
    if (sessionChecked) return; // already resolved via the synchronous pre-check
    let cancelled = false;
    // Belt-and-suspenders timeout: if getSession() stalls (e.g. during
    // supabase-js internal lock acquisition), show the guest surface rather
    // than hanging on the skeleton forever.
    const fallback = setTimeout(() => {
      if (!cancelled) setSessionChecked(true);
    }, 5_000);
    supabase.auth.getSession()
      .then(({ data }) => {
        clearTimeout(fallback);
        if (cancelled) return;
        if (data.session?.user) navigate("/home", { replace: true });
        else setSessionChecked(true);
      })
      .catch(() => {
        clearTimeout(fallback);
        if (!cancelled) setSessionChecked(true);
      });
    return () => { cancelled = true; clearTimeout(fallback); };
  }, [navigate, sessionChecked]);
  return sessionChecked;
}
