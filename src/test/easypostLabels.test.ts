/**
 * EasyPost labels (supabase/functions/_shared/easypostLabels.ts; shipping S3, Q2259): one label per order, the rate
 * checked before the buy, the real cost always recorded, mode-locked, voids mapped onto shipments.label_state.
 *
 * @mutate supabase/functions/_shared/easypostLabels.ts |   if (s.postage_label && typeof s.postage_label.label_url === "string") return { buy: false, reason: "already_bought" }; |
 * @mutate supabase/functions/_shared/easypostLabels.ts |   if (cents > expect.quotedCents) return { buy: false, reason: "dearer_than_paid" }; |
 * @mutate supabase/functions/_shared/easypostLabels.ts |   if (s.mode !== expect.mode) return { buy: false, reason: "mode_mismatch" }; |
 * @mutate supabase/functions/_shared/easypostLabels.ts |   if (s.mode !== expect.mode) return { ok: false, reason: "mode_mismatch" }; |
 * @mutate supabase/functions/_shared/easypostLabels.ts | overQuote: cents > expect.quotedCents | overQuote: false
 * @mutate supabase/functions/_shared/easypostLabels.ts |     case "rejected": return "void_rejected"; |     case "rejected": return "voided";
 */
import { describe, expect, it } from "vitest";
import { checkBeforeBuy, labelOnShipment, labelStateAfterVoid } from "../../supabase/functions/_shared/easypostLabels";

const SHP = "shp_abc";
/** A recorded-shape Shipment (docs.easypost.com/docs/shipments). */
const shipment = (over: Record<string, unknown> = {}) => ({
  id: SHP, mode: "test",
  rates: [
    { id: "rate_ga", carrier: "USPS", service: "GroundAdvantage", rate: "7.33", currency: "USD" },
    { id: "rate_pri", carrier: "USPS", service: "Priority", rate: "9.85", currency: "USD" },
  ],
  postage_label: null, tracking_code: null, selected_rate: null, tracker: null,
  ...over,
});
const bought = (rate = "7.33") => shipment({
  postage_label: { label_url: "https://easypost-files.s3.amazonaws.com/label.pdf" },
  tracking_code: "9400100000000000000000",
  selected_rate: { id: "rate_ga", rate, currency: "USD" },
  tracker: { id: "trk_1" },
});
const want = { shipmentId: SHP, rateId: "rate_ga", mode: "test" as const, quotedCents: 733 };

describe("checkBeforeBuy: only the stored rate, once, in the order's mode, never dearer than paid", () => {
  it("buys the stored rate by id", () => {
    expect(checkBeforeBuy(shipment(), want)).toEqual({ buy: true, body: { rate: { id: "rate_ga" } } });
  });
  it("a shipment that already has a label is never bought again (fix 7)", () => {
    expect(checkBeforeBuy(bought(), want)).toEqual({ buy: false, reason: "already_bought" });
  });
  it("a rate now dearer than the buyer paid is not bought (the hold is released, fix 2)", () => {
    expect(checkBeforeBuy(shipment(), { ...want, quotedCents: 732 })).toEqual({ buy: false, reason: "dearer_than_paid" });
  });
  it("the other mode, another shipment, or a vanished rate: no buy (fix 8)", () => {
    expect(checkBeforeBuy(shipment({ mode: "production" }), want)).toMatchObject({ buy: false, reason: "mode_mismatch" });
    expect(checkBeforeBuy(shipment({ mode: "live" }), want)).toMatchObject({ buy: false, reason: "mode_mismatch" });
    expect(checkBeforeBuy(shipment({ id: "shp_other" }), want)).toMatchObject({ buy: false, reason: "wrong_shipment" });
    expect(checkBeforeBuy(shipment({ rates: [] }), want)).toMatchObject({ buy: false, reason: "rate_gone" });
  });
});

describe("labelOnShipment: the label to keep, with its real cost", () => {
  const read = { shipmentId: SHP, mode: "test" as const, quotedCents: 733 };
  it("reads the label, tracking code, tracker and the cost in exact cents", () => {
    expect(labelOnShipment(bought(), read)).toEqual({
      ok: true,
      label: { shipmentId: SHP, trackingCode: "9400100000000000000000", labelUrl: "https://easypost-files.s3.amazonaws.com/label.pdf", costCents: 733, trackerId: "trk_1", overQuote: false },
    });
  });
  it("a cost above the quote is still recorded, and flagged for ops", () => {
    expect(labelOnShipment(bought("7.86"), read)).toMatchObject({ ok: true, label: { costCents: 786, overQuote: true } });
  });
  it("no label yet: only then may the worker buy", () => {
    expect(labelOnShipment(shipment(), read)).toEqual({ ok: false, reason: "no_label" });
  });
  it("the other mode or another shipment is refused", () => {
    expect(labelOnShipment({ ...bought(), mode: "live" }, read)).toEqual({ ok: false, reason: "mode_mismatch" });
    expect(labelOnShipment({ ...bought(), id: "shp_x" }, read)).toEqual({ ok: false, reason: "wrong_shipment" });
  });
});

describe("labelStateAfterVoid", () => {
  const v = { shipmentId: SHP, mode: "test" as const };
  it("maps EasyPost's three refund states onto shipments.label_state", () => {
    expect(labelStateAfterVoid({ ...bought(), refund_status: "submitted" }, v)).toBe("void_requested");
    expect(labelStateAfterVoid({ ...bought(), refund_status: "refunded" }, v)).toBe("voided");
    expect(labelStateAfterVoid({ ...bought(), refund_status: "rejected" }, v)).toBe("void_rejected");
  });
  it("anything else, or the other mode, is not a state change", () => {
    expect(labelStateAfterVoid({ ...bought(), refund_status: "not_applicable" }, v)).toBeNull();
    expect(labelStateAfterVoid({ ...bought(), refund_status: "refunded", mode: "live" }, v)).toBeNull();
  });
});
