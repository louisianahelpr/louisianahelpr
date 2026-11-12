/**
 * F260q (owner 11-11 "Spanish EVERYTHING now"): the listing-setting parts the saved draft's step form shares with
 * Manage listing and Declutter settings, in the member's language: "Keep it up until it sells" (KeepUpRow), "make it
 * free after __ days" (AutoFreeRow / autoFree.ts), how long it stays up (the draft's review row), the price-drops
 * switch's name on the sell form, the "If it doesn't sell" strip (DropSchedule) and the ways buyers can get it
 * (SellHandoverChoices / SellWayTiles, also on Declutter settings). Words: enListingParts.ts /
 * esListingParts.ts (its own small chunk). An English member reads the old words, word for word (the exported English
 * constants read the same dictionary).
 *
 * @mutate src/components/declutter/KeepUpRow.tsx |   return on ? t("lp.keepUpOn") : t("lp.keepUpOff"); |   return on ? enListingParts["lp.keepUpOn"] : enListingParts["lp.keepUpOff"];
 * @mutate src/components/declutter/KeepUpRow.tsx | >{t("lp.keepUpTitle")}</span> | >{KEEP_UP_TITLE}</span>
 * @mutate src/components/declutter/AutoFreeRow.tsx | >{t("lp.afLabel")}</label> | >If it doesn't sell, make it free after</label>
 * @mutate src/components/declutter/AutoFreeRow.tsx | {o.value === "never" ? t("lp.afNeverOption") : t("lp.afDays", { n: o.value })} | {o.label}
 * @mutate src/components/declutter/AutoFreeRow.tsx | {t("lp.afWins", { n: days })} | This wins over a stopped price: on day {days} it's free.
 * @mutate src/lib/declutter/autoFree.ts |   return t("lp.afExplainer", { n: days }); |   return `If it hasn't sold by day ${days}, it becomes free and anyone nearby can claim it.`;
 * @mutate src/components/declutter/DeclutterSellSteps.tsx | >{t("lp.dsHead")}</p> | >If it doesn't sell</p>
 * @mutate src/components/declutter/DeclutterSellSteps.tsx |         {t("lp.dsFoot", { floor: formatPrice(floorCents) })} |         The first drop comes after it has been up 12 hours.
 * @mutate src/components/declutter/KeepUpRow.tsx | >{t("lp.keepUpExplainer")}</span> | >{KEEP_UP_EXPLAINER}</span>
 * @mutate src/components/declutter/SellHandoverChoices.tsx | export const wayTitle = (w: SellerHandover): string => t(`lp.way.${w}`); | export const wayTitle = (w: SellerHandover): string => HANDOVER_CHOICE[w].title;
 * @mutate src/components/declutter/SellHandoverChoices.tsx | : t(`lp.way.${w}.words`)} | : c.words}
 * @mutate src/components/declutter/SellHandoverChoices.tsx | {free ? t("lp.waysHeadFree") : t("lp.waysHead")} | {free ? "How it's picked up" : "Tick every way that works for you"}
 * @mutate src/components/declutter/SellHandoverChoices.tsx | data-helpr-delivery-always="">{t("lp.helprAlways")}</p> | data-helpr-delivery-always="">Buyers can also choose Helpr delivery.</p>
 * @mutate src/components/declutter/DeclutterPickupTimes.tsx | const dayWord = (d: number) => t(`lp.day.${d}` as MsgKey); | const dayWord = (d: number) => ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][d];
 * @mutate src/components/declutter/DeclutterPickupTimes.tsx | const dayShort = (d: number) => t(`lp.dayShort.${d}` as MsgKey); | const dayShort = (d: number) => SHORT[d];
 * @mutate src/components/declutter/DeclutterPickupTimes.tsx | text-foreground">{t("lp.pt.days")}</legend> | text-foreground">Days</legend>
 * @mutate src/components/declutter/DeclutterPickupTimes.tsx | {t("lp.pt.addOn", { day: dayWord(d) })} | Add another time on {dayWord(d)}
 * @mutate src/components/declutter/DeclutterPickupTimes.tsx | if (windows.length === 0) return t("lp.pt.needOne"); | if (windows.length === 0) return "Pick at least one day and time buyers can come.";
 * @mutate src/components/declutter/SellFormParts.tsx | <span className="block text-ds-15 font-semibold text-foreground">{t("lp.dropsSwitch")}</span> | <span className="block text-ds-15 font-semibold text-foreground">Lower the price over time</span>
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { setLang, ensureLangLoaded, __resetLangForTests } from "@/lib/i18n/language";
import { es } from "@/lib/i18n/es";
import { enListingParts } from "@/lib/i18n/enListingParts";
import { esListingParts } from "@/lib/i18n/esListingParts";
import { autoFreeExplainer, autoFreeSaved } from "@/lib/declutter/autoFree";
import { KEEP_UP_TITLE, keepUpSettingLine } from "@/components/declutter/KeepUpRow";
import { DROPS_SWITCH_LABEL } from "@/components/declutter/sellForm";
import { handoverSummary } from "@/components/declutter/SellHandoverChoices";

vi.mock("@/components/declutter/SellPorchPlaces", async (orig) => ({ ...(await orig<object>()), SellPorchPlaces: () => null }));
vi.mock("@/components/declutter/SellPorchDays", () => ({ SellPorchDays: () => null }));
vi.mock("@/components/declutter/useSellerSetupFee", () => ({ useSellerSetupFee: () => ({ unknown: false, server: false, orderId: null, cents: 0 }) }));

const { AutoFreeChoice } = await import("@/components/declutter/AutoFreeRow");
const { KeepUpSwitch } = await import("@/components/declutter/KeepUpRow");
const { SellHandoverChoices } = await import("@/components/declutter/SellHandoverChoices");
const { PickupTimesEditor, pickupWindowsProblem } = await import("@/components/declutter/DeclutterPickupTimes");
const { DropSchedule } = await import("@/components/declutter/DeclutterSellSteps");
const { SellDropsCard } = await import("@/components/declutter/SellFormParts");

type S = Parameters<typeof SellDropsCard>[0]["s"];
const flow = () => ({
  form: { free: false, price: "40", floor: "20", drops: true, dropPct: 10 },
  priceCents: 4000,
  floorCents: 2000,
  set: vi.fn(),
  setForm: vi.fn(),
}) as unknown as S;

const show = () => render(
  <QueryClientProvider client={new QueryClient()}><div>
    <AutoFreeChoice days={14} onChange={() => {}} />
    <DropSchedule priceCents={4000} floorCents={2000} pct={10} />
    <SellDropsCard s={flow()} />
    <KeepUpSwitch as="div" rowClassName="" keep={{ itemId: "i1", on: false, state: { data: false, isError: false, isLoading: false }, flip: { isPending: false, mutate: vi.fn() } } as unknown as Parameters<typeof KeepUpSwitch>[0]["keep"]} />
    <SellHandoverChoices ways={["porch", "meetup"]} setWays={() => {}} free={false} sellerDeliveryOpen={false} />
    <PickupTimesEditor windows={[{ weekday: 1, starts: "09:00", ends: "12:00" }, { weekday: 3, starts: "17:00", ends: "19:00" }]} setWindows={() => {}} />
  </div></QueryClientProvider>,
);

describe("the listing-setting parts follow the member's language (F260q)", () => {
  afterEach(() => {
    cleanup();
    __resetLangForTests();
  });

  it("every English word has its Spanish and es.ts carries it", () => {
    for (const k of Object.keys(enListingParts) as (keyof typeof enListingParts)[]) {
      expect(esListingParts[k], k).toBeTruthy();
      expect(esListingParts[k], k).not.toBe(enListingParts[k]);
      expect((es as Record<string, string>)[k], k).toBe(esListingParts[k]);
      // Same {vars} on both sides, so a filled Spanish line never shows a raw {n}.
      expect((esListingParts[k].match(/\{\w+\}/g) ?? []).sort(), k).toEqual((enListingParts[k].match(/\{\w+\}/g) ?? []).sort());
    }
  });

  it("English reads the old words, word for word", () => {
    show();
    expect(KEEP_UP_TITLE).toBe("Keep it up until it sells");
    expect(DROPS_SWITCH_LABEL).toBe("Lower the price over time");
    expect(keepUpSettingLine(false)).toBe("Off. It's up for 30 days at a time, up to 4 times (about 4 months). We'll remind you before each round ends.");
    expect(autoFreeExplainer(14)).toBe("If it hasn't sold by day 14, it becomes free and anyone nearby can claim it. Already past day 14? It becomes free tonight.");
    expect(autoFreeSaved(7)).toBe("If it hasn't sold by day 7, it becomes free.");
    expect(screen.getByText("If it doesn't sell, make it free after")).toBeTruthy();
    expect(screen.getByRole("option", { name: "14 days" })).toBeTruthy();
    expect(screen.getAllByText("If it doesn't sell").length).toBeGreaterThan(0);
    expect(screen.getByText("Keep it up until it sells")).toBeTruthy();
    expect(screen.getByText("Tick every way that works for you")).toBeTruthy();
    expect(screen.getByRole("checkbox", { name: "Porch pickup" })).toBeTruthy();
    expect(screen.getByText("Days")).toBeTruthy();
    expect(screen.getAllByText("Monday").length).toBeGreaterThan(0);
    expect(screen.getByText("Add another time on Monday")).toBeTruthy();
    expect(pickupWindowsProblem([])).toBe("Pick at least one day and time buyers can come.");
    expect(screen.getByText("Lower the price over time")).toBeTruthy();
  });

  it("Spanish: keep it up, make it free after, the drop strip and the drops switch", async () => {
    setLang("es");
    await ensureLangLoaded();
    show();
    expect(keepUpSettingLine(true)).toBe(esListingParts["lp.keepUpOn"]);
    expect(keepUpSettingLine(false)).toBe(esListingParts["lp.keepUpOff"]);
    expect(autoFreeExplainer(14)).toContain("Si no se ha vendido para el día 14");
    expect(autoFreeExplainer(null)).toBe("No se hará gratis por sí solo.");
    expect(screen.getByText(esListingParts["lp.afLabel"])).toBeTruthy();
    expect(screen.getByRole("option", { name: "Nunca hacerlo gratis" })).toBeTruthy();
    expect(screen.getByRole("option", { name: "14 días" })).toBeTruthy();
    expect(screen.getByText("Esto gana sobre un precio detenido: el día 14 es gratis.")).toBeTruthy();
    expect(screen.getAllByText("Si no se vende").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/La primera bajada llega cuando lleva 12 horas publicado\. Nunca baja de \$20/).length).toBeGreaterThan(0);
    expect(screen.getByText("Bajar el precio con el tiempo")).toBeTruthy();
    expect(screen.getByText("Mantenerlo publicado hasta que se venda")).toBeTruthy();
    expect(screen.getByText(esListingParts["lp.keepUpExplainer"])).toBeTruthy();
    expect(screen.getByText("Marque cada forma que le sirva")).toBeTruthy();
    expect(screen.getByRole("checkbox", { name: "Recoger en el porche" })).toBeTruthy();
    expect(screen.getByText(esListingParts["lp.way.meetup.words"])).toBeTruthy();
    expect(screen.getByText(esListingParts["lp.helprAlways"])).toBeTruthy();
    expect(screen.getByText("Días")).toBeTruthy();
    expect(screen.getAllByText("lunes").length).toBeGreaterThan(0);
    expect(screen.getAllByText("mié").length).toBeGreaterThan(0);
    expect(screen.getByText("Agregar otra hora el lunes")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Quitar lunes de 9:00 AM a 12:00 PM" })).toBeTruthy();
    expect(screen.getAllByText("Desde").length).toBeGreaterThan(0);
    expect(pickupWindowsProblem([])).toBe(esListingParts["lp.pt.needOne"]);
    expect(pickupWindowsProblem([{ weekday: 1, starts: "12:00", ends: "09:00" }])).toBe(esListingParts["lp.pt.endAfter"]);
    expect(handoverSummary(["meetup", "porch"])).toBe("Recoger en el porche, Lugar de encuentro seguro");
    expect(document.body.textContent).not.toMatch(/If it doesn't sell|make it free after|Lower the price over time|first drop comes|Keep it up|Tick every way|Porch pickup|Safe meeting spot|Buyers can also choose|Add another time|Monday|Wednesday/);
  });
});
