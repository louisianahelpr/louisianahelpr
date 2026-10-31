/**
 * What /signup does the moment it opens (moved out of Signup.tsx, which is over the component-size line).
 */
import { useEffect } from "react";
import type { NavigateFunction } from "react-router-dom";
import { useAuthReady } from "@/hooks/useAuthReady";
import { track, AhaEvent } from "@/lib/analytics";
import { ppoTrackingProps } from "@/lib/ppoAttribution";
import { rememberReferralFromUrl } from "@/lib/pendingReferral";
import { rememberJobIntent, rememberSignupRedirect, postAuthDestination } from "@/lib/jobIntent";

export function useSignupEntry(searchParams: URLSearchParams, navigate: NavigateFunction) {
  const { user, isReady } = useAuthReady();
  // `?job=<id>` — the job a guest tapped on /browse or /jobs before the signup
  // wall. `?redirect=<path>` — the fuller form of the same idea: the exact
  // in-app route they were trying to reach (e.g. `/jobs/<id>`). Persist both
  // immediately, because signup does not end here: it ends at /signup-pending
  // and then in the visitor's email client, and neither router state nor a
  // query param survives that round-trip. See lib/jobIntent.
  //
  // SECURITY: `redirect` is attacker-controllable. `rememberSignupRedirect`
  // drops anything that isn't a same-origin path, so a crafted
  // `/signup?redirect=https://evil.com` stores nothing and the flow falls back
  // to its normal landing.
  const pendingJobId = searchParams.get("job");
  const pendingRedirect = searchParams.get("redirect");
  // NOTE ON ORDER: this effect is declared BEFORE the already-authenticated
  // bounce below on purpose. Both fire on the mount commit, in declaration
  // order, and the bounce reads the value this one writes.
  useEffect(() => {
    if (pendingJobId) rememberJobIntent(pendingJobId);
    rememberSignupRedirect(pendingRedirect); rememberReferralFromUrl(window.location.search); // ?ref= survives an Apple/Google sign-up
  }, [pendingJobId, pendingRedirect]);
  // An already-authenticated visitor is bounced into the app (after isReady, never on the null snapshot).
  useEffect(() => {
    if (isReady && user) navigate(postAuthDestination(), { replace: true });
  }, [isReady, user, navigate]);
  // Funnel event: user landed on signup page (top of activation funnel)
  useEffect(() => {
    track(AhaEvent.SignupStarted, { source: "web", ...ppoTrackingProps() });
  }, []);
}
