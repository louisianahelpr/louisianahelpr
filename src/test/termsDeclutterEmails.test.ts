/**
 * AUD31-25 (audit 10-31, Legal): the Terms said "Declutter emails you only about money", but the Pickups email switch is
 * on by default and pickup and no-show notices are emailed through it (as are price drops and Wanted matches). The
 * Terms now name what is emailed, from the same switch table Settings shows (declutterRows): the rows with no email
 * switch are app only; Sales and Refunds receipts are always emailed; the rest email unless turned off.
 *
 * @mutate src/pages/info/legal/TermsSection.tsx | Pickup reminders, price drops and Wanted matches are emailed too | Pickup reminders are emailed too
 * @mutate src/pages/info/legal/TermsSection.tsx | Listings, offers and questions come only | Listings and offers come only
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";
import { declutterRows } from "@/components/notificationPreferences/constants";

const terms = blankComments(readFileSync(resolve(__dirname, "../pages/info/legal/TermsSection.tsx"), "utf8"));
const APP_ONLY = "In the app only, no email for this";

describe("AUD31-25: the Terms say which Declutter notices are emailed", () => {
  it("names every Declutter switch the way Settings treats its email", () => {
    expect(declutterRows.length).toBeGreaterThan(7);
    expect(terms).not.toContain("emails you only about money");
    const sentence = terms.match(/<p>Declutter always emails[^<]*<\/p>/)?.[0] ?? "";
    expect(sentence).not.toBe("");
    const appOnly = declutterRows.filter((r) => r.noEmailSwitch === APP_ONLY).map((r) => r.label.toLowerCase());
    const optional = declutterRows.filter((r) => !r.noEmailSwitch).map((r) => r.label.toLowerCase());
    expect(appOnly).toEqual(["listings", "offers", "questions"]);
    expect(sentence).toContain("Listings, offers and questions come only as a push notification and in-app alert.");
    expect(optional).toEqual(["pickups", "price drops", "wanted matches"]);
    expect(sentence).toContain("Pickup reminders, price drops and Wanted matches are emailed too unless you turn their email off in Settings.");
    expect(sentence).toContain("always emails your sale, payout and refund receipts");
  });
});
