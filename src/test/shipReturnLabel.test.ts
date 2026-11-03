/**
 * Shipping S6 return label worker (supabase/functions/_shared/shipReturnLabel.ts; spec 5.3; Q2259): the return is
 * created by EasyPost ids with the outbound's addresses swapped, saved before any buy, read back first (a label already
 * on it is recorded, never bought twice), bought only at USPS Ground Advantage at or below the cap, test mode only;
 * errors are retried and give up after MAX_ATTEMPTS. Answers are hand-made in EasyPost's documented shapes.
 *
 * @mutate supabase/functions/_shared/shipReturnLabel.ts |   return { shipment: { to_address: { id: sellerAdr }, from_address: { id: buyerAdr }, parcel: { id: parcel } } }; |   return { shipment: { to_address: { id: buyerAdr }, from_address: { id: sellerAdr }, parcel: { id: parcel } } };
 * @mutate supabase/functions/_shared/shipReturnLabel.ts |   if (on.ok) return (await p.recordBought(r.id, on.label)) === "already" ? "return_already" : "return_bought"; |   if (false) return "return_bought";
 * @mutate supabase/functions/_shared/shipReturnLabel.ts |   return q && q.rateCents <= capCents ? | return q ?
 * @mutate supabase/functions/_shared/shipReturnLabel.ts |     if (!(await p.saveReturnShipment(r.id, madeId))) return "return_skipped"; |     await p.saveReturnShipment(r.id, madeId);
 * @mutate supabase/functions/_shared/shipReturnLabel.ts |   if (r.label_mode !== "test") { |   if (false) {
 * @mutate supabase/functions/_shared/shipLabelRun.ts |   await runReturns(admin, record, counts); |
 * @mutate supabase/functions/_shared/shipLabelRun.ts |             .eq("id", id).eq("state", "requested").is("provider_shipment_id", null).select("id"); |             .eq("id", id).select("id");
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { blankComments } from "./helpers/blankNonCode";
import { MAX_ATTEMPTS, returnRate, returnShipmentBody, runShipReturn, type ReturnPorts, type ReturnRow } from "../../supabase/functions/_shared/shipReturnLabel";

const OUT = "shp_out";
const RET = "shp_ret";
const outbound = (over: Record<string, unknown> = {}) => ({
  id: OUT, mode: "test", to_address: { id: "adr_buyer" }, from_address: { id: "adr_seller" }, parcel: { id: "prcl_box" }, ...over,
});
const rate = (id: string, service: string, dollars: string, carrier = "USPS") =>
  ({ id, carrier, service, rate: dollars, currency: "USD", shipment_id: RET });
const created = (rates = [rate("rate_ga", "GroundAdvantage", "6.50"), rate("rate_pr", "Priority", "9.10")], over: Record<string, unknown> = {}) =>
  ({ id: RET, mode: "test", rates, ...over });
const withLabel = (cost = "6.50") => ({
  ...created(), postage_label: { label_url: "https://easypost-files.s3.amazonaws.com/files/postage_label/r.png" },
  tracking_code: "9400RET", selected_rate: { rate: cost, currency: "USD" }, tracker: { id: "trk_r" },
});
const row = (over: Partial<ReturnRow> = {}): ReturnRow => ({
  id: "r1", order_id: "o1", label_mode: "test", provider_shipment_id: null, attempts: 0, outbound_shipment_id: OUT, cap_cents: 700, ...over,
});

function ports(answers: { get?: Record<string, unknown>; create?: unknown; buy?: unknown; createOk?: boolean; buyOk?: boolean; saved?: boolean } = {}) {
  const calls: string[] = [];
  const p: ReturnPorts = {
    getShipment: async (id) => { calls.push(`get:${id}`); const b = answers.get?.[id]; return { ok: b !== undefined, status: b === undefined ? 0 : 200, body: b ?? null }; },
    createShipment: async (body) => { calls.push(`create:${JSON.stringify(body)}`); return { ok: answers.createOk ?? true, status: 200, body: answers.create ?? created() }; },
    buyShipment: async (id, body) => { calls.push(`buy:${id}:${body.rate.id}`); return { ok: answers.buyOk ?? true, status: 200, body: answers.buy ?? withLabel() }; },
    saveReturnShipment: async (_r, id) => { calls.push(`save:${id}`); return answers.saved ?? true; },
    recordBought: async (_r, l) => { calls.push(`bought:${l.costCents}:${l.trackingCode}`); return "bought"; },
    recordFailed: async (_r, why) => { calls.push(`failed:${why}`); },
    recordRetry: async (_r, n, why) => { calls.push(`retry:${n}:${why}`); },
  };
  return { p, calls };
}

describe("returnShipmentBody", () => {
  it("swaps the outbound's addresses and keeps its parcel, by EasyPost id only", () => {
    expect(returnShipmentBody(outbound(), OUT)).toEqual({
      shipment: { to_address: { id: "adr_seller" }, from_address: { id: "adr_buyer" }, parcel: { id: "prcl_box" } },
    });
  });
  it("refuses a live, foreign or incomplete outbound shipment", () => {
    expect(returnShipmentBody(outbound({ mode: "production" }), OUT)).toBeNull();
    expect(returnShipmentBody(outbound(), "shp_other")).toBeNull();
    expect(returnShipmentBody(outbound({ parcel: null }), OUT)).toBeNull();
  });
});

describe("returnRate", () => {
  it("is the cheapest Ground Advantage rate on this shipment at or below the cap", () => {
    expect(returnRate(created([rate("rate_a", "GroundAdvantage", "6.90"), rate("rate_b", "GroundAdvantageCubic", "5.20")]), RET, 700))
      .toEqual({ id: "rate_b", cents: 520 });
    expect(returnRate(created([rate("rate_a", "GroundAdvantage", "7.01")]), RET, 700)).toBeNull();
    expect(returnRate(created([rate("rate_p", "Priority", "3.00")]), RET, 700)).toBeNull();
    expect(returnRate(created(undefined, { mode: "production" }), RET, 700)).toBeNull();
  });
});

describe("runShipReturn", () => {
  it("first run: reads the outbound, creates the return, saves it, then buys Ground Advantage and records it", async () => {
    const { p, calls } = ports({ get: { [OUT]: outbound() } });
    expect(await runShipReturn(row(), p)).toBe("return_bought");
    expect(calls[0]).toBe(`get:${OUT}`);
    expect(calls[1]).toContain('"to_address":{"id":"adr_seller"}');
    expect(calls.slice(2)).toEqual([`save:${RET}`, `buy:${RET}:rate_ga`, "bought:650:9400RET"]);
  });
  it("another run saved a return first: nothing is bought", async () => {
    const { p, calls } = ports({ get: { [OUT]: outbound() }, saved: false });
    expect(await runShipReturn(row(), p)).toBe("return_skipped");
    expect(calls.some((c) => c.startsWith("buy"))).toBe(false);
  });
  it("a saved return that already carries a label (a crash after the buy) is recorded, never bought again", async () => {
    const { p, calls } = ports({ get: { [RET]: withLabel() } });
    expect(await runShipReturn(row({ provider_shipment_id: RET }), p)).toBe("return_bought");
    expect(calls).toEqual([`get:${RET}`, "bought:650:9400RET"]);
  });
  it("no rate under the cap: failed (ops paged by the RPC), nothing bought", async () => {
    const { p, calls } = ports({ get: { [RET]: created([rate("rate_ga", "GroundAdvantage", "8.00")]) } });
    expect(await runShipReturn(row({ provider_shipment_id: RET }), p)).toBe("return_failed");
    expect(calls.some((c) => c.startsWith("buy"))).toBe(false);
    expect(calls.slice(-1)[0]).toMatch(/^failed:no USPS Ground Advantage rate/);
  });
  it("a provider error is retried, and after MAX_ATTEMPTS the row is failed", async () => {
    const a = ports({ get: { [OUT]: outbound() }, createOk: false });
    expect(await runShipReturn(row(), a.p)).toBe("return_retry");
    expect(a.calls.slice(-1)[0]).toBe("retry:1:create 200");
    const b = ports({ get: {} });
    expect(await runShipReturn(row({ attempts: MAX_ATTEMPTS - 1 }), b.p)).toBe("return_failed");
    expect(b.calls.slice(-1)[0]).toMatch(/^failed:gave up after 8 tries/);
  });
  it("a buy that answers no label is retried (the next run reads it back first)", async () => {
    const { p, calls } = ports({ get: { [RET]: created() }, buy: created() });
    expect(await runShipReturn(row({ provider_shipment_id: RET }), p)).toBe("return_retry");
    expect(calls.slice(-1)[0]).toBe("retry:1:buy answered no_label");
  });
  it("a live row or a live / foreign return shipment is failed, never bought", async () => {
    const a = ports();
    expect(await runShipReturn(row({ label_mode: "live" }), a.p)).toBe("return_failed");
    expect(a.calls).toEqual(["failed:live return labels are not supported"]);
    const b = ports({ get: { [RET]: { ...withLabel(), mode: "production" } } });
    expect(await runShipReturn(row({ provider_shipment_id: RET }), b.p)).toBe("return_failed");
    expect(b.calls.some((c) => c.startsWith("buy") || c.startsWith("bought"))).toBe(false);
  });
});

describe("the declutter-money run drives the return labels", () => {
  const run = blankComments(readFileSync("supabase/functions/_shared/shipLabelRun.ts", "utf8"));
  it("calls the return pass, saves the return shipment compare-and-set, records through the two RPCs", () => {
    const must = [
      "await runReturns(admin, record, counts);",
      '.eq("id", id).eq("state", "requested").is("provider_shipment_id", null).select("id");',
      'admin.rpc("declutter_ship_return_label_bought"',
      'admin.rpc("declutter_ship_return_label_failed"',
      'Deno.env.get(easypostKeyName("test"))',
    ];
    for (const m of must) expect(run, m).toContain(m);
    expect(must.length).toBeGreaterThan(4);
  });
});
