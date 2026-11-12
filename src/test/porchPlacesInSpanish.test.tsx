/**
 * F260q (owner 11-11 "Spanish EVERYTHING now"): the buyer's pickup-place picker (buy, trade, free claim) and the order's
 * pickup place in the member's language. Day words follow too (pickupTimesText). An English member reads the old words,
 * word for word. The source is checked by spanishScreensUseDictionary (CONVERTED).
 *
 * @mutate src/components/declutter/DeclutterPorchPlaces.tsx | {forDelivery ? t("ppk.helprPicks") : t("ppk.pick")} | {forDelivery ? t("ppk.helprPicks") : "Pick a pickup place"}
 * @mutate src/components/declutter/DeclutterPorchPlaces.tsx | {!forDelivery && <p className="text-xs text-muted-foreground">{t("ppk.afterPay")}</p>} | {!forDelivery && <p className="text-xs text-muted-foreground">You get the exact address after you pay.</p>}
 * @mutate src/components/declutter/DeclutterPorchPlaces.tsx |       {t("ppk.orderPlace")} <span className="font-medium"> |       Pickup place: <span className="font-medium">
 * @mutate src/components/declutter/DeclutterPorchPlaces.tsx | {forDelivery ? t("ppk.helprPicks") : t("ppk.place")} | {forDelivery ? t("ppk.helprPicks") : "Pickup place"}
 * @mutate src/lib/i18n/es.ts |   ...esPorchPlaces,\n |
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { setLang, ensureLangLoaded, __resetLangForTests } from "@/lib/i18n/language";
import { es } from "@/lib/i18n/es";
import { enPorchPlaces } from "@/lib/i18n/enPorchPlaces";
import { esPorchPlaces } from "@/lib/i18n/esPorchPlaces";

vi.mock("@/lib/declutter/porchPlaces", async (orig) => ({
  ...(await orig<object>()),
  fetchOrderPorchPlace: async () => ({ label: "Camp", area: "New Orleans", address: "99 Camp Road", lat: 29.95, lng: -90.07, weekdays: [0] }),
  chooseSellerPorchPlace: async () => undefined,
}));

const { PorchPlacePicker, OrderPorchPlace } = await import("@/components/declutter/DeclutterPorchPlaces");

const ONE = [{ id: "p1", label: null, area: "Lafayette", weekdays: [6], chosen: true }];
const TWO = [
  { id: "p1", label: null, area: "Lafayette", weekdays: [6], chosen: false },
  { id: "p2", label: null, area: "New Orleans", weekdays: [0], chosen: false },
];
const wrap = (ui: ReactNode) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
};
const spanish = async () => {
  setLang("es");
  await ensureLangLoaded();
};

describe("the buyer's pickup places follow the member's language (F260q)", () => {
  afterEach(() => {
    cleanup();
    __resetLangForTests();
  });

  it("every English word has its Spanish, and es.ts carries it", () => {
    const keys = Object.keys(enPorchPlaces) as (keyof typeof enPorchPlaces)[];
    expect(keys.length).toBeGreaterThan(7);
    for (const k of keys) {
      expect(es[k], k).toBe(esPorchPlaces[k]);
      expect(esPorchPlaces[k], `${k} still English`).not.toBe(enPorchPlaces[k]);
    }
  });

  it("English: the old words", async () => {
    const { container, unmount } = wrap(<PorchPlacePicker sellerId="s1" cartKey={1} places={TWO} loadError={null} onRetry={() => undefined} />);
    expect(container.querySelector("legend")?.textContent).toBe("Pick a pickup place");
    expect(container.textContent).toContain("You get the exact address after you pay.");
    unmount();
    const one = wrap(<PorchPlacePicker sellerId="s1" cartKey={1} places={ONE} loadError={null} onRetry={() => undefined} />);
    expect(one.container.textContent).toContain("Pickup place");
    one.unmount();
    wrap(<OrderPorchPlace orderId="o1" side="buyer" />);
    expect((await screen.findByText("New Orleans")).parentElement?.textContent).toBe("Pickup place: New Orleans");
  });

  it("Spanish: the picker, the one place, delivery and free words, the order line and the day words", async () => {
    await spanish();
    const paid = wrap(<PorchPlacePicker sellerId="s1" cartKey={1} places={TWO} loadError={null} onRetry={() => undefined} />);
    expect(paid.container.querySelector("legend")?.textContent).toBe("Elija un lugar de recogida");
    expect(paid.container.textContent).toContain("Recibe la dirección exacta después de pagar.");
    expect(paid.container.textContent).toContain("sáb");
    paid.unmount();
    const free = wrap(<PorchPlacePicker sellerId="s1" cartKey={1} places={TWO} loadError={null} onRetry={() => undefined} free />);
    expect(free.container.textContent).toContain("Recibe la dirección exacta cuando confirme.");
    free.unmount();
    const one = wrap(<PorchPlacePicker sellerId="s1" cartKey={1} places={ONE} loadError={null} onRetry={() => undefined} />);
    expect(one.container.textContent).toContain("Lugar de recogida");
    expect(one.container.textContent).toContain("Recibe la dirección exacta después de pagar.");
    one.unmount();
    const helpr = wrap(<PorchPlacePicker sellerId="s1" cartKey={1} places={ONE} loadError={null} onRetry={() => undefined} forDelivery />);
    expect(helpr.container.textContent).toContain("Dónde lo recoge el Helpr");
    helpr.unmount();
    const { container } = wrap(<OrderPorchPlace orderId="o1" side="buyer" />);
    expect((await screen.findByText("New Orleans")).parentElement?.textContent).toBe("Lugar de recogida: New Orleans");
    expect(container.textContent).not.toMatch(/Pickup place|exact address/);
  });
});
