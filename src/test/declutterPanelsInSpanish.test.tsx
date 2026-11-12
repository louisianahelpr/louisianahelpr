/**
 * F260q (owner 11-11 "Spanish EVERYTHING now"): Declutter's item-page panels in the member's language. A Spanish
 * member reads deadlines ("quedan 3 horas"), the price-drop banner, the fair-price hint and Helpr delivery's price list
 * in Spanish; an English member reads the old words, word for word. The trade offer button is source-checked by
 * spanishScreensUseDictionary (CONVERTED).
 *
 * @mutate src/lib/declutter/timeLeft.ts |   if (h >= 1) return h === 1 ? t("dp.hourLeft") : t("dp.hoursLeft", { n: h }); |   if (h >= 1) return `${h} hours left`;
 * @mutate src/lib/declutter/timeLeft.ts |   return t("dp.byTime", { time: sameDay | return "by " + ({ time: sameDay
 * @mutate src/lib/declutter/priceDrop.ts |   if (day === tomorrow) return t("dp.dropTomorrow", { time }); |   if (day === tomorrow) return `tomorrow at ${time}`;
 * @mutate src/lib/declutter/priceHint.ts |     basis: t("dp.hintBasis", { n: h.sales }), |     basis: `Based on ${h.sales}+ Declutter sales.`,
 * @mutate src/components/declutter/DeclutterPriceDrop.tsx |           {t(mine ? "dp.dropRuleMine" : "dp.dropRule", { pct })} |           {`Each evening it can drop ${pct}%.`}
 * @mutate src/components/declutter/handoverCopy.ts | export const handoverTitle = (h: Handover): string => t(`ho.title.${h}`); | export const handoverTitle = (h: Handover): string => HANDOVER_TITLE[h];
 * @mutate src/components/declutter/ItemPickupBlock.tsx |   return cities.some(same) ? ` · ${t("pb.also")} | return cities.some(same) ? ` · also
 * @mutate src/components/declutter/DeliveryPriceList.tsx |     { size: "xl", label: t("dp.sizeXl"), | { size: "xl", label: "Extra large",
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { setLang, ensureLangLoaded, __resetLangForTests } from "@/lib/i18n/language";
import { es } from "@/lib/i18n/es";
import { enDeclPanels } from "@/lib/i18n/enDeclPanels";
import { esDeclPanels } from "@/lib/i18n/esDeclPanels";
import { timeLeft, byClock } from "@/lib/declutter/timeLeft";
import { dropWhenLabel } from "@/lib/declutter/priceDrop";
import { priceHintWords } from "@/lib/declutter/priceHint";
import { PriceDropBanner } from "@/components/declutter/DeclutterPriceDrop";
import { DeliveryPriceList } from "@/components/declutter/DeliveryPriceList";
import { HANDOVER_TITLE, HANDOVER_WORDS, handoverTitle } from "@/components/declutter/handoverCopy";
import { townsWords } from "@/components/declutter/ItemPickupBlock";

const NOW = Date.parse("2026-11-11T18:00:00Z");
const HINT = { sales: 20, low_cents: 1000, high_cents: 2500 } as Parameters<typeof priceHintWords>[0];

async function spanish() {
  __resetLangForTests();
  setLang("es");
  await ensureLangLoaded();
}

describe("Declutter panels follow the member's language (F260q)", () => {
  afterEach(() => {
    cleanup();
    __resetLangForTests();
  });

  it("every English panel word has its Spanish, and es.ts carries it", () => {
    const keys = Object.keys(enDeclPanels) as (keyof typeof enDeclPanels)[];
    expect(keys.length).toBeGreaterThan(30);
    for (const k of keys) {
      expect(es[k], k).toBe(esDeclPanels[k]);
      expect(esDeclPanels[k], `${k} still English`).not.toBe(enDeclPanels[k]);
    }
  });

  it("the handover ways' English is the checkout's table, word for word", () => {
    const ways = Object.keys(HANDOVER_TITLE) as (keyof typeof HANDOVER_TITLE)[];
    expect(ways.length).toBeGreaterThan(4);
    for (const w of ways) {
      expect(enDeclPanels[`ho.title.${w}`], w).toBe(HANDOVER_TITLE[w]);
      expect(enDeclPanels[`ho.words.${w}`], w).toBe(HANDOVER_WORDS[w]);
    }
  });

  it("Spanish: the handover ways and the pickup block's town words", async () => {
    await spanish();
    expect(handoverTitle("porch")).toBe(esDeclPanels["ho.title.porch"]);
    expect(townsWords(["Lafayette", "Delcambre", "Erath"], "Lafayette")).toBe(" · también Delcambre o Erath");
  });

  it("English: the old words, word for word", () => {
    __resetLangForTests();
    expect(timeLeft(new Date(NOW + 3 * 3_600_000).toISOString(), NOW)).toBe("3 hours left");
    expect(timeLeft(new Date(NOW + 1 * 3_600_000).toISOString(), NOW)).toBe("1 hour left");
    expect(timeLeft(new Date(NOW - 1).toISOString(), NOW)).toBe("time is up");
    expect(byClock(new Date(NOW + 3_600_000).toISOString(), NOW)).toMatch(/^by /);
    expect(dropWhenLabel(new Date(NOW + 24 * 3_600_000), new Date(NOW))).toMatch(/^tomorrow at /);
    expect(priceHintWords(HINT, "near_you")?.basis).toMatch(/^Based on 20\+ Declutter sales/);
  });

  it("Spanish: deadlines, the drop time and the price hint", async () => {
    await spanish();
    expect(timeLeft(new Date(NOW + 3 * 3_600_000).toISOString(), NOW)).toBe("quedan 3 horas");
    expect(timeLeft(new Date(NOW + 72 * 3_600_000).toISOString(), NOW)).toBe("quedan 3 días");
    expect(byClock(new Date(NOW + 3_600_000).toISOString(), NOW)).toMatch(/^antes de /);
    expect(dropWhenLabel(new Date(NOW + 24 * 3_600_000), new Date(NOW))).toMatch(/^mañana a las /);
    const hint = priceHintWords(HINT, "near_you");
    expect(hint?.headline).toContain("cerca de usted");
    expect(hint?.basis).toMatch(/^Según 20\+ ventas en Declutter/);
  });

  it("Spanish: the price-drop banner and the delivery price list render in Spanish", async () => {
    await spanish();
    render(<PriceDropBanner lowestCents={4000} at={new Date(Date.now() + 2 * 86_400_000)} pct={10} />);
    expect(screen.getByText(/^Próxima rebaja posible: \$40,/)).toBeTruthy();
    expect(screen.getByText(/Cada tarde puede bajar un 10%/)).toBeTruthy();
    cleanup();
    render(<DeliveryPriceList quote={null} size="xl" />);
    expect(screen.getByText("Muy grande")).toBeTruthy();
    expect(screen.getByText(/por milla$/)).toBeTruthy();
  });
});
