/**
 * ship-rates (supabase/functions/ship-rates/index.ts; docs/specs/shipping-draft.md S2 rates; Q2259) keeps its
 * promises in its own source, comments ignored:
 *   - the declutter_shipping switch is checked (and its refusal returned) before EasyPost is ever called;
 *   - test mode only (lead 2026-10-30): a non-test pair is refused, only the TEST key name is read, never the live
 *     key, and EasyPost's answer must itself say mode "test";
 *   - exactly one EasyPost call, whose body is the request built by buildRateRequest, checked by
 *     memberContactInRequest (refused when not empty) before it is sent; no email or phone key anywhere in the code;
 *   - the options come from offeredQuotes (the 3-option, never-air filter) and only quote ids go back.
 *
 * @mutate supabase/functions/ship-rates/index.ts |   if (off) return off; |   void off;
 * @mutate supabase/functions/ship-rates/index.ts |     if (mode !== "test") return json({ error: "shipping_test_only" }, 409); |
 * @mutate supabase/functions/ship-rates/index.ts |     const key = Deno.env.get(easypostKeyName("test")); |     const key = Deno.env.get(easypostKeyName(mode));
 * @mutate supabase/functions/ship-rates/index.ts |     if (contact.length > 0) { |     if (contact.length < 0) {
 * @mutate supabase/functions/ship-rates/index.ts |     if (!responseModeMatches(shipment, "test")) { |     if (false) {
 * @mutate supabase/functions/ship-rates/index.ts |     const offers = offeredQuotes(shipment.rates as never); |     const offers = allowedQuotes(shipment.rates as never).map((q, i) => ({ ...q, preselected: i === 0 }));
 * @mutate supabase/functions/ship-rates/index.ts |       body: JSON.stringify(request), |       body: JSON.stringify({ ...request, email: user.email }),
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { blankComments } from "./helpers/blankNonCode";

const FILE = "supabase/functions/ship-rates/index.ts";
const code = blankComments(readFileSync(FILE, "utf8"));
const at = (needle: string | RegExp) => (typeof needle === "string" ? code.indexOf(needle) : code.search(needle));

describe("ship-rates keeps its promises in its own source", () => {
  it("reads a real function (floor)", () => {
    expect(code.length).toBeGreaterThan(2000);
    expect([...code.matchAll(/\breturn json\(/g)].length).toBeGreaterThan(8);
  });

  it("the declutter_shipping switch is checked and its refusal returned before EasyPost is called", () => {
    const sw = at(/const off = await requireFeature\(admin, "declutter_shipping", user, corsHeaders\);\s*if \(off\) return off;/);
    expect(sw).toBeGreaterThan(0);
    expect(sw).toBeLessThan(at("fetch(EASYPOST_SHIPMENTS"));
  });

  it("test mode only: a non-test pair is refused, only the test key is read, and the answer must say test", () => {
    expect(at(/if \(mode !== "test"\) return json\(\{ error: "shipping_test_only" \}, 409\);/)).toBeGreaterThan(0);
    const keyReads = [...code.matchAll(/easypostKeyName\(([^)]*)\)/g)].map((m) => m[1]);
    expect(keyReads).toEqual(['"test"']);
    expect(code).not.toMatch(/EASYPOST_API_KEY|EASYPOST_TEST_API_KEY/); // the name comes only from easypostKeyName
    const modeCheck = at('if (!responseModeMatches(shipment, "test")) {');
    expect(code.slice(modeCheck, modeCheck + 300)).toMatch(/\n\s*return json\(\{ error: TRY_AGAIN \}, 502\);/);
    expect(modeCheck).toBeGreaterThan(at("fetch(EASYPOST_SHIPMENTS"));
    expect(modeCheck).toBeLessThan(at("offeredQuotes(shipment.rates"));
  });

  it("one EasyPost call, its body built by buildRateRequest and refused if it carries any email or phone", () => {
    expect([...code.matchAll(/\bfetch\(/g)].length).toBe(1);
    const built = at(/const request = buildRateRequest\(/);
    const checked = at(/const contact = memberContactInRequest\(request\);\s*if \(contact\.length > 0\) \{/);
    expect(code.slice(checked, checked + 500)).toMatch(/\n\s*return json\(\{ error: TRY_AGAIN \}, 500\);/);
    const sent = at("fetch(EASYPOST_SHIPMENTS, {");
    const callArgs = code.slice(sent, code.indexOf("});", sent));
    expect(callArgs).toMatch(/\n\s*body: JSON\.stringify\(request\),\n/);
    expect(built).toBeGreaterThan(0);
    expect(checked).toBeGreaterThan(built);
    expect(sent).toBeGreaterThan(checked);
    // No email or phone key, and no member email value, anywhere in the code.
    expect(code).not.toMatch(/\b(email|phone)\s*:/i);
    expect(code).not.toMatch(/user\.(email|phone)/);
  });

  it("options come from offeredQuotes and only quote ids, services and cents go back", () => {
    expect(at("const offers = offeredQuotes(shipment.rates as never);")).toBeGreaterThan(0);
    expect(code).not.toMatch(/\ballowedQuotes\b/);
    const reply = code.slice(at("quotes: quotes.map("));
    expect(reply).toMatch(/quote_id: q\.id, service: q\.service, rate_cents: q\.rate_cents, delivery_days: q\.delivery_days, preselected: q\.preselected,/);
    expect(reply.slice(0, 400)).not.toMatch(/provider_|ship_to|parcel/);
  });
});
