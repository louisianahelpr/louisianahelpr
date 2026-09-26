import { supabase } from "@/integrations/supabase/client";
import { report } from "@/lib/errorLogger";
import { toast } from "sonner";

/**
 * Reports a blocked (off-platform-contact) message to the server and tells the
 * user honestly what happened.
 *
 * This function used to RUN the ladder: it counted prior violations, and on a
 * second offence it inserted a `permanent` row into user_bans and set the
 * user's own `profiles.ban_status = 'permanently_banned'` — all from the
 * OFFENDER'S OWN CLIENT, with `banned_by` pointing at the offender. That made
 * the harshest action this product can take both bypassable (a modified client
 * just doesn't run it) and unreviewable (no human ever saw the case), and two
 * scanner false positives were enough to kill a legitimate account.
 *
 * The escalation now lives in `apply_message_violation_consequence`
 * (20260825183000_message_violation_ladder_human_review.sql), SECURITY DEFINER
 * and scoped to auth.uid():
 *   1st  → recorded + courtesy warning
 *   2nd  → final warning
 *   3rd+ → recorded as `pending_ban_review` + a REVERSIBLE 7-day restriction,
 *          routed to an admin at /admin?view=banreview. No automatic
 *          permanent ban.
 * The client's only job is to call it and surface the verdict.
 */
export const logViolation = async (
  userId: string | null,
  _cachedUser: { user_metadata?: { full_name?: string } } | null | undefined,
  violationDescription: string,
  blockedContent: string,
) => {
  if (!userId) return;

  const { data, error } = await supabase.rpc("apply_message_violation_consequence", {
    p_description: violationDescription,
    p_content: blockedContent,
  });

  if (error) {
    // PGRST202 = the RPC isn't deployed yet (the window between merge and
    // db-deploy finishing). The message is still blocked either way — the
    // scanner refused it before we got here, and the server-side
    // scan_message_content trigger hides + fraud-flags anything that lands.
    // So degrade to "blocked, not recorded" rather than pretending otherwise,
    // and never fall back to a client-side ban.
    const code = (error as { code?: string }).code;
    report(error, {
      severity: code === "PGRST202" ? "warning" : "error",
      tags: { source: "Messages.logViolation.rpc" },
    });
    return;
  }

  const action = (data as { action?: string } | null)?.action;

  if (action === "warning") {
    // The RPC's own verdict, not the client's guess (docs/OPEN.md queue #1
    // residual, 2026-09-15): the send handler's immediate toast is neutral
    // ("remove contact details…") because the client scanner also flags
    // phrases ("my number", "my email") the server's contact_leak_reason
    // does not act on. Only THIS response — the server having actually
    // recorded a first strike — earns the "first warning" wording.
    toast.error(
      // Honest copy: a second offence is a FINAL WARNING, not a ban. The
      // ladder (apply_message_violation_consequence, 20260825183000) runs
      // warning → final warning → 7-day restriction + admin review, and a
      // permanent ban only ever comes from a person confirming it.
      "Sharing contact info or taking business off-platform isn't allowed. This is your first warning — a second one is a final warning.",
      { duration: 8000 },
    );
  } else if (action === "final_warning") {
    toast.error(
      "Final warning — that's your second blocked message. One more and your account is restricted for 7 days while an admin reviews it.",
      { duration: 9000 },
    );
  } else if (action === "pending_ban_review") {
    toast.error(
      "Your account is restricted for 7 days while an admin reviews it. If you think this was a mistake, email admin@louisianahelpr.com.",
      { duration: 10000 },
    );
  }
  // 'duplicate' means this exact message was already counted, and
  // 'not_flagged' (20260915020258) means the server rule does not flag this
  // text (a client-only phrase like "my number") — neither earns a strike
  // toast on top of the neutral notice the send handler already showed.
};
