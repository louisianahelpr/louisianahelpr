// Q2225: a READ-ONLY Stripe lookup for the admin money page's "Mark settled by hand"
// (HeldForReview.tsx -> admin_payout_settle_by_hand). The SQL already refuses an id
// recorded on another money row, but nothing read the id from Stripe, so a transfer
// sent to another account, for another amount, reversed, or failed could be recorded
// as settling a held row. This answers WARNINGS only: the admin can still confirm
// (the button stays enabled); it never blocks and it moves no money (no Face ID gate:
// nothing here creates, changes or cancels anything in Stripe or the database, except
// the audit row).
//
// Shape:
// * Caller presents a Supabase JWT; caller must hold the admin role (has_role with the
//   service-role client). A failed role LOOKUP answers 503, never 403.
// * The row is read on the server from admin_payouts_held_for_review() AS THE CALLER
//   (that RPC checks has_role itself), by kind + id. Nothing the client says about the
//   row (payee, account, amount, group) is trusted; only the amount the admin typed is
//   taken, to warn when the Stripe object is for a different amount.
// * The Stripe mode is the one the row's payee decides (payout: the payee's mode; a
//   refund: the payer's, who is the row's payee here), the rule stripeMode.ts uses for
//   a read ("read": an unenrolled test-looking account is not refused). A deleted payee
//   reads live.
// * Ids: tr_ (transfers.retrieve), re_ (refunds.retrieve), po_ (payouts.retrieve on the
//   payee's connected account). "other: ..." is not looked up (the client never sends it).
// * Every lookup writes an admin_audit_log row ('settle_ref_lookup') with the ref, the
//   mode and the warning codes.

import { createClient } from "npm:@supabase/supabase-js@2";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { serve } from "../_shared/buildStamp.ts";
import { caughtMessage } from "../_shared/caughtMessage.ts";
import { createStripeModeResolver, StripeModeRefused, type StripeMode } from "../_shared/stripeMode.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

export type SettleRefWarning = { code: string; text: string };

type HeldRow = {
  kind: string;
  id: string;
  payee_id: string | null;
  payee_account?: string | null;
  amount_cents: number;
  stripe_group: string | null;
};

const REF_RE = /^(tr|po|re)_[A-Za-z0-9]{6,}$/;
const dollars = (c: number) => `$${(c / 100).toFixed(2)}`;
const idOf = (v: unknown): string | null =>
  typeof v === "string" ? v : (v && typeof v === "object" && typeof (v as { id?: unknown }).id === "string") ? (v as { id: string }).id : null;

