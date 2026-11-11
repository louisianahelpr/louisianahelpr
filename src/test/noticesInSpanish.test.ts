/**
 * F260q (owner 11-11 "Spanish everything"; lead 11-11: server-written notices in Spanish, rendered on the client by
 * notice shape). noticeEs.ts re-writes each known English notice shape (titles and messages, picked from 60 days of
 * prod notices, most-seen first) in Spanish, carrying names, quoted titles, places and amounts over and re-writing
 * dates. The bell panel shows that Spanish when the reader chose Spanish, and the stored English otherwise.
 *
 * @mutate src/components/NotificationPanelView.tsx |   const say = (text: string) => (lang === "es" ? noticeInSpanish(text) : text); |   const say = (text: string) => (void lang, text);
 * @mutate src/components/NotificationPanelView.tsx |                                 {say(n.title)} |                                 {n.title}
 * @mutate src/components/NotificationPanelView.tsx | <NotificationMessage text={say(n.message)} /> | <NotificationMessage text={n.message} />
 * @mutate supabase/functions/_shared/noticeEs.ts |       vals[tok] = tok === "date" ? dateInSpanish(m[i + 1]) : m[i + 1]; |       vals[tok] = m[i + 1];
 * @mutate supabase/functions/_shared/noticeEs.ts |     return { re: new RegExp(`^${body}$`), tokens, spanish }; |     return { re: new RegExp(body), tokens, spanish };
 * @mutate src/lib/nativePush.ts |           toast(say(notification.title) \|\| t("notif.toastNew"), { |           toast(notification.title \|\| t("notif.toastNew"), {
 * @mutate src/hooks/useRealtimePush.ts | showLocalNotification(noticeInSpanish(notification.title), noticeInSpanish(notification.message), notification.link) | showLocalNotification(notification.title, notification.message, notification.link)
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { blankComments } from "./helpers/blankNonCode";
import { NOTICE_SHAPES, noticeInSpanish } from "@/lib/i18n/noticeEs";

const SAMPLE: Record<string, string> = {
  name: "Ana P.", name2: "Luc B.", q: "Mow the lawn", q2: "Rake leaves", place: "New Iberia", any: "Tue 10:00 PM",
  cat: "yard_work", amount: "$20.00", amount2: "$45", date: "Fri, Nov 6", time: "10:00 PM", n: "2",
};
const fill = (tpl: string, vals: Record<string, string>) => tpl.replace(/\{([a-z0-9]+)\}/g, (_, k: string) => vals[k]);

describe("F260q: server-written notices in Spanish", () => {
  it("covers the most-seen notices (exact real shapes)", () => {
    expect(noticeInSpanish("New job posted")).toBe("Nuevo trabajo publicado");
    expect(noticeInSpanish('"Mow the lawn" was just posted in New Iberia.')).toBe('Se acaba de publicar "Mow the lawn" en New Iberia.');
    expect(noticeInSpanish("Your card is on hold for $85.00. You're only charged when you hire someone."))
      .toBe("Su tarjeta tiene una retención de $85.00. Solo se le cobra cuando contrata a alguien.");
    expect(noticeInSpanish('Thanks for approving "Deep clean". Your Helpr is paid Fri, Nov 6.'))
      .toBe('Gracias por aprobar "Deep clean". A su Helpr se le paga el vie 6 nov.');
    expect(noticeInSpanish("Hallie H. accepted your offer")).toBe("Hallie H. aceptó su oferta");
    expect(noticeInSpanish('Hallie H. applied to "Rake". Next: review and pick a Helpr before it starts Mon, Nov 9 at 3:00 PM.'))
      .toBe('Hallie H. se postuló a "Rake". Siguiente: revise y elija un Helpr antes de que empiece el lun 9 nov a las 3:00 PM.');
  });

  it("every shape is reachable (no earlier shape swallows it) and leaves no token behind", () => {
    expect(NOTICE_SHAPES.length).toBeGreaterThan(150);
    for (const [english, spanish] of NOTICE_SHAPES) {
      const want = fill(spanish, { ...SAMPLE, date: "vie 6 nov" });
      expect(noticeInSpanish(fill(english, SAMPLE)), english).toBe(want);
      expect(want, english).not.toMatch(/\{[a-z0-9]+\}/);
    }
  });

  it("an unknown notice, or one with extra words, stays as written", () => {
    expect(noticeInSpanish("Something we never wrote before")).toBe("Something we never wrote before");
    expect(noticeInSpanish("New job posted today")).toBe("New job posted today");
    expect(noticeInSpanish("")).toBe("");
  });

  it("the bell panel shows the Spanish only to Spanish readers, for both title and message", () => {
    const view = blankComments(readFileSync("src/components/NotificationPanelView.tsx", "utf8"));
    expect(view).toContain('(lang === "es" ? noticeInSpanish(text) : text)');
    expect(view).toContain("{say(n.title)}");
    expect(view).toContain("<NotificationMessage text={say(n.message)} />");
  });

  it("the foreground push toast and the web's background notification follow the language too", () => {
    const push = blankComments(readFileSync("src/lib/nativePush.ts", "utf8"));
    expect(push).toContain('const say = (text: string | undefined) => (text && getLang() === "es" ? noticeInSpanish(text) : text);');
    expect(push).toContain('toast(say(notification.title) || t("notif.toastNew"), {');
    expect(push).toContain("description: say(notification.body) || undefined,");
    const web = blankComments(readFileSync("src/hooks/useRealtimePush.ts", "utf8"));
    expect(web).toContain("showLocalNotification(noticeInSpanish(notification.title), noticeInSpanish(notification.message), notification.link)");
  });
});
