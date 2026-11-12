/**
 * F260q (owner 11-11 "Spanish EVERYTHING now"): the listing-settings rows of the Sell summary and Sell a bunch
 * (SellingSettingsRows: "From your settings", Pickup / Price drops / Make it free and their values, plural day names),
 * Sell a bunch's switches (BunchChoices) and list step (DeclutterBunchListStep), and Declutter settings' Listing
 * defaults (DeclutterListingDefaults), in the member's language. Words: enListingParts.ts / esListingParts.ts
 * (lp.sr.*, lp.dayPl.*, lp.b.*, lp.ld.*). The tax statements (TaxStatementsCheck) stay English by decision 11-11.
 * An English member reads the old words, word for word; the Listing defaults' offers/trades lines equal the shared
 * English helpers (offersOnPost / trades), which other screens still read.
 *
 * @mutate src/components/declutter/SellingSettingsRows.tsx |   const names = uniq.map((d) => t(`lp.dayPl.${d}` as MsgKey)); |   const names = uniq.map((d) => `${["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][d]}s`);
 * @mutate src/components/declutter/SellingSettingsRows.tsx | text-foreground">{t("lp.sr.from")}</p> | text-foreground">From your settings</p>
 * @mutate src/components/declutter/SellingSettingsRows.tsx | title={t("lp.sr.drops")} | title="Price drops"
 * @mutate src/components/declutter/SellingSettingsRows.tsx | (w === "porch" ? t("lp.sr.porch") : wayTitle(w)) | (w === "porch" ? "Porch" : wayTitle(w))
 * @mutate src/components/declutter/BunchChoices.tsx | {drops ? t("lp.b.dropsOn", { pct: dropPct, floor: floorPct }) : t("lp.b.dropsOff")} | {drops ? t("lp.b.dropsOn", { pct: dropPct, floor: floorPct }) : "Off. Each priced item stays at its price."}
 * @mutate src/components/declutter/BunchChoices.tsx | font-semibold">{t("lp.keepUpTitle")}</span> | font-semibold">Keep it up until it sells</span>
 * @mutate src/components/declutter/DeclutterBunchListStep.tsx |   return t("lp.b.takes", { time }); |   return `Takes about ${time}. Keep this page open.`;
 * @mutate src/components/declutter/DeclutterBunchListStep.tsx | font-semibold">{t("lp.b.usualHead")}</h3> | font-semibold">Your usual pickup times</h3>
 * @mutate src/components/declutter/DeclutterBunchListStep.tsx | {listing ? t("lp.b.listingBtn") : t(readyCount === 1 ? "lp.b.list1" : "lp.b.listN", { n: readyCount })} | {listing ? t("lp.b.listingBtn") : `List ${readyCount} items`}
 * @mutate src/components/declutter/DeclutterBunchListStep.tsx | data-bunch-free-note="">{t("lp.b.freeNote")}</p> | data-bunch-free-note="">Free items are claimed, not bought.</p>
 * @mutate src/components/declutter/DeclutterListingDefaults.tsx | {draft.acceptsOffers ? t("lp.ld.offersOn") : t("lp.ld.offersOff")} | {draft.acceptsOffers ? "Buyers can offer a lower price, and you say yes or no." : t("lp.ld.offersOff")}
 * @mutate src/components/declutter/DeclutterListingDefaults.tsx | text-foreground">{t("lp.ld.tradesTitle")}</span> | text-foreground">Open to trades</span>
 * @mutate src/components/declutter/DeclutterListingDefaults.tsx |         {t("lp.ld.intro")}\n |         Your next listing starts with these.\n
 * @mutate src/components/declutter/DeclutterListingDefaults.tsx | text-foreground">{t("lp.ld.waysHead")}</p> | text-foreground">How buyers can get it</p>
 * @mutate src/components/declutter/DeclutterConfirmSheet.tsx | disabled={pending}>{cancelLabel ?? t("core.notNow")}</SheetSecondaryAction> | disabled={pending}>{cancelLabel ?? "Not now"}</SheetSecondaryAction>
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { setLang, ensureLangLoaded, __resetLangForTests } from "@/lib/i18n/language";
import { enListingParts } from "@/lib/i18n/enListingParts";
import { esListingParts } from "@/lib/i18n/esListingParts";
import { SELLER_DEFAULTS } from "@/lib/declutter/sellerDefaults";

vi.mock("@/components/declutter/SellPorchPlaces", async (orig) => ({ ...(await orig<object>()), SellPorchPlaces: () => null }));
vi.mock("@/components/declutter/SellPorchDays", () => ({ SellPorchDays: () => null }));
vi.mock("@/components/declutter/useSellerSetupFee", () => ({ useSellerSetupFee: () => ({ unknown: false, server: false, orderId: null, cents: 0 }) }));
vi.mock("@/components/declutter/DeclutterOffersForAll", () => ({ OffersForAllListings: () => null }));
vi.mock("@/components/declutter/BundleDiscountCard", () => ({ BundleDiscountCard: () => null, bundleRuleKey: () => ["b"], useBundleRule: () => ({ data: null }) }));
vi.mock("@/hooks/useFeature", () => ({ useFeature: () => false }));
vi.mock("@/lib/declutter/porchPlaces", async (orig) => ({ ...(await orig<object>()), fetchMyPorchPlaces: async () => [] }));
vi.mock("@/lib/declutter/sellerDefaults", async (orig) => {
  const real = await orig<typeof import("@/lib/declutter/sellerDefaults")>();
  return { ...real, fetchSellerDefaults: async () => ({ ...real.SELLER_DEFAULTS, acceptsOffers: true, acceptsTrades: false, handovers: ["porch"] }) };
});

const { SellingSettingsRows, dayWords, makeFreeValue, bunchDropsValue, pickupLines } = await import("@/components/declutter/SellingSettingsRows");
const { BunchChoicesCard } = await import("@/components/declutter/BunchChoices");
const { BunchListStep } = await import("@/components/declutter/DeclutterBunchListStep");
const { ListingDefaultsCard } = await import("@/components/declutter/DeclutterListingDefaults");

type StepProps = Parameters<typeof BunchListStep>[0];
const choices = { choices: { keepUp: true, drops: false, dropPct: 10, floorPct: 50 }, set: vi.fn(), remember: vi.fn() } as unknown as StepProps["choices"];
const stepProps = (): StepProps => ({
  step: 3, items: [{ free: false }, { free: true }] as unknown as StepProps["items"], pricedDraftsOffered: false, readyCount: 2, heldForFee: 0,
  savedSetup: { hasSettings: false, pickup: null } as unknown as StepProps["savedSetup"],
  savedWindows: { isSuccess: true, isError: false } as unknown as StepProps["savedWindows"], savedWays: [],
  windows: [{ weekday: 6, starts: "09:00", ends: "12:00" }], setWindows: vi.fn(), choices, ways: ["porch"], setWays: vi.fn(),
  sellerDeliveryOpen: false, attested: false, setAttested: vi.fn(), problem: null, blocked: false, listing: false, photoProgress: null, onList: vi.fn(),
});

const show = () => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter><div>
    <ul><SellingSettingsRows pickup={[]} drops={bunchDropsValue({ drops: true, dropPct: 10, floorPct: 50 })} makeFree={makeFreeValue(14)} /></ul>
    <BunchChoicesCard c={choices} anyPriced />
    <BunchListStep {...stepProps()} />
    <ListingDefaultsCard userId="u1" />
  </div></MemoryRouter></QueryClientProvider>,
);

describe("listing settings rows, Sell a bunch and Listing defaults follow the member's language (F260q)", () => {
  afterEach(() => {
    cleanup();
    __resetLangForTests();
  });

  it("English reads the old words, word for word", async () => {
    expect(enListingParts["lp.ld.offersTitle"]).toBe("Accept offers");
    expect(enListingParts["lp.ld.offersOn"]).toBe("Buyers can offer a lower price, and you say yes or no.");
    expect(enListingParts["lp.ld.offersOff"]).toBe("Off. Buyers pay your price with Buy now; no offers.");
    expect(enListingParts["lp.ld.tradesTitle"]).toBe("Open to trades");
    expect(enListingParts["lp.ld.tradesOn"]).toBe("Buyers can offer one of their listings in trade. No money changes hands.");
    expect(enListingParts["lp.ld.tradesOff"]).toBe("Off. Buyers can't offer a trade.");
    expect(dayWords([6, 0])).toBe("Sundays and Saturdays");
    expect(dayWords([1, 3, 5])).toBe("Mondays, Wednesdays and Fridays");
    expect(makeFreeValue(null)).toBe("Never");
    expect(pickupLines({ ways: ["porch", "meetup"], places: [], areaLabel: "Lafayette", windows: [{ weekday: 6, starts: "09:00", ends: "12:00" }] }))
      .toEqual(["Porch, Safe meeting spot · Lafayette · Saturdays 9:00 AM–12:00 PM"]);
    show();
    expect(screen.getByText("From your settings")).toBeTruthy();
    expect(screen.getByText("10% each evening, lowest 50% of each price")).toBeTruthy();
    expect(screen.getByText("After 14 days")).toBeTruthy();
    expect(screen.getAllByText("Off. Each priced item stays at its price.").length).toBeGreaterThan(0);
    expect(screen.getByText("3. List 2 items")).toBeTruthy();
    expect(screen.getByRole("button", { name: "List 2 items" })).toBeTruthy();
    expect(screen.getByText("Takes about 1 minute. Keep this page open.")).toBeTruthy();
    expect(await screen.findByText("Open to trades")).toBeTruthy();
    expect(screen.getByText(/^Your next listing starts with these, and you can change them on any listing\./)).toBeTruthy();
  });

  it("Spanish: the rows, the bunch switches and list step, and Listing defaults", async () => {
    setLang("es");
    await ensureLangLoaded();
    expect(dayWords([6, 0])).toBe("domingos y sábados");
    expect(dayWords([0, 1, 2, 3, 4, 5, 6])).toBe("Todos los días");
    expect(makeFreeValue(null)).toBe("Nunca");
    expect(pickupLines({ ways: ["porch", "meetup"], places: [], areaLabel: "Lafayette", windows: [{ weekday: 6, starts: "09:00", ends: "12:00" }] }))
      .toEqual(["Porche, Lugar de encuentro seguro · Lafayette · sábados 9:00 AM–12:00 PM"]);
    show();
    expect(screen.getByText("De sus ajustes")).toBeTruthy();
    expect(screen.getByText("Bajadas de precio")).toBeTruthy();
    expect(screen.getByText("Hacerlo gratis")).toBeTruthy();
    expect(screen.getByText("Aún sin fijar")).toBeTruthy();
    expect(screen.getByText("10% cada tarde, mínimo 50% de cada precio")).toBeTruthy();
    expect(screen.getByText("Después de 14 días")).toBeTruthy();
    expect(screen.getAllByText(esListingParts["lp.b.dropsOff"]).length).toBeGreaterThan(0);
    expect(screen.getAllByText(esListingParts["lp.keepUpTitle"]).length).toBeGreaterThan(0);
    expect(screen.getByText("3. Publicar 2 artículos")).toBeTruthy();
    expect(screen.getByText(esListingParts["lp.b.usualHead"])).toBeTruthy();
    expect(screen.getByText(esListingParts["lp.b.freeNote"])).toBeTruthy();
    expect(screen.getByRole("button", { name: "Publicar 2 artículos" })).toBeTruthy();
    expect(screen.getByText("Tarda alrededor de 1 minuto. Mantenga esta página abierta.")).toBeTruthy();
    expect(await screen.findByText("Abierto a cambios")).toBeTruthy();
    expect(screen.getByText(esListingParts["lp.ld.offersOn"])).toBeTruthy();
    expect(screen.getByText(esListingParts["lp.ld.intro"])).toBeTruthy();
    expect(screen.getByText(esListingParts["lp.ld.waysHead"])).toBeTruthy();
    expect(SELLER_DEFAULTS).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/From your settings|Price drops|Make it free|each evening|Keep it up|List 2 items|Takes about|usual pickup times|Free items are claimed|Accept offers|Open to trades|Your next listing|How buyers can get/);
  });

  it("the shared confirm sheet's default way out is Spanish too (core.notNow, boot words)", async () => {
    const { ConfirmSheet } = await import("@/components/declutter/DeclutterConfirmSheet");
    const sheet = () => render(<ConfirmSheet open title="T" confirmLabel="OK" onConfirm={() => {}} onClose={() => {}}>x</ConfirmSheet>);
    sheet();
    expect(screen.getByRole("button", { name: "Not now" })).toBeTruthy();
    cleanup();
    setLang("es");
    await ensureLangLoaded();
    sheet();
    expect(screen.getByRole("button", { name: "Ahora no" })).toBeTruthy();
  });
});
