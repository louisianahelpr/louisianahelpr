/**
 * Q2466 (lead 2026-11-01): the Declutter refund receipt email is a money receipt and always sends. The sender
 * (declutter-money's tellBuyerRefunded) reads no notification switch, and every place a member reads about it says so:
 * the Refunds row's dash in Settings and the Terms. A switch added on one side only would make one of them untrue.
 *
 * @mutate src/components/notificationPreferences/constants.tsx | strikes. Refund receipts are always emailed." | strikes."
 * @mutate src/pages/info/legal/TermsSection.tsx | Declutter always emails your sale, payout and refund receipts. | Declutter always emails your sale and payout receipts.
 * @mutate supabase/functions/declutter-money/index.ts |     const { data: profile, error } = await admin.from("profiles").select("email, full_name").eq("user_id", buyerId).maybeSingle(); |     const { data: profile, error } = await admin.from("notification_preferences").select("email, full_name").eq("user_id", buyerId).maybeSingle();
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { blankComments } from "./helpers/blankNonCode";
import { declutterRows } from "@/components/notificationPreferences/constants";

const read = (p: string) => blankComments(readFileSync(join(process.cwd(), p), "utf8"));

describe("the Declutter refund receipt always sends, and says so", () => {
  it("the sender queues the receipt with no switch read", () => {
    const money = read("supabase/functions/declutter-money/index.ts");
    const start = money.indexOf("async function tellBuyerRefunded(");
    const end = money.indexOf("\nasync function ", start + 10);
    const fn = money.slice(start, end);
    expect(fn.length).toBeGreaterThan(400);
    expect(fn).toContain('subject: "Your Declutter refund"');
    expect(fn).toContain("await queueEmail(admin, {");
    expect(fn).not.toMatch(/notification_preferences|email_declutter_refunds|send-notification-email/);
  });

  // H1 (Declutter buy audit 11-08): refund notices now email under the Refunds switch, so the row has a real switch;
  // its description says the receipt goes whatever that switch says.
  it("Settings says on the Refunds row that the receipt is always emailed", () => {
    const refunds = declutterRows.find((r) => r.key === "declutter_refunds");
    expect(declutterRows.length).toBeGreaterThan(5);
    expect(refunds?.description).toContain("Refund receipts are always emailed.");
  });

  it("the Terms say refund receipts are always emailed", () => {
    expect(read("src/pages/info/legal/TermsSection.tsx")).toContain("Declutter always emails your sale, payout and refund receipts.");
  });
});
