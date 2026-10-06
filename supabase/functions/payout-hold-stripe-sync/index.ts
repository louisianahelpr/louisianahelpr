// seed-policy: pages for seed/E2E Helprs too. A held Helpr whose automatic
// payouts did not pause (or did not come back) is a platform failure whoever
// the account belongs to, and the hold itself is an admin action, never a
// fixture default.
//
// Q1221 (owner decision 2026-10-05): while a payout hold is active, the held
// Helpr's Stripe AUTOMATIC payouts are frozen (Connect payout schedule set to
// manual), and their previous schedule is put back when the hold lifts.
//
// Callers:
//   - the admin payout queue, right after placing or releasing a hold
//     (admin JWT, body { helper_id });
//   - public.sweep_payout_schedule_freezes(), pg_cron 'payout-freeze-sync'
//     every 10 minutes, for every request older than 5 minutes (service key,
//     body { helper_id }); with no helper_id a service caller settles every
//     open request.
//
// The state machine is _shared/payoutFreeze.ts. This file only authenticates,
// wires Stripe and the database into it, and makes every failure visible: a
// critical ops page and, on the first failed attempt of a request, a note on
// the Helpr's admin page from the admin who asked for it. The 10-minute sweep
// retries and pages again if it stays stuck.
import { serve } from "../_shared/buildStamp.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeadersFull as corsHeaders } from "../_shared/cors.ts";
import { postSlackOpsAlert } from "../_shared/slack-alerts.ts";
import { caughtMessage } from "../_shared/caughtMessage.ts";
import { writeAdminAudit } from "../_shared/adminAuditLog.ts";
import { isUnusableConnectAccountError } from "../_shared/stripeAccountUsable.ts";
import {
  type FreezeOutcome,
  type PayoutSchedule,
  reconcilePayoutFreeze,
  supabaseFreezeStore,
} from "../_shared/payoutFreeze.ts";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SWEEP_LIMIT = 25;

function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify({ fn: "payout-hold-stripe-sync", ...body }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const authHeader = req.headers.get("Authorization") ?? "";
  const cronSecret = Deno.env.get("CRON_SECRET");
  const serviceKey = Deno.env.get("SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const supabaseAdmin = createClient(Deno.env.get("SUPABASE_URL") ?? "", serviceKey ?? "");

  // `!!` guards: an unset secret must never make "Bearer undefined" a key.
  const isService =
    (!!cronSecret && authHeader === `Bearer ${cronSecret}`) ||
    (!!serviceKey && authHeader === `Bearer ${serviceKey}`);

  let adminId: string | null = null;
  if (!isService) {
    try {
      const supabaseUser = createClient(
        Deno.env.get("SUPABASE_URL") ?? "",
        Deno.env.get("PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      );
      const { data: u } = await supabaseUser.auth.getUser(authHeader.replace("Bearer ", ""));
      if (!u?.user) return json({ error: "not authenticated" }, 401);
      const { data: isAdmin, error: roleErr } = await supabaseAdmin.rpc("has_role", {
        _user_id: u.user.id,
        _role: "admin",
      });
      if (roleErr) return json({ error: "could not check the admin role" }, 500);
      if (isAdmin !== true) return json({ error: "admin role required" }, 403);
      adminId = u.user.id;
    } catch (err) {
      return json({ error: caughtMessage(err, "not authenticated") }, 401);
    }
  }

  let body: { helper_id?: unknown } = {};
  try {
    body = await req.json();
  } catch {
    // An empty body is a service sweep of every open request.
    body = {};
  }
  const helperId = typeof body.helper_id === "string" ? body.helper_id : null;
  if (helperId !== null && !UUID_RE.test(helperId)) return json({ error: "helper_id must be a uuid" }, 400);
  if (helperId === null && !isService) return json({ error: "helper_id required" }, 400);

  let helperIds: string[];
  if (helperId) {
    helperIds = [helperId];
  } else {
    const { data, error } = await supabaseAdmin
      .from("payout_schedule_freezes")
      .select("helper_id")
      .in("freeze_state", ["pause_requested", "restore_requested"])
      .order("updated_at", { ascending: true })
      .limit(SWEEP_LIMIT);
    if (error) return json({ error: `could not list open freeze requests: ${error.message}` }, 500);
    // Plus 'paused' rows not checked at Stripe for 6 hours: a paused row is
    // verified, not trusted (a restore that landed at Stripe after its run
    // failed would otherwise go unnoticed).
    const staleBefore = new Date(Date.now() - 6 * 3_600_000).toISOString();
    const { data: paused, error: pausedErr } = await supabaseAdmin
      .from("payout_schedule_freezes")
      .select("helper_id, verified_at")
      .eq("freeze_state", "paused")
      .or(`verified_at.is.null,verified_at.lt.${staleBefore}`)
      .limit(SWEEP_LIMIT);
    if (pausedErr) return json({ error: `could not list paused freezes to verify: ${pausedErr.message}` }, 500);
    helperIds = [...new Set([
      ...(data ?? []).map((r: { helper_id: string }) => r.helper_id),
      ...(paused ?? []).map((r: { helper_id: string }) => r.helper_id),
    ])];
  }

  const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") ?? "", {
    apiVersion: "2025-08-27.basil",
  });
  const store = supabaseFreezeStore(supabaseAdmin);
  const port = {
    async retrieveSchedule(accountId: string): Promise<PayoutSchedule | null> {
      const account = await stripe.accounts.retrieve(accountId);
      return ((account as { settings?: { payouts?: { schedule?: PayoutSchedule } } }).settings?.payouts?.schedule) ?? null;
    },
    async setSchedule(accountId: string, schedule: PayoutSchedule, idempotencyKey: string): Promise<void> {
      await stripe.accounts.update(
        accountId,
        { settings: { payouts: { schedule } } } as never,
        { idempotencyKey },
      );
    },
    isAccountGone: (err: unknown) => isUnusableConnectAccountError(err),
  };

  const results: Array<{ helper_id: string } & FreezeOutcome> = [];
  for (const id of helperIds) {
    let outcome = await reconcilePayoutFreeze(id, store, port);
    if (outcome.kind === "failed" && outcome.state === "restore_requested") {
      // The restore may have landed at Stripe before this run failed, while a
      // re-hold turned the row back to paused: then the row says paused and
      // Stripe pays out daily. Re-run once; a paused row is verified at
      // Stripe and set to manual again (drifted) if so.
      let now: { state: string } | null = null;
      try {
        now = await store.get(id);
      } catch (err) {
        console.error(`[payout-hold-stripe-sync] re-read after a failed restore for ${id}: ${caughtMessage(err)}`);
      }
      if (now?.state === "paused") {
        const again = await reconcilePayoutFreeze(id, store, port);
        if (again.kind === "paused" && again.drifted) {
          outcome = { ...again, note: `restore failed (${outcome.message}) after a re-hold; ${again.note ?? "drift fixed"}` };
        } else if (again.kind === "failed") {
          outcome = again;
        }
      }
    }
    results.push({ helper_id: id, ...outcome });
    if (outcome.kind === "failed") await reportFailure(supabaseAdmin, id, outcome);
    if (outcome.kind === "paused" && outcome.drifted) {
      // The row said paused but Stripe was paying out automatically: fixed
      // above, and paged so someone finds out how it drifted.
      await postSlackOpsAlert({
        kind: "money_at_risk",
        severity: "warning",
        title: "Payout hold: Stripe automatic payouts had come back on while held",
        message: "The held Helpr's Connect schedule was not manual although the hold said paused. It has been set to manual again; check their recent Stripe payouts.",
        fields: { helper_id: id, note: outcome.note ?? "" },
      });
    }
  }

  const ok = results.every((r) => r.kind !== "failed");
  // An admin's call is an admin action on a Helpr's Stripe account: audited
  // (the hold RPC audits the hold itself; this records what Stripe was told).
  if (adminId && helperId) {
    await writeAdminAudit(supabaseAdmin, {
      adminId,
      action: "payout_hold_stripe_sync",
      targetType: "user",
      targetId: helperId,
      details: { results: results.map((r) => ({ kind: r.kind, ...(r.kind === "failed" ? { message: r.message } : {}) })) },
      source: "payout-hold-stripe-sync",
    }, postSlackOpsAlert);
  }
  return json({ ok, results });
});

