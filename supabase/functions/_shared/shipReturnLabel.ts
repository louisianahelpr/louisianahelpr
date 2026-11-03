/**
 * Shipping S6: the return label an admin asked for on a damaged / not-as-described parcel (docs/specs/shipping-draft.md
 * 5.3: "a return label if the admin wants the item back = seller debt"; Q2259; migration 20261103212046). The
 * declutter-money run (shipLabelRun.ts) drives 'requested' rows of shipping_return_labels through here.
 * TEST MODE ONLY: the table cannot hold a live row, and a live row is refused here too.
 *
 * Steps, ONE label per return row, never bought twice:
 *   1. No return shipment yet: read the OUTBOUND shipment back from EasyPost and create the return shipment with its
 *      two addresses swapped and the same parcel, by EasyPost object id (to = the outbound's from_address, from = the
 *      outbound's to_address): no address text, name, email or phone leaves our database. Its id is saved
 *      compare-and-set before anything is bought; an unsaved shipment is never bought (an unbought shipment costs
 *      nothing), so a crash here at worst leaves one unused EasyPost shipment.
 *   2. Read the saved return shipment back FIRST: one that already carries a label (a crash after the buy) is recorded,
 *      never bought again.
 *   3. Buy the cheapest USPS Ground Advantage rate ON THAT SHIPMENT, only at or below the cap (the outbound's quoted
 *      postage: the same parcel over the same Louisiana route reversed). None under the cap: failed, ops paged, the
 *      admin arranges the return by hand.
 *   4. The bought label is recorded by declutter_ship_return_label_bought (one seller debt, both sides told).
 * A network or provider error is retried later; after MAX_ATTEMPTS the row is failed and ops paged.
 * NOT YET PROVEN against EasyPost itself (after the App Store submit, with the TEST key): that POST /v2/shipments
 * accepts {id} references for the addresses and the parcel. Until then the recorded answers in
 * src/test/shipReturnLabel.test.ts are hand-made in the documented shapes.
 */
import { labelOnShipment, type LabelRead } from "./easypostLabels.ts";
import { allowedQuotes } from "./easypostRates.ts";

export type ReturnRow = {
  id: string;
  order_id: string;
  label_mode: string;
  /** The return shipment, once created and saved. */
  provider_shipment_id: string | null;
  attempts: number;
  /** The outbound shipment (shipments.provider_shipment_id). */
  outbound_shipment_id: string;
  /** The most the return label may cost: the outbound's quoted_cents. */
  cap_cents: number;
};

type Answer = { ok: boolean; status: number; body: unknown };
type Bought = Extract<LabelRead, { ok: true }>["label"];

export interface ReturnPorts {
  /** GET /v2/shipments/:id */
  getShipment(id: string): Promise<Answer>;
  /** POST /v2/shipments */
  createShipment(body: unknown): Promise<Answer>;
  /** POST /v2/shipments/:id/buy */
  buyShipment(id: string, body: { rate: { id: string } }): Promise<Answer>;
  /** Saves the return shipment id on a 'requested' row whose id is still empty; false if another run saved one. */
  saveReturnShipment(returnId: string, shipmentId: string): Promise<boolean>;
  /** declutter_ship_return_label_bought: 'bought' | 'already'. */
  recordBought(returnId: string, label: Bought): Promise<string>;
  /** declutter_ship_return_label_failed (pages ops through log_cron_defect). */
  recordFailed(returnId: string, why: string): Promise<void>;
  /** attempts + next_attempt_at on a 'requested' row. */
  recordRetry(returnId: string, attempts: number, why: string): Promise<void>;
}

export type ReturnOutcome = "return_bought" | "return_already" | "return_failed" | "return_retry" | "return_skipped";

/** After this many tries the row is failed (the admin arranges the return by hand). */
export const MAX_ATTEMPTS = 8;

const idOf = (v: unknown, prefix: string): string | null => {
  const id = v && typeof v === "object" ? (v as { id?: unknown }).id : null;
  return typeof id === "string" && id.startsWith(prefix) ? id : null;
};

