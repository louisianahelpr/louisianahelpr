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
 * @mutate src/components/SosShareButton.tsx |         {t("cp.safety")}\n |         {""}\n
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { blankComments } from "./helpers/blankNonCode";
import { enNotifPrefs } from "@/lib/i18n/enNotifPrefs";
import { esNotifPrefs } from "@/lib/i18n/esNotifPrefs";
import { jobReminderWords } from "@/lib/i18n/notifPrefWords";

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
    expect(src).toMatch(/data-sos-shield-label=""[\s\S]{0,300}\{t\("cp\.safety"\)\}/);
    expect(src).toContain('title={t("cp.safety")}');
  });
});
