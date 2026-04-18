import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Verify cron secret
  const cronSecret = Deno.env.get("CRON_SECRET");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const authHeader = req.headers.get("Authorization");
  if (!authHeader || ((!cronSecret || authHeader !== `Bearer ${cronSecret}`) && (!serviceRoleKey || authHeader !== `Bearer ${serviceRoleKey}`))) {
    return new Response("Unauthorized", { status: 401, headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const now = new Date().toISOString();
    const in24h = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const in23h = new Date(Date.now() + 23 * 60 * 60 * 1000).toISOString();
    const resolved: string[] = [];
    const warned: string[] = [];

    // 0. Proactive 24h warnings — revision deadline approaches and helper hasn't fixed
    const { data: warnRevisions } = await supabase
      .from("jobs")
      .select("id, title, customer_id, helper_id, revision_deadline")
      .eq("status", "revision_requested")
      .is("revision_completed_at", null)
      .not("revision_deadline", "is", null)
      .gt("revision_deadline", in23h)
      .lte("revision_deadline", in24h);

    for (const job of warnRevisions || []) {
      const notifications: any[] = [];
      if (job.helper_id) {
        notifications.push({
          user_id: job.helper_id,
          title: "⏰ Revision window closing in 24h",
          message: `Please update your progress on "${job.title}" to avoid a potential dispute.`,
          type: "warning",
          link: "/my-jobs?filter=in_progress",
        });
      }
      notifications.push({
        user_id: job.customer_id,
        title: "Revision window closing in 24h",
        message: `The helpr has 24h left to fix "${job.title}". You'll be able to approve or escalate after that.`,
        type: "info",
        link: "/my-posts?filter=in_progress",
      });
      if (notifications.length) await supabase.from("notifications").insert(notifications);
      warned.push(job.id);
    }

    // 0b. Proactive 24h warnings — acceptance deadline approaches (helper fixed, poster hasn't responded)
    const { data: warnAcceptances } = await supabase
      .from("jobs")
      .select("id, title, customer_id, helper_id, revision_acceptance_deadline")
      .eq("status", "revision_requested")
      .not("revision_completed_at", "is", null)
      .not("revision_acceptance_deadline", "is", null)
      .gt("revision_acceptance_deadline", in23h)
      .lte("revision_acceptance_deadline", in24h);

    for (const job of warnAcceptances || []) {
      await supabase.from("notifications").insert([{
        user_id: job.customer_id,
        title: "⏰ Approve or dispute in 24h",
        message: `The helpr fixed "${job.title}". You have 24h to approve or escalate — otherwise payment auto-releases.`,
        type: "warning",
        link: "/my-posts?filter=in_progress",
      }]);
      warned.push(job.id);
    }

    // 1. Revisions where helper didn't fix within 72h → unlock dispute for poster
    const { data: expiredRevisions } = await supabase
      .from("jobs")
      .select("id, title, customer_id, helper_id, revision_deadline")
      .eq("status", "revision_requested")
      .is("revision_completed_at", null)
      .not("revision_deadline", "is", null)
      .lte("revision_deadline", now);

    for (const job of expiredRevisions || []) {
      // Notify poster they can now complete or dispute
      await supabase.from("notifications").insert([
        {
          user_id: job.customer_id,
          title: "Revision deadline expired",
          message: `The helpr did not fix "${job.title}" within 72 hours. You can now mark it complete or file a dispute.`,
          type: "warning",
          link: "/my-posts?filter=revision_requested",
        },
        ...(job.helper_id ? [{
          user_id: job.helper_id,
          title: "Revision deadline expired",
          message: `You did not address the revision for "${job.title}" within 72 hours. The poster may now dispute or complete the job.`,
          type: "warning",
          link: "/my-jobs?filter=revision_requested",
        }] : []),
      ]);
      resolved.push(job.id);
    }

    // 2. Helper completed revision, poster didn't respond within 72h → auto-complete
    const { data: expiredAcceptances } = await supabase
      .from("jobs")
      .select("id, title, customer_id, helper_id, revision_acceptance_deadline")
      .eq("status", "revision_requested")
      .not("revision_completed_at", "is", null)
      .not("revision_acceptance_deadline", "is", null)
      .lte("revision_acceptance_deadline", now);

    const autoCompleted: string[] = [];

    for (const job of expiredAcceptances || []) {
      const { error: updateErr } = await supabase
        .from("jobs")
        .update({
          status: "completed",
          revision_note: null,
        })
        .eq("id", job.id);

      if (updateErr) {
        console.error(`Failed to auto-complete revision for job ${job.id}:`, updateErr);
        continue;
      }

      const notifications = [
        {
          user_id: job.customer_id,
          title: "Revision auto-accepted",
          message: `You did not respond within 72 hours after the helpr fixed "${job.title}". Per policy, the job is marked complete and payment released.`,
          type: "warning",
          link: "/my-posts?filter=completed",
        },
      ];

      if (job.helper_id) {
        notifications.push({
          user_id: job.helper_id,
          title: "Revision auto-accepted ✓",
          message: `The poster did not respond within 72 hours for "${job.title}". Payment will be released to you.`,
          type: "payment",
          link: "/my-jobs?filter=completed",
        });
      }

      await supabase.from("notifications").insert(notifications);
      autoCompleted.push(job.id);
    }

    return new Response(
      JSON.stringify({ warned: warned.length, expired_revisions: resolved.length, auto_completed: autoCompleted.length }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("Auto-resolve revisions error:", err);
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
