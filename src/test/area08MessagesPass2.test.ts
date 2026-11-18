/**
 * Area 08 pass 2 (design audit 11-18, ~/.lh-shots/design-audit-areas/08-messages-notifications/FINDINGS.md).
 *
 * @mutate src/components/notificationPreferences/QuietHoursCard.tsx |               {t("np.quiet.desc")}\n |               Hold app notifications overnight. Everything still shows in your notifications.\n
 * @mutate src/components/notificationPreferences/TestSendCard.tsx |             {t("np.test.label")}\n |             Send a test\n
 * @mutate src/components/notificationPreferences/JobRemindersGroup.tsx |                     {t("np.jr.alwaysOn")}\n |                     Always on\n
 * @mutate src/components/NotificationPreferences.tsx |           {t("np.footer.safety")}{" "}\n | Safety and dispute alerts arrive under Account and safety alerts.{" "}\n
 * @mutate src/components/notificationPreferences/SmsAlertsCard.tsx |           {t("np.sms.title")}\n |           Text alerts\n
 * @mutate src/components/NotificationPanelView.tsx |                     <span>{group.label}</span>\n |                     <span>{group.label}</span><span>{group.items.length}</span>\n
 * @mutate src/components/messages/MessageBubble.tsx | relative z-10 mt-0.5 flex | relative z-10 -mt-2 flex
 * @mutate src/components/NotificationPreferences.tsx | className="sticky top-0 z-20 flex items-center justify-end | className="flex items-center justify-end
 * @mutate src/components/NotificationPreferences.tsx | liquid-glass overflow-clip shadow-sm | liquid-glass overflow-hidden shadow-sm
 * @mutate src/components/SosShareButton.tsx |         {t("cp.safetyLabel")}\n |         {""}\n
 * @mutate src/components/messages/ConversationListHeader.tsx |           {inboxTab === "pinned" ? t("msg.viewPinned") : t("msg.viewDeleted")}\n |           {""}\n
 * @mutate src/components/messages/ConversationListHeader.tsx |           aria-label={t("msg.backToAll")}\n | \n
 * @mutate src/components/messages/chatView/ChatTimeline.tsx |             hideTime={timeOnNext}\n | \n
 * @mutate src/components/messages/MessageBubble.tsx |             {!hideTime ? ( |             {true ? (
 * @mutate src/components/messages/chatView/ChatTimeline.tsx | export const TIME_GROUP_MS = 10 * 60 * 1000; | export const TIME_GROUP_MS = 0;
 * @mutate supabase/functions/_shared/email-templates/email-changed.tsx |         Questions? Write to us at <SupportAddress />.\n      </TransactionalFooter>\n    }\n  >\n    <Heading className="e-h1" style={h1}>\n      {SELF_CHANGE_HEADING} |         Questions? Contact us at <SupportAddress />.\n      </TransactionalFooter>\n    }\n  >\n    <Heading className="e-h1" style={h1}>\n      {SELF_CHANGE_HEADING}
 * @mutate supabase/functions/_shared/email-templates/drip.tsx |       Questions? Write to us at admin@louisianahelpr.com.\n |       Questions? admin@louisianahelpr.com.\n
 * @mutate supabase/functions/_shared/email-templates/confirmReminder.tsx | create an account on Louisiana Helpr | create an account on Helpr
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { blankComments } from "./helpers/blankNonCode";
import { enNotifPrefs } from "@/lib/i18n/enNotifPrefs";
import { esNotifPrefs } from "@/lib/i18n/esNotifPrefs";
import { jobReminderWords } from "@/lib/i18n/notifPrefWords";
import { TIME_GROUP_MS } from "@/components/messages/chatView/ChatTimeline";

const code = (f: string) => blankComments(readFileSync(f, "utf8"));
const P = "src/components/notificationPreferences/";

describe("H3 rest: the whole Notification settings screen goes through t()", () => {
  const files: [string, string[]][] = [
    [`${P}QuietHoursCard.tsx`, ["np.quiet.label", "np.quiet.desc", "np.quiet.from", "np.quiet.to"]],
    [`${P}TestSendCard.tsx`, ["np.test.label", "np.test.none", "np.test.many", "np.test.button"]],
    [`${P}JobRemindersGroup.tsx`, ["np.jr.title", "np.jr.desc", "np.jr.alwaysOn"]],
    ["src/components/NotificationPreferences.tsx", ["np.h.app", "np.h.email", "np.all", "np.footer.safety", "np.footer.auth"]],
    [`${P}SmsAlertsCard.tsx`, ["np.sms.title", "np.sms.phone", "np.sms.turnOn", "np.sms.what"]],
  ];
  it("each card reads its words by key, and every key has Spanish", () => {
    let n = 0;
    for (const [f, keys] of files) {
      const src = code(f);
      for (const k of keys) {
        expect(src, `${f} uses ${k}`).toContain(`t("${k}"`);
        expect(esNotifPrefs[k as keyof typeof esNotifPrefs], k).toBeTruthy();
        n++;
      }
    }
    expect(n).toBeGreaterThan(15);
    // The old English sentences are gone from the components.
    expect(code(`${P}QuietHoursCard.tsx`)).not.toContain("Hold app notifications overnight");
    expect(code(`${P}TestSendCard.tsx`)).not.toMatch(/>\s*Send a test\s*</);
    expect(code(`${P}JobRemindersGroup.tsx`)).not.toMatch(/>\s*Always on\s*</);
    expect(code(`${P}SmsAlertsCard.tsx`)).not.toMatch(/>\s*Text alerts\s*</);
    expect(code("src/components/NotificationPreferences.tsx")).not.toMatch(/^\s*Safety and dispute alerts arrive/m);
  });
  it("job reminder rows: Spanish only while the server's English is the English we translated", () => {
    expect(Object.keys(enNotifPrefs).filter((k) => k.startsWith("np.jr.l.")).length).toBeGreaterThan(10);
    expect(jobReminderWords("starting_soon", "l", "Starting soon")).toBe("Starting soon");
    expect(jobReminderWords("starting_soon", "l", "Reworded on the server")).toBe("Reworded on the server");
    expect(jobReminderWords("no_such_kind", "d", "Anything")).toBe("Anything");
  });
});

describe("M8: one count on the Notifications tab", () => {
  it("the day header carries no count of its own", () => {
    const src = code("src/components/NotificationPanelView.tsx");
    expect(src).toContain("<span>{group.label}</span>");
    expect(src).not.toContain("group.items.length");
  });
});

describe("M16: the App / Email header stays while the switches scroll", () => {
  it("is sticky, opaque, and its card does not trap it", () => {
    const src = code("src/components/NotificationPreferences.tsx");
    expect(src).toMatch(/data-prefs-column-header=""\s*className="sticky top-0 z-20 /);
    expect(src).toContain('rounded-2xl liquid-glass overflow-clip shadow-sm');
    expect(src).not.toContain('rounded-2xl liquid-glass overflow-hidden shadow-sm');
  });
});

describe("L4 / L6: reaction chip and SOS shield", () => {
  it("the reaction chip hangs outside the bubble", () => {
    const src = code("src/components/messages/MessageBubble.tsx");
    expect(src).toContain("relative z-10 mt-0.5 flex items-center gap-0.5");
    expect(src).not.toContain("z-10 -mt-2 flex");
  });
  it("the shield wears its word", () => {
    const src = code("src/components/SosShareButton.tsx");
    expect(src).toMatch(/data-sos-shield-label=""[\s\S]{0,300}\{t\("cp\.safetyLabel"\)\}/);
    expect(src).toContain('title={t("cp.safetyLabel")}');
  });
});

describe("M9: Pinned and Recently deleted have a header", () => {
  it("a back arrow to All and the view's name as its title", () => {
    const src = code("src/components/messages/ConversationListHeader.tsx");
    expect(src).toMatch(/data-inbox-view-header=""[\s\S]{0,400}aria-label=\{t\("msg\.backToAll"\)\}/);
    expect(src).toMatch(/<h2[^>]*>\s*\{inboxTab === "pinned" \? t\("msg\.viewPinned"\) : t\("msg\.viewDeleted"\)\}/);
  });
});

describe("L3: one time per 10-minute stretch, on its last message", () => {
  it("the timeline hides a time the next message (within 10 minutes) carries", () => {
    expect(TIME_GROUP_MS).toBe(10 * 60 * 1000);
    const tl = code("src/components/messages/chatView/ChatTimeline.tsx");
    expect(tl).toMatch(/Date\.parse\(next\.message\.created_at\) - Date\.parse\(m\.created_at\) < TIME_GROUP_MS/);
    expect(tl).toContain("hideTime={timeOnNext}");
    const bubble = code("src/components/messages/MessageBubble.tsx");
    expect(bubble).toContain("{!hideTime ? (");
    expect(bubble).not.toMatch(/\{!grouped && \(\s*<span>\s*\{new Date/);
  });
});

describe("L17: one contact line across the emails, the full name first", () => {
  const T = "supabase/functions/_shared/email-templates/";
  it("every contact line reads the same", () => {
    const changed = code(`${T}email-changed.tsx`);
    const drip = code(`${T}drip.tsx`);
    expect((changed.match(/Questions\? Write to us at <SupportAddress \/>\./g) ?? []).length).toBe(2);
    expect((drip.match(/Questions\? Write to us at admin@louisianahelpr\.com\./g) ?? []).length).toBe(2);
    for (const src of [changed, drip]) expect(src).not.toMatch(/Reach out any time at|Just reply to this email|Questions\? Contact us at|Questions\? admin@/);
    expect(code(`${T}confirmReminder.tsx`)).toContain("create an account on Louisiana Helpr");
    expect(code(`${T}gift-card.tsx`)).toContain("sent you a {amount} Louisiana Helpr credit");
  });
});
