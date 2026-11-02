/**
 * Shipping S3: the declutter-money step that runs the label worker (shipLabelWorker.ts) over the claimed shipments
 * that are due, with the real ports: EasyPost (TEST key only), Stripe (test mode) and the service-role database.
 * At most 10 a run; each row is one order's one label (idempotency key per order, money review fix 7).
 */
import type Stripe from "https://esm.sh/stripe@18.5.0";
import { easypostKeyName } from "./easypostRates.ts";
import { nextAttemptDelayMs, reconcileShipCapture, runShipLabel, type ClaimedShipment, type LabelOutcome, type ReconcileOutcome, type ShipOrder } from "./shipLabelWorker.ts";
import { postSlackOpsAlert } from "./slack-alerts.ts";
import { caughtMessage } from "./caughtMessage.ts";

// deno-lint-ignore no-explicit-any
type Db = any;
const EASYPOST = "https://api.easypost.com/v2/shipments";
const TIMEOUT_MS = 20_000;

/** The capture port, shared by the label worker and the crash reconcile (same amount, same per-order key). */
function captureWith(testStripe: Stripe) {
  return async (pi: string, orderId: string, amountCents: number): Promise<"captured" | "hold_lost"> => {
    try {
      // amount_to_capture: a setup fee the account already paid elsewhere stays on the card (released with the
      // rest of the hold), never captured then refunded. The same amount on every retry (the RPC's answer is
      // stable), so the per-order idempotency key never sees different parameters.
      const r = await testStripe.paymentIntents.capture(pi, { amount_to_capture: amountCents },
        { idempotencyKey: `declutter-ship-capture-${orderId}` });
      return r.status === "succeeded" ? "captured" : "hold_lost";
    } catch (e) {
      const code = (e as { code?: string }).code;
      // The hold is gone (expired or cancelled): nothing can be taken. Anything else is thrown and retried.
      if (code === "payment_intent_unexpected_state") return "hold_lost";
      throw e;
    }
  };
}

/** declutter_ship_setup_fee_at_capture: the cents to capture. */
function captureAmountWith(admin: Db) {
  return async (orderId: string): Promise<number> => {
    const { data, error: e } = await admin.rpc("declutter_ship_setup_fee_at_capture", { p_order_id: orderId });
    if (e) throw new Error(`capture amount failed: ${e.message}`);
    if (!Number.isInteger(data) || (data as number) <= 0) throw new Error(`capture amount unreadable: ${String(data)}`);
    return data as number;
  };
}

/** held -> captured | released, compare-and-set on 'held'. */
function setCaptureWith(admin: Db) {
  return async (orderId: string, st: "captured" | "released"): Promise<void> => {
    const { error: e } = await admin.from("declutter_orders").update({ ship_capture: st })
      .eq("id", orderId).eq("ship_capture", "held").select("id");
    if (e) throw new Error(`order capture state failed: ${e.message}`);
  };
}

function pageWith(shipmentId: string, labelMode: string) {
  return (title: string, message: string, fields: Record<string, string>) => postSlackOpsAlert({
    kind: "money_at_risk", severity: "warning", title, message, fields, oncePerDayKey: `ship-label-${shipmentId}-${title}`,
    // A test-mode label (the worker never touches a live one yet) is test data: digest only, never a page.
    seed: labelMode === "test",
  }).then(() => undefined);
}

export async function runShipLabels(admin: Db, testStripeOf: () => Stripe, record: (defect: string) => void): Promise<Partial<Record<LabelOutcome | ReconcileOutcome, number>>> {
  const counts: Partial<Record<LabelOutcome | ReconcileOutcome, number>> = {};
  await runClaimedLabels(admin, testStripeOf, record, counts);
  await reconcileCaptures(admin, testStripeOf, record, counts);
  return counts;
}

/**
 * The crash reconcile (reconcileShipCapture): paid ship orders still 'held' whose shipment is already 'bought'. At most
 * 10 a run. Runs after the label pass in the same declutter-money call, so a label this run bought and captured is
 * already 'captured' and is not read here.
 */
async function reconcileCaptures(admin: Db, testStripeOf: () => Stripe, record: (defect: string) => void,
  counts: Partial<Record<LabelOutcome | ReconcileOutcome, number>>): Promise<void> {
  const { data: orders, error } = await admin.from("declutter_orders")
    .select("id, status, ship_capture, stripe_payment_intent_id")
    .eq("status", "paid").eq("handover", "ship").eq("ship_capture", "held").limit(50);
  if (error) {
    if (error.code === "42P01" || error.code === "42703") return;
    record(`ship capture reconcile: held orders read failed: ${error.message}`);
    return;
  }
  if (!orders || orders.length === 0) return;
  const byId = new Map((orders as (ShipOrder & { id: string })[]).map((o) => [o.id, o]));
  const { data: rows, error: sErr } = await admin.from("shipments")
    .select("id, declutter_order_id, label_mode, provider_shipment_id")
    .eq("label_state", "bought").in("declutter_order_id", [...byId.keys()]).limit(10);
  if (sErr) {
    record(`ship capture reconcile: bought read failed: ${sErr.message}`);
    return;
  }
  if (!rows || rows.length === 0) return;
  let testStripe: Stripe;
  try {
    testStripe = testStripeOf();
  } catch (e) {
    record(`ship capture reconcile: no test-mode Stripe client: ${caughtMessage(e)}`);
    return;
  }
  for (const s of rows as Pick<ClaimedShipment, "id" | "declutter_order_id" | "label_mode" | "provider_shipment_id">[]) {
    try {
      const outcome = await reconcileShipCapture(s, byId.get(s.declutter_order_id) ?? null, {
        intentStatus: async (pi) => (await testStripe.paymentIntents.retrieve(pi)).status,
        captureAmount: captureAmountWith(admin),
        capture: captureWith(testStripe),
        setCapture: setCaptureWith(admin),
        page: pageWith(s.id, s.label_mode),
      });
      counts[outcome] = (counts[outcome] ?? 0) + 1;
    } catch (e) {
      record(`ship capture reconcile ${s.id}: ${caughtMessage(e)}`.slice(0, 200));
    }
  }
}

