/**
 * F260q (owner 11-11, OWNER-DECISIONS.md "Spanish everything"): the notifications panel's own words (header, Mark all
 * read, the Unread | All filter, the Messages row, the empty state, the footer lines) read the member's language from
 * the dictionary (enNotifications.ts / esNotifications.ts). Source-level: no English literal of them is left in the
 * panel, each key is drawn, and each Spanish word differs from the English. The notices themselves come from the
 * server in English (phase 2).
 *
 * @mutate src/components/NotificationPanelView.tsx |           title={t("notif.title")} |           title="Notifications"
 * @mutate src/components/NotificationPanelView.tsx |               { key: "all", label: t("notif.all") }, |               { key: "all", label: "All" },
 * @mutate src/components/NotificationPanelView.tsx | <BellRing className="w-4 h-4" /> {t("notif.turnOnPush")} | <BellRing className="w-4 h-4" /> Turn on push notifications
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { blankComments } from "./helpers/blankNonCode";
import { enNotifications } from "@/lib/i18n/enNotifications";
import { esNotifications } from "@/lib/i18n/esNotifications";

const view = blankComments(readFileSync("src/components/NotificationPanelView.tsx", "utf8"));

describe("F260q: the notifications panel speaks the member's language", () => {
  const keys = Object.keys(enNotifications) as (keyof typeof enNotifications)[];

  it("draws every panel word through t()", () => {
    expect(keys.length).toBeGreaterThan(10);
    for (const k of keys) expect(view, k).toContain(`t("${k}"`);
    expect(view).toContain('import { useLanguage } from "@/lib/i18n/language";');
  });

  it("leaves no English literal of those words in the panel", () => {
    for (const k of keys) {
      const english = enNotifications[k].split("{")[0].trim();
      if (english.length < 4) continue;
      expect(view.includes(`"${english}`) || view.includes(`>${english}`) || view.includes(` ${english}\n`), `${k}: ${english}`).toBe(false);
    }
  });

  it("each Spanish word is Spanish (differs from the English)", () => {
    for (const k of keys) expect(esNotifications[k], k).not.toBe(enNotifications[k]);
    expect(esNotifications["notif.title"]).toBe("Notificaciones");
  });
});
