/**
 * F260q (owner 11-11 "Spanish EVERYTHING now"): Declutter's free items in the member's language: the rules sentence
 * behind How it works, the giver's list of who asked, Buying's asks and pause line, the free checkout, the Ask for it
 * sheet and the pickup day words. A Spanish member reads Spanish; an English member reads the old words, word for word.
 * The source of DeclutterFreeClaim.tsx and FreeAskSheet.tsx is checked by spanishScreensUseDictionary (CONVERTED).
 *
 * @mutate src/components/declutter/DeclutterFreeClaim.tsx |   return tr("free.rulesLine", { lead: | return "When you ask, you pick a pickup time." || tr("free.rulesLine", { lead:
 * @mutate src/components/declutter/DeclutterFreeClaim.tsx |     : offered.length === 2 ? tr("free.howBoth") |     : offered.length === 2 ? " to pick it up at their home or from their porch"
 * @mutate src/lib/declutter/freePickSteps.ts |   return idCheckOn ? t("free.stepsId") : t("free.stepsNoId"); |   return idCheckOn ? t("free.stepsId") : "you choose your pickup time and get the address";
 * @mutate src/components/declutter/DeclutterFreeClaim.tsx | {t((trade ? TRADE_HANDOVER : FREE_HANDOVER)[h].title)} | {(trade ? TRADE_HANDOVER : FREE_HANDOVER)[h].title}
 * @mutate src/components/declutter/DeclutterFreeClaim.tsx | {t("free.pick")} | Pick
 * @mutate src/components/declutter/FreeAskSheet.tsx | {isToday(d.slots[0].iso) ? t("fask.today") : d.label} | {isToday(d.slots[0].iso) ? "Today" : d.label}
 * @mutate src/lib/declutter/pickupSlots.ts | const dayNames = () => (getLang() === "es" ? DAY_ES : DAY_EN); | const dayNames = () => DAY_EN;
 * @mutate src/lib/declutter/pickupSlots.ts |   const everyDay = es ? "Todos los días" : "Every day"; |   const everyDay = "Every day";
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { setLang, ensureLangLoaded, __resetLangForTests } from "@/lib/i18n/language";
import { es } from "@/lib/i18n/es";
import { enFree } from "@/lib/i18n/enFree";
import { esFree } from "@/lib/i18n/esFree";
import { enFreeAsk } from "@/lib/i18n/enFreeAsk";
import { esFreeAsk } from "@/lib/i18n/esFreeAsk";
import { weekHoursLine, windowsSummary } from "@/lib/declutter/pickupSlots";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: () => {
      const answer = Promise.resolve({ data: [], error: null });
      return Object.assign(answer, { abortSignal: () => answer });
    },
  },
}));
vi.mock("@/lib/declutter/api", async (orig) => ({
  ...(await orig<typeof import("@/lib/declutter/api")>()),
  fetchFreeRequestsForItem: vi.fn(async () => [
    { request_id: "r1", display_name: "Ana", avg_rating: 4.5, review_count: 2, pickup_at: null },
  ]),
  fetchItemHandovers: vi.fn(async () => null),
  fetchSellerCard: vi.fn(async () => ({ name: "Gina Giver" })),
  fetchMyFreeRequests: vi.fn(async () => []),
  fetchMyCart: vi.fn(async () => []),
}));

import { FreeCheckoutForSeller, FreeClaimPanel, FreeRequestsForGiver } from "@/components/declutter/DeclutterFreeClaim";

const ITEM = { id: "i1", seller_id: "s1", title: "Lamp", status: "live", porch_ok: true, price_cents: 0, current_price_cents: 0 } as never;

function show(ui: ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><MemoryRouter>{ui}</MemoryRouter></QueryClientProvider>);
}

async function spanish() {
  __resetLangForTests();
  setLang("es");
  await ensureLangLoaded();
}

const WEEK = [1, 2, 3, 4, 5].map((weekday) => ({ weekday, starts: "17:00", ends: "20:00" }));

describe("free items follow the member's language (F260q)", () => {
  afterEach(() => {
    cleanup();
    __resetLangForTests();
  });

  it("every English free-item word has its Spanish, and es.ts carries it", () => {
    for (const [en, sp] of [[enFree, esFree], [enFreeAsk, esFreeAsk]] as const) {
      const keys = Object.keys(en) as (keyof typeof en)[];
      expect(keys.length).toBeGreaterThan(20);
      for (const k of keys) {
        expect((es as Record<string, string>)[k], k).toBe((sp as Record<string, string>)[k]);
        // "Free" words that are the same in both languages: none here.
        expect((sp as Record<string, string>)[k], `${k} still English`).not.toBe((en as Record<string, string>)[k]);
      }
    }
  });

  it("English: the giver's list and the free checkout keep their words", async () => {
    __resetLangForTests();
    show(<FreeRequestsForGiver item={ITEM} />);
    expect(await screen.findByText("Requests (1)")).toBeTruthy();
    expect(screen.getByText("4.5 stars, 2 reviews")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Pick" })).toBeTruthy();
    cleanup();
    show(<FreeCheckoutForSeller sellerId="s1" porchOk onDone={() => {}} />);
    expect(screen.getByText("Porch pickup")).toBeTruthy();
    expect(screen.getByText("Free items are picked up only. Nothing is charged.")).toBeTruthy();
  });

  it("Spanish: the giver's list and the free checkout", async () => {
    await spanish();
    show(<FreeRequestsForGiver item={ITEM} />);
    expect(await screen.findByText("Solicitudes (1)")).toBeTruthy();
    expect(screen.getByText("4.5 estrellas, 2 reseñas")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Elegir" })).toBeTruthy();
    cleanup();
    show(<FreeCheckoutForSeller sellerId="s1" porchOk onDone={() => {}} />);
    expect(screen.getByText("Recogida en el porche")).toBeTruthy();
    expect(screen.getByText(esFree["free.checkoutLine"])).toBeTruthy();
    expect(screen.queryByText(/Porch pickup|picked up only/)).toBeNull();
  });

  it("the rules sentence behind How it works, in each language", async () => {
    __resetLangForTests();
    const { fireEvent } = await import("@testing-library/react");
    show(<FreeClaimPanel item={ITEM} />);
    fireEvent.click(await screen.findByRole("button", { name: "How it works" }));
    expect(await screen.findByText(/^Free, nothing is charged\. When you ask, you pick a pickup time from the giver's times\..* to pick it up at their home or from their porch\. You can ask for up to 3 free items at a time\.$/)).toBeTruthy();
    cleanup();
    await spanish();
    show(<FreeClaimPanel item={ITEM} />);
    fireEvent.click(await screen.findByRole("button", { name: "Cómo funciona" }));
    expect(await screen.findByText(/^Gratis, no se cobra nada\. Al pedirlo.* para recogerlo en su casa o en su porche\. Puede pedir hasta 3 artículos gratis a la vez\.$/)).toBeTruthy();
  });

  it("the first-pick steps follow the language", async () => {
    const { firstPickSteps } = await import("@/lib/declutter/freePickSteps");
    __resetLangForTests();
    expect(firstPickSteps(false)).toBe("you choose your pickup time and get the address");
    await spanish();
    expect(firstPickSteps(false)).toBe(esFree["free.stepsNoId"]);
    expect(firstPickSteps(true)).toBe(esFree["free.stepsId"]);
  });

  it("pickup day words: English word for word, Spanish day names", async () => {
    __resetLangForTests();
    expect(windowsSummary(WEEK)).toBe("Mon–Fri 5–8 PM");
    expect(weekHoursLine(WEEK.concat([0, 6].map((weekday) => ({ weekday, starts: "17:00", ends: "20:00" }))), null, 1)).toBe("Every day 5–8 PM");
    await spanish();
    expect(windowsSummary(WEEK)).toBe("lun–vie 5–8 PM");
    expect(weekHoursLine(WEEK.concat([0, 6].map((weekday) => ({ weekday, starts: "17:00", ends: "20:00" }))), null, 1)).toBe("Todos los días 5–8 PM");
  });
});
