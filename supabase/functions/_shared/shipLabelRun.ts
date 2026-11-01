/**
 * Shipping S3: the declutter-money step that runs the label worker (shipLabelWorker.ts) over the claimed shipments
 * that are due, with the real ports: EasyPost (TEST key only), Stripe (test mode) and the service-role database.
 * At most 10 a run; each row is one order's one label (idempotency key per order, money review fix 7).
 */
import type Stripe from "https://esm.sh/stripe@18.5.0";
import { easypostKeyName } from "./easypostRates.ts";
import { nextAttemptDelayMs, runShipLabel, type ClaimedShipment, type LabelOutcome, type ShipOrder } from "./shipLabelWorker.ts";
import { postSlackOpsAlert } from "./slack-alerts.ts";
import { caughtMessage } from "./caughtMessage.ts";

// deno-lint-ignore no-explicit-any
type Db = any;
const EASYPOST = "https://api.easypost.com/v2/shipments";
const TIMEOUT_MS = 20_000;

export async function runShipLabels(admin: Db, testStripeOf: () => Stripe, record: (defect: string) => void): Promise<Partial<Record<LabelOutcome, number>>> {
  const counts: Partial<Record<LabelOutcome, number>> = {};
  const { data: rows, error } = await admin.from("shipments")
    .select("id, declutter_order_id, label_mode, provider_shipment_id, provider_rate_id, quoted_cents, attempts")
    .eq("label_state", "claimed").not("declutter_order_id", "is", null).lte("next_attempt_at", new Date().toISOString())
    .order("next_attempt_at").limit(10);
  if (error) {
    // 42P01 / 42703: the shipping migrations are not on this database yet; nothing to do.
    if (error.code === "42P01" || error.code === "42703") return counts;
    record(`ship labels: claimed read failed: ${error.message}`);
    return counts;
  }
  if (!rows || rows.length === 0) return counts;
  const key = Deno.env.get(easypostKeyName("test"));
  // Made only when a label is due, so a missing test key never stops the rest of the money run.
  let testStripe: Stripe;
  try {
    testStripe = testStripeOf();
  } catch (e) {
    record(`ship labels: no test-mode Stripe client: ${caughtMessage(e)}`);
    return counts;
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
        capture: async (pi, orderId) => {
          try {
            const r = await testStripe.paymentIntents.capture(pi, {}, { idempotencyKey: `declutter-ship-capture-${orderId}` });
            return r.status === "succeeded" ? "captured" : "hold_lost";
          } catch (e) {
            const code = (e as { code?: string }).code;
            // The hold is gone (expired or cancelled): nothing can be taken. Anything else is thrown and retried.
            if (code === "payment_intent_unexpected_state") return "hold_lost";
            throw e;
          }
        },
        release: async (pi) => {
          const cur = await testStripe.paymentIntents.retrieve(pi);
          if (cur.status === "requires_capture") await testStripe.paymentIntents.cancel(pi);
        },
        setCapture: async (orderId, st) => {
          const { error: e } = await admin.from("declutter_orders").update({ ship_capture: st })
            .eq("id", orderId).eq("ship_capture", "held").select("id");
          if (e) throw new Error(`order capture state failed: ${e.message}`);
        },
        page: (title, message, fields) => postSlackOpsAlert({
          kind: "money_at_risk", severity: "warning", title, message, fields, oncePerDayKey: `ship-label-${s.id}-${title}`,
        }).then(() => undefined),
      });
      counts[outcome] = (counts[outcome] ?? 0) + 1;
    } catch (e) {
      record(`ship label ${s.id}: ${caughtMessage(e)}`.slice(0, 200));
    }
  }
  return counts;
}
