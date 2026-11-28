/**
 * Polish audit 11-27 #126: Declutter's setting and Manage rows repeated their switch's state in words ("On. It renews
 * every 30 days...", "Off. Buyers can't offer a trade."), beside the switch that already shows it. Each line now says
 * what the setting does. Whole class: no line in the sell-form and listing-parts dictionaries (English and Spanish)
 * starts with the state word.
 *
 * @mutate src/lib/i18n/enListingParts.ts |   "lp.ld.tradesOff": "Buyers can't offer a trade.", |   "lp.ld.tradesOff": "Off. Buyers can't offer a trade.",
 * @mutate src/lib/i18n/esSellForm.ts |   "sf.dr.off": "Se queda en su precio hasta que usted lo cambie.", |   "sf.dr.off": "Apagado. Se queda en su precio hasta que usted lo cambie.",
 */
import { describe, expect, it } from "vitest";
import { enSellForm } from "@/lib/i18n/enSellForm";
import { enListingParts } from "@/lib/i18n/enListingParts";
import { esSellForm } from "@/lib/i18n/esSellForm";
import { esListingParts } from "@/lib/i18n/esListingParts";

const lines = (d: Record<string, string>) => Object.entries(d);

describe("Declutter setting lines say what the setting does, not On / Off (#126)", () => {
  it("is not vacuous: the dictionaries hold the setting lines", () => {
    const all = [...lines(enSellForm), ...lines(enListingParts)];
    expect(all.length).toBeGreaterThan(200);
    const settingKeys = ["sf.offersOff", "sf.dr.on", "sf.dr.off", "lp.keepUpOn", "lp.keepUpOff", "lp.ld.tradesOff", "lp.m.dropsOn"];
    for (const k of settingKeys) expect(all.find(([key]) => key === k), k).toBeTruthy();
  });

  it("no English line starts with 'On.' or 'Off.'", () => {
    const bad = [...lines(enSellForm), ...lines(enListingParts)].filter(([, v]) => /^(On|Off)\.\s/.test(v)).map(([k]) => k);
    expect(bad).toEqual([]);
  });

  it("no Spanish line starts with 'Encendido.' or 'Apagado.'", () => {
    const bad = [...lines(esSellForm), ...lines(esListingParts)].filter(([, v]) => /^(Encendido|Apagado)\.\s/.test(v)).map(([k]) => k);
    expect(bad).toEqual([]);
  });
});
