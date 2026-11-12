/**
 * F260q (owner 11-11 "Spanish EVERYTHING now"): Declutter's offer cards in the member's language: "Offers on your
 * items" (Selling) and "Your offers" (Buying), the who-set-it line, the next-step line, the money note, the answers,
 * the counter box's range and the confirm sheets, from enDeclOffers.ts / esDeclOffers.ts. English reads the old words.
 * The source of DeclutterOffersSection.tsx is checked by spanishScreensUseDictionary (CONVERTED).
 *
 * @mutate src/components/declutter/DeclutterOffersSection.tsx |   const title = seller ? t("dof.onYourItems") : t("dof.yourOffers"); |   const title = seller ? "Offers on your items" : "Your offers";
 * @mutate src/components/declutter/DeclutterOffersSection.tsx | {t("dof.keepA")}<strong | If you accept and the buyer pays, you keep the whole <strong
 * @mutate src/components/declutter/DeclutterOffersSection.tsx | { who: "them", text: o.my_side === "buyer" ? t("dof.waitSeller") : t("dof.waitBuyer"), | { who: "them", text: "Waiting on the seller to answer",
 * @mutate src/components/declutter/DeclutterOffersSection.tsx | const offerStatusWords = (status: MyOffer["status"]) => tr(`dof.st.${status}` as MsgKey); | const offerStatusWords = (status: MyOffer["status"]) => status;
 * @mutate src/components/declutter/DeclutterOffersSection.tsx | return tr("dof.alreadyOffered", { amount: formatPrice(o.amount_cents) }); | return `They already offered ${formatPrice(o.amount_cents)}.`;
 * @mutate src/components/declutter/DeclutterOffersSection.tsx | confirmLabel={t("dof.sayNo")} cancelLabel={t("dof.notNow")} testId="decline-offer"> | confirmLabel={t("dof.sayNo")} testId="decline-offer">
 * @mutate src/lib/i18n/es.ts |   ...esDeclOffers,\n |
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { setLang, ensureLangLoaded, __resetLangForTests } from "@/lib/i18n/language";
import { en } from "@/lib/i18n/en";
import { es } from "@/lib/i18n/es";
import { enDeclOffers } from "@/lib/i18n/enDeclOffers";
import { esDeclOffers } from "@/lib/i18n/esDeclOffers";

const state = vi.hoisted(() => ({ offers: [] as unknown[] }));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));
vi.mock("@/hooks/useFeature", () => ({ useFeature: () => false }));
vi.mock("@/lib/declutter/api", () => ({
  fetchMyOffers: async () => state.offers,
  fetchMyCart: async () => [],
  fetchItemHandovers: async () => [],
  respondOffer: async () => "countered",
}));
vi.mock("@/components/declutter/BuyerTotal", () => ({ BuyerTotal: () => null }));

const { OffersSection } = await import("@/components/declutter/DeclutterOffersSection");

const soon = () => new Date(Date.now() + 47 * 3_600_000).toISOString();
const offer = (over: Record<string, unknown>) => ({
  offer_id: "o1", item_id: "i1", item_title: "Blue enamel mug", my_side: "seller", amount_cents: 600, awaiting: "seller",
  status: "open", respond_by: soon(), counter_count: 0, current_price_cents: 1000, floor_price_cents: null,
  updated_at: "2026-11-11", buyer_display: "Ann S.", ...over,
});

function show(side: "buyer" | "seller") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><MemoryRouter><OffersSection side={side} /></MemoryRouter></QueryClientProvider>);
}

describe("Declutter's offer cards follow the language (F260q)", () => {
  afterEach(() => {
    cleanup();
    __resetLangForTests();
  });

  it("every enDeclOffers key has Spanish in es.ts, with the same {vars}", () => {
    const keys = Object.keys(enDeclOffers) as (keyof typeof enDeclOffers)[];
    expect(keys.length).toBeGreaterThan(60);
    for (const k of keys) {
      expect(en[k], k).toBe(enDeclOffers[k]);
      expect(es[k], k).toBe(esDeclOffers[k]);
      expect([...esDeclOffers[k].matchAll(/\{\w+\}/g)].map((m) => m[0]).sort(), k).toEqual([...enDeclOffers[k].matchAll(/\{\w+\}/g)].map((m) => m[0]).sort());
    }
  });

  it("English: the seller's card reads the old words", async () => {
    state.offers = [offer({}), offer({ offer_id: "o2", status: "declined" })];
    show("seller");
    expect(await screen.findByText("From Ann S.")).toBeTruthy();
    expect(document.querySelector("h2")?.textContent).toBe("Offers on your items · 1 to answer");
    expect(screen.getByText("From Ann S.")).toBeTruthy();
    expect(screen.getByText("Price now $10")).toBeTruthy();
    expect(screen.getByText("their offer")).toBeTruthy();
    expect(document.querySelector("[data-offer-note]")?.textContent).toBe("If you accept and the buyer pays, you keep the whole $6.");
    expect(screen.getByRole("button", { name: "Accept" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Show 1 closed offer from the last 30 days" }));
    expect(screen.getByText("Declined")).toBeTruthy();
  });

  it("Spanish: the seller's card, its answers, the counter box and the Say no sheet", async () => {
    setLang("es");
    await ensureLangLoaded();
    state.offers = [offer({}), offer({ offer_id: "o2", status: "declined" })];
    show("seller");
    expect(await screen.findByText("De Ann S.")).toBeTruthy();
    expect(document.querySelector("h2")?.textContent).toBe("Ofertas por sus artículos · 1 por responder");
    expect(screen.getByText("De Ann S.")).toBeTruthy();
    expect(screen.getByText("Precio actual $10")).toBeTruthy();
    expect(screen.getByText("su oferta")).toBeTruthy();
    expect(document.querySelector("[data-offer-note]")?.textContent).toBe("Si acepta y el comprador paga, usted recibe los $6 completos.");
    expect(document.body.textContent).toMatch(/Siguiente: responda a su oferta · quedan 4\d horas/);
    fireEvent.click(screen.getByRole("button", { name: "Responder con un precio" }));
    expect(screen.getByLabelText("Su precio")).toBeTruthy();
    expect(screen.getByText("Entre $6.01 y $10.")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Su precio"), { target: { value: "5" } });
    expect(screen.getByText("Ya ofrecieron $6. Responda con más que eso, o toque Aceptar.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Decir que no" }));
    expect(await screen.findByText("¿Decir que no a $6?")).toBeTruthy();
    expect(screen.getByText("\"Blue enamel mug\": esta oferta termina y se le avisa al comprador que dijo que no.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Ahora no" }));
    await waitFor(() => expect(screen.queryByText("¿Decir que no a $6?")).toBeNull());
    fireEvent.click(screen.getByRole("button", { name: "Mostrar 1 oferta cerrada de los últimos 30 días" }));
    expect(screen.getByText("Rechazada")).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/Offers on|to answer|From Ann|Price now|their offer|you keep|Say no|Not now|Declined|closed offer/);
  });

  it("Spanish: the buyer waiting on the seller, and an empty Buying list", async () => {
    setLang("es");
    await ensureLangLoaded();
    state.offers = [offer({ my_side: "buyer", awaiting: "seller" })];
    show("buyer");
    expect(await screen.findByText("Retirar mi oferta")).toBeTruthy();
    expect(document.querySelector("h2")?.textContent).toBe("Sus ofertas");
    expect(document.body.textContent).toMatch(/Esperando la respuesta del vendedor · quedan 4\d horas/);
    expect(screen.getByRole("button", { name: "Retirar mi oferta" })).toBeTruthy();
    cleanup();
    state.offers = [];
    show("buyer");
    expect(await screen.findByText("No ha hecho ninguna oferta.")).toBeTruthy();
  });
});
