import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeadersFull as corsHeaders } from "../_shared/cors.ts";
import { checkRateLimit, rateLimitResponse } from "../_shared/rate-limit.ts";

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const rl = await checkRateLimit(req, {
    windowMs: 300_000,
    maxRequests: 3,
    keyPrefix: "delete-own-account",
  });
  if (!rl.allowed) return rateLimitResponse(rl.retryAfter ?? 300, corsHeaders);

  try {
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      (Deno.env.get("SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"))!
    );

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseAuth = createClient(
      Deno.env.get("SUPABASE_URL")!,
      (Deno.env.get("PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY"))!
    );
    const token = authHeader.replace("Bearer ", "");
    const { data: { user } } = await supabaseAuth.auth.getUser(token);

    if (!user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Require confirmation phrase
    const { confirmation } = await req.json();
    if (confirmation !== "DELETE MY ACCOUNT") {
      return new Response(JSON.stringify({ error: "Invalid confirmation" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Refuse to delete while the user is party to an in-flight job or holds
    // money in escrow. Deleting mid-transaction would strand the counterparty
    // (their helper/poster vanishes) and orphan escrowed funds with no party
    // left to release or refund them. The job must reach a terminal state
    // (completed/cancelled) and escrow must be settled first.
    // `.or(...).or(...)` ANDs the two clauses: (I'm a party) AND (it's live).
    //
    // ⚠️ Every value below MUST be a real member of the `job_status` enum:
    //   open | accepted | in_progress | completed | cancelled |
    //   revision_requested | disputed | pending_approval
    // (see supabase/migrations/20260311000404_*.sql plus the three ADD VALUE
    // migrations). Postgres rejects the whole query with 22P02 "invalid input
    // value for enum job_status" if ANY listed value is not a member — and
    // because the block below fails closed on `activeErr`, one bad value makes
    // account deletion return 500 for EVERY user, not just users with jobs.
    // That is exactly what happened: this list previously contained `arrived`
    // and `awaiting`, neither of which is a job_status. `arrived` is a
    // `job_tracking.status` value; `awaiting` exists nowhere. Result: 100% of
    // in-app account deletions failed with 500 — an App Store compliance gate.
    // Verified against prod 2026-08-31: the query 400s with 22P02 regardless of
    // user id, and delete-own-account answered 500 for a fresh test account
    // that had no live jobs at all.
    //
    // `disputed` and `payout_pending` are included deliberately: both mean the
    // counterparty still has money or a claim in flight, which is the stated
    // reason this guard exists.
    const { data: activeJobs, error: activeErr } = await supabaseAdmin
      .from("jobs")
      .select("id")
      .or(`customer_id.eq.${user.id},helper_id.eq.${user.id}`)
      .or(
        "status.in.(accepted,in_progress,revision_requested,disputed)," +
          "payment_status.in.(escrow,payout_pending)",
      )
      .limit(1);

    if (activeErr) {
      // Fail closed — if we can't verify the account is safe to delete, don't.
      return new Response(
        JSON.stringify({ error: "Couldn't verify account state. Please try again." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    if (activeJobs && activeJobs.length > 0) {
      return new Response(
        JSON.stringify({
          error:
            "You have an active job or funds held in escrow. Finish or cancel your open jobs and let any payments settle before deleting your account.",
        }),
        { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Delete the user from auth (cascade removes profile and related data)
    const { error: deleteError } = await supabaseAdmin.auth.admin.deleteUser(user.id);

    if (deleteError) {
      return new Response(JSON.stringify({ error: deleteError.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    // `catch` binds `unknown`: a thrown string, a Supabase error object or a
    // rejected non-Error all reach here, and `err.message` on `null`/`undefined`
    // throws INSIDE the handler — turning a diagnosable 500 into an empty one.
    const message = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
