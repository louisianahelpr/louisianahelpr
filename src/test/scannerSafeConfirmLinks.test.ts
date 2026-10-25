/**
 * Scanner-safe email confirmation links (lead, 2026-10-25).
 *
 * Prod auth logs 2026-10-20..25: 107 verify successes against 30 "One-time
 * token not found" and 13 "email link has expired"; 53 of 164 email sign-ups
 * since 10-15 never confirmed. The old link was GoTrue's GET /verify, which a
 * mail scanner's pre-fetch spends before the person taps. The new link opens
 * /signup-pending with the token as data, and only the person's tap spends it.
 *
 * Guards:
 * - the link carries the token as data and opens the app's own page;
 * - the page reads a token, an expired link, or nothing, and nothing else;
 * - the sign-up email uses the new link only behind its switch, and the
 *   reminders always use it;
 * - the page renders the Confirm panel for a token or an expired link.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  CONFIRM_LINK_PATH,
  SCANNER_SAFE_CONFIRM_SWITCH,
  confirmLinkUrl,
  isSpentOrExpired,
  readConfirmLink,
} from "../../supabase/functions/_shared/confirmLink";

const code = (p: string) => readFileSync(p, "utf8");

describe("scanner-safe confirm links", () => {
  it("the link opens the app's own page with the token as data, never GoTrue's /verify", () => {
    const url = new URL(confirmLinkUrl("https://www.louisianahelpr.com", "abcDEF123_-xyz", "signup"));
    expect(url.pathname).toBe(CONFIRM_LINK_PATH);
    expect(url.searchParams.get("token_hash")).toBe("abcDEF123_-xyz");
    expect(url.searchParams.get("type")).toBe("signup");
    expect(url.toString()).not.toMatch(/\/auth\/v1\/verify/);
  });

  it("the page reads a token, an expired link, or nothing", () => {
    expect(readConfirmLink("?token_hash=abcDEF123_-xyz&type=signup", "")).toEqual({ kind: "token", tokenHash: "abcDEF123_-xyz", type: "signup" });
    expect(readConfirmLink("?token_hash=abcDEF123_-xyz&type=magiclink", "")).toEqual({ kind: "token", tokenHash: "abcDEF123_-xyz", type: "magiclink" });
    // A type the page does not spend, or a malformed token, is not a token.
    expect(readConfirmLink("?token_hash=abcDEF123_-xyz&type=recovery", "")).toEqual({ kind: "none" });
    expect(readConfirmLink("?token_hash=%3Cscript%3E&type=signup", "")).toEqual({ kind: "none" });
    // GoTrue reports a spent/expired GET link in the query or the fragment.
    expect(readConfirmLink("", "#error=access_denied&error_code=otp_expired")).toEqual({ kind: "expired" });
    expect(readConfirmLink("?error_code=otp_expired", "")).toEqual({ kind: "expired" });
    expect(readConfirmLink("", "")).toEqual({ kind: "none" });
  });

  it("a spent or expired token is told apart from a network fault", () => {
    expect(isSpentOrExpired({ code: "otp_expired" })).toBe(true);
    expect(isSpentOrExpired({ message: "Token has expired or is invalid", status: 403 })).toBe(true);
    expect(isSpentOrExpired({ message: "Failed to fetch" })).toBe(false);
    expect(isSpentOrExpired(null)).toBe(false);
  });

  it("the sign-up email uses the new link only behind its switch; GoTrue's link stays the fallback", () => {
    const hook = code("supabase/functions/auth-email-hook/index.ts");
    // @mutate supabase/functions/auth-email-hook/index.ts | await scannerSafeFor(supabase, user.id) | true
    expect(hook).toMatch(/await scannerSafeFor\(supabase, user\.id\)/);
    expect(hook).toMatch(/rpc\('scanner_safe_confirm_link_for'/);
    expect(hook).toMatch(/confirmLinkUrl\(getAppUrl\(\),\s*emailData\.token_hash,\s*'signup'\)/);
    expect(hook).toMatch(/:\s*verifyUrl\.toString\(\)/);
    expect(SCANNER_SAFE_CONFIRM_SWITCH).toBe("scanner_safe_confirm_links");
    const mig = code("supabase/migrations/20261025190000_confirm_reminders.sql");
    expect(mig).toMatch(/\('scanner_safe_confirm_links',\s*'testers'/);
    expect(mig).toMatch(/feature_enabled_for_user\('scanner_safe_confirm_links', p_user_id\)/);
  });

  it("the reminders always send the scanner-safe link", () => {
    const fn = code("supabase/functions/confirm-reminders/index.ts");
    // @mutate supabase/functions/confirm-reminders/index.ts | const confirmationUrl = confirmLinkUrl(getAppUrl(), hashed, "magiclink"); | const confirmationUrl = (link as { properties?: { action_link?: string } }).properties?.action_link ?? "";
    expect(fn).toMatch(/const confirmationUrl = confirmLinkUrl\(getAppUrl\(\), hashed, "magiclink"\)/);
  });

  it("the Check your email page shows the Confirm panel for a token or an expired link", () => {
    const page = code("src/pages/auth/SignupPending.tsx");
    // @mutate src/pages/auth/SignupPending.tsx | if (confirmLink.kind !== "none") { | if (false) {
    expect(page).toMatch(/if \(confirmLink\.kind !== "none"\) \{/);
    expect(page).toMatch(/<ConfirmLinkPanel/);
    const panel = code("src/pages/auth/signupPending/ConfirmLinkPanel.tsx");
    // The token is spent by a tap (verifyOtp inside the click handler), never on render.
    expect(panel).toMatch(/supabase\.auth\.verifyOtp\(\{ token_hash: token\.tokenHash, type: token\.type \}\)/);
    expect(panel).not.toMatch(/useEffect\([^)]*verifyOtp/s);
  });
});
