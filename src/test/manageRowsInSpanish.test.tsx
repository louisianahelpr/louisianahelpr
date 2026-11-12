/**
 * F260q (owner 11-11 "Spanish EVERYTHING now"): Manage listing's own rows (Accept offers, Lowest you'll take, Answer
 * offers for me, Open to trades, Deliver this item, Ship it) in the member's language. Words live in enListingParts
 * (lp.or.*, lp.tr.*, lp.dl.*, lp.sh.*; the trades title and lines reuse Listing defaults' lp.ld.* so both say it the
 * same way). An English member reads the old words, word for word.
 *
 * @mutate src/components/declutter/DeclutterOfferRules.tsx | {on ? t("lp.or.onLine") : t("lp.or.offLine")} | {on ? "Buyers can offer less than your price" : t("lp.or.offLine")}
 * @mutate src/components/declutter/DeclutterOfferRules.tsx | font-semibold">{t("lp.or.auto")}</span> | font-semibold">Answer offers for me</span>
 * @mutate src/components/declutter/DeclutterOfferRules.tsx | {floorCents == null ? t("lp.or.notSet") : formatPrice(floorCents)} | {floorCents == null ? "Not set" : formatPrice(floorCents)}
 * @mutate src/components/declutter/DeclutterTradeRules.tsx | {on ? t("lp.ld.tradesOn") : t("lp.ld.tradesOff")}</span> | {on ? t("lp.ld.tradesOn") : "Off. Buyers can't offer a trade."}</span>
 * @mutate src/components/declutter/DeclutterTradeRules.tsx | {t("lp.ld.tradesTitle")}</span> | Open to trades</span>
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { setLang, ensureLangLoaded, __resetLangForTests } from "@/lib/i18n/language";
import { es } from "@/lib/i18n/es";
import { enListingParts } from "@/lib/i18n/enListingParts";
import { esListingParts } from "@/lib/i18n/esListingParts";

vi.mock("@/lib/declutter/api", async (orig) => ({ ...(await orig<object>()), fetchMyItemPrivate: async () => ({ auto_offers: false }) }));
vi.mock("@/lib/declutter/trades", async (orig) => ({ ...(await orig<object>()), fetchAcceptsTrades: async () => false }));

const { DeclutterOfferRules } = await import("@/components/declutter/DeclutterOfferRules");
const { DeclutterTradeRules } = await import("@/components/declutter/DeclutterTradeRules");

const wrap = (ui: ReactNode) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><ul>{ui}</ul></QueryClientProvider>);
};
const rows = () => (
  <>
    <DeclutterOfferRules itemId="i1" priceCents={4000} acceptsOffers floorCents={null} rowClassName="" />
    <DeclutterTradeRules itemId="i1" rowClassName="" />
  </>
);

describe("Manage listing's own rows follow the member's language (F260q)", () => {
  afterEach(() => {
    cleanup();
    __resetLangForTests();
  });

  it("every new row word has its Spanish, and es.ts carries it", () => {
    const keys = (Object.keys(enListingParts) as (keyof typeof enListingParts)[]).filter((k) => /^lp\.(or|tr|dl|sh)\./.test(k));
    expect(keys.length).toBeGreaterThan(25);
    for (const k of keys) {
      expect(es[k], k).toBe(esListingParts[k]);
      expect(esListingParts[k], `${k} still English`).not.toBe(enListingParts[k]);
      expect([...esListingParts[k].matchAll(/\{\w+\}/g)].map((m) => m[0]), k).toEqual([...enListingParts[k].matchAll(/\{\w+\}/g)].map((m) => m[0]));
    }
  });

  it("English: the old words", async () => {
    const { container } = wrap(rows());
    expect(await screen.findByText("Off. Buyers can't offer a trade.")).toBeTruthy();
    for (const w of ["Accept offers", "Buyers can offer less than your price", "Lowest you'll take", "Not set", "Suggest one", "Answer offers for me", "Open to trades"]) {
      expect(container.textContent, w).toContain(w);
    }
  });

  it("Spanish: offers, the lowest price, answer for me and trades", async () => {
    setLang("es");
    await ensureLangLoaded();
    const { container } = wrap(rows());
    expect(await screen.findByText("Apagado. Los compradores no pueden ofrecer un cambio.")).toBeTruthy();
    for (const w of ["Aceptar ofertas", "Los compradores pueden ofrecer menos que su precio", "Lo menos que acepta", "Sin fijar", "Sugerir uno", "Responder ofertas por mí", "Abierto a cambios"]) {
      expect(container.textContent, w).toContain(w);
    }
    expect(container.textContent).not.toMatch(/Accept offers|Lowest you|Not set|Open to trades/);
  });
});
