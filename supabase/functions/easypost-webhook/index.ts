/**
 * easypost-webhook: tracking scans for Declutter shipping (docs/specs/shipping-draft.md S4; Q2259, Q2424).
 *
 * EasyPost POSTs an Event here for every tracker change. This function:
 *   1. refuses anything without EasyPost's HMAC signature over the RAW body (easypostSignatureValid), before the
 *      body is parsed. Fail closed: with no EASYPOST_WEBHOOK_SECRET set, every call is refused (owner step: create
 *      the webhook in the EasyPost dashboard, test and production, with that secret, then
 *      `supabase secrets set EASYPOST_WEBHOOK_SECRET=...`);
 *   2. acts only on tracker.created / tracker.updated (trackerFromEvent); every other event is acknowledged and
 *      ignored;
 *   3. finds the ONE shipments row by EasyPost's shipment id (never by anything else in the body), and lets
 *      nextTracking decide: the event's mode must be the label's mode, the tracking code must match, and the status
 *      only moves forward (delivered is final; a delivered scan at another ZIP is a problem, not a delivery);
 *   4. writes the move with a compare-and-set on the status it read (.eq / .is on tracking_status) and .select("id"):
 *      a concurrent event that moved the row first leaves zero rows, answered 409 so EasyPost sends it again and it is
 *      re-decided against the new state.
 * It never touches money: the 48-hour window and payout after a delivered scan are S5 (declutter-money's ship sweep).
 * Only shipments rows exist for testers while declutter_shipping is testers-only, so this needs no user switch check
 * (EasyPost is the caller, there is no user).
 */
import { serve } from "../_shared/buildStamp.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { caughtMessage } from "../_shared/caughtMessage.ts";
import { easypostSignatureValid, nextTracking, trackerFromEvent, type ShipmentTrackingRow } from "../_shared/easypostTracking.ts";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

/** EasyPost's events are small; anything bigger is not one of them. */
const MAX_BODY_BYTES = 256_000;

serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const secret = Deno.env.get("EASYPOST_WEBHOOK_SECRET") ?? "";
  if (!secret) {
    console.error("[easypost-webhook] EASYPOST_WEBHOOK_SECRET is not set: refusing every call");
    return json({ error: "not_configured" }, 503);
  }
  const raw = await req.text();
  if (raw.length > MAX_BODY_BYTES) return json({ error: "too_large" }, 413);
  if (!(await easypostSignatureValid(raw, req.headers.get("X-Hmac-Signature"), secret))) {
    return json({ error: "bad_signature" }, 401);
  }

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return json({ error: "bad_json" }, 400);
  }
  const ev = trackerFromEvent(body);
  if (!ev) return json({ ok: true, ignored: "not_a_tracker_event" });
  if (!ev.shipmentId) return json({ ok: true, ignored: "no_shipment" });

  try {
    const admin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      (Deno.env.get("SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")) ?? "",
    );
    const { data: row, error: readErr } = await admin
      .from("shipments")
      .select("id, label_mode, label_state, tracking_code, tracking_status, accepted_at, delivered_at, ship_to")
      .eq("provider_shipment_id", ev.shipmentId)
      .maybeSingle();
    if (readErr) throw new Error(`shipment read failed: ${readErr.message}`);
    // Not one of ours (another integration on the same EasyPost account): acknowledged, nothing to do.
    if (!row) return json({ ok: true, ignored: "unknown_shipment" });

    const decision = nextTracking(row as ShipmentTrackingRow, ev);
    if (decision.act === "ignore") return json({ ok: true, ignored: decision.reason });

    const was = (row as ShipmentTrackingRow).tracking_status;
    let update = admin.from("shipments").update(decision.patch).eq("id", row.id as string);
    update = was === null ? update.is("tracking_status", null) : update.eq("tracking_status", was);
    const { data: moved, error: writeErr } = await update.select("id");
    if (writeErr) throw new Error(`shipment update failed: ${writeErr.message}`);
    if (!moved || moved.length !== 1) return json({ error: "moved_meanwhile" }, 409);
    return json({ ok: true, status: decision.patch.tracking_status });
  } catch (error) {
    console.error(`[easypost-webhook] error: ${caughtMessage(error)}`);
    return json({ error: "server_error" }, 500);
  }
});
