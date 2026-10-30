/**
 * Every screen that asks Supabase Auth to SEND an email shows a visible result
 * when the send succeeds, never only a button label that flicks back.
 *
 * Member report 2026-10-23 (iPhone Safari, signed out): "I press resend but
 * nothing happens" on Check Your Email. Her address was already confirmed
 * (the lead measured email_confirmed_at 2026-10-22 09:44Z and no resend in
 * email_send_log); Supabase answers a signup resend for a confirmed address
 * with success and sends nothing, and the screen's only sign was its button
 * label turning "Resent". The same shape was fixed once before on the profile
 * reset card ("the only visible change was the button label").
 *
 * The class: every call site of supabase.auth.resend / resetPasswordForEmail /
 * signInWithOtp in app source (EXACT, both ways) names the visible result its
 * success shows, and the behavioural test that proves it renders.
 *
 * @mutate src/pages/auth/SignupPending.tsx |               role="status" |               role="presentation"
 */
import { describe, it, expect } from "vitest";
import path from "node:path";
import { walkSource, readSource } from "./helpers/walkSource";
import { blankComments } from "./helpers/blankNonCode";

const ROOT = path.resolve(__dirname, "../..");
const SEND = /\bsupabase\.auth\.(resend|resetPasswordForEmail|signInWithOtp)\s*\(/;

/** file -> the visible success result in it, and the test proving it renders. */
/** `shownIn`: the screen that renders the result, when the send lives in a helper it calls (default: the send's own file). */
const VISIBLE_RESULT: Record<string, { marker: string; test: string; proof: string; shownIn?: string }> = {
  "src/pages/auth/SignupPending.tsx": {
    marker: 'role="status"',
    test: "src/pages/auth/SignupPending.test.tsx",
    proof: "every success shows a visible result",
  },
  "src/pages/auth/ForgotPassword.tsx": {
    marker: 'title={sent ? "Check your inbox"',
    test: "src/pages/auth/ForgotPassword.sentResult.test.tsx",
    proof: "a successful send shows Check your inbox",
  },
  "src/components/profile/PasswordResetCard.tsx": {
    marker: "confirmConsequential(`Reset link sent to",
    test: "src/lib/toastPolicy.consequential.test.ts",
    proof: "Reset link sent to",
  },
  // A3-I5 (batch 3): the delete-account "is it really you?" code. The send is in the helper; the dialog step shows it.
  "src/lib/deleteAccountReauth.ts": {
    // Its words are in the dictionary (Spanish option, 2026-10-29): en "deleteAccount.codeSentTo" = "We sent a 6-digit code to".
    marker: 't("deleteAccount.codeSentTo")',
    shownIn: "src/components/profile/DeleteAccountReauth.tsx",
    test: "src/test/deleteAccountAsksWhoYouAre.test.tsx",
    proof: "we sent a 6-digit code to",
  },
};

function sendSites(): string[] {
  return walkSource([path.join(ROOT, "src")])
    .filter((f) => !/\.test\.tsx?$/.test(f) && !f.includes(`${path.sep}test${path.sep}`))
    .filter((f) => SEND.test(blankComments(readSource(f) ?? "")))
    .map((f) => path.relative(ROOT, f).split(path.sep).join("/"))
    .sort();
}

describe("every auth email send shows a visible result", () => {
  it("the inventory of send sites is exact, both ways", () => {
    const sites = sendSites();
    expect(sites.length, "inventory floor: the walker found the send sites").toBeGreaterThanOrEqual(3);
    expect(sites).toEqual(Object.keys(VISIBLE_RESULT).sort());
  });

  for (const [file, want] of Object.entries(VISIBLE_RESULT)) {
    it(`${file} renders its success result, and a test proves it`, () => {
      const src = blankComments(readSource(path.join(ROOT, want.shownIn ?? file)) ?? "");
      expect(src, `${want.shownIn ?? file} must show ${want.marker}`).toContain(want.marker);
      expect(readSource(path.join(ROOT, want.test)) ?? "", `${want.test} must prove it`).toContain(want.proof);
    });
  }
});
