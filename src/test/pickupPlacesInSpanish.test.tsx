/**
 * F260q (owner 11-11 "Spanish EVERYTHING now"): the draft form's pickup cards, also on Declutter settings, in the
 * member's language: Pickup places (SellPorchPlaces: words, rows, the add/edit form, remove sheet, "New listings now
 * use..."), Porch days (SellPorchDays), the "I can deliver is off" note (SellDeliveryOffNotice), Meet spots
 * (SellMeetupSpots), and the day words of every place's hours line (pickupTimesText: "sáb", "Todos los días").
 * Words: enListingParts.ts / esListingParts.ts (lp.f.*, lp.pp.*, lp.pd.*, lp.do.*, lp.ms.*). An English member reads
 * the old words, word for word.
 *
 * @mutate src/components/declutter/SellPorchPlaces.tsx |   if (card) return count > 0 ? `${t("lp.pp.bothKinds")} ${all}` : `${more} ${t("lp.pp.bothKinds")}`; |   if (card) return count > 0 ? `${PLACES_BOTH_KINDS} This applies to all your listings.` : `${more} ${t("lp.pp.bothKinds")}`;
 * @mutate src/components/declutter/SellPorchPlaces.tsx | <p className="text-ds-14 font-semibold text-foreground">{t("lp.pp.title")}</p> | <p className="text-ds-14 font-semibold text-foreground">Pickup places</p>
 * @mutate src/components/declutter/SellPorchPlaces.tsx | aria-label={t("lp.pp.edit", { name: place.label })} | aria-label={`Edit ${place.label}`}
 * @mutate src/components/declutter/SellPorchPlaces.tsx | {usualRead.isLoading ? t("lp.pp.loadingTimes") : t("lp.pp.add")} | {usualRead.isLoading ? t("lp.pp.loadingTimes") : "Add a pickup place"}
 * @mutate src/components/declutter/SellPorchPlaces.tsx |             : t("lp.pp.nowEach", { hours: placeHoursLine(usual, null) })}{" "} |             : `New listings now use the address you give each one, with pickup ${placeHoursLine(usual, null)}.`}{" "}
 * @mutate src/components/declutter/SellPorchPlaces.tsx | {save.isPending ? t("lp.f.saving") : t("lp.pp.save")} | {save.isPending ? t("lp.f.saving") : "Save place"}
 * @mutate src/components/declutter/SellPorchDays.tsx | text-foreground">{t("lp.pd.onlyQ")}</label> | text-foreground">Porch only on some of these days?</label>
 * @mutate src/components/declutter/SellPorchDays.tsx | text-muted-foreground">{t("lp.pd.any")}</p> | text-muted-foreground">Buyers can pick any of your pickup days for porch pickup.</p>
 * @mutate src/components/declutter/SellDeliveryOffNotice.tsx |         {t("lp.do.note")}\n |         Buyers won't see "I'll deliver" until you turn on "I can deliver".\n
 * @mutate src/components/declutter/SellMeetupSpots.tsx | text-foreground">{t("lp.ms.title")}</h2> | text-foreground">Meet spots</h2>
 * @mutate src/components/declutter/SellMeetupSpots.tsx |           {t("lp.ms.body")}\n |           Public places where you'll meet a buyer.\n
 * @mutate src/components/declutter/SellMeetupSpots.tsx | text-foreground">{t("lp.ms.police")}</p> | text-foreground">Or start from a police safe exchange spot</p>
 * @mutate src/lib/declutter/pickupTimesText.ts | const shortDayNames = () => (getLang() === "es" ? SHORT_DAY_ES : SHORT_DAY_EN); | const shortDayNames = () => SHORT_DAY_EN;
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { setLang, ensureLangLoaded, __resetLangForTests } from "@/lib/i18n/language";
import { esListingParts } from "@/lib/i18n/esListingParts";

const h = vi.hoisted(() => ({ places: [] as unknown[] }));
const HOME = { id: "p1", position: 0, label: "Casa", address: "12 Home Street, Lafayette", area: "Lafayette", lat: 30.2, lng: -92, weekdays: [6],
  windows: [{ weekday: 6, starts: "09:00", ends: "12:00" }] };
const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6].map((d) => ({ weekday: d, starts_local: "07:00:00", ends_local: "21:00:00" }));

vi.mock("@/hooks/useMapKitJs", () => ({ useMapKitJs: () => "missing-token" }));
vi.mock("@/hooks/useCurrentUser", () => ({ useCurrentUser: () => ({ user: { id: "seller-1" } }) }));
vi.mock("@/hooks/useFeature", () => ({ useFeature: () => true }));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }));
vi.mock("@/components/declutter/SellerDeliverySettings", () => ({ SellerDeliveryCard: () => null }));
vi.mock("@/lib/declutter/porchPlaces", async (orig) => ({ ...(await orig<object>()), fetchMyPorchPlaces: async () => h.places }));
vi.mock("@/lib/declutter/api", async (orig) => ({ ...(await orig<object>()), fetchMyPickupWindows: async () => EVERY_DAY }));
vi.mock("@/lib/declutter/lastSetup", () => ({ fetchLastSetup: async () => ({ areaLabel: "" }) }));
vi.mock("@/lib/declutter/porchDays", async (orig) => ({ ...(await orig<object>()), fetchMyPorchDays: async () => null }));
vi.mock("@/lib/declutter/sellerDelivery", async (orig) => ({ ...(await orig<object>()), fetchMySellerDelivery: async () => ({ enabled: false }) }));
vi.mock("@/lib/declutter/meetup", async (orig) => ({
  ...(await orig<object>()),
  fetchMyMeetupSpots: async () => [],
  fetchMeetupSuggestions: async () => [{ id: "s1", name: "Iberia Sheriff Safe Zone", address: "300 Iberia St, New Iberia, LA", area: "New Iberia", lat: 30, lng: -91 }],
}));

const { SellPorchPlaces } = await import("@/components/declutter/SellPorchPlaces");
const { SellPorchDays } = await import("@/components/declutter/SellPorchDays");
const { SellDeliveryOffNotice } = await import("@/components/declutter/SellDeliveryOffNotice");
const { SellMeetupSpots } = await import("@/components/declutter/SellMeetupSpots");
const { placeHoursLine } = await import("@/lib/declutter/pickupTimesText");

const show = () => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><div>
    <SellPorchPlaces card />
    <SellPorchDays pickupDays={[1, 3]} />
    <SellDeliveryOffNotice ticked />
    <SellMeetupSpots />
  </div></QueryClientProvider>,
);

describe("the draft form's pickup cards follow the member's language (F260q)", () => {
  beforeEach(() => { h.places = []; });
  afterEach(() => {
    cleanup();
    __resetLangForTests();
  });

  it("English reads the old words, word for word", async () => {
    show();
    expect(await screen.findByText(/New listings now use the address you give each one, with pickup Every day 7:00 AM–9:00 PM\./)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Add a pickup place" })).toBeTruthy();
    expect(await screen.findByText("Porch only on some of these days?")).toBeTruthy();
    expect(screen.getByText("Buyers can pick any of your pickup days for porch pickup.")).toBeTruthy();
    expect(await screen.findByText(`Buyers won't see "I'll deliver" until you turn on "I can deliver" and set your delivery price.`)).toBeTruthy();
    expect(await screen.findByText("Meet spots")).toBeTruthy();
    expect(await screen.findByText("Or start from a police safe exchange spot")).toBeTruthy();
    expect(placeHoursLine([{ weekday: 6, starts: "09:00", ends: "12:00" }], null)).toBe("Sat 9:00 AM–12:00 PM");
  });

  it("Spanish: pickup places (no place yet), porch days, the delivery-off note, meet spots", async () => {
    setLang("es");
    await ensureLangLoaded();
    show();
    expect(await screen.findByText(/Las publicaciones nuevas ahora usan la dirección que le dé a cada una, con recogida Todos los días 7:00 AM–9:00 PM\./)).toBeTruthy();
    expect(screen.getByText(/Agregue un lugar de recogida para guardarlo aquí y cambiarlo\./)).toBeTruthy();
    expect(screen.getByText(/^¿Guarda cosas en más de un lugar\? Guarde hasta 5, cada uno con sus propios días y horas\. Los compradores eligen uno/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Agregar un lugar de recogida" }));
    expect(screen.getByRole("button", { name: "Guardar lugar" })).toBeTruthy();
    expect(screen.getByText("Agregue un nombre para guardar este lugar.")).toBeTruthy();
    expect(screen.getByText(esListingParts["lp.pp.hoursHead"])).toBeTruthy();
    expect(await screen.findByText(esListingParts["lp.pd.onlyQ"])).toBeTruthy();
    expect(screen.getByText(esListingParts["lp.pd.any"])).toBeTruthy();
    expect(screen.getByText("Sus días de recogida: lun, mié.")).toBeTruthy();
    expect(await screen.findByText(esListingParts["lp.do.note"])).toBeTruthy();
    expect(await screen.findByText("Lugares de encuentro")).toBeTruthy();
    expect(screen.getByText(esListingParts["lp.ms.body"])).toBeTruthy();
    expect(await screen.findByText(esListingParts["lp.ms.police"])).toBeTruthy();
    expect(placeHoursLine([{ weekday: 6, starts: "09:00", ends: "12:00" }], null)).toBe("sáb 9:00 AM–12:00 PM");
    expect(document.body.textContent).not.toMatch(/Pickup places|New listings now use|Add a pickup place|Save place|Porch only|Buyers can pick any|Buyers won't see|Meet spots|police safe exchange|Every day|Days and hours/);
  });

  it("Spanish: a saved place's row, its words and its edit/remove names", async () => {
    h.places = [HOME];
    setLang("es");
    await ensureLangLoaded();
    show();
    expect(await screen.findByText(`${esListingParts["lp.pp.bothKinds"]} ${esListingParts["lp.pp.allListings"]}`)).toBeTruthy();
    expect(screen.getByText(esListingParts["lp.pp.daysRule"])).toBeTruthy();
    expect(screen.getByText("Lugares de recogida")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Editar Casa" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Quitar Casa" })).toBeTruthy();
    expect(screen.getByText("sáb 9:00 AM–12:00 PM")).toBeTruthy();
  });
});
