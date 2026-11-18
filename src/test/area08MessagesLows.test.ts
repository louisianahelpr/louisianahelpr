/**
 * Area 08 (design audit 11-18, ~/.lh-shots/design-audit-areas/08-messages-notifications/FINDINGS.md): the Medium and
 * Low fixes that are read straight from the source (comments blanked).
 *
 * M14: the "keep payments on Helpr" banner does not show on a closed thread.
 * @mutate src/components/messages/ChatView.tsx | {!bannerDismissed && !isTeam && !threadClosed && ( | {!bannerDismissed && !isTeam && (
 * M17: the settings footer names the real row (Account and safety alerts), never "System Alerts".
 * @mutate src/lib/i18n/enNotifPrefs.ts | "Safety and dispute alerts arrive under Account and safety alerts." | "Safety and dispute alerts arrive under System Alerts."
 * M19: the win-back email makes no uncounted claim and no sales talk.
 * @mutate supabase/functions/_shared/email-templates/drip.tsx |       See what's open near you\n    </Heading> |       New jobs are open in your area.\n    </Heading>
 * @mutate supabase/functions/engagement-automations/index.ts |         "See what's open near you",\n        're_engagement', |         'New jobs are open in your area.',\n        're_engagement',
 * L9: member activity notices wear their own glyph, not the generic "i".
 * @mutate src/components/notificationPanel/notificationPanelHelpers.tsx |   admin_activity: <Activity className="w-4 h-4" />, |   admin_activity: <Info className="w-4 h-4" />,
 * L18: 20px around every email button; the logo has a fixed size (brand-asset's 160x138 PNG at half size).
 * @mutate supabase/functions/_shared/email-templates/components.tsx |   <div style={{ margin: '20px 0 20px' }}> |   <div style={{ margin: '0 0 4px' }}>
 * @mutate supabase/functions/_shared/email-templates/components.tsx | width="80" height="69" className="e-logo" | width="80" height="auto" className="e-logo"
 * M10: the Recently deleted view's empty state never says "not deleted".
 * @mutate src/lib/i18n/enMessages.ts |   "msg.noneHidden": "Nothing here. Swipe a chat left to remove it from your inbox; you can restore it from here.", |   "msg.noneHidden": "Nothing hidden. Swipe a thread left to hide it — it stays here, not deleted.",
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";
import { enMessages } from "@/lib/i18n/enMessages";

const ROOT = resolve(__dirname, "..", "..");
const src = (p: string) => blankComments(readFileSync(resolve(ROOT, p), "utf8"));

describe("Area 08 Mediums and Lows (design audit 11-18)", () => {
  it("M14: no safety banner on a closed thread", () => {
    const chat = src("src/components/messages/ChatView.tsx");
    expect(chat.length).toBeGreaterThan(1000);
    expect(chat).toMatch(/\{!bannerDismissed && !isTeam && !threadClosed && \(\s*<div data-off-platform-note/);
  });

  it("M17: the settings footer names a row that exists", () => {
    // Area 08 pass 2: the footer's words live in enNotifPrefs.ts (t()).
    const prefs = src("src/components/NotificationPreferences.tsx") + src("src/lib/i18n/enNotifPrefs.ts");
    expect(prefs).toContain('{t("np.footer.safety")}');
    expect(prefs).not.toMatch(/arrive under System Alerts/);
    expect(prefs).toContain("Safety and dispute alerts arrive under Account and safety alerts.");
    expect(src("src/components/notificationPreferences/constants.tsx")).toContain('label: "Account and safety alerts"');
  });

  it("M19: the win-back email and its subject claim nothing they cannot count", () => {
    const drip = src("supabase/functions/_shared/email-templates/drip.tsx");
    const body = drip.slice(drip.indexOf("export const ReEngagementEmail"), drip.indexOf("export const", drip.indexOf("export const ReEngagementEmail") + 10));
    expect(body.length).toBeGreaterThan(200);
    for (const bad of ["been a minute", "New jobs are open", "great time", "See What's New"]) expect(body, bad).not.toContain(bad);
    expect(body).toContain('label="See open jobs"');
    expect(src("supabase/functions/engagement-automations/index.ts")).not.toContain("'New jobs are open in your area.',");
  });

  it("L9: admin_activity has its own glyph", () => {
    expect(src("src/components/notificationPanel/notificationPanelHelpers.tsx")).toContain('admin_activity: <Activity className="w-4 h-4" />');
  });

  it("L18: email buttons have room around them and the logo a fixed size", () => {
    const c = src("supabase/functions/_shared/email-templates/components.tsx");
    expect(c).toContain("<div style={{ margin: '20px 0 20px' }}>");
    expect(c).toContain('width="80" height="69"');
    expect(src("supabase/functions/_shared/email-templates/styles.ts")).toMatch(/maxWidth: '80px',\s*height: '69px',/);
  });

  it("M10: the Recently deleted empty state does not say not deleted", () => {
    expect(enMessages["msg.noneHidden"]).not.toMatch(/not deleted/);
    expect(enMessages["msg.noneHidden"]).toMatch(/restore it/);
  });
});
