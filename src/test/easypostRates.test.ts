/**
 * EasyPost rates (docs/specs/shipping-draft.md S2 rates and owner decisions 11 and 13; Q2259): the buyer is offered
 * AT MOST 3 options, cheapest first with the cheapest pre-selected, from USPS Ground Advantage (cubic included),
 * USPS Priority and UPS Ground only; air, express and overnight never; dollar strings become cents exactly; a
 * malformed or foreign rate is dropped; a response in the wrong mode is refused (money review fix 8); and no member
 * email or phone is ever put in a request to EasyPost (lead design rule 2026-10-30, spec 4.2).
 *
 * Fixture: the shape of the Rate object in EasyPost's docs (docs.easypost.com/docs/shipments/rates, read
 * 2026-10-30: "rate": "11.01" string, "mode": "test", id "rate_...", shipment_id "shp_..."), with amounts from the
 * spec's measured Louisiana prices (section 3 and 4.2) and the owner's dashboard quote (decision 13). NOT a recorded
 * live call: the exact UPS and cubic service strings are confirmed by the first quote through ship-rates.
 *
 * @mutate supabase/functions/_shared/easypostRates.ts |     if (typeof r?.carrier !== "string" \|\| typeof r.service !== "string" \|\| r.currency !== "USD") continue; |     if (typeof r?.carrier !== "string" \|\| typeof r.service !== "string") continue;
 * @mutate supabase/functions/_shared/easypostRates.ts |   const cents = Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0")); |   const cents = Math.trunc(Number(v) * 100);
 * @mutate supabase/functions/_shared/easypostRates.ts |   return obj?.mode === mode; |   return true;
 * @mutate supabase/functions/_shared/easypostRates.ts |   "USPS:GroundAdvantageCubic": "usps_ground_advantage",\n |
 * @mutate supabase/functions/_shared/easypostRates.ts | export const NEVER_OFFERED = /air\|express\|overnight\|next ?day\|2nd ?day\|3 ?day\|saver\|early\|priority ?overnight/i; | export const NEVER_OFFERED = /$^/;
 * @mutate supabase/functions/_shared/easypostRates.ts |   return out.sort(cheapestFirst); |   return out;
 * @mutate supabase/functions/_shared/easypostRates.ts |   for (const k of ADDRESS_FIELDS) if (typeof a[k] === "string" && a[k]) out[k] = a[k]; |   Object.assign(out, a);
 * @mutate supabase/functions/_shared/easypostRates.ts |   const weightOz = ranks.reduce((s, r) => s + PARCEL_PRESETS[PRESET_ORDER[r]].weightOz, 0) + BUNDLE_BOX_OZ; |   const weightOz = ranks.reduce((s, r) => s + PARCEL_PRESETS[PRESET_ORDER[r]].weightOz, 0);
 * @mutate supabase/functions/_shared/easypostRates.ts |   if (weightOz > CUSTOM_BOX.weightOz) return null; |
 * @mutate supabase/functions/_shared/easypostRates.ts |   return zips.length ? zips[zips.length - 1] : null; |   return zips.length ? zips[0] : null;
 * @mutate supabase/functions/_shared/easypostRates.ts | const LA_ZIP = /^(70[013-8]\|71[0-4])[0-9]{2}$/; | const LA_ZIP = /^(70[0-8]\|71[0-4])[0-9]{2}$/;
 * @mutate supabase/functions/_shared/easypostRates.ts |   if (state !== "LA" \|\| !/^[0-9]{5} |   if (!/^[0-9]{5}
 */
import { describe, expect, it } from "vitest";
import {
  allowedQuotes,
  buildRateRequest,
  dollarsToCents,
  easypostKeyName,
  memberContactInRequest,
  NEVER_OFFERED,
  offeredQuotes,
  responseModeMatches,
  bundleParcel,
  CUSTOM_BOX,
  louisianaZipIn,
  PARCEL_PRESETS,
  shipToFromBody,
} from "../../supabase/functions/_shared/easypostRates";
import { isLouisianaZip } from "@/lib/shipping/policy";

