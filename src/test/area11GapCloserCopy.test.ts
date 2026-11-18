// Area 11 (gap closer, 11-18) copy fixes. Each line below is the finding's own words, now gone.
//   M16 strike dialog "INTERNAL NOTE (SENT TO USER)" -> "Note to the member (they'll see it)" (13 px, sentence case)
//   L14 payout failed "Fix bank" (40 px) vs body "bank or card" -> "Update payout method", h-11
//   L16 sponsor form "NOT saved" -> "wasn't saved"
//   L19 Receipts "you were ruled at fault on" -> "Card cost owed after a ruling on one of your jobs"
//       (job_helpr_fault_rulings is an admin ruling, not only a dispute; card_fee_remaining_cents is the card cost)
//   L13 one rate-limit sentence on the auth screens (authErrors AUTH_RATE_LIMIT_MESSAGE)
//   M10 the approve window says what it is for (escrowTiming.ts THE RULE, rule 2)
//   L3  "Paid and released" -> "Paid. Your Helpr's pay goes out ..."
//
// @mutate src/components/admin/FormalWarningDialog.tsx | Note to the member (they'll see it)</p> | Internal note (sent to user)</p>
// @mutate src/components/money/PayoutFailedCard.tsx |         Update payout method |         Fix bank
// @mutate src/content/sponsorPage.ts | your sign-up wasn't saved. | your sign-up was NOT saved.
// @mutate src/pages/profile/Receipts.tsx | "Card cost owed after a ruling on one of your jobs" | "Amount owed from a job you were ruled at fault on"
// @mutate src/pages/auth/SignupPending.tsx | toast.error(AUTH_RATE_LIMIT_MESSAGE); | toast.error("Too many requests — try again in a minute.");
// @mutate src/pages/jobs/jobPage/reviewTimeLeft.ts | left to approve or ask for a change, then Helpr support steps in`; | left, then Helpr support steps in`;
// @mutate src/pages/jobs/jobPage/JobPageParts.tsx | `Paid. Your Helpr's pay goes out ${payoutWhen(at)}.` | `Paid and released to your Helpr. Their pay goes out ${payoutWhen(at)}.`
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { blankComments } from "./helpers/blankNonCode";
import { AUTH_RATE_LIMIT_MESSAGE, recognizedAuthError } from "@/lib/authErrors";
import { enScreens } from "@/lib/i18n/enScreens";
import { sponsorPage } from "@/content/sponsorPage";
import { reviewTimeLeft } from "@/pages/jobs/jobPage/reviewTimeLeft";

const src = (rel: string) => blankComments(fs.readFileSync(path.resolve(__dirname, "..", rel), "utf8"));

describe("area 11 gap-closer copy", () => {
  const files = {
    strike: src("components/admin/FormalWarningDialog.tsx"),
    payout: src("components/money/PayoutFailedCard.tsx"),
    receipts: src("pages/profile/Receipts.tsx"),
    fees: src("components/money/FeesOwedLine.tsx"),
    pending: src("pages/auth/SignupPending.tsx"),
    parts: src("pages/jobs/jobPage/JobPageParts.tsx"),
  };
  it("the files were read", () => {
    for (const s of Object.values(files)) expect(s.length).toBeGreaterThan(500);
  });
  it("M16: the strike note says the member sees it, in sentence case at 13 px", () => {
    expect(files.strike).not.toMatch(/Internal note \(sent to user\)/);
    expect(files.strike).toMatch(/<p className="text-ds-13 font-medium text-muted-foreground">Note to the member \(they'll see it\)<\/p>/);
  });
  it("L14: the payout card's button names the payout method at 44 px", () => {
    expect(files.payout).not.toMatch(/>\s*Fix bank\s*</);
    expect(files.payout).toMatch(/h-11 px-5[^>]*>\s*Update payout method\s*</);
  });
  it("L16: the sponsor error doesn't shout", () => {
    expect(sponsorPage.claim.errors.generic).not.toMatch(/\bNOT\b/);
    expect(sponsorPage.claim.errors.generic).toContain("wasn't saved");
  });
  it("L19: the fault debt is named for what it is", () => {
    for (const s of [files.receipts, files.fees]) {
      expect(s).not.toMatch(/ruled at fault on/);
      expect(s).toContain("Card cost owed after a ruling on one of your jobs");
    }
  });
  it("L13: one rate-limit sentence across login, sign-up resend and forgot password", () => {
    expect(recognizedAuthError("Email rate limit exceeded")).toBe(AUTH_RATE_LIMIT_MESSAGE);
    expect(recognizedAuthError("For security purposes, you can only request this after 40 seconds")).toBe(AUTH_RATE_LIMIT_MESSAGE);
    expect(enScreens["forgot.tooMany"]).toBe(AUTH_RATE_LIMIT_MESSAGE);
    expect(files.pending).toContain("toast.error(AUTH_RATE_LIMIT_MESSAGE);");
    expect(files.pending).not.toMatch(/Too many requests/);
  });
  it("M10: the approve window says it is for approving or asking for a change", () => {
    const now = Date.parse("2026-11-18T12:00:00Z");
    expect(reviewTimeLeft(now + (23 * 60 + 39) * 60_000, now)).toBe("23h 39m left to approve or ask for a change, then Helpr support steps in");
  });
  it("L3: the released line never says 'released' before the pay goes out", () => {
    expect(files.parts).not.toMatch(/Paid and released/);
    expect(files.parts).toContain("`Paid. Your Helpr's pay goes out ${payoutWhen(at)}.`");
  });
});
