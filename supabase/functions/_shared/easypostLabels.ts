/**
 * EasyPost labels for Declutter shipping (docs/specs/shipping-draft.md S3 label worker and 5.2; money review fixes 2,
 * 7, 8 and 13; Q2259, Q2424). Pure: no network, no Deno APIs, so vitest runs it on recorded responses. The label
 * worker (declutter-money, after the card hold) calls EasyPost and hands each answer here; nothing here buys.
 *
 * Rules:
 *  - ONE label per order, ever (fix 7): before any buy the worker reads the stored shipment back; a shipment that
 *    already carries a label is USED (labelOnShipment), never bought again. Only a shipment with no label is bought.
 *  - The rate is checked BEFORE the buy (fix 7): the stored rate id must still be on the shipment, in the order's mode,
 *    and cost no more than what the buyer paid (quoted_cents). Dearer = no buy; the hold is released at no cost (fix 2).
 *  - After a buy the real cost is ALWAYS recorded, even above the quote (the purchase happened); above the quote it is
 *    flagged for an ops page.
 *  - Mode (fix 8): every EasyPost object carries the mode of the key that made it; a response in the other mode is
 *    refused, so a test order can never be answered by (or buy) live postage.
 *  - Voids: POST /v2/shipments/:id/refund answers refund_status "submitted", "refunded" or "rejected"
 *    (docs.easypost.com/docs/shipments, read 2026-11-01), mapped onto shipments.label_state.
 * EasyPost endpoints (docs.easypost.com/docs/shipments, read 2026-11-01): buy = POST /v2/shipments/:id/buy with the
 * Rate to buy; refund = POST /v2/shipments/:id/refund. Bought fields: postage_label.label_url, tracking_code,
 * selected_rate.rate, tracker.id.
 */
import { dollarsToCents } from "./easypostRates.ts";

type Mode = "test" | "live";
interface RawRate { id?: unknown; rate?: unknown; currency?: unknown }
interface RawShipment {
  id?: unknown;
  mode?: unknown;
  rates?: unknown;
  postage_label?: { label_url?: unknown } | null;
  tracking_code?: unknown;
  selected_rate?: RawRate | null;
  tracker?: { id?: unknown } | null;
  refund_status?: unknown;
}

const asShipment = (v: unknown): RawShipment => (v && typeof v === "object" ? (v as RawShipment) : {});

export interface BoughtLabel {
  shipmentId: string;
  trackingCode: string;
  labelUrl: string;
  costCents: number;
  trackerId: string | null;
  /** The real cost is above what the buyer paid: recorded anyway, and ops is paged. */
  overQuote: boolean;
}

export type LabelRead =
  | { ok: true; label: BoughtLabel }
  | { ok: false; reason: "mode_mismatch" | "wrong_shipment" | "no_label" | "bad_cost" };

/**
 * The label a shipment already carries (a resume after a crash, or the buy's own answer). "no_label" means the
 * provider confirms none was bought: only then may the worker buy.
 */
export function labelOnShipment(body: unknown, expect: { shipmentId: string; mode: Mode; quotedCents: number }): LabelRead {
  const s = asShipment(body);
  if (s.mode !== expect.mode) return { ok: false, reason: "mode_mismatch" };
  if (s.id !== expect.shipmentId) return { ok: false, reason: "wrong_shipment" };
  const labelUrl = s.postage_label?.label_url;
  if (typeof labelUrl !== "string" || !labelUrl.startsWith("https://")) return { ok: false, reason: "no_label" };
  if (typeof s.tracking_code !== "string" || s.tracking_code.length === 0) return { ok: false, reason: "no_label" };
  const cents = s.selected_rate?.currency === "USD" ? dollarsToCents(s.selected_rate?.rate) : null;
  if (cents === null || cents <= 0) return { ok: false, reason: "bad_cost" };
  const trackerId = typeof s.tracker?.id === "string" && s.tracker.id.startsWith("trk_") ? s.tracker.id : null;
  return {
    ok: true,
    label: { shipmentId: expect.shipmentId, trackingCode: s.tracking_code, labelUrl, costCents: cents, trackerId, overQuote: cents > expect.quotedCents },
  };
}

export type BuyCheck =
  | { buy: true; body: { rate: { id: string } } }
  | { buy: false; reason: "mode_mismatch" | "wrong_shipment" | "already_bought" | "rate_gone" | "dearer_than_paid" };

/**
 * Before the buy, on the shipment read back from EasyPost: buy only the stored rate, only when the shipment has no
 * label yet, in the order's mode, and only at or below what the buyer paid.
 */
export function checkBeforeBuy(body: unknown, expect: { shipmentId: string; rateId: string; mode: Mode; quotedCents: number }): BuyCheck {
  const s = asShipment(body);
  if (s.mode !== expect.mode) return { buy: false, reason: "mode_mismatch" };
  if (s.id !== expect.shipmentId) return { buy: false, reason: "wrong_shipment" };
  if (s.postage_label && typeof s.postage_label.label_url === "string") return { buy: false, reason: "already_bought" };
  const rate = (Array.isArray(s.rates) ? (s.rates as RawRate[]) : []).find((r) => r?.id === expect.rateId);
  const cents = rate && rate.currency === "USD" ? dollarsToCents(rate.rate) : null;
  if (cents === null || cents <= 0) return { buy: false, reason: "rate_gone" };
  if (cents > expect.quotedCents) return { buy: false, reason: "dearer_than_paid" };
  return { buy: true, body: { rate: { id: expect.rateId } } };
}

/** shipments.label_state after a void (refund) answer; null when the answer is not one EasyPost documents. */
export function labelStateAfterVoid(body: unknown, expect: { shipmentId: string; mode: Mode }): "void_requested" | "voided" | "void_rejected" | null {
  const s = asShipment(body);
  if (s.mode !== expect.mode || s.id !== expect.shipmentId) return null;
  switch (s.refund_status) {
    case "submitted": return "void_requested";
    case "refunded": return "voided";
    case "rejected": return "void_rejected";
    default: return null;
  }
}