async function reportFailure(
  // deno-lint-ignore no-explicit-any
  db: any,
  helperId: string,
  outcome: Extract<FreezeOutcome, { kind: "failed" }>,
): Promise<void> {
  const pausing = outcome.state !== "restore_requested";
  console.error(`[payout-hold-stripe-sync] ${pausing ? "pause" : "restore"} failed for ${helperId}: ${outcome.message}`);
  await postSlackOpsAlert({
    kind: "money_at_risk",
    severity: "critical",
    title: pausing
      ? "Payout hold: Stripe automatic payouts NOT paused"
      : "Payout hold released: Stripe payout schedule NOT restored",
    message: pausing
      ? "A held Helpr's Connect balance can still pay out to their bank on Stripe's schedule. Retried every 10 minutes (payout-freeze-sync); fix the cause."
      : "The Helpr is still on manual payouts and will not be paid out automatically. Retried every 10 minutes (payout-freeze-sync); fix the cause.",
    fields: { helper_id: helperId, attempts: outcome.attempts ?? "unknown", error: outcome.message },
    oncePerDayKey: `payout-freeze-${pausing ? "pause" : "restore"}-${helperId}`,
  });

  // The admin-visible note, once per request (its first failed attempt), from
  // the admin who placed or released the hold. Never stacked by the sweep.
  if (outcome.attempts === 1 && outcome.requestedBy) {
    const { error } = await db.from("admin_user_notes").insert({
      user_id: helperId,
      admin_id: outcome.requestedBy,
      category: "billing",
      note: pausing
        ? `Payout hold: Stripe automatic payouts could NOT be paused (${outcome.message}). Money already in this Helpr's Stripe balance can still go to their bank until it is. The system retries every 10 minutes and pages ops.`
        : `Payout hold released, but the Stripe payout schedule could NOT be restored (${outcome.message}). This Helpr stays on manual payouts until it is. The system retries every 10 minutes and pages ops.`,
    });
    if (error) console.error(`[payout-hold-stripe-sync] admin note failed for ${helperId}: ${error.message}`);
  }
}
