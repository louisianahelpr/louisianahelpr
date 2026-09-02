import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeadersFull as corsHeaders } from "../_shared/cors.ts";
import { checkRateLimit, rateLimitResponse } from "../_shared/rate-limit.ts";
import { describeDeleteError, findActiveWork, purgeAccount } from "../_shared/accountPurge.ts";

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
    //
    // One implementation, in _shared/accountPurge.ts, shared with
    // admin-delete-user. This used to be a hand-copied block in each function
    // with a comment promising they were kept byte-identical; they were not,
    // and the drift (a dead `arrived`/`awaiting` enum list left in the admin
    // twin) broke admin deletion completely for a day. It also missed group
    // jobs entirely — see findActiveWork for that half.
    const active = await findActiveWork(supabaseAdmin, user.id);

    if (!active.ok) {
      // Fail closed — if we can't verify the account is safe to delete, don't.
      return new Response(
        JSON.stringify({ error: "Couldn't verify account state. Please try again." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    if (active.active) {
      return new Response(
        JSON.stringify({
          error:
            "You have an active job or funds held in escrow. Finish or cancel your open jobs and let any payments settle before deleting your account.",
        }),
        { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Erase what must be erased and anonymise what must be retained, BEFORE
    // touching the auth row. See _shared/accountPurge.ts for the ordering
    // argument — the short version is that if anything below fails, the
    // account is already stripped of its PII and its stored documents rather
    // than left fully intact behind an error message.
    //
    // This is the step that was missing entirely. `auth.admin.deleteUser`
    // alone left the user's government ID scan in `id-documents/<uid>/`, their
    // avatar anonymously fetchable from the public `avatars` bucket, their
    // messages (no FK on that table, so nothing cascades) and their Stripe
    // subscription still billing.
    const purge = await purgeAccount(supabaseAdmin, user.id);
    if (!purge.ok) {
      console.error("[delete-own-account] purge incomplete:", JSON.stringify(purge.steps));
      return new Response(JSON.stringify({ error: purge.userMessage }), {
        status: 503,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    console.log(`[delete-own-account] purge for ${user.id}:`, JSON.stringify(purge.steps));

    // Now the auth row. Remaining FK rules finish the job: CASCADE erases the
    // profile and the reviews written ABOUT this user; SET NULL anonymises the
    // reviews they WROTE (a third party's reputation), the payout ledger, and
    // the jobs retained as financial records.
    const { error: deleteError } = await supabaseAdmin.auth.admin.deleteUser(user.id);

    if (deleteError) {
      // Never pass a raw Postgres constraint violation to the user. Before
      // this, a 23503 surfaced verbatim in the delete dialog as
      // `violates foreign key constraint "jobs_helper_id_fkey"` — a permanent,
      // unexplained refusal with no way forward.
      console.error("[delete-own-account] deleteUser failed:", deleteError.message);
      return new Response(JSON.stringify({ error: describeDeleteError(deleteError.message) }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ success: true, steps: purge.steps }), {
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
