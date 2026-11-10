/**
 * Audit 11-10 W2 F281a: a member whose session ended, then tapped an action on a page that was still showing (the job
 * page's "Message Hallie"), was bounced to /login with the guest line "Your messages need an account. Create an
 * account, or log in..." and a Create-an-account lead: as if they had never had one. ProtectedRoute's
 * `signed_out=session-lost` only fires when the session is lost ON a signed-in screen; a bounce from a gated route
 * carries no such marker. This flag remembers that this browser has held a session, so /login can tell the two apart.
 *
 * localStorage THROWS (not null) in some private windows; every call is wrapped. Never cleared on sign-out on purpose:
 * a member who logged out and comes back is still a member, and the line it selects ("You were signed out on this
 * browser. Log back in...") leads with Log in, which is right for them too.
 */
export const HAD_SESSION_KEY = "helpr_had_session";

export function rememberHadSession(): void {
  try {
    window.localStorage.setItem(HAD_SESSION_KEY, "1");
  } catch {
    /* storage unavailable: the guest line is shown, as before */
  }
}

export function hadSessionOnThisBrowser(): boolean {
  try {
    return window.localStorage.getItem(HAD_SESSION_KEY) === "1";
  } catch {
    /* storage unavailable or blocked: no memory of a session, so the guest line, as before */
    return false;
  }
}
