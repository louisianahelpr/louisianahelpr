/**
 * Area 08 H2/H3 (design audit 11-18): a Spanish thread, inbox and bell still read English: TODAY / YESTERDAY, "4m
 * ago", "Show progress", the safety banner, "Verified neighbor · 11 reviews", the Hired / Working / Completed chips,
 * "Your job", the Jobs chip, and the whole Declutter order chat. Each now reads t() (enChatParts.ts / esChatParts.ts).
 * Notification settings: the row labels, descriptions and group headers (enNotifPrefs.ts via notifPrefWords.ts); pass 2
 * moved the rest of that screen (quiet hours, text alerts, test send, job reminders, footer) there too.
 * @mutate src/components/notificationPreferences/CategoryRow.tsx |                 {notifPrefLabel(item.key, item.label)} |                 {item.label}
 * @mutate src/components/notificationPreferences/NotificationGroupHeader.tsx |         {notifPrefGroup(title)} |         {title}
 *
 * @mutate src/components/messages/chatView/chatViewHelpers.ts |   if (diffDays === 0) return t("cp.today"); |   if (diffDays === 0) return "Today";
 * @mutate src/components/notificationPanel/notificationPanelHelpers.tsx |     { key: "today", label: t("cp.today"), items: [] }, |     { key: "today", label: "Today", items: [] },
 * @mutate src/components/notificationPanel/notificationPanelHelpers.tsx |   if (mins < 60) return t("cp.minAgo", { n: mins }); |   if (mins < 60) return `${mins}m ago`;
 * @mutate src/lib/declutter/talkTime.ts |   if (sameDay(d, now)) return t("cp.today"); |   if (sameDay(d, now)) return "Today";
 * @mutate src/lib/expiredListingInThread.ts |   if (key in enChatParts) return t(key as keyof typeof enChatParts); |   if (key === "") return t(key as keyof typeof enChatParts);
 * @mutate src/components/messages/messageSections.ts |   if (c.viewerIsPoster) return t("cp.role.yourJob"); |   if (c.viewerIsPoster) return "Your job";
 * @mutate src/components/profile/profileLanding/YouCard.tsx |   if (verified) parts.push(t("cp.verified")); |   if (verified) parts.push(VERIFIED_NEIGHBOR);
 * @mutate src/components/messages/chatView/DealCard.tsx |               {t("cp.showProgress")} |               Show progress
 * @mutate src/components/messages/ChatView.tsx |                 {t("cp.safety")} |                 Keep chats &amp; payments on Helpr so your job stays covered.
 * @mutate src/pages/messages/useMessageSections.tsx | label: SECTION_CHIP_KEY[k] ? t(SECTION_CHIP_KEY[k]) : sectionByKey(k).label | label: sectionByKey(k).label
 * @mutate src/components/declutter/DeclutterOrderTalk.tsx | aria-label={send.isPending ? tr("cp.ot.sending") : tr("cp.ot.send")} | aria-label={send.isPending ? tr("cp.ot.sending") : "Send"}
 * @mutate src/components/declutter/DeclutterOrderTalk.tsx | <span data-order-talk-rule="">{tr("cp.ot.rule")}</span> | <span data-order-talk-rule="">Only you two can read this. Keep payment in the app.</span>
 */
import { afterEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { setLang, ensureLangLoaded, __resetLangForTests } from "@/lib/i18n/language";
import { es } from "@/lib/i18n/es";
import { enChatParts } from "@/lib/i18n/enChatParts";
import { esChatParts } from "@/lib/i18n/esChatParts";
import { dateDividerLabel } from "@/components/messages/chatView/chatViewHelpers";
import { groupByDay, timeAgo } from "@/components/notificationPanel/notificationPanelHelpers";
import { talkTime } from "@/lib/declutter/talkTime";
import { threadJobChipLabel } from "@/lib/expiredListingInThread";
import { threadRoleCaption } from "@/components/messages/messageSections";
import { youCardFacts } from "@/components/profile/profileLanding/YouCard";
import { blankComments } from "@/test/helpers/blankNonCode";
import { enNotifPrefs } from "@/lib/i18n/enNotifPrefs";
import { esNotifPrefs } from "@/lib/i18n/esNotifPrefs";
import { notifPrefGroup, notifPrefLabel } from "@/lib/i18n/notifPrefWords";
import { rows as jobRows, adminActivityRows, declutterRows, shopsRows } from "@/components/notificationPreferences/constants";
import type { Notification } from "@/components/notificationPanel/types";

const ROOT = resolve(__dirname, "../..");
const src = (p: string) => blankComments(readFileSync(resolve(ROOT, p), "utf8"));
const NOW = new Date().toISOString();

describe("Area 08 H2/H3: chat, inbox and bell words follow the member's language", () => {
  afterEach(() => { __resetLangForTests(); });

  it("every word has its Spanish with the same slots, and es.ts carries it", () => {
    const keys = Object.keys(enChatParts) as (keyof typeof enChatParts)[];
    expect(keys.length).toBeGreaterThan(40);
    for (const k of keys) {
      expect(es[k], k).toBe(esChatParts[k]);
      expect(esChatParts[k], `${k} still English`).not.toBe(enChatParts[k]);
      expect([...esChatParts[k].matchAll(/\{\w+\}/g)].map((m) => m[0]).sort(), k)
        .toEqual([...enChatParts[k].matchAll(/\{\w+\}/g)].map((m) => m[0]).sort());
    }
  });

  it("English reads as before", () => {
    expect(dateDividerLabel(new Date())).toBe("Today");
    expect(groupByDay([{ created_at: NOW } as Notification])[0].label).toBe("Today");
    expect(timeAgo(new Date(Date.now() - 4 * 60_000).toISOString())).toBe("4m ago");
    expect(talkTime(NOW).startsWith("Today ")).toBe(true);
    expect(threadJobChipLabel("accepted", null)).toBe("Hired");
    expect(threadJobChipLabel("completed", null)).toBe("Completed");
    expect(threadRoleCaption({ viewerIsPoster: true, jobStatus: "open" })).toBe("Your job");
    expect(youCardFacts(true, 4.9, 11)).toBe("Verified neighbor · 4.9 · 11 reviews");
  });

  it("Spanish: day labels, ages, chips, captions and the person line", async () => {
    setLang("es");
    await ensureLangLoaded();
    expect(dateDividerLabel(new Date())).toBe("Hoy");
    expect(dateDividerLabel(new Date(Date.now() - 86_400_000))).toBe("Ayer");
    expect(groupByDay([{ created_at: NOW } as Notification])[0].label).toBe("Hoy");
    expect(timeAgo(new Date(Date.now() - 4 * 60_000).toISOString())).toBe("hace 4 min");
    expect(talkTime(NOW).startsWith("Hoy ")).toBe(true);
    expect(threadJobChipLabel("accepted", null)).toBe("Contratado");
    expect(threadJobChipLabel("in_progress", null)).toBe("Trabajando");
    expect(threadJobChipLabel("completed", null)).toBe("Completado");
    expect(threadRoleCaption({ viewerIsPoster: true, jobStatus: "open" })).toBe("Su trabajo");
    expect(youCardFacts(true, 4.9, 11)).toBe("Vecino verificado · 4.9 · 11 reseñas");
  });

  it("the thread, the inbox chips and the Declutter chat draw their words through t()", () => {
    expect(src("src/components/messages/chatView/DealCard.tsx")).toContain('{t("cp.showProgress")}');
    expect(src("src/components/messages/ChatView.tsx")).toContain('{t("cp.safety")}');
    expect(src("src/pages/messages/useMessageSections.tsx")).toContain("t(SECTION_CHIP_KEY[k])");
    const talk = src("src/components/declutter/DeclutterOrderTalk.tsx");
    for (const english of [">Close<", ">See the order<", "No messages yet.", "Only you two can read this", '"Send"', "Photo hidden", '"Order chat"'])
      expect(talk, english).not.toContain(english);
  });

  it("notification settings: every row and group has Spanish, the rows match constants.tsx, and the screen draws it", async () => {
    const rows = [...jobRows, ...adminActivityRows, ...declutterRows, ...shopsRows];
    expect(rows.length).toBeGreaterThan(20);
    for (const r of rows) {
      expect(enNotifPrefs[`np.l.${r.key}` as keyof typeof enNotifPrefs], r.key).toBe(r.label);
      if (r.description) expect(enNotifPrefs[`np.d.${r.key}` as keyof typeof enNotifPrefs], r.key).toBe(r.description);
    }
    for (const k of Object.keys(enNotifPrefs) as (keyof typeof enNotifPrefs)[]) {
      expect(es[k], k).toBe(esNotifPrefs[k]);
      // "App" is the same word in Spanish (the column header over the push switches); "Declutter" is the area's name,
      // kept in Spanish as the nav and settings keep it (nav.declutter, settings.declutter).
      if (k !== "np.h.app" && k !== "np.g.Declutter") expect(esNotifPrefs[k], `${k} still English`).not.toBe(enNotifPrefs[k]);
    }
    setLang("es");
    await ensureLangLoaded();
    expect(notifPrefLabel("payments", "Receipts and refunds")).toBe("Recibos y reembolsos");
    expect(notifPrefGroup("Money")).toBe("Dinero");
    expect(src("src/components/notificationPreferences/CategoryRow.tsx")).toContain("{notifPrefLabel(item.key, item.label)}");
    expect(src("src/components/notificationPreferences/NotificationGroupHeader.tsx")).toContain("{notifPrefGroup(title)}");
  });
});