/**
 * POST /v2/shipments body for the return: the outbound's addresses swapped and its parcel, by EasyPost id only.
 * null when the outbound shipment is not in test mode, is another shipment, or lacks any of the three ids.
 */
export function returnShipmentBody(outbound: unknown, expectId: string): { shipment: Record<string, { id: string }> } | null {
  const o = outbound && typeof outbound === "object" ? (outbound as Record<string, unknown>) : {};
  if (o.mode !== "test" || o.id !== expectId) return null;
  const buyerAdr = idOf(o.to_address, "adr_");
  const sellerAdr = idOf(o.from_address, "adr_");
  const parcel = idOf(o.parcel, "prcl_");
  if (!buyerAdr || !sellerAdr || !parcel) return null;
  return { shipment: { to_address: { id: sellerAdr }, from_address: { id: buyerAdr }, parcel: { id: parcel } } };
}

/** The cheapest USPS Ground Advantage rate on THIS shipment at or below the cap, or null. */
export function returnRate(shipment: unknown, shipmentId: string, capCents: number): { id: string; cents: number } | null {
  const s = shipment && typeof shipment === "object" ? (shipment as { rates?: unknown; mode?: unknown }) : {};
  if (s.mode !== "test") return null;
  const q = allowedQuotes((Array.isArray(s.rates) ? s.rates : []) as Parameters<typeof allowedQuotes>[0])
    .find((r) => r.service === "usps_ground_advantage" && r.providerShipmentId === shipmentId);
  return q && q.rateCents <= capCents ? { id: q.providerRateId, cents: q.rateCents } : null;
}

export async function runShipReturn(r: ReturnRow, p: ReturnPorts): Promise<ReturnOutcome> {
  if (r.label_mode !== "test") {
    await p.recordFailed(r.id, "live return labels are not supported");
    return "return_failed";
  }
  const retry = async (why: string): Promise<ReturnOutcome> => {
    const n = r.attempts + 1;
    if (n >= MAX_ATTEMPTS) {
      await p.recordFailed(r.id, `gave up after ${n} tries: ${why}`);
      return "return_failed";
    }
    await p.recordRetry(r.id, n, why);
    return "return_retry";
  };

  let shipmentId = r.provider_shipment_id;
  let shipment: unknown;
  if (!shipmentId) {
    const out = await p.getShipment(r.outbound_shipment_id);
    if (!out.ok) return retry(`outbound read ${out.status}`);
    const body = returnShipmentBody(out.body, r.outbound_shipment_id);
    if (!body) {
      await p.recordFailed(r.id, "the outbound shipment could not be read for a return");
      return "return_failed";
    }
    const made = await p.createShipment(body);
    if (!made.ok) return retry(`create ${made.status}`);
    const madeId = idOf(made.body, "shp_");
    if (!madeId || (made.body as { mode?: unknown }).mode !== "test") return retry("create answered no test shipment");
    if (!(await p.saveReturnShipment(r.id, madeId))) return "return_skipped";
    shipmentId = madeId;
    shipment = made.body;
  } else {
    const read = await p.getShipment(shipmentId);
    if (!read.ok) return retry(`read ${read.status}`);
    shipment = read.body;
  }

  const expect = { shipmentId, mode: "test" as const, quotedCents: r.cap_cents };
  const on = labelOnShipment(shipment, expect);
  if (on.ok) return (await p.recordBought(r.id, on.label)) === "already" ? "return_already" : "return_bought";
  if (on.reason === "mode_mismatch" || on.reason === "wrong_shipment") {
    await p.recordFailed(r.id, `return shipment ${on.reason}`);
    return "return_failed";
  }
  const rate = returnRate(shipment, shipmentId, r.cap_cents);
  if (!rate) {
    await p.recordFailed(r.id, `no USPS Ground Advantage rate at or below ${r.cap_cents} cents`);
    return "return_failed";
  }
  const buy = await p.buyShipment(shipmentId, { rate: { id: rate.id } });
  if (!buy.ok) return retry(`buy ${buy.status}`);
  const got = labelOnShipment(buy.body, expect);
  if (!got.ok) return retry(`buy answered ${got.reason}`);
  return (await p.recordBought(r.id, got.label)) === "already" ? "return_already" : "return_bought";
}
