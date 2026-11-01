/**
 * EasyPost tracking (supabase/functions/_shared/easypostTracking.ts; shipping S4, Q2259) and the easypost-webhook
 * function's own promises in its source, comments ignored.
 *
 * @mutate supabase/functions/_shared/easypostTracking.ts |   return constantTimeEqual(SIGNATURE_PREFIX + hex, header); |   return header.length > 0;
 * @mutate supabase/functions/_shared/easypostTracking.ts |   if (row.label_mode !== ev.mode) return { act: "ignore", reason: "mode_mismatch" }; |
 * @mutate supabase/functions/_shared/easypostTracking.ts |   if (was === "delivered") return { act: "ignore", reason: "not_newer" }; |
 * @mutate supabase/functions/_shared/easypostTracking.ts |   if (status === "delivered" && ev.scanZip && buyerZip && ev.scanZip !== buyerZip) status = "failure"; |
 * @mutate supabase/functions/_shared/easypostTracking.ts | (!PROBLEM.has(was) && RANK[status] > RANK[was]) | (!PROBLEM.has(was) && RANK[status] !== RANK[was])
 * @mutate supabase/functions/easypost-webhook/index.ts |   if (!(await easypostSignatureValid(raw, req.headers.get("X-Hmac-Signature"), secret))) { |   if (false) {
 * @mutate supabase/functions/easypost-webhook/index.ts |     update = was === null ? update.is("tracking_status", null) : update.eq("tracking_status", was); |
 */
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { blankComments } from "./helpers/blankNonCode";
import {
  easypostSignatureValid,
  nextTracking,
  trackerFromEvent,
  type ShipmentTrackingRow,
  type TrackerEvent,
} from "../../supabase/functions/_shared/easypostTracking";

const SECRET = "whsec_test_é"; // a non-ASCII secret: EasyPost normalises it (NFKD) before signing
const sign = (body: string, secret = SECRET) =>
  "hmac-sha256-hex=" + createHmac("sha256", Buffer.from(secret.normalize("NFKD"), "utf8")).update(body).digest("hex");

/** A recorded-shape tracker.updated event (EasyPost docs' Event and Tracker objects). */
function event(over: Record<string, unknown> = {}, tracker: Record<string, unknown> = {}) {
  return {
    object: "Event", description: "tracker.updated", mode: "test",
    result: {
      object: "Tracker", id: "trk_abc", mode: "test", tracking_code: "9400100000000000000000", status: "in_transit",
      shipment_id: "shp_123",
      tracking_details: [
        { status: "pre_transit", datetime: "2026-11-01T10:00:00Z", tracking_location: { zip: null } },
        { status: "in_transit", datetime: "2026-11-01T15:00:00Z", tracking_location: { zip: "70501" } },
      ],
      ...tracker,
    },
    ...over,
  };
}
const row = (over: Partial<ShipmentTrackingRow> = {}): ShipmentTrackingRow => ({
  label_mode: "test", label_state: "bought", tracking_code: "9400100000000000000000", tracking_status: null,
  accepted_at: null, delivered_at: null, ship_to: { zip: "70528" }, ...over,
});
const ev = (over: Partial<TrackerEvent> = {}): TrackerEvent => ({
  mode: "test", trackerId: "trk_abc", trackingCode: "9400100000000000000000", shipmentId: "shp_123",
  status: "in_transit", scannedAt: "2026-11-01T15:00:00.000Z", scanZip: "70501", ...over,
});

describe("EasyPost's webhook signature", () => {
  const body = JSON.stringify(event());
  it("accepts EasyPost's own HMAC of the raw body", async () => {
    expect(await easypostSignatureValid(body, sign(body), SECRET)).toBe(true);
  });
  it("refuses a missing, unprefixed, wrong-secret or other-body signature, and an empty secret", async () => {
    expect(await easypostSignatureValid(body, null, SECRET)).toBe(false);
    expect(await easypostSignatureValid(body, sign(body).replace("hmac-sha256-hex=", ""), SECRET)).toBe(false);
    expect(await easypostSignatureValid(body, sign(body, "whsec_other"), SECRET)).toBe(false);
    expect(await easypostSignatureValid(body + " ", sign(body), SECRET)).toBe(false);
    expect(await easypostSignatureValid(body, sign(body, ""), "")).toBe(false);
  });
});

describe("trackerFromEvent", () => {
  it("reads the tracker, its newest scan's time and ZIP", () => {
    expect(trackerFromEvent(event())).toEqual(ev());
  });
  it("ignores other events, bad modes, a tracker in the other mode, and non-trackers", () => {
    expect(trackerFromEvent(event({ description: "batch.updated" }))).toBeNull();
    expect(trackerFromEvent(event({ mode: "production" }))).toBeNull();
    expect(trackerFromEvent(event({}, { mode: "live" }))).toBeNull();
    expect(trackerFromEvent(event({}, { object: "Shipment" }))).toBeNull();
    expect(trackerFromEvent(null)).toBeNull();
  });
  it("an unknown carrier status reads as unknown", () => {
    expect(trackerFromEvent(event({}, { status: "lost_in_space" }))?.status).toBe("unknown");
  });
});

