/**
 * F260q (owner 11-11 "Spanish EVERYTHING now"): the listing-setting parts the saved draft's step form shares with
 * Manage listing and Declutter settings, in the member's language: "Keep it up until it sells" (KeepUpRow), "make it
 * free after __ days" (AutoFreeRow / autoFree.ts), how long it stays up (the draft's review row), the price-drops
 * switch's name on the sell form and the "If it doesn't sell" strip (DropSchedule). Words: enListingParts.ts /
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
 * @mutate src/components/declutter/SellFormParts.tsx | <span className="block text-ds-15 font-semibold text-foreground">{t("lp.dropsSwitch")}</span> | <span className="block text-ds-15 font-semibold text-foreground">Lower the price over time</span>
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { setLang, ensureLangLoaded, __resetLangForTests } from "@/lib/i18n/language";
import { es } from "@/lib/i18n/es";
import { enListingParts } from "@/lib/i18n/enListingParts";
import { esListingParts } from "@/lib/i18n/esListingParts";
import { autoFreeExplainer, autoFreeSaved } from "@/lib/declutter/autoFree";
import { KEEP_UP_TITLE, keepUpSettingLine } from "@/components/declutter/KeepUpRow";
import { DROPS_SWITCH_LABEL } from "@/components/declutter/sellForm";

vi.mock("@/components/declutter/useSellerSetupFee", () => ({ useSellerSetupFee: () => ({ unknown: false, server: false, orderId: null, cents: 0 }) }));

const { AutoFreeChoice } = await import("@/components/declutter/AutoFreeRow");
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
  <div>
    <AutoFreeChoice days={14} onChange={() => {}} />
    <DropSchedule priceCents={4000} floorCents={2000} pct={10} />
    <SellDropsCard s={flow()} />
  </div>,
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
    expect(document.body.textContent).not.toMatch(/If it doesn't sell|make it free after|Lower the price over time|first drop comes/);
  });
});
