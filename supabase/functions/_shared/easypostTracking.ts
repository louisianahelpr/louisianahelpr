/**
 * EasyPost tracking for Declutter shipping (docs/specs/shipping-draft.md S4 tracking webhook, section 7 and money
 * review should-fix 10; Q2259, Q2424). Pure: no network and no Deno APIs (WebCrypto only, which Deno and node share),
 * so vitest runs it on recorded events. easypost-webhook calls it and writes the decision to public.shipments.
 *
 * Rules:
 *  - The signature is EasyPost's: header X-Hmac-Signature = "hmac-sha256-hex=" + hex(HMAC-SHA256(NFKD(secret),
 *    raw body)), compared in constant time (EasyPost's own client, easypost-python util.validate_webhook, read
 *    2026-11-01). A missing or wrong signature is refused before the body is parsed.
 *  - Only "tracker.created" / "tracker.updated" events carrying a Tracker are acted on; the event's mode must be the
 *    shipment's label_mode (a test event can never move a live order, nor the other way).
 *  - The status only moves in a way that cannot undo a later scan: "delivered" is final; a problem scan
 *    (return_to_sender, failure, available_for_pickup) is taken from any earlier state; otherwise the rank only rises
 *    (pre_transit < in_transit < out_for_delivery). An older event delivered late changes nothing (replay-safe).
 *  - "delivered" counts only at the buyer's ZIP (review fix 10): a delivered scan whose location names another ZIP is
 *    a problem ("failure"), never a delivery that starts the 48-hour window.
 *  - accepted_at is the first scan that shows the carrier has the parcel (in_transit or later); delivered_at the
 *    delivered scan's own time.
 */

export type TrackingStatus =
  | "pre_transit" | "in_transit" | "out_for_delivery" | "delivered"
  | "available_for_pickup" | "return_to_sender" | "failure" | "unknown";

const CARRIER_STATUSES: ReadonlySet<string> = new Set([
  "pre_transit", "in_transit", "out_for_delivery", "delivered", "available_for_pickup", "return_to_sender", "failure", "unknown",
]);
/** A scan that needs a person (seller, buyer or admin) to act: taken from any state but delivered. */
const PROBLEM: ReadonlySet<TrackingStatus> = new Set(["available_for_pickup", "return_to_sender", "failure"]);
const RANK: Record<TrackingStatus, number> = {
  unknown: 0, pre_transit: 1, in_transit: 2, out_for_delivery: 3,
  available_for_pickup: 4, return_to_sender: 4, failure: 4, delivered: 5,
};
const SIGNATURE_PREFIX = "hmac-sha256-hex=";

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** True only when the X-Hmac-Signature header is EasyPost's HMAC of this exact raw body under the secret. */
export async function easypostSignatureValid(rawBody: string, header: string | null | undefined, secret: string): Promise<boolean> {
  if (!secret || typeof header !== "string" || !header.startsWith(SIGNATURE_PREFIX)) return false;
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret.normalize("NFKD")), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(rawBody)));
  const hex = [...mac].map((b) => b.toString(16).padStart(2, "0")).join("");
  return constantTimeEqual(SIGNATURE_PREFIX + hex, header);
}

export interface TrackerEvent {
  mode: "test" | "live";
  trackerId: string;
  trackingCode: string;
  shipmentId: string | null;
  status: TrackingStatus;
  /** The newest scan's time (ISO), or null when the tracker has none. */
  scannedAt: string | null;
  /** The newest scan's ZIP (5 digits), or null when the carrier gave none. */
  scanZip: string | null;
}

interface RawDetail { status?: unknown; datetime?: unknown; tracking_location?: { zip?: unknown } | null }