async function runClaimedLabels(admin: Db, testStripeOf: () => Stripe, record: (defect: string) => void,
  counts: Partial<Record<LabelOutcome | ReconcileOutcome, number>>): Promise<void> {
  const { data: rows, error } = await admin.from("shipments")
    .select("id, declutter_order_id, label_mode, provider_shipment_id, provider_rate_id, quoted_cents, attempts")
    .eq("label_state", "claimed").not("declutter_order_id", "is", null).lte("next_attempt_at", new Date().toISOString())
    .order("next_attempt_at").limit(10);
  if (error) {
    // 42P01 / 42703: the shipping migrations are not on this database yet; nothing to do.
    if (error.code === "42P01" || error.code === "42703") return;
    record(`ship labels: claimed read failed: ${error.message}`);
    return;
  }
  if (!rows || rows.length === 0) return;
  const key = Deno.env.get(easypostKeyName("test"));
  // Made only when a label is due, so a missing test key never stops the rest of the money run.
  let testStripe: Stripe;
  try {
    testStripe = testStripeOf();
  } catch (e) {
    record(`ship labels: no test-mode Stripe client: ${caughtMessage(e)}`);
    return;
  }
  for (const s of (rows ?? []) as ClaimedShipment[]) {
    if (!key) {
      record("ship labels: the EasyPost test key is not set");
      break;
    }
    const auth = { Authorization: `Basic ${btoa(`${key}:`)}`, "Content-Type": "application/json" };
    const call = async (url: string, init: RequestInit) => {
      try {
        const res = await fetch(url, { ...init, headers: auth, signal: AbortSignal.timeout(TIMEOUT_MS) });
        return { ok: res.ok, status: res.status, body: await res.json().catch(() => null) };
      } catch (e) {
        // A timeout or network failure: the worker retries (an unanswered buy is read back first next time).
        return { ok: false, status: 0, body: { error: caughtMessage(e).slice(0, 100) } };
      }
    };
    const { data: order, error: orderErr } = await admin.from("declutter_orders")
      .select("status, ship_capture, stripe_payment_intent_id").eq("id", s.declutter_order_id).maybeSingle();
    if (orderErr) {
      record(`ship labels: order ${s.declutter_order_id} read failed: ${orderErr.message}`);
      continue;
    }
    try {
      const outcome = await runShipLabel(s, order as ShipOrder | null, {
        getShipment: (_m, id) => call(`${EASYPOST}/${id}`, { method: "GET" }),
        buyShipment: (_m, id, body) => call(`${EASYPOST}/${id}/buy`, { method: "POST", body: JSON.stringify(body) }),
        rateBuyable: async (id, cents) => {
          const { data, error: e } = await admin.rpc("shipping_rate_buyable", { p_shipment_id: id, p_rate_cents: cents });
          if (e) throw new Error(`shipping_rate_buyable failed: ${e.message}`);
          return data === true;
        },
        recordBought: async (id, l) => {
          const { data, error: e } = await admin.from("shipments").update({
            label_state: "bought", label_cost_cents: l.costCents, tracking_code: l.trackingCode, label_path: l.labelUrl,
            tracking_status: "pre_transit", last_error: null, updated_at: new Date().toISOString(),
          }).eq("id", id).eq("label_state", "claimed").select("id");
          if (e) throw new Error(`label record failed: ${e.message}`);
          return Array.isArray(data) && data.length === 1;
        },
        recordFailed: async (id, reason) => {
          const { error: e } = await admin.from("shipments").update({ label_state: "failed", last_error: reason.slice(0, 500) })
            .eq("id", id).eq("label_state", "claimed").select("id");
          if (e) throw new Error(`label failure record failed: ${e.message}`);
        },
        recordRetry: async (id, attempts, why) => {
          const { error: e } = await admin.from("shipments").update({
            attempts: Math.min(attempts, 100), last_error: why,
            next_attempt_at: new Date(Date.now() + nextAttemptDelayMs(attempts)).toISOString(),
          }).eq("id", id).eq("label_state", "claimed").select("id");
          if (e) throw new Error(`label retry record failed: ${e.message}`);
        },
        captureAmount: captureAmountWith(admin),
        capture: captureWith(testStripe),
        release: async (pi) => {
          const cur = await testStripe.paymentIntents.retrieve(pi);
          if (cur.status === "requires_capture") await testStripe.paymentIntents.cancel(pi);
        },
        setCapture: setCaptureWith(admin),
        closeReleased: async (orderId) => {
          const { data, error: e } = await admin.rpc("declutter_ship_hold_released", { p_order_id: orderId });
          if (e) throw new Error(`closing the released order failed: ${e.message}`);
          return String(data);
        },
        page: pageWith(s.id, s.label_mode),
      });
      counts[outcome] = (counts[outcome] ?? 0) + 1;
    } catch (e) {
      record(`ship label ${s.id}: ${caughtMessage(e)}`.slice(0, 200));
    }
  }
}
