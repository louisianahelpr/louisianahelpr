/**
 * OA-018: a web Apple/Google sign-in that GoTrue refused comes back as
 * ?error=…&error_code=…#error=… on /home. Nothing read it; Login showed "That
 * page needs an account" instead. These pin the capture and its scoping.
 * @mutate src/lib/oauthRedirectError.ts | if (!pending) return null; | if (!pending && !hasError) return null;
 */
import { beforeEach, describe, expect, it } from "vitest";
import {
  SOCIAL_AUTH_ERROR_CODES,
  captureOAuthRedirectError,
  markOAuthPending,
  socialAuthErrorCopy,
  takeOAuthRedirectError,
} from "./oauthRedirectError";

const DESC = "Unverified email with google. A confirmation email has been sent to your google email";

function fakeLocation(url: string) {
  const u = new URL(url, "https://www.louisianahelpr.com");
  let replaced: string | null = null;
  const loc = { pathname: u.pathname, search: u.search, hash: u.hash } as Location;
  const hist = {
    state: null,
    replaceState: (_s: unknown, _t: string, next: string) => {
      replaced = next;
    },
  } as unknown as History;
  return { loc, hist, replaced: () => replaced };
}

const errorUrl = (code: string, desc = DESC) => {
  const q = new URLSearchParams({ error: "access_denied", error_code: code, error_description: desc });
  const h = new URLSearchParams({ error: "access_denied", error_code: code, error_description: desc, sb: "" });
  return `/home?${q}#${h}`;
};

beforeEach(() => {
  sessionStorage.clear();
  takeOAuthRedirectError(); // drain any in-memory capture from an earlier case
});

describe("captureOAuthRedirectError", () => {
  it("captures a refused Google round trip, strips the URL and hands Login the reason once", () => {
    markOAuthPending("google");
    const f = fakeLocation(errorUrl("provider_email_needs_verification"));
    const got = captureOAuthRedirectError(f.loc, f.hist);
    expect(got?.code).toBe("provider_email_needs_verification");
    expect(got?.message).toMatch(/Verify it with Google/);
    expect(f.replaced()).toBe("/home");
    expect(sessionStorage.getItem("helpr_oauth_pending")).toBeNull();

    expect(takeOAuthRedirectError()?.code).toBe("provider_email_needs_verification");
    expect(takeOAuthRedirectError()).toBeNull();
  });

  it("leaves an error URL it did not cause alone (an expired /reset-password link)", () => {
    const f = fakeLocation("/reset-password#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired");
    expect(captureOAuthRedirectError(f.loc, f.hist)).toBeNull();
    expect(f.replaced()).toBeNull();
    expect(takeOAuthRedirectError()).toBeNull();
  });

  it("ignores a stale marker (an abandoned attempt, not this redirect)", () => {
    sessionStorage.setItem("helpr_oauth_pending", JSON.stringify({ provider: "apple", at: Date.now() - 60 * 60 * 1000 }));
    const f = fakeLocation(errorUrl("user_banned", "User is banned"));
    expect(captureOAuthRedirectError(f.loc, f.hist)).toBeNull();
  });

  it("says nothing when the person declined on the provider's own screen", () => {
    markOAuthPending("google");
    const f = fakeLocation("/home?error=access_denied&error_description=The+user+denied+the+request");
    expect(captureOAuthRedirectError(f.loc, f.hist)).toBeNull();
    expect(f.replaced()).toBe("/home");
  });

  it("clears the marker on a successful return and captures nothing", () => {
    markOAuthPending("apple");
    const f = fakeLocation("/home#access_token=x&refresh_token=y&type=bearer");
    expect(captureOAuthRedirectError(f.loc, f.hist)).toBeNull();
    expect(sessionStorage.getItem("helpr_oauth_pending")).toBeNull();
    expect(f.replaced()).toBeNull();
  });

  it("names the two-accounts-one-email refusal, which GoTrue sends with no dedicated code", () => {
    markOAuthPending("apple");
    const f = fakeLocation(
      errorUrl("unexpected_failure", "Multiple accounts with the same email address in the same linking domain detected: default"),
    );
    expect(captureOAuthRedirectError(f.loc, f.hist)?.message).toMatch(/More than one Helpr account/);
  });
});

describe("socialAuthErrorCopy — every social refusal has its own words", () => {
  it("covers each GoTrue code the social path can end in", () => {
    expect(SOCIAL_AUTH_ERROR_CODES.length).toBeGreaterThan(9);
    for (const provider of ["apple", "google"] as const) {
      for (const code of SOCIAL_AUTH_ERROR_CODES) {
        const copy = socialAuthErrorCopy(provider, code);
        expect(copy, `${provider}/${code}`).toBeTruthy();
        expect(copy).not.toMatch(/give it another try\?$/);
        // Never role-based copy (CLAUDE.md UI rules).
        expect(copy).not.toMatch(/\b(helpers?|posters?|customers?)\b/i);
      }
    }
  });

  it("returns null for a code it does not know, so the caller keeps its fallback", () => {
    expect(socialAuthErrorCopy("google", "some_new_code")).toBeNull();
  });
});
