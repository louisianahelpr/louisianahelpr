// Board 120 "Pause my account" (owner 2026-10-25), on for everyone.
//
// POST {} as the signed-in member. Refuses (409) while the member has live work, by the SAME check
// account deletion uses (_shared/accountPurge.ts findActiveWork), and while they have an open job
// posted (a paused poster's applicants could not reach them). Otherwise public.account_pause_apply
// (service role only, 20261026023246) takes their live Declutter listings down and marks the
// profile paused. Resume is the client-callable public.account_resume(); no edge function needed.
import { serve } from "../_shared/buildStamp.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeadersFull as corsHeaders } from "../_shared/cors.ts";
import { checkRateLimit, rateLimitResponse } from "../_shared/rate-limit.ts";
import { findActiveWork } from "../_shared/accountPurge.ts";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

/** What the member reads when the pause is refused (one sentence, what to do). */
export const PAUSE_REFUSED = {
  active: "Finish your open deals first: a booked or disputed job, a sale or order underway, or money on its way.",
  open_jobs: "Close or finish the jobs you've posted first, so nobody is left waiting on you.",
} as const;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const rl = await checkRateLimit(req, { windowMs: 300_000, maxRequests: 5, keyPrefix: "pause-own-account" });
  if (!rl.allowed) return rateLimitResponse(rl.retryAfter ?? 300, corsHeaders);
  try {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, (Deno.env.get("SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"))!);
    const auth = req.headers.get("Authorization");
    if (!auth) return json({ error: "Unauthorized" }, 401);
    const anon = createClient(Deno.env.get("SUPABASE_URL")!, (Deno.env.get("PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY"))!);
    const { data: { user } } = await anon.auth.getUser(auth.replace("Bearer ", ""));
    if (!user) return json({ error: "Unauthorized" }, 401);

    const active = await findActiveWork(admin, user.id);
    // Fail closed: if we can't prove there is no live work, don't pause.
    if (!active.ok) return json({ error: "Couldn't check your account just now. Try again." }, 500);
    if (active.active) return json({ error: PAUSE_REFUSED.active, reason: "active" }, 409);

    const open = await admin.from("jobs").select("id", { count: "exact", head: true }).eq("customer_id", user.id).eq("status", "open");
    if (open.error) return json({ error: "Couldn't check your account just now. Try again." }, 500);
    if ((open.count ?? 0) > 0) return json({ error: PAUSE_REFUSED.open_jobs, reason: "open_jobs" }, 409);

    const { data, error } = await admin.rpc("account_pause_apply", { p_user_id: user.id });
    if (error) {
      // account_pause_apply re-checks under a lock what may have started since (authz review).
      if (/active_work/.test(error.message)) return json({ error: PAUSE_REFUSED.active, reason: "active" }, 409);
      console.error("[pause-own-account] apply failed:", error.message);
      return json({ error: "Couldn't pause your account just now. Try again." }, 500);
    }
    return json({ paused: true, listings_paused: data ?? 0 });
  } catch (err) {
    console.error("[pause-own-account] failed:", err instanceof Error ? err.message : String(err));
    return json({ error: "Couldn't pause your account just now. Try again." }, 500);
  }
});
