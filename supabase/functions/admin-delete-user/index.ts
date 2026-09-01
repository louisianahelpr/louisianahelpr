import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeadersFull as corsHeaders } from "../_shared/cors.ts";
import { checkRateLimit, rateLimitResponse } from "../_shared/rate-limit.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const rl = await checkRateLimit(req, {
    windowMs: 300_000,
    maxRequests: 5,
    keyPrefix: "admin-delete-user",
  });
  if (!rl.allowed) return rateLimitResponse(rl.retryAfter ?? 300, corsHeaders);

  try {
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      (Deno.env.get("SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"))!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
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
    const { data: userData, error: userErr } = await supabaseAuth.auth.getUser(token);
    if (userErr || !userData?.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const caller = userData.user;

    // Use has_role RPC (consistent with other admin functions)
    // Distinguish "not an admin" from "couldn't check". This still fails
    // CLOSED, but a transient RPC failure now returns a truthful 503 instead of
    // telling a legitimate admin they are Forbidden.
    const { data: isAdmin, error: roleError } = await supabaseAdmin.rpc("has_role", {
      _user_id: caller.id,
      _role: "admin",
    });
    if (roleError) {
      console.error("[admin-delete-user] has_role check failed:", roleError.message);
      return new Response(JSON.stringify({ error: "Couldn't verify permissions. Please retry." }), {
        status: 503,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!isAdmin) {
      return new Response(JSON.stringify({ error: "Forbidden: admin only" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { userId } = await req.json();
    if (!userId) {
      return new Response(JSON.stringify({ error: "userId is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (userId === caller.id) {
      return new Response(JSON.stringify({ error: "Cannot delete your own account" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch profile details before deleting — cascade removes this row on auth deletion
    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("approval_status, full_name, email")
      .eq("user_id", userId)
      .single();

    if (!profile) {
      return new Response(JSON.stringify({ error: "User not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Refuse to delete a user who is party to an in-flight job or holds money
    // in escrow — same guard as the user-initiated delete-own-account path.
    // An admin delete has no such check today, so deleting mid-job strands
    // the counterparty and orphans the escrowed funds with no party left to
    // release or refund them.
    //
    // ⚠️ Every value below MUST be a real member of the `job_status` enum:
    //   open | accepted | in_progress | completed | cancelled |
    //   revision_requested | disputed | pending_approval
    // Postgres rejects the WHOLE query with 22P02 if any listed value is not a
    // member, and because the block below fails closed on `activeErr`, one bad
    // value makes admin deletion return 500 for EVERY target — including users
    // with no jobs at all.
    //
    // That is exactly the state this was in: the list read
    // `(accepted,arrived,in_progress,awaiting)`. `arrived` is a
    // `job_tracking.status` value, `awaiting` exists nowhere. delete-own-account
    // hit the identical bug and was fixed on 2026-08-31; the fix was never
    // carried across to this admin twin, so admin user-deletion has been 100%
    // broken since. Verified against prod 2026-08-31 by replaying both filters
    // through PostgREST: the old list answers
    //   400 {"code":"22P02","message":"invalid input value for enum job_status: \"arrived\""}
    // and the corrected list below answers 200.
    //
    // Kept byte-identical to delete-own-account:81-86 so the two guards cannot
    // drift again. `disputed` and `payout_pending` are in deliberately: both
    // mean the counterparty still has money or a claim in flight.
    const { data: activeJobs, error: activeErr } = await supabaseAdmin
      .from("jobs")
      .select("id")
      .or(`customer_id.eq.${userId},helper_id.eq.${userId}`)
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
            "This user has an active job or funds held in escrow. Resolve or cancel it and let any payment settle before deleting the account.",
        }),
        { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Write audit log BEFORE deletion so the record survives cascade deletes
    const { error: auditError } = await supabaseAdmin.from("admin_audit_log").insert({
      admin_id: caller.id,
      action: "delete_user",
      target_id: userId,
      target_type: "user",
      details: {
        email: profile.email,
        full_name: profile.full_name,
        approval_status: profile.approval_status,
      },
    });
    // NOTE: a PostgrestBuilder is a lazy PromiseLike that implements `then`
    // only — it has no `.catch`. Chaining `.catch()` here threw a synchronous
    // TypeError before the builder ever issued its request, so the audit row
    // was never written AND the delete below never ran (the outer catch turned
    // it into a 500). Destructure the error instead; a failed audit write is
    // logged but must not block the deletion.
    if (auditError) {
      console.error("[admin-delete-user] audit log failed:", auditError.message);
    }

    const { error: deleteError } = await supabaseAdmin.auth.admin.deleteUser(userId);
    if (deleteError) {
      return new Response(JSON.stringify({ error: deleteError.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`Admin ${caller.id} deleted user ${userId} (${profile.email ?? "no-email"})`);

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[admin-delete-user] error:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Internal server error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
