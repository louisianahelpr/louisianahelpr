import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { userFacingError } from "@/lib/userFacingError";
import { rpcErrorMessage } from "@/lib/lifecycleErrors";

const NUDGE_RESULT: Record<string, string> = {
  sent: "Nudge sent. We'll let you know when they confirm.",
  too_soon: "You nudged them recently. Try again in a little while.",
  already_confirmed: "They've already confirmed.",
  not_booked: "This job isn't booked any more.",
  account_restricted: "Your account is restricted, so nudges are off.",
};

/**
 * NUDGE (owner, 2026-10-08, answer 1: "helpr and poster can each nudge each
 * other so they can confirm"). A one-line link under the confirm step, shown
 * only while the OTHER side has not confirmed. nudge_confirm decides the rest
 * (once per 2 hours, only while it is owed).
 */
export function NudgeConfirmLink({ jobId, otherLabel }: { jobId: string; otherLabel: string }) {
  const [busy, setBusy] = useState(false);
  return (
    <p className="font-sans text-center text-ds-11" data-nudge-confirm="">
      <span style={{ color: "hsl(var(--olivewood) / 0.8)" }}>{otherLabel} hasn't confirmed yet · </span>
      <button
        type="button"
        disabled={busy}
        className="underline underline-offset-2 font-semibold min-h-[44px]"
        onClick={async (e) => {
          e.stopPropagation();
          setBusy(true);
          try {
            const { data, error } = await supabase.rpc("nudge_confirm", { p_job_id: jobId });
            if (error) throw error;
            const msg = NUDGE_RESULT[String(data)] ?? NUDGE_RESULT.sent;
            if (data === "sent") toast.success(msg);
            else toast.info(msg);
          } catch (err) {
            toast.error(rpcErrorMessage("nudge_confirm", err) ?? userFacingError(err, "Couldn't send the nudge — try again."));
          } finally {
            setBusy(false);
          }
        }}
      >
        Nudge
      </button>
    </p>
  );
}
