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
 * (20260825160000_message_violation_ladder_human_review.sql), SECURITY DEFINER
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

  // `as any`: the RPC ships with this change's migration, so the generated
  // types.ts doesn't know it yet — same escape hatch the business RPCs use.
  const { data, error } = await supabase.rpc(
    "apply_message_violation_consequence" as any,
    { p_description: violationDescription, p_content: blockedContent } as any,
  );

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

  if (action === "final_warning") {
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
  // 'warning' is already covered by the first-offence toast the send handler
  // shows, and 'duplicate' means this exact message was already counted —
  // neither needs a second toast on top.
};
