/**
 * Shipping S3: the declutter-money step that runs the label worker (shipLabelWorker.ts) over the claimed shipments
 * that are due, with the real ports: EasyPost (TEST key only), Stripe (test mode) and the service-role database.
 * At most 10 a run; each row is one order's one label (idempotency key per order, money review fix 7).
 */
import type Stripe from "https://esm.sh/stripe@18.5.0";
import { easypostKeyName } from "./easypostRates.ts";
import { nextAttemptDelayMs, reconcileShipCapture, runShipLabel, type ClaimedShipment, type LabelOutcome, type ReconcileOutcome, type ShipOrder } from "./shipLabelWorker.ts";
import { runShipVoid, type VoidableShipment, type VoidOutcome } from "./shipLabelVoid.ts";
import { postSlackOpsAlert } from "./slack-alerts.ts";
import { caughtMessage } from "./caughtMessage.ts";

// deno-lint-ignore no-explicit-any
type Db = any;
const EASYPOST = "https://api.easypost.com/v2/shipments";
const TIMEOUT_MS = 20_000;
/** A void that EasyPost has not settled (or did not answer) is asked again 30 min later. */
const VOID_RETRY_MS = 30 * 60_000;

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

/** Shipping S6: bought + no acceptance scan -> void_requested (compare-and-set; a scan that lands first wins). */
function requestVoidWith(admin: Db) {
  return async (shipmentId: string): Promise<boolean> => {
    const { data, error: e } = await admin.from("shipments")
      .update({ label_state: "void_requested", last_error: null, next_attempt_at: new Date().toISOString() })
      .eq("id", shipmentId).eq("label_state", "bought").is("accepted_at", null)
      .or("tracking_status.is.null,tracking_status.eq.pre_transit").select("id");
    if (e) throw new Error(`void request failed: ${e.message}`);
    return Array.isArray(data) && data.length === 1;
  };
}

/** One EasyPost caller per key: a timeout or network failure is an answer with ok false (the caller retries). */
function easypostCaller(key: string) {
  const auth = { Authorization: `Basic ${btoa(`${key}:`)}`, "Content-Type": "application/json" };
  return async (url: string, init: RequestInit) => {
    try {
      const res = await fetch(url, { ...init, headers: auth, signal: AbortSignal.timeout(TIMEOUT_MS) });
      return { ok: res.ok, status: res.status, body: await res.json().catch(() => null) };
    } catch (e) {
      return { ok: false, status: 0, body: { error: caughtMessage(e).slice(0, 100) } };
    }
  };
}

function pageWith(shipmentId: string, labelMode: string) {
  return (title: string, message: string, fields: Record<string, string>) => postSlackOpsAlert({
    kind: "money_at_risk", severity: "warning", title, message, fields, oncePerDayKey: `ship-label-${shipmentId}-${title}`,
    // A test-mode label (the worker never touches a live one yet) is test data: digest only, never a page.
    seed: labelMode === "test",
  }).then(() => undefined);
}

type Counts = Partial<Record<LabelOutcome | ReconcileOutcome | VoidOutcome, number>>;

export async function runShipLabels(admin: Db, testStripeOf: () => Stripe, record: (defect: string) => void): Promise<Counts> {
  const counts: Counts = {};
  await runClaimedLabels(admin, testStripeOf, record, counts);
  await reconcileCaptures(admin, testStripeOf, record, counts);
  await runVoids(admin, record, counts);
  return counts;
}

/**
 * Shipping S6 void pass (shipLabelVoid.ts runShipVoid): 'void_requested' labels that are due, at most 10 a run. Runs
 * last, so a void this run's worker or reconcile requested is asked of EasyPost in the same call.
 */
async function runVoids(admin: Db, record: (defect: string) => void, counts: Counts): Promise<void> {
  const { data: rows, error } = await admin.from("shipments")
    .select("id, declutter_order_id, label_mode, provider_shipment_id, tracking_status, accepted_at")
    .eq("label_state", "void_requested").not("declutter_order_id", "is", null).lte("next_attempt_at", new Date().toISOString())
    .order("next_attempt_at").limit(10);
  if (error) {
    if (error.code === "42P01" || error.code === "42703") return;
    record(`ship voids: read failed: ${error.message}`);
    return;
  }
  if (!rows || rows.length === 0) return;
  const key = Deno.env.get(easypostKeyName("test"));
  if (!key) {
    record("ship voids: the EasyPost test key is not set");
    return;
  }
  const call = easypostCaller(key);
  for (const s of rows as VoidableShipment[]) {
    try {
      const outcome = await runShipVoid(s, {
        getShipment: (_m, id) => call(`${EASYPOST}/${id}`, { method: "GET" }),
        refundShipment: (_m, id) => call(`${EASYPOST}/${id}/refund`, { method: "POST" }),
        recordVoid: async (id, state) => {
          const { error: e } = await admin.from("shipments").update({ label_state: state, last_error: null })
            .eq("id", id).eq("label_state", "void_requested").select("id");
          if (e) throw new Error(`void record failed: ${e.message}`);
        },
        recordVoidError: async (id, why) => {
          const { error: e } = await admin.from("shipments").update({
            last_error: why.slice(0, 500), next_attempt_at: new Date(Date.now() + VOID_RETRY_MS).toISOString(),
          }).eq("id", id).eq("label_state", "void_requested").select("id");
          if (e) throw new Error(`void error record failed: ${e.message}`);
        },
        page: pageWith(s.id, s.label_mode),
      });
      counts[outcome] = (counts[outcome] ?? 0) + 1;
    } catch (e) {
      record(`ship void ${s.id}: ${caughtMessage(e)}`.slice(0, 200));
    }
  }
}

/**
 * The crash reconcile (reconcileShipCapture): paid ship orders still 'held' whose shipment is already 'bought'. At most
 * 10 a run. Runs after the label pass in the same declutter-money call, so a label this run bought and captured is
 * already 'captured' and is not read here.
 */
async function reconcileCaptures(admin: Db, testStripeOf: () => Stripe, record: (defect: string) => void,
  counts: Counts): Promise<void> {
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
        requestVoid: requestVoidWith(admin),
      });
      counts[outcome] = (counts[outcome] ?? 0) + 1;
    } catch (e) {
      record(`ship capture reconcile ${s.id}: ${caughtMessage(e)}`.slice(0, 200));
    }
  }
}

async function runClaimedLabels(admin: Db, testStripeOf: () => Stripe, record: (defect: string) => void,
  counts: Counts): Promise<void> {
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
    // A timeout or network failure is a retry (an unanswered buy is read back first next time).
    const call = easypostCaller(key);
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
        requestVoid: requestVoidWith(admin),
      });
      counts[outcome] = (counts[outcome] ?? 0) + 1;
    } catch (e) {
      record(`ship label ${s.id}: ${caughtMessage(e)}`.slice(0, 200));
    }
  }
}
