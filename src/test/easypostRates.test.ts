/**
 * EasyPost rates (docs/specs/shipping-draft.md S2 rates; Q2259): only USPS Ground Advantage (cubic included) and
 * Priority are offered, cheapest of each; dollar strings become cents exactly; a malformed or foreign rate is
 * dropped; a response in the wrong mode is refused (money review fix 8).
 *
 * Fixture: the shape of the Rate object in EasyPost's docs (docs.easypost.com/docs/shipments/rates, read
 * 2026-10-30: "rate": "11.01" string, "mode": "test", id "rate_...", shipment_id "shp_..."), with amounts from the
 * spec's measured Louisiana prices (section 3 and 4.2). NOT a recorded live call: no EasyPost key exists yet (S0).
 *
 * @mutate supabase/functions/_shared/easypostRates.ts |     if (r?.carrier !== "USPS" \|\| typeof r.service !== "string" \|\| r.currency !== "USD") continue; |     if (typeof r.service !== "string") continue;
 * @mutate supabase/functions/_shared/easypostRates.ts |   const cents = Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0")); |   const cents = Math.trunc(Number(v) * 100);
 * @mutate supabase/functions/_shared/easypostRates.ts |   return obj?.mode === mode; |   return true;
 * @mutate supabase/functions/_shared/easypostRates.ts |   GroundAdvantageCubic: "usps_ground_advantage",\n |
 */
import { describe, expect, it } from "vitest";
import { allowedQuotes, dollarsToCents, easypostKeyName, offeredQuotes, responseModeMatches } from "../../supabase/functions/_shared/easypostRates";

const rate = (service: string, amount: string, over: Record<string, unknown> = {}) => ({
  id: `rate_${service.toLowerCase()}${amount.replace(".", "")}`, object: "Rate", mode: "test", carrier: "USPS", service,
  rate: amount, currency: "USD", delivery_days: service.startsWith("Priority") ? 2 : 4, shipment_id: "shp_d121498c06864586b0c9d961e971f509",
  ...over,
});
const RATES = [
  rate("Priority", "10.11"),
  rate("GroundAdvantage", "7.70"),
  rate("GroundAdvantageCubic", "6.50"),
  rate("PriorityMailCubic", "8.62"),
  rate("Express", "29.90"),
  rate("MediaMail", "4.63"),
  rate("GroundAdvantage", "7.10", { carrier: "UPS" }),
  rate("GroundAdvantage", "1.00", { currency: "CAD" }),
  rate("GroundAdvantage", "abc"),
  rate("GroundAdvantage", "0.00"),
  rate("Priority", "3.00", { id: "bogus" }),
];

describe("EasyPost rates for shipped orders", () => {
  it("dollar strings become cents exactly; anything else is refused", () => {
    expect(dollarsToCents("7.33")).toBe(733);
    expect(dollarsToCents("7.3")).toBe(730);
    expect(dollarsToCents("11")).toBe(1100);
    expect(dollarsToCents("0.29")).toBe(29); // 0.29 * 100 = 28.999999999999996 in floats
    expect(dollarsToCents("16.37")).toBe(1637);
    for (const bad of ["7.333", "-1.00", "1e3", "", " ", "7,33", null, undefined, 7.33, "$7.33"]) expect(dollarsToCents(bad), String(bad)).toBeNull();
  });

  it("only USPS Ground Advantage (cubic included) and Priority in USD, cheapest first", () => {
    const q = allowedQuotes(RATES);
    expect(q.map((x) => `${x.providerService}:${x.rateCents}`)).toEqual([
      "GroundAdvantageCubic:650", "GroundAdvantage:770", "PriorityMailCubic:862", "Priority:1011"]);
    expect(q.every((x) => x.providerShipmentId === "shp_d121498c06864586b0c9d961e971f509")).toBe(true);
    expect(allowedQuotes(null)).toEqual([]);
  });

  it("the buyer is offered the cheapest of each service, Ground Advantage first (the default)", () => {
    const o = offeredQuotes(RATES);
    expect(o.map((x) => [x.service, x.rateCents, x.providerRateId])).toEqual([
      ["usps_ground_advantage", 650, "rate_groundadvantagecubic650"],
      ["usps_priority", 862, "rate_prioritymailcubic862"],
    ]);
    expect(offeredQuotes([rate("Priority", "9.44")]).map((x) => x.service)).toEqual(["usps_priority"]);
  });

  it("a test order uses only the test key, and a response in the other mode is refused", () => {
    expect(easypostKeyName("test")).toBe("EASYPOST_TEST_API_KEY");
    expect(easypostKeyName("live")).toBe("EASYPOST_API_KEY");
    expect(responseModeMatches({ mode: "test" }, "test")).toBe(true);
    expect(responseModeMatches({ mode: "production" }, "test")).toBe(false);
    expect(responseModeMatches({ mode: "test" }, "live")).toBe(false);
    expect(responseModeMatches({}, "test")).toBe(false);
    expect(responseModeMatches(null, "live")).toBe(false);
  });
});