describe("nextTracking: one event, one row", () => {
  it("the first carrier scan sets the status and accepted_at", () => {
    expect(nextTracking(row(), ev())).toEqual({ act: "update", patch: { tracking_status: "in_transit", accepted_at: "2026-11-01T15:00:00.000Z" } });
  });
  it("a test event never moves a live label (and the other way)", () => {
    expect(nextTracking(row({ label_mode: "live" }), ev())).toEqual({ act: "ignore", reason: "mode_mismatch" });
    expect(nextTracking(row(), ev({ mode: "live" }))).toEqual({ act: "ignore", reason: "mode_mismatch" });
  });
  it("no bought label, or another tracking code: nothing", () => {
    expect(nextTracking(row({ label_state: "claimed" }), ev())).toMatchObject({ act: "ignore", reason: "no_label" });
    expect(nextTracking(row({ tracking_code: "OTHER" }), ev())).toMatchObject({ act: "ignore", reason: "code_mismatch" });
  });
  it("delivered at the buyer's ZIP is final, with its own time", () => {
    const d = nextTracking(row({ tracking_status: "out_for_delivery", accepted_at: "x" }), ev({ status: "delivered", scanZip: "70528", scannedAt: "2026-11-03T18:00:00.000Z" }));
    expect(d).toEqual({ act: "update", patch: { tracking_status: "delivered", delivered_at: "2026-11-03T18:00:00.000Z" } });
    expect(nextTracking(row({ tracking_status: "delivered", delivered_at: "x", accepted_at: "x" }), ev({ status: "in_transit" }))).toMatchObject({ act: "ignore", reason: "not_newer" });
    expect(nextTracking(row({ tracking_status: "delivered", delivered_at: "x", accepted_at: "x" }), ev({ status: "return_to_sender" }))).toMatchObject({ act: "ignore" });
  });
  it("delivered somewhere else is a problem, never a delivery (review fix 10)", () => {
    expect(nextTracking(row({ tracking_status: "out_for_delivery", accepted_at: "x" }), ev({ status: "delivered", scanZip: "70119" })))
      .toEqual({ act: "update", patch: { tracking_status: "failure" } });
  });
  it("an older scan arriving late changes nothing; a problem scan is taken from any earlier state", () => {
    expect(nextTracking(row({ tracking_status: "out_for_delivery", accepted_at: "x" }), ev({ status: "in_transit" }))).toMatchObject({ act: "ignore", reason: "not_newer" });
    expect(nextTracking(row({ tracking_status: "in_transit", accepted_at: "x" }), ev({ status: "in_transit" }))).toMatchObject({ act: "ignore", reason: "not_newer" });
    expect(nextTracking(row({ tracking_status: "out_for_delivery", accepted_at: "x" }), ev({ status: "return_to_sender" })))
      .toEqual({ act: "update", patch: { tracking_status: "return_to_sender" } });
    expect(nextTracking(row({ tracking_status: "return_to_sender", accepted_at: "x" }), ev({ status: "in_transit" }))).toMatchObject({ act: "ignore" });
  });
  it("an unknown status changes nothing", () => {
    expect(nextTracking(row(), ev({ status: "unknown" }))).toMatchObject({ act: "ignore", reason: "unknown_status" });
  });
});

describe("easypost-webhook keeps its promises in its own source", () => {
  const code = blankComments(readFileSync("supabase/functions/easypost-webhook/index.ts", "utf8"));
  const at = (s: string | RegExp) => (typeof s === "string" ? code.indexOf(s) : code.search(s));
  it("reads a real function (floor)", () => {
    expect(code.length).toBeGreaterThan(1500);
    expect([...code.matchAll(/\breturn json\(/g)].length).toBeGreaterThan(8);
  });
  it("fails closed without the secret, and checks the signature on the raw body before parsing it", () => {
    expect(at(/if \(!secret\) \{[\s\S]{0,200}return json\(\{ error: "not_configured" \}, 503\);/)).toBeGreaterThan(0);
    const sig = at('if (!(await easypostSignatureValid(raw, req.headers.get("X-Hmac-Signature"), secret))) {');
    expect(sig).toBeGreaterThan(0);
    expect(sig).toBeLessThan(at("JSON.parse(raw)"));
  });
  it("finds the row only by EasyPost's shipment id and lets nextTracking decide", () => {
    expect(at('.eq("provider_shipment_id", ev.shipmentId)')).toBeGreaterThan(0);
    expect(at("const decision = nextTracking(row as ShipmentTrackingRow, ev);")).toBeGreaterThan(0);
  });
  it("writes with a compare-and-set on the status it read, and a zero-row write is retried (409)", () => {
    expect(at('update = was === null ? update.is("tracking_status", null) : update.eq("tracking_status", was);')).toBeGreaterThan(0);
    expect(at(/if \(!moved \|\| moved\.length !== 1\) return json\(\{ error: "moved_meanwhile" \}, 409\);/)).toBeGreaterThan(0);
  });
  it("never reads a member's email or phone, and never a Stripe or label call", () => {
    expect(code).not.toMatch(/\b(email|phone)\b/i);
    expect(code).not.toMatch(/stripe|api\.easypost\.com/i);
  });
});