const rate = (carrier: string, service: string, amount: string, over: Record<string, unknown> = {}) => ({
  id: `rate_${carrier.toLowerCase()}${service.toLowerCase()}${amount.replace(".", "")}`, object: "Rate", mode: "test", carrier, service,
  rate: amount, currency: "USD", delivery_days: service.startsWith("Priority") ? 2 : 4, shipment_id: "shp_d121498c06864586b0c9d961e971f509",
  ...over,
});
const RATES = [
  rate("USPS", "Priority", "10.11"),
  rate("USPS", "GroundAdvantage", "7.70"),
  rate("USPS", "GroundAdvantageCubic", "6.50"),
  rate("USPS", "PriorityMailCubic", "8.62"),
  rate("USPS", "Express", "29.90"),
  rate("USPS", "MediaMail", "4.63"),
  rate("UPS", "Ground", "7.60"),
  rate("UPS", "NextDayAir", "107.00"),
  rate("UPS", "2ndDayAir", "41.00"),
  rate("FedEx", "FEDEX_GROUND", "5.00"),
  rate("FedEx", "STANDARD_OVERNIGHT", "88.00"),
  rate("UPS", "GroundAdvantage", "1.10"),
  rate("USPS", "GroundAdvantage", "1.00", { currency: "CAD" }),
  rate("USPS", "GroundAdvantage", "abc"),
  rate("USPS", "GroundAdvantage", "0.00"),
  rate("USPS", "Priority", "3.00", { id: "bogus" }),
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

  it("only USPS Ground Advantage (cubic included), USPS Priority and UPS Ground in USD, cheapest first", () => {
    const q = allowedQuotes(RATES);
    expect(q.map((x) => `${x.providerCarrier}:${x.providerService}:${x.rateCents}`)).toEqual([
      "USPS:GroundAdvantageCubic:650", "UPS:Ground:760", "USPS:GroundAdvantage:770", "USPS:PriorityMailCubic:862", "USPS:Priority:1011"]);
    expect(q.every((x) => x.providerShipmentId === "shp_d121498c06864586b0c9d961e971f509")).toBe(true);
    expect(allowedQuotes(null)).toEqual([]);
  });

  it("never air, express or overnight, even if one were ever added to the allowed map", () => {
    const names = allowedQuotes(RATES).map((x) => x.providerService).join(" ");
    expect(names).not.toMatch(/air|express|overnight/i);
    // The deny pattern stands on its own: a service string that looks allowed but names air is still dropped.
    expect(allowedQuotes([rate("USPS", "GroundAdvantageAir", "5.00"), rate("UPS", "GroundExpress", "5.00")])).toEqual([]);
    for (const s of ["NextDayAir", "2ndDayAir", "3DaySelect", "Express", "PriorityExpress", "STANDARD_OVERNIGHT", "FEDEX_EXPRESS_SAVER", "NextDayAirEarlyAM"]) {
      expect(NEVER_OFFERED.test(s), s).toBe(true);
    }
    for (const s of ["GroundAdvantage", "GroundAdvantageCubic", "Priority", "PriorityMailCubic", "Ground"]) expect(NEVER_OFFERED.test(s), s).toBe(false);
  });

  it("the buyer gets at most 3 options, the cheapest of each service, cheapest first and pre-selected", () => {
    const o = offeredQuotes(RATES);
    expect(o.map((x) => [x.service, x.rateCents, x.providerRateId, x.preselected])).toEqual([
      ["usps_ground_advantage", 650, "rate_uspsgroundadvantagecubic650", true],
      ["ups_ground", 760, "rate_upsground760", false],
      ["usps_priority", 862, "rate_uspsprioritymailcubic862", false],
    ]);
    expect(o.length).toBeLessThanOrEqual(3);
    // UPS cheaper than USPS: UPS is first and pre-selected (cheapest, never a carrier preference).
    const ups = offeredQuotes([rate("USPS", "GroundAdvantage", "7.70"), rate("UPS", "Ground", "6.10"), rate("USPS", "Priority", "9.44")]);
    expect(ups.map((x) => [x.service, x.preselected])).toEqual([["ups_ground", true], ["usps_ground_advantage", false], ["usps_priority", false]]);
    expect(offeredQuotes([rate("USPS", "Priority", "9.44")]).map((x) => [x.service, x.preselected])).toEqual([["usps_priority", true]]);
    expect(offeredQuotes([])).toEqual([]);
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

  it("no member email or phone ever goes to EasyPost: the request carries only address and parcel fields", () => {
    const body = buildRateRequest(
      { zip: "70112", city: "New Orleans", state: "LA", email: "buyer@example.com", phone: "5045550100", name: "Buyer Person" } as never,
      { zip: "70808", street1: "1 Main St", email: "seller@example.com", phone: "2255550100" } as never,
      { weightOz: 12, lengthIn: 9, widthIn: 6, heightIn: 3 },
    );
    expect(memberContactInRequest(body)).toEqual([]);
    const text = JSON.stringify(body);
    for (const leaked of ["email", "phone", "@example.com", "555", "Buyer Person"]) expect(text, leaked).not.toContain(leaked);
    expect(body).toEqual({
      shipment: {
        to_address: { zip: "70112", city: "New Orleans", state: "LA", country: "US" },
        from_address: { zip: "70808", street1: "1 Main St", country: "US" },
        // Box dimensions always sent so USPS Cubic is quoted whenever the parcel qualifies (decision 11).
        parcel: { length: 9, width: 6, height: 3, weight: 12 },
      },
    });
  });

  it("the contact check itself catches an email or phone anywhere in a request", () => {
    expect(memberContactInRequest({ shipment: { to_address: { email: "a@b.co" } } })).toEqual(["shipment.to_address.email"]);
    expect(memberContactInRequest({ shipment: { from_address: { phone: "1" }, x: [{ Email: "" }] } })).toEqual([
      "shipment.from_address.phone", "shipment.x.0.Email"]);
    expect(memberContactInRequest({ shipment: { to_address: { zip: "70112" } } })).toEqual([]);
  });
});

describe("ship-rates inputs: parcel, seller ZIP and the buyer's address", () => {
  it("one item ships in its own preset; a bundle is one parcel (decision 10): summed weights plus the box", () => {
    expect(bundleParcel(["small_box"])).toEqual(PARCEL_PRESETS.small_box);
    expect(bundleParcel(["envelope"])).toEqual(PARCEL_PRESETS.envelope);
    // 8 + 16 + 8 oz of box = 32 oz: the medium box (the small box is for up to 16 oz).
    expect(bundleParcel(["envelope", "small_box"])).toEqual({ ...PARCEL_PRESETS.medium_box, weightOz: 32 });
    // 8 + 8 + 8 = 24 oz: the smallest box that holds it.
    expect(bundleParcel(["envelope", "envelope"])).toEqual({ ...PARCEL_PRESETS.medium_box, weightOz: 24 });
    // 48 + 8 + 8 = 64 oz: past the medium box's 3 lb, so the large box (never smaller than the biggest item's box).
    expect(bundleParcel(["medium_box", "envelope"])).toEqual({ ...PARCEL_PRESETS.large_box, weightOz: 64 });
    // 160 + 8 + 8 = 176 oz: over the large box's 10 lb, so the 20 lb custom box.
    expect(bundleParcel(["large_box", "envelope"])).toEqual({ ...CUSTOM_BOX, weightOz: 176 });
    expect(bundleParcel(["large_box", "large_box"])).toBeNull(); // 328 oz: over 20 lb, refused (never mis-priced)
    expect(bundleParcel([])).toBeNull();
    expect(bundleParcel(["crate"])).toBeNull();
    expect(bundleParcel(["small_box", null as never])).toBeNull();
    for (const p of [...Object.values(PARCEL_PRESETS), CUSTOM_BOX]) {
      expect(Math.max(p.lengthIn, p.widthIn, p.heightIn)).toBeLessThanOrEqual(22);
      expect(p.weightOz).toBeLessThanOrEqual(320);
    }
  });

  it("the seller's ZIP is read from their pickup line, Louisiana only, and agrees with policy.ts on every ZIP", () => {
    expect(louisianaZipIn("123 Oak St, Baton Rouge, LA 70808")).toBe("70808");
    expect(louisianaZipIn("4521 Magazine St New Orleans 70115-1234")).toBe("70115");
    expect(louisianaZipIn("12345 Airline Hwy, Metairie LA 70001")).toBe("70001");
    expect(louisianaZipIn("70512 Oak St, Baton Rouge LA 70808")).toBe("70808"); // a house number that looks like a ZIP
    expect(louisianaZipIn("1 Main St, Dallas TX 75001")).toBeNull();
    expect(louisianaZipIn("no zip here")).toBeNull();
    expect(louisianaZipIn(null)).toBeNull();
    let disagree = 0;
    for (let z = 0; z < 100000; z++) {
      const zip = String(z).padStart(5, "0");
      if ((louisianaZipIn(`x ${zip}`) === zip) !== isLouisianaZip(zip)) disagree++;
    }
    expect(disagree).toBe(0);
  });

  it("the buyer's address: a Louisiana street address only, trimmed and length-capped, nothing else kept", () => {
    expect(shipToFromBody({ street1: " 1 Main St ", city: "New Orleans", state: "la", zip: "70112", email: "x@y.z", phone: "5" })).toEqual(
      { ok: true, address: { street1: "1 Main St", city: "New Orleans", state: "LA", zip: "70112" } });
    expect(shipToFromBody({ street1: "1 Main St", street2: "Apt 2", city: "Metairie", state: "LA", zip: "70001-1234" })).toEqual(
      { ok: true, address: { street1: "1 Main St", street2: "Apt 2", city: "Metairie", state: "LA", zip: "70001-1234" } });
    expect(shipToFromBody({ street1: "1 Main St", city: "Dallas", state: "TX", zip: "75001" })).toEqual({ ok: false, error: "louisiana_only" });
    expect(shipToFromBody({ street1: "1 Main St", city: "Dallas", state: "LA", zip: "75001" })).toEqual({ ok: false, error: "louisiana_only" });
    expect(shipToFromBody({ street1: "1 Main St", city: "Houston", state: "TX", zip: "70112" })).toEqual({ ok: false, error: "louisiana_only" });
    expect(shipToFromBody({ street1: "", city: "New Orleans", state: "LA", zip: "70112" })).toEqual({ ok: false, error: "address_incomplete" });
    expect(shipToFromBody({ street1: "x".repeat(101), city: "New Orleans", state: "LA", zip: "70112" })).toEqual({ ok: false, error: "address_incomplete" });
    expect(shipToFromBody(null)).toEqual({ ok: false, error: "address_incomplete" });
  });
});
