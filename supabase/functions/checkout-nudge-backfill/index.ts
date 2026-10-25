// seed-policy: raises no alert of its own. It acts on ONE job named by the
// caller; the notification's seed boundary drops a seed job's row, and
// send-notification-email refuses test recipients and suppressed addresses.
//
// checkout-nudge-backfill: send the abandoned-checkout nudge
// (_shared/checkoutNudge.ts) for ONE named job the owner approved (lead,
// 2026-10-25: the real poster of a job whose checkout was abandoned before the
// nudge existed). Service role only (verifyCronSecret): no member can call it.
//
//   POST { "job_id": "<uuid>" }
//
// It sends exactly what the webhook sends: the in-app "Finish posting your
// job" notice and its email, linking to Post a job with the job filled in.
// It works on a job the sweep already marked 'abandoned' (and on 'unpaid' or
// 'failed'), refuses a funded, cancelled or ownerless job, and is ONCE per
// job: the same claim the webhook writes (public.claim_checkout_nudge)
// answers a second call "duplicate" and sends nothing. The checkout_nudge
// switch is not asked (p_owner_approved: the owner approved this job by name).
//
// Answers 200 { status, emailed } on sent / duplicate / dropped, 400 on a bad
// job id, 404 on no such job, 409 on a job that may not be nudged, 500 on a
// failure (the claim was written or not, as `status` says).
import { createClient } from "npm:@supabase/supabase-js@2";
import { serve } from "../_shared/buildStamp.ts";
import { boundedFetch } from "../_shared/boundedFetch.ts";
import { verifyCronSecret } from "../_shared/cron-auth.ts";
import { caughtMessage } from "../_shared/caughtMessage.ts";
import { sendCheckoutNudge } from "../_shared/checkoutNudge.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Never funded: the only states a "finish posting" nudge is true for. */
const NUDGEABLE = new Set(["unpaid", "abandoned", "failed"]);

const reply = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const denied = verifyCronSecret(req);
  if (denied) return denied;
  if (req.method !== "POST") return reply(405, { error: "POST only" });

  try {
    const body = await req.json().catch(() => ({})) as { job_id?: unknown };
    const jobId = typeof body.job_id === "string" ? body.job_id.trim() : "";
    if (!UUID.test(jobId)) return reply(400, { error: "job_id must be a uuid" });

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      (Deno.env.get("SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")) ?? "",
      { global: { fetch: boundedFetch() } },
    );

    const { data: job, error: jobErr } = await supabase
      .from("jobs")
      .select("id, customer_id, title, status, payment_status")
      .eq("id", jobId)
      .maybeSingle();
    if (jobErr) return reply(500, { error: `job read: ${jobErr.message}` });
    if (!job) return reply(404, { error: "no such job" });
    const row = job as { id: string; customer_id: string | null; title: string | null; status: string | null; payment_status: string | null };
    if (!row.customer_id) return reply(409, { error: "the job has no account on it" });
    if (row.status !== "open" || !NUDGEABLE.has(row.payment_status ?? "unpaid")) {
      return reply(409, { error: `not a never-paid open job (status ${row.status}, payment ${row.payment_status})` });
    }

    const result = await sendCheckoutNudge(supabase, {
      jobId: row.id,
      customerId: row.customer_id,
      title: row.title,
      sessionId: null,
      ownerApprovedJob: true,
    });
    console.log("[checkout-nudge-backfill]", { jobId, ...result });
    if (result.status === "failed") return reply(500, { ...result });
    if (result.status === "not_nudgeable") return reply(409, { ...result });
    return reply(200, { ...result });
  } catch (e) {
    return reply(500, { error: caughtMessage(e) });
  }
});
