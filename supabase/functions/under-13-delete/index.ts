// Q1803 (OWNER RULING 2026-10-21, COPPA): deletes every account stamped
// profiles.under_13_blocked_at (an under-13 birthday was refused by the
// profiles trigger block_under_13_birthday, which never stores the birthday).
//
// Called two ways, both with the service key (verifyCronSecret):
//   * by that trigger through pg_net, body { user_id }: delete that one now;
//   * by cron every 5 minutes, body {}: the backstop for a call that never
//     arrived.
// Each account goes through deleteUnder13Account (_shared/under13.ts): the
// normal accountPurge path, then auth.admin.deleteUser. Money in flight: the
// account stays locked, its personal fields are blanked, ONE admin alert is
// sent (stamped under_13_waiting_since), and later runs skip it quietly until
// the money clears. Nothing is retained beyond what accountPurge keeps for any
// deletion.
import { serve } from "../_shared/buildStamp.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { verifyCronSecret } from "../_shared/cron-auth.ts";
import { cronError, cronResult, defectTracker } from "../_shared/cron-result.ts";
import { boundedFetch } from "../_shared/boundedFetch.ts";
import { caughtMessage } from "../_shared/caughtMessage.ts";
import { alertWaitingOnMoney, deleteUnder13Account } from "../_shared/under13.ts";

const FN = "under-13-delete";
const MAX_PER_RUN = 25;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const unauthorized = verifyCronSecret(req);
  if (unauthorized) return unauthorized;

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    (Deno.env.get("SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"))!,
    { global: { fetch: boundedFetch() } },
  );
  const defects = defectTracker();

  try {
    const body = await req.json().catch(() => ({})) as { user_id?: unknown };
    const one = typeof body?.user_id === "string" && UUID_RE.test(body.user_id) ? body.user_id : null;

    let q = admin.from("profiles").select("user_id, under_13_waiting_since").not("under_13_blocked_at", "is", null);
    if (one) q = q.eq("user_id", one);
    // Accounts waiting on money go last, so they can never fill a run ahead of newer ones.
    const { data: rows, error } = await q
      .order("under_13_waiting_since", { ascending: true, nullsFirst: true })
      .order("under_13_blocked_at", { ascending: true })
      .limit(MAX_PER_RUN);
    if (error) {
      // Deployed before its migration (PGRST204/42703: no such column): nothing can be stamped yet.
      if (error.code === "42703" || error.code === "PGRST204") return cronResult(FN, { notDeployed: true }, { count: 0 }, corsHeaders);
      throw error;
    }

    let deleted = 0;
    let waiting = 0;
    let deferred = 0;
    for (const r of (rows ?? []) as { user_id: string; under_13_waiting_since: string | null }[]) {
      const out = await deleteUnder13Account(admin, r.user_id, alertWaitingOnMoney);
      if (out.status === "deleted") deleted++;
      else if (out.status === "waiting_on_money") waiting++;
      else if (out.status === "deferred") deferred++;
      else defects.record(`${r.user_id}: ${out.detail}`);
    }

    return cronResult(FN, { scanned: rows?.length ?? 0, deleted, waitingOnMoney: waiting, deferred }, defects.defects, corsHeaders);
  } catch (e) {
    console.error(`${FN} failed:`, caughtMessage(e));
    return cronError(FN, "Internal server error", corsHeaders);
  }
});
