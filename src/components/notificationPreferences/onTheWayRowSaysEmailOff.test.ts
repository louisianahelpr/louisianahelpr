/**
 * Audit 11-10 F452: Settings > Notifications showed "Helpr on the way" with its email switch off and no word why,
 * so it read as a leftover. The email for that row starts off for everyone (notification_preferences
 * .email_transit_updates DEFAULT false since 20260418215317; the client default matches) and the row now says so.
 * The other "off" switches the finding saw are owner decisions, not defaults gone wrong: Promotions email is
 * "not chosen until set" (Q2299, null), saved-Helpr openings are opt-in (owner 2026-09-15), quiet hours are off
 * until set.
 *
 * @mutate src/components/notificationPreferences/constants.tsx | description: "As your Helpr heads your way. Email is off unless you turn it on.", | description: "As your Helpr heads your way.",
 * @mutate src/components/notificationPreferences/constants.tsx |   transit_updates: true, email_transit_updates: false, |   transit_updates: true, email_transit_updates: true,
 */
import { describe, expect, it } from "vitest";
import { defaultPrefs, rows } from "./constants";

describe("the Helpr-on-the-way row explains its off email (F452)", () => {
  it("email starts off, and the row says so", () => {
    expect(defaultPrefs.email_transit_updates).toBe(false);
    const row = rows.find((r) => r.key === "transit_updates");
    expect(row?.label).toBe("Helpr on the way");
    expect(row?.description).toMatch(/Email is off unless you turn it on\./);
  });
  it("the other defaults the finding saw are the decided ones", () => {
    expect(defaultPrefs.email_promotions).toBeNull();
    expect(defaultPrefs.saved_helper_availability).toBe(false);
    expect(defaultPrefs.quiet_start).toBeNull();
    expect(defaultPrefs.quiet_end).toBeNull();
  });
});
