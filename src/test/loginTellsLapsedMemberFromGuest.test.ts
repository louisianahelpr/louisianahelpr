/**
 * Audit 11-10 W2 F281a: after a session ended, tapping "Message Hallie" on the still-open job page bounced to /login
 * with the guest line ("Your messages need an account. Create an account, or log in...") leading with Create an
 * account. A browser that has held a session is a lapsed member's: the line is the session-lost one and leads with
 * Log in. The flag is written whenever the auth snapshot carries a user (useAuthReady.emitAuthSnapshot).
 *
 * @mutate src/pages/auth/loginNotice.ts | : o.sessionLost \|\| (o.bouncedFromGatedRoute && o.hadSessionHere) | : o.sessionLost
 * @mutate src/lib/hadSession.ts | window.localStorage.setItem(HAD_SESSION_KEY, "1"); |
 */
import { beforeEach, describe, expect, it } from "vitest";
import { loginNotice } from "@/pages/auth/loginNotice";
import { HAD_SESSION_KEY, hadSessionOnThisBrowser, rememberHadSession } from "@/lib/hadSession";

const base = { oauthError: null, connect: null, signedOutForInactivity: false, arrivedFromSignup: false, bouncedFromGatedRoute: true, redirect: "/messages?jobId=j1&userId=u1" };

describe("F281a: /login tells a lapsed member from a guest", () => {
  beforeEach(() => window.localStorage.removeItem(HAD_SESSION_KEY));

  it("a browser that held a session gets the session-lost line and leads with Log in", () => {
    const n = loginNotice({ ...base, hadSessionHere: true });
    expect(n.notice).toBe("You were signed out on this browser. Log back in and we'll take you right back to where you were.");
    expect(n.leadWithSignup).toBe(false);
  });

  it("a browser that never held one keeps the guest line and leads with Create an account", () => {
    const n = loginNotice({ ...base, redirect: "/post-job", hadSessionHere: false });
    expect(n.notice).toMatch(/^Posting a job needs a free account\./);
    expect(n.leadWithSignup).toBe(true);
  });

  // F418 (audit 11-10): a /messages link is a member's (message email or notice), so even a fresh browser leads with Log in.
  // @mutate src/pages/auth/loginNotice.ts |   ["/messages", "Log in to see your messages."], |   ["/messagesx", "Log in to see your messages."],
  it("a messages link on a fresh browser says log in and leads with Log in", () => {
    const n = loginNotice({ ...base, hadSessionHere: false });
    expect(n.notice).toBe("Log in to see your messages. We'll take you straight back to it.");
    expect(n.leadWithSignup).toBe(false);
  });

  it("the flag is remembered on this browser once set", () => {
    expect(hadSessionOnThisBrowser()).toBe(false);
    rememberHadSession();
    expect(hadSessionOnThisBrowser()).toBe(true);
  });
});