/** The tracker a webhook event carries, or null for any event this function does not act on. */
export function trackerFromEvent(body: unknown): TrackerEvent | null {
  const ev = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  if (ev.object !== "Event" || (ev.description !== "tracker.updated" && ev.description !== "tracker.created")) return null;
  if (ev.mode !== "test" && ev.mode !== "live") return null;
  const t = (ev.result && typeof ev.result === "object" ? ev.result : {}) as Record<string, unknown>;
  if (t.object !== "Tracker" || typeof t.id !== "string" || !t.id.startsWith("trk_")) return null;
  if (typeof t.tracking_code !== "string" || t.tracking_code.length === 0 || t.tracking_code.length > 64) return null;
  if (t.mode !== undefined && t.mode !== ev.mode) return null;
  const status = typeof t.status === "string" && CARRIER_STATUSES.has(t.status) ? (t.status as TrackingStatus) : "unknown";
  const details = Array.isArray(t.tracking_details) ? (t.tracking_details as RawDetail[]) : [];
  const timed = details.filter((d) => typeof d?.datetime === "string" && !Number.isNaN(Date.parse(d.datetime as string)));
  timed.sort((a, b) => Date.parse(a.datetime as string) - Date.parse(b.datetime as string));
  const newest = timed.length > 0 ? timed[timed.length - 1] : null;
  const zipRaw = newest?.tracking_location?.zip;
  const scanZip = typeof zipRaw === "string" && /^[0-9]{5}/.test(zipRaw) ? zipRaw.slice(0, 5) : null;
  return {
    mode: ev.mode,
    trackerId: t.id,
    trackingCode: t.tracking_code,
    shipmentId: typeof t.shipment_id === "string" && t.shipment_id.startsWith("shp_") ? t.shipment_id : null,
    status,
    scannedAt: newest ? new Date(newest.datetime as string).toISOString() : null,
    scanZip,
  };
}

export interface ShipmentTrackingRow {
  label_mode: "test" | "live";
  label_state: string;
  tracking_code: string | null;
  tracking_status: TrackingStatus | null;
  accepted_at: string | null;
  delivered_at: string | null;
  ship_to: { zip?: unknown } | null;
}

export type TrackingDecision =
  | { act: "ignore"; reason: "mode_mismatch" | "no_label" | "code_mismatch" | "not_newer" | "unknown_status" }
  | { act: "update"; patch: { tracking_status: TrackingStatus; accepted_at?: string; delivered_at?: string } };

/** What one tracker event does to one shipments row (the caller found the row by provider_shipment_id). */
export function nextTracking(row: ShipmentTrackingRow, ev: TrackerEvent, now: Date = new Date()): TrackingDecision {
  if (row.label_mode !== ev.mode) return { act: "ignore", reason: "mode_mismatch" };
  if (row.label_state !== "bought") return { act: "ignore", reason: "no_label" };
  if (!row.tracking_code || row.tracking_code !== ev.trackingCode) return { act: "ignore", reason: "code_mismatch" };
  if (ev.status === "unknown") return { act: "ignore", reason: "unknown_status" };
  let status: TrackingStatus = ev.status;
  // Review fix 10: a delivered scan somewhere else is a problem, never the start of the 48-hour window.
  const buyerZip = typeof row.ship_to?.zip === "string" ? row.ship_to.zip.slice(0, 5) : null;
  if (status === "delivered" && ev.scanZip && buyerZip && ev.scanZip !== buyerZip) status = "failure";
  const was = row.tracking_status;
  if (was === "delivered") return { act: "ignore", reason: "not_newer" };
  const forward = !was || PROBLEM.has(status) || status === "delivered" || (!PROBLEM.has(was) && RANK[status] > RANK[was]);
  if (!forward || status === was) return { act: "ignore", reason: "not_newer" };
  const at = ev.scannedAt ?? now.toISOString();
  const patch: { tracking_status: TrackingStatus; accepted_at?: string; delivered_at?: string } = { tracking_status: status };
  if (!row.accepted_at && RANK[status] >= RANK.in_transit) patch.accepted_at = at;
  if (status === "delivered") patch.delivered_at = at;
  return { act: "update", patch };
}
