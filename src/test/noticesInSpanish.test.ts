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
 * @mutate supabase/functions/_shared/noticeEs.ts |       const word = (tok === "name" \|\| tok === "name2") ? NAME_WORDS[v.toLowerCase()] : undefined; |       const word = undefined as string \| undefined;
 * @mutate supabase/functions/_shared/noticeEs.ts |   ['{name} said no to your {amount} price on "{q}".', | ['{name} said NO to your {amount} price on "{q}".',
 * @mutate supabase/functions/_shared/noticeEs.ts |   "the seller": "el vendedor", |   "the sellers": "el vendedor",
 * @mutate supabase/functions/_shared/noticeEs.ts |   ['You accepted {name}\'s {amount} price for "{q}". | ['You accepted {name}\'s {amount} offer for "{q}".
 * @mutate src/hooks/useRealtimePush.ts | showLocalNotification(noticeInSpanish(notification.title), noticeInSpanish(notification.message), notification.link) | showLocalNotification(notification.title, notification.message, notification.link)
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { blankComments } from "./helpers/blankNonCode";
import { NOTICE_SHAPES, noticeInSpanish } from "@/lib/i18n/noticeEs";

const SAMPLE: Record<string, string> = {
  name: "Ana P.", name2: "Luc B.", q: "Mow the lawn", q2: "Rake leaves", place: "New Iberia", any: "Tue 10:00 PM",
  cat: "yard_work", amount: "$20.00", amount2: "$45", amount3: "$18.00", amount4: "$17.50", date: "Fri, Nov 6", time: "10:00 PM", n: "2",
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

  it("the reserved notice says who accepted, and a departed member reads as un exmiembro (Builder 1, 2de8d159fe / 4c82c8a040)", () => {
    const tail = " Check out by Wed, Nov 11 at 2:00 PM to keep it: choose pickup or delivery, pick a day and time, and pay. Your card is not charged until you check out. If you miss it, the item goes back up for sale and that counts as a strike.";
    const tailEs = " Pague antes del mié 11 nov a las 2:00 PM para quedárselo: elija recogida o entrega, escoja un día y una hora, y pague. No se le cobra a su tarjeta hasta que pague. Si no lo hace, el artículo vuelve a estar a la venta y eso cuenta como una falta.";
    expect(noticeInSpanish("Reserved for you: check out in 24 hours")).toBe("Reservado para usted: pague en las próximas 24 horas");
    expect(noticeInSpanish(`Sam S. accepted your $35.00 offer for "Lamp".${tail}`)).toBe(`Sam S. aceptó su oferta de $35.00 por "Lamp".${tailEs}`);
    expect(noticeInSpanish(`The seller accepted your $35.00 offer for "Mirror".${tail}`)).toBe(`El vendedor aceptó su oferta de $35.00 por "Mirror".${tailEs}`);
    expect(noticeInSpanish(`You accepted Sam S.'s $35.00 price for "Rug".${tail}`)).toBe(`Usted aceptó el precio de $35.00 de Sam S. por "Rug".${tailEs}`);
    expect(noticeInSpanish(`You accepted the seller's $35.00 price for "Chair".${tail}`)).toBe(`Usted aceptó el precio de $35.00 del vendedor por "Chair".${tailEs}`);
    expect(noticeInSpanish('Cal C. accepted your $35.00 price for "Desk". They have 24 hours to check out and pay. We\'ll tell you when they pay.'))
      .toBe('Cal C. aceptó su precio de $35.00 por "Desk". Tiene 24 horas para pagar. Le avisaremos cuando pague.');
    expect(noticeInSpanish('The buyer accepted your $35.00 price for "Rug". They have 24 hours to check out and pay. We\'ll tell you when they pay.'))
      .toBe('El comprador aceptó su precio de $35.00 por "Rug". Tiene 24 horas para pagar. Le avisaremos cuando pague.');
    expect(noticeInSpanish('You earned $4.00 from a former member\'s sale of "Lamp". It is on its way to your payout account.'))
      .toBe('Ganó $4.00 de la venta de "Lamp" de un exmiembro. Va en camino a su cuenta de pagos.');
    expect(noticeInSpanish('The handover of "Lamp" is done. $40.00 sale · $4.00 to a former member (10%) · $36.00 to you. We send your $36.00 once the sale is final, 24 hours after the handover, unless the buyer asks for a refund.'))
      .toBe('La entrega de "Lamp" está hecha. Venta de $40.00 · $4.00 para un exmiembro (10 %) · $36.00 para usted. Le enviamos sus $36.00 cuando la venta sea definitiva, 24 horas después de la entrega, a menos que el comprador pida un reembolso.');
  });

  it("b1d's seller notices name the buyer, or a fallback word that is re-written too (lead 11-11)", () => {
    expect(noticeInSpanish('Ann S. offered $40.00 on "Oak lamp". Accept, decline or send a different price within 48 hours.'))
      .toBe('Ann S. ofreció $40.00 por "Oak lamp". Acepte, rechace o envíe otro precio en menos de 48 horas.');
    expect(noticeInSpanish('The buyer said no to your $40.00 price on "Oak lamp".')).toBe('El comprador rechazó su precio de $40.00 por "Oak lamp".');
    expect(noticeInSpanish('the buyer said no to your $40.00 price on "Oak lamp". Your listing is still up.'))
      .toBe('El comprador rechazó su precio de $40.00 por "Oak lamp". Su anuncio sigue publicado.');
    expect(noticeInSpanish('A buyer wants 3 of your items ($60.00 in all). Accept all or pick some within 48 hours.'))
      .toBe('Un comprador quiere 3 de sus artículos ($60.00 en total). Acepte todos o elija algunos en menos de 48 horas.');
    expect(noticeInSpanish('"Oak lamp" is held for the buyer at $40.00. They have 24 hours to check out and pay. We\'ll tell you when they pay.'))
      .toBe('"Oak lamp" está reservado para el comprador por $40.00. Tiene 24 horas para pagar. Le avisaremos cuando pague.');
    expect(noticeInSpanish('You did not answer the buyer\'s offer on "Oak lamp" within 48 hours, so it closed.'))
      .toBe('Usted no respondió a la oferta del comprador por "Oak lamp" en 48 horas, así que se cerró.');
    expect(noticeInSpanish('A former member took back their offer on "Oak lamp".')).toBe('Un exmiembro retiró su oferta por "Oak lamp".');
    // The literal shapes written before b1d still win over the {name} ones.
    expect(noticeInSpanish('The buyer took back their offer on "Oak lamp".')).toBe('El comprador retiró su oferta por "Oak lamp".');
    // The old wording stays a fallback.
    expect(noticeInSpanish('You got a $40.00 offer on "Oak lamp". Accept, decline or counter within 48 hours.'))
      .toBe('Recibió una oferta de $40.00 por "Oak lamp". Acepte, rechace o haga una contraoferta en menos de 48 horas.');
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
