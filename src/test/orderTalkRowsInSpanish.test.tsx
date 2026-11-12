/**
 * F260q (owner 11-11 "Spanish EVERYTHING now"): Messages' Declutter order-chat rows (who wrote last, bought/sold,
 * Ended, "Your order", the load error) in the member's language. Words in enMessages (msg.ot.*). An English member
 * reads the old words.
 *
 * @mutate src/components/messages/DeclutterOrderTalkInbox.tsx |   return row.side === "buyer" ? t("msg.ot.sellerLast") : t("msg.ot.buyerLast"); |   return row.side === "buyer" ? "The seller wrote last" : t("msg.ot.buyerLast");
 * @mutate src/components/messages/DeclutterOrderTalkInbox.tsx | return row.title ?? t("msg.ot.yourOrder"); | return row.title ?? "Your order";
 * @mutate src/components/messages/DeclutterOrderTalkInbox.tsx | text-muted-foreground">{t("msg.ot.ended")}</span>} | text-muted-foreground">Ended</span>}
 * @mutate src/components/messages/DeclutterOrderTalkInbox.tsx | title={t("msg.ot.loadFailed")} | title="We couldn't load your order chats."
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { setLang, ensureLangLoaded, __resetLangForTests } from "@/lib/i18n/language";
import { es } from "@/lib/i18n/es";
import { enMessages } from "@/lib/i18n/enMessages";
import { esMessages } from "@/lib/i18n/esMessages";
import { OrderTalkLoadError, OrderTalkRow, orderTalkRowLine, orderTalkRowTitle } from "@/components/messages/DeclutterOrderTalkInbox";
import type { OrderTalkListRow } from "@/lib/declutter/orderTalk";

const row = { order_id: "o1", title: null, side: "buyer", last_mine: false, open: false, last_at: new Date().toISOString() } as unknown as OrderTalkListRow;
const text = () => {
  cleanup();
  render(<MemoryRouter><OrderTalkRow row={row} /><OrderTalkLoadError error={new Error("x")} retry={() => {}} /></MemoryRouter>);
  return document.body.textContent ?? "";
};

describe("Messages' order-chat rows follow the member's language (F260q)", () => {
  afterEach(() => {
    cleanup();
    __resetLangForTests();
  });

  it("every word has its Spanish, and es.ts carries it", () => {
    const keys = (Object.keys(enMessages) as (keyof typeof enMessages)[]).filter((k) => k.startsWith("msg.ot."));
    expect(keys.length).toBe(8);
    for (const k of keys) {
      expect(es[k], k).toBe(esMessages[k]);
      expect(esMessages[k], `${k} still English`).not.toBe(enMessages[k]);
    }
  });

  it("English: the old words", () => {
    const en = text();
    for (const w of ["Your order", "Ended", "You bought this · The seller wrote last", "We couldn't load your order chats."]) expect(en).toContain(w);
    expect(orderTalkRowLine({ side: "seller", last_mine: false })).toBe("The buyer wrote last");
  });

  it("Spanish: the row and the error change", async () => {
    setLang("es");
    await ensureLangLoaded();
    const sp = text();
    for (const w of ["Su pedido", "Terminado", "Usted compró esto · Último mensaje: el vendedor", "No pudimos cargar sus chats de pedidos."]) expect(sp).toContain(w);
    expect(orderTalkRowTitle({ title: null })).toBe("Su pedido");
    expect(orderTalkRowLine({ side: "seller", last_mine: true })).toBe("Último mensaje: usted");
  });
});
