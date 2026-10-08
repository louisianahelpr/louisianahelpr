import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { userFacingError } from "@/lib/userFacingError";
import { rpcErrorMessage } from "@/lib/lifecycleErrors";

/** What the link says after a tap, in its own place. */
export const NUDGE_RESULT: Record<string, string> = {
  sent: "Nudge sent ✓",
  too_soon: "Nudged recently — you can nudge again 2 hours after the last one",
  already_confirmed: "They've already confirmed",
  not_booked: "This job isn't booked any more",
  account_restricted: "Your account is restricted, so nudges are off",
};

/**
 * NUDGE (owner, 2026-10-08, answer 1: "helpr and poster can each nudge each
 * other so they can confirm"). A one-line link on the row's note line, shown
 * only while the OTHER side has not confirmed. nudge_confirm decides the rest
 * (once per 2 hours, only while it is owed).
 *
 * THE ANSWER IS SAID IN PLACE, NEVER BY TOAST (owner, 2026-10-08: "when i
 * click nudge it does nothing"): toastPolicy.ts suppresses every success and
 * info toast app-wide, so "Nudge sent" was never seen. After a tap the link is
 * replaced by what happened. Failures still toast (errors render).
 */
export function NudgeConfirmLink({ jobId, otherLabel }: { jobId: string; otherLabel: string }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  return (
    <p className="font-sans text-center text-ds-11" data-nudge-confirm="">
      <span style={{ color: "hsl(var(--olivewood) / 0.8)" }}>{otherLabel} hasn't confirmed yet · </span>
      {result ? (
        <span className="font-semibold" data-nudge-result="" role="status" style={{ color: "hsl(var(--olivewood))" }}>
          {result}
        </span>
      ) : (
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
              setResult(NUDGE_RESULT[String(data)] ?? NUDGE_RESULT.sent);
            } catch (err) {
              toast.error(rpcErrorMessage("nudge_confirm", err) ?? userFacingError(err, "Couldn't send the nudge — try again."));
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "Sending…" : "Nudge"}
        </button>
      )}
    </p>
  );
}