function isMissing(err: unknown): boolean {
  const e = err as { code?: string; statusCode?: number } | null;
  return e?.code === "resource_missing" || e?.statusCode === 404;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const anonKey = Deno.env.get("PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY");
  if (!supabaseUrl || !serviceRoleKey || !anonKey) {
    console.error("[admin-settle-ref-lookup] missing SUPABASE_URL / service-role / publishable key");
    return json({ error: "Server not configured" }, 500);
  }

  const jwt = authHeader.replace("Bearer ", "");
  const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: `Bearer ${jwt}` } } });
  const { data: userData, error: userError } = await userClient.auth.getUser(jwt);
  if (userError || !userData?.user) return json({ error: "Unauthorized" }, 401);
  const callerId = userData.user.id;

  const admin = createClient(supabaseUrl, serviceRoleKey);
  const { data: isAdmin, error: roleError } = await admin.rpc("has_role", { _user_id: callerId, _role: "admin" });
  if (roleError) {
    console.error("[admin-settle-ref-lookup] has_role check failed:", roleError.message);
    return json({ error: "Couldn't verify permissions. Please retry." }, 503);
  }
  if (!isAdmin) return json({ error: "Forbidden" }, 403);

  let body: { kind?: unknown; id?: unknown; ref?: unknown; amount_cents?: unknown };
  try {
    body = await req.json();
  } catch (_e) {
    // A body that is not JSON is the caller's mistake, answered as such.
    return json({ error: "Send kind, id and ref." }, 400);
  }
  const kind = typeof body.kind === "string" ? body.kind : "";
  const id = typeof body.id === "string" ? body.id : "";
  const ref = typeof body.ref === "string" ? body.ref.trim() : "";
  const typed = Number.isInteger(body.amount_cents) && (body.amount_cents as number) > 0 ? body.amount_cents as number : null;
  if (!kind || !id || !REF_RE.test(ref)) return json({ error: "Send kind, id and a Stripe id that starts tr_, po_ or re_." }, 400);

  // The row, as the admin money page lists it (the RPC re-checks the admin role).
  const { data: held, error: heldErr } = await userClient.rpc("admin_payouts_held_for_review");
  if (heldErr) {
    console.error("[admin-settle-ref-lookup] held rows read failed:", heldErr.message);
    return json({ error: "Couldn't read the held payouts. Please retry." }, 503);
  }
  const row = ((Array.isArray(held) ? held : []) as HeldRow[]).find((r) => r.kind === kind && r.id === id);
  if (!row) return json({ error: "That row is no longer held for review. Reload the page." }, 404);

  let mode: StripeMode;
  let stripe: Stripe;
  const modes = createStripeModeResolver(admin, (key) => new Stripe(key, { apiVersion: "2025-08-27.basil" }));
  try {
    ({ mode, stripe } = await modes.clientForParties([row.payee_id], "read"));
  } catch (e) {
    if (e instanceof StripeModeRefused) return json({ error: "Couldn't tell which Stripe account to check. Check this id by hand." }, 503);
    throw e;
  }

  const expected = typed ?? row.amount_cents;
  const warnings: SettleRefWarning[] = [];
  const found: Record<string, unknown> = { ref, mode };
  const prefix = ref.slice(0, 2);
  const readRef = async (stripe: Stripe): Promise<void> => {
    if (prefix === "tr") {
      const t = await stripe.transfers.retrieve(ref);
      const destination = idOf(t.destination);
      Object.assign(found, { destination, amount: t.amount, amount_reversed: t.amount_reversed ?? 0, transfer_group: t.transfer_group ?? null });
      if (row.payee_account && destination !== row.payee_account) {
        warnings.push({ code: "other_destination", text: `This transfer went to ${destination ?? "no account"}, not the payee's payout account ${row.payee_account}.` });
      } else if (!row.payee_account) {
        warnings.push({ code: "no_payee_account", text: "The payee has no payout account on file, so where this transfer went can't be checked." });
      }
      if (Number(t.amount) !== expected) {
        warnings.push({ code: "other_amount", text: `This transfer is for ${dollars(Number(t.amount))}, not ${dollars(expected)}.` });
      }
      if (Number(t.amount_reversed ?? 0) > 0) {
        warnings.push({ code: "reversed", text: `${dollars(Number(t.amount_reversed))} of this transfer was reversed.` });
      }
      if (row.stripe_group && t.transfer_group && t.transfer_group !== row.stripe_group) {
        warnings.push({ code: "other_group", text: `This transfer belongs to ${t.transfer_group}, not ${row.stripe_group}.` });
      }
    } else if (prefix === "re") {
      const r = await stripe.refunds.retrieve(ref);
      const pi = idOf(r.payment_intent);
      Object.assign(found, { amount: r.amount, status: r.status, payment_intent: pi });
      if (Number(r.amount) !== expected) {
        warnings.push({ code: "other_amount", text: `This refund is for ${dollars(Number(r.amount))}, not ${dollars(expected)}.` });
      }
      if (r.status === "failed" || r.status === "canceled") {
        warnings.push({ code: "failed", text: `Stripe says this refund ${r.status === "failed" ? "failed" : "was canceled"}.` });
      }
      if (row.stripe_group?.startsWith("pi_") && pi !== row.stripe_group) {
        warnings.push({ code: "other_payment", text: `This refund is for payment ${pi ?? "unknown"}, not ${row.stripe_group}.` });
      }
    } else {
      if (!row.payee_account) {
        warnings.push({ code: "no_payee_account", text: "The payee has no payout account on file, so a po_ payout can't be looked up." });
      } else {
        const p = await stripe.payouts.retrieve(ref, {}, { stripeAccount: row.payee_account });
        Object.assign(found, { amount: p.amount, status: p.status });
        if (Number(p.amount) !== expected) {
          warnings.push({ code: "other_amount", text: `This payout is for ${dollars(Number(p.amount))}, not ${dollars(expected)}.` });
        }
        if (p.status === "failed" || p.status === "canceled") {
          warnings.push({ code: "failed", text: `Stripe says this payout ${p.status === "failed" ? "failed" : "was canceled"}.` });
        }
      }
    }
  };
  try {
    try {
      await readRef(stripe);
    } catch (e) {
      if (!isMissing(e)) throw e;
      // Not in the payee's mode: one read-only look with the other key (lead 11-03), so an id
      // from the other mode is named as such rather than as missing.
      const other: StripeMode = mode === "live" ? "test" : "live";
      let otherStripe: Stripe | null = null;
      try {
        otherStripe = modes.clientFor(other);
      } catch (keyErr) {
        // No usable key for the other mode (e.g. the test key unset): the id is reported missing.
        if (!(keyErr instanceof StripeModeRefused)) throw keyErr;
      }
      try {
        if (!otherStripe) throw e;
        await readRef(otherStripe);
        found.mode = other;
        warnings.unshift({
          code: "other_mode",
          text: `This id is in ${other.toUpperCase()} mode, not the payee's (${mode.toUpperCase()}), so it did not pay this row.`,
        });
      } catch (e2) {
        if (!isMissing(e2)) throw e2;
        warnings.length = 0;
        warnings.push({ code: "not_found", text: `Stripe has no ${ref} in either mode${prefix === "po" ? " on the payee's account" : ""}.` });
      }
    }
  } catch (e) {
    console.error("[admin-settle-ref-lookup] Stripe read failed:", caughtMessage(e));
    return json({ error: "Couldn't check this id in Stripe right now. Check it by hand." }, 502);
  }

  const { data: auditRow, error: auditError } = await admin
    .from("admin_audit_log")
    .insert({
      admin_id: callerId,
      action: "settle_ref_lookup",
      target_type: kind,
      target_id: id,
      details: { ref, mode: found.mode, warnings: warnings.map((w) => w.code) },
    })
    .select("id")
    .single();
  if (auditError || !auditRow?.id) {
    // The lookup read nothing it could change; its answer still goes back, but the gap is loud.
    console.error("[admin-settle-ref-lookup] audit log write FAILED:", auditError?.message ?? "insert returned no id");
  }

  return json({ ok: true, found, warnings });
});
