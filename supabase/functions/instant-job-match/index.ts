import { createClient } from "https://esm.sh/@supabase/supabase-js@2.99.0";
import { checkRateLimit, rateLimitResponse } from "../_shared/rate-limit.ts";
import { corsHeadersFull as corsHeaders } from "../_shared/cors.ts";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = (Deno.env.get("SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"))!;

  // Two valid callers, exactly as in str-ical-sync:
  //   1. INTERNAL (service role / cron secret) — the post-funding trigger in
  //      stripe-webhook's checkoutSessionCompleted. Owns no user session, so
  //      it cannot pass the ownership check below and is exempted from it.
  //   2. A user JWT — must own the job.
  // Anything else is rejected. An unauthenticated caller must never be able to
  // trigger a platform-wide notification fan-out for an arbitrary job (spam
  // vector + leaks targeted offers into the open pool).
  const authHeader = req.headers.get("Authorization") ?? "";
  const cronSecret = Deno.env.get("CRON_SECRET");
  const isInternal =
    (!!cronSecret && authHeader === `Bearer ${cronSecret}`) ||
    (!!serviceRoleKey && authHeader === `Bearer ${serviceRoleKey}`);

  // Rate limit: 20 requests per minute per IP. Internal callers are exempt —
  // the webhook fans out once per funded job and must never be throttled into
  // silently skipping a match.
  if (!isInternal) {
    const { allowed, retryAfter } = await checkRateLimit(req, {
      windowMs: 60_000, maxRequests: 20, keyPrefix: "instant-job-match",
    });
    if (!allowed) return rateLimitResponse(retryAfter!, corsHeaders);
  }

  try {
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Authentication required" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    let callerId: string | null = null;
    if (!isInternal) {
      const supabaseAuth = createClient(supabaseUrl, (Deno.env.get("PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY"))!);
      const token = authHeader.replace("Bearer ", "");
      const { data: userData } = await supabaseAuth.auth.getUser(token);
      callerId = userData?.user?.id || null;
      if (!callerId) {
        return new Response(JSON.stringify({ error: "Invalid or expired session" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    const { jobId } = await req.json();
    if (typeof jobId !== "string" || !UUID_RE.test(jobId)) {
      return new Response(JSON.stringify({ error: "Missing or invalid jobId" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Q392: one user-triggered match per job per caller every 10 minutes. The
    // server-side dedupe (job_match_queue's UNIQUE (user_id, job_id)) already
    // means a re-trigger notifies nobody twice; this stops a poster re-running
    // the scan to fish for newly matching users. The webhook is exempt: it
    // runs once per funded job and Stripe retries are absorbed by the dedupe.
    if (!isInternal) {
      const { allowed, retryAfter } = await checkRateLimit(req, {
        windowMs: 10 * 60_000, maxRequests: 1, keyPrefix: `instant-job-match:job:${jobId}`,
      });
      if (!allowed) return rateLimitResponse(retryAfter!, corsHeaders);
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);

    // Get the job details — include urgency so we can decide whether
    // this match goes out immediately (urgent) or rolls into the daily
    // digest (everything else, for users who opt in). Only OPEN jobs are
    // matchable, and a job with a pending direct offer is private to its
    // targeted helper — it must never be blasted to the open pool.
    //
    // FUNDING GATE — `payment_status` must be one of the funded states.
    //
    // This is the same predicate all three browse surfaces enforce since
    // migration 20260831010000 (F-1): get_ranked_open_jobs, the
    // open_jobs_browse view, and get_open_jobs_for_map each require
    // `payment_status = ANY (ARRAY['escrow','payout_pending','released'])`.
    // Without it this function notified up to 20 helpers about a job that
    // every one of those surfaces would refuse to return — so the push landed,
    // the helper tapped it, and browse showed them nothing. Worse, it fired
    // BEFORE the poster had opened Stripe at all: `create-payment` only mints a
    // Checkout Session URL, and the flip to 'escrow' happens later in
    // stripe-webhook's checkoutSessionCompleted. An abandoned checkout meant 20
    // people were told about work that never became real.
    //
    // The matching rule and the browse rule have to be the SAME rule. A helper
    // must never be told about a job they cannot open, and the cheapest way to
    // guarantee that is to ask the same question browse asks.
    const FUNDED_PAYMENT_STATUSES = ["escrow", "payout_pending", "released"];
    const { data: job, error: jobError } = await supabase
      .from("jobs")
      .select("id, title, category, location, budget, customer_id, is_urgent, payment_status")
      .eq("id", jobId)
      .eq("status", "open")
      // Q392: an ownerless job (the poster deleted their account) is off every
      // browse surface (open_jobs_browse: customer_id IS NOT NULL), so it is
      // never announced. enqueue_instant_job_match re-checks the whole gate.
      .not("customer_id", "is", null)
      .in("payment_status", FUNDED_PAYMENT_STATUSES)
      // Same visibility rule as get_public_open_jobs: hidden while a direct
      // offer is pending; matchable again once it resolves (declined/expired).
      .or("offered_to_helper_id.is.null,direct_offer_status.neq.pending")
      .maybeSingle();

    // Never drop the Supabase error: a transport/permission failure and "this
    // job is not fundable yet" are different outcomes and must not collapse
    // into one opaque 500.
    if (jobError) throw jobError;
    if (!job) {
      // Not an error condition. The overwhelmingly common case is the caller
      // firing before escrow is funded, which is exactly what this gate is for
      // — answer 200 with a zero count so the poster's submit path is not
      // failed by a match that correctly declined to run.
      return new Response(
        JSON.stringify({ notified: 0, queued: 0, skipped: "job_not_matchable" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Mask the street address before it ever reaches a notification. Match
    // recipients here are pulled from the general helper pool (jobs with a
    // pending direct offer are excluded above), so nobody in this fan-out has
    // been awarded the job — the full address must never be interpolated
    // into their notification. Reuse the same Postgres function the
    // open_jobs_browse view uses, so there is exactly one masking rule.
    const { data: maskedLocation, error: maskError } = await supabase.rpc(
      "mask_job_location",
      { loc: job.location },
    );
    if (maskError) throw maskError;
    const displayLocation = maskedLocation ?? "";

    // Verify the caller owns the job — always, not just when a token happened
    // to be attached. Internal (service-role) callers have no user identity by
    // construction; they are trusted because holding the service-role key is
    // itself the authorisation, and the only internal caller is the webhook
    // acting on a job Stripe has just confirmed payment for.
    if (!isInternal && callerId !== job.customer_id) {
      return new Response(JSON.stringify({ error: "Not authorized to trigger match for this job" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Match-eligible users: anyone approved + not banned. After today's
    // unified-user model shift, role-based filtering ('helper' / 'customer')
    // is dead — every signup gets role='customer' now, so the previous
    // .eq('role', 'helper') filter would have returned ZERO users for any
    // job posted after the migration. Same for the Elite-only filter at
    // current scale (likely 0 Elite subscribers).
    //
    // New filter: email-verified (the only entry gate; this read
    // approval_status = 'approved' until Q205b), non-banned, not the poster. Tier-priority
    // (Elite gets matched first / more aggressively) can come back as a
    // sort dimension once the user base actually splits across tiers.
    const { data: helpers, error: helpersError } = await supabase
      .from("profiles")
      .select("user_id, full_name, skills, location, subscription_tier, subscription_expires_at, ban_status")
      .eq("email_verified", true)
      .neq("user_id", job.customer_id);

    if (helpersError) throw helpersError;

    // Exclude anyone in a block relationship with the poster (either
    // direction). Without this, blocking a user doesn't stop them being
    // auto-matched to — and notified about — the blocker's job, which
    // defeats the point of Block as a safety control.
    const { data: blocks, error: blocksError } = await supabase
      .from("user_blocks")
      .select("blocker_id, blocked_id")
      .or(`blocker_id.eq.${job.customer_id},blocked_id.eq.${job.customer_id}`);
    if (blocksError) throw blocksError;
    const blockedUserIds = new Set<string>();
    for (const b of blocks || []) {
      if (b.blocker_id === job.customer_id) blockedUserIds.add(b.blocked_id);
      if (b.blocked_id === job.customer_id) blockedUserIds.add(b.blocker_id);
    }

    const now = new Date().toISOString();
    const activeHelpers = (helpers || []).filter((h) => {
      // Skip banned users (any non-active status).
      if (h.ban_status && ["banned", "temp_banned", "permanently_banned"].includes(h.ban_status)) return false;
      // Skip anyone blocked by / blocking the poster.
      if (blockedUserIds.has(h.user_id)) return false;
      // Drop expired-tier filter — at current scale we notify everyone
      // who scores above zero, regardless of tier. Re-add as a sort
      // boost once tiers are populated.
      return true;
    });
    if (activeHelpers.length === 0) {
      return new Response(JSON.stringify({ notified: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const jobLocation = job.location.toLowerCase();
    const jobCategory = job.category.toLowerCase();

    // Score helpers by relevance
    const scored = activeHelpers
      .map((h) => {
        let score = 0;
        const helperLoc = (h.location || "").toLowerCase();
        // `.filter(Boolean)` is load-bearing. Without it an empty `skills`
        // yields [""] — and `"cleaning".includes("")` is TRUE — so BOTH skill
        // rules below fired for every helper who had not set skills, handing
        // them a free +3. Since `profiles.skills` has had no editor anywhere in
        // the app since 4112a6e02 (an unlabelled bot rewrite that deleted the
        // input but left the save path), that was EVERY profile in the
        // database: 0 of 23 have skills set. So `.filter(h => h.score > 0)`
        // below filtered nobody, and "relevance" collapsed to the tier
        // tie-break — every job post notified an arbitrary top-20 of all
        // approved helpers. An empty skill list must match nothing.
        const helperSkills = (h.skills || "")
          .toLowerCase()
          .split(",")
          .map((s: string) => s.trim())
          .filter(Boolean);

        // Location match
        if (helperLoc && (jobLocation.includes(helperLoc) || helperLoc.includes(jobLocation))) {
          score += 3;
        }
        // Category/skills match
        if (helperSkills.some((s: string) => jobCategory.includes(s) || s.includes(jobCategory))) {
          score += 2;
        }
        // Title keyword match
        if (helperSkills.some((s: string) => job.title.toLowerCase().includes(s))) {
          score += 1;
        }
        return { ...h, score };
      })
      .filter((h) => h.score > 0)
      .sort((a, b) => {
        // Tie-break score by tier: Elite > Pro > Basic > none.
        if (b.score !== a.score) return b.score - a.score;
        const tierRank: Record<string, number> = { elite: 3, pro: 2, basic: 1 };
        return (tierRank[b.subscription_tier ?? ""] ?? 0) - (tierRank[a.subscription_tier ?? ""] ?? 0);
      })
      // Ranked candidates, not the final 20: enqueue_instant_job_match keeps
      // the first 20 the browse gate admits for each recipient (a user below
      // the job's credential tier must not take a slot). Bounded payload.
      .slice(0, 200);

    if (scored.length === 0) {
      return new Response(JSON.stringify({ notified: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Tiny category emoji map — surfaces a glanceable icon in the push
    // notification title so users can identify the work type without
    // reading. Keeps the brand-voiced "Match for you" framing.
    const categoryEmoji: Record<string, string> = {
      cleaning: "🧹",
      yard_work: "🌿",
      moving: "📦",
      errands: "🛒",
      handyman: "🔧",
      painting: "🎨",
      delivery: "🚚",
      pet_care: "🐾",
      assembly: "🪛",
      // storm_prep and events were MISSING until 2026-09-19, so both fell
      // through to the generic "✨" in the one place a user sees this map —
      // the push notification title. In Louisiana, storm_prep is the category
      // that most needs to be glanceable: `src/lib/categoryIcons.ts` gives it
      // CloudLightning for exactly that reason, and the in-app CategoryIcon
      // list had the same two-member hole (see CategoryIcon.tsx's note).
      // `ENUM_MAP_RATCHET` in src/test/edge/exhaustivenessRegistry.test.ts is
      // what found it and is what keeps the next enum member from repeating it.
      storm_prep: "⛈️",
      events: "🎉",
      other: "✨",
    };
    const emoji = categoryEmoji[job.category] ?? "✨";

    // The job-match OFF switch, honoured before anything is queued (ADDED
    // 2026-09-11). `job_matches` false means no in-app row, no push, no digest
    // entry. Absent row or absent column reads as TRUE. deliver_job_match
    // re-reads it at send time, and routes digest-mode users to the digest.
    const scoredIds = scored.map((h) => h.user_id);
    const mutedMatches = new Set<string>();
    const { data: prefs, error: prefsError } = await supabase
      .from("notification_preferences")
      .select("user_id, job_matches")
      .in("user_id", scoredIds);
    if (prefsError) throw prefsError;
    for (const p of (prefs ?? []) as Array<{ user_id: string; job_matches: boolean | null }>) {
      if (p.job_matches === false) mutedMatches.add(p.user_id);
    }

    const matches: Array<{ user_id: string; title: string; message: string; link: string }> = [];
    for (const h of scored) {
      // The switch wins over everything, urgency included.
      if (mutedMatches.has(h.user_id)) continue;
      matches.push({
        user_id: h.user_id,
        // Category emoji in the title for faster glance recognition.
        title: `${emoji} Match for you${job.is_urgent ? " · Urgent" : ""}`,
        message: `${job.title} in ${displayLocation} · $${job.budget}. Tap to review and apply.`,
        link: `/home?quickApply=${job.id}`,
      });
    }

    // Q392: this function no longer writes notifications itself. It hands the
    // ranked matches to enqueue_instant_job_match, which (per recipient) applies
    // open_jobs_browse's gate — credential tier, ownerless, funded, direct
    // offer, fixture — queues each match until the job is in THAT user's feed
    // under early access (early_access_visible_at), sends the ones already
    // visible, and dedupes on (job_id, user_id) so a re-trigger tells nobody
    // twice. The every-minute sweep_job_match_queue sends the rest.
    const { data: outcome, error: enqueueError } = await supabase.rpc("enqueue_instant_job_match", {
      p_job_id: job.id,
      p_matches: matches,
    });
    if (enqueueError) {
      // Deploy lag: this function can ship before its migration. Fail CLOSED —
      // an un-gated send is the defect this replaced — and say so.
      if ((enqueueError as { code?: string }).code === "PGRST202") {
        console.error("instant-job-match: enqueue_instant_job_match not deployed yet (PGRST202); no match sent");
        return new Response(
          JSON.stringify({ notified: 0, queued: 0, skipped: "match_queue_not_deployed" }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      throw enqueueError;
    }
    const result = (outcome ?? {}) as { eligible?: number; queued?: number; already?: number; sent_now?: number };

    // Counts only: the ranked candidate list (up to 200 nearby accounts,
    // some the gate refuses) is never handed back to the caller.
    return new Response(
      JSON.stringify({
        notified: result.sent_now ?? 0,
        queued: result.queued ?? 0,
        already_matched: result.already ?? 0,
        eligible: result.eligible ?? 0,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    // `catch` binds `unknown` — see delete-own-account for why this is not a nit.
    const message = error instanceof Error ? error.message : String(error);
    // The DETAIL stays server-side and the CALLER gets a fixed string (EF-5,
    // hole hunt 2026-09-15). `message` here is whatever PostgREST or the push
    // fan-out threw, so returning it hands table and column names to whoever
    // can reach this endpoint. src/test/edge/error-leak-EF5.test.ts sweeps the
    // whole class; this was the one site in it that this lane owns.
    console.error("Instant match error:", message, error);
    return new Response(JSON.stringify({ error: "Could not run the job match right now." }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
