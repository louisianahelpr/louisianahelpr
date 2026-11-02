/**
 * A shipped Declutter order, after the buyer paid (docs/specs/shipping-draft.md section 6; Q2259; B134).
 * The seller reads the label, tracking number and Ship-by deadline (declutter_my_ship_label, 20261102023246) and
 * marks it packed (declutter_mark_packed); the buyer reads where it is (declutter_my_ship_tracking, 20261102025148).
 * Both reads give nothing to print or track until the label is bought and the buyer's hold captured.
 * "Shipped" is the carrier's acceptance scan (accepted_at), never a tap; "Delivered" is the delivered scan.
 * Guard: src/components/declutter/shipOrderPanel.test.tsx.
 */
import { supabase } from "@/integrations/supabase/client";
import { rpcErrorMessage } from "@/lib/lifecycleErrors";
import { rpcData } from "@/lib/declutter/api";

export type ShipLabel = {
  order_status: string | null;
  label_state: string | null;
  label_url: string | null;
  tracking_code: string | null;
  tracking_status: string | null;
  service: string | null;
  ship_by: string | null;
  packed_at: string | null;
  accepted_at: string | null;
  delivered_at: string | null;
};

export type ShipTracking = {
  order_status: string | null;
  ready: boolean;
  tracking_code: string | null;
  tracking_status: string | null;
  service: string | null;
  ship_by: string | null;
  packed_at: string | null;
  accepted_at: string | null;
  delivered_at: string | null;
};

export const shipLabelKey = (orderId: string) => ["declutter", "ship-label", orderId] as const;
export const shipTrackingKey = (orderId: string) => ["declutter", "ship-tracking", orderId] as const;

export async function fetchMyShipLabel(orderId: string): Promise<ShipLabel> {
  return rpcData(await supabase.rpc("declutter_my_ship_label", { p_order_id: orderId }), (e) => rpcErrorMessage("declutter_my_ship_label", e)) as unknown as ShipLabel;
}

export async function fetchMyShipTracking(orderId: string): Promise<ShipTracking> {
  return rpcData(await supabase.rpc("declutter_my_ship_tracking", { p_order_id: orderId }), (e) => rpcErrorMessage("declutter_my_ship_tracking", e)) as unknown as ShipTracking;
}

/** The seller's "Packed". The server returns the packed time; no time back means nothing was marked, so it throws. */
export async function markPacked(orderId: string): Promise<string> {
  const at = rpcData(await supabase.rpc("declutter_mark_packed", { p_order_id: orderId }), (e) => rpcErrorMessage("declutter_mark_packed", e)) as unknown as string | null;
  if (!at) throw new Error("label_not_ready");
  return at;
}

/** The carrier of a label (shipments.service: usps_ground_advantage, usps_priority, ups_ground; 20261030012052). */
export function shipCarrier(service: string | null | undefined): "USPS" | "UPS" {
  return service?.startsWith("ups_") ? "UPS" : "USPS";
}

/** The carrier's own tracking page for a number. */
export function trackingUrl(service: string | null | undefined, code: string): string {
  return shipCarrier(service) === "UPS"
    ? `https://www.ups.com/track?tracknum=${encodeURIComponent(code)}`
    : `https://tools.usps.com/go/TrackConfirmAction?tLabels=${encodeURIComponent(code)}`;
}

/** "Wed, Nov 4": the Ship-by day (the deadline is the end of that day, Louisiana time). */
export function shipByWords(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return new Date(t).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "America/Chicago" });
}

/** The carrier's own words for a tracking status the order card shows (shipments.tracking_status). */
const STATUS_WORDS: Record<string, string> = {
  pre_transit: "Label made, not scanned yet",
  in_transit: "In transit",
  out_for_delivery: "Out for delivery",
  delivered: "Delivered",
  available_for_pickup: "Waiting at the post office",
  return_to_sender: "Going back to the seller",
  failure: "Delivery problem",
};
export function trackingStatusWords(status: string | null | undefined): string | null {
  return status ? STATUS_WORDS[status] ?? null : null;
}
