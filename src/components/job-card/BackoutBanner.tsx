import { useState } from "react";
import { AlertTriangle } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ackBackoutNotice, backoutBannerText, type BackoutNotice } from "@/lib/backoutNotices";
import { userFacingError } from "@/lib/userFacingError";

/**
 * THE RED BANNER (owner, 2026-10-08, Q1575: "the other person needs to be very
 * aware so they don't show up or expect someone"). On the card, collapsed and
 * expanded, until Got It; the card stays in Needs You until then.
 */
export function BackoutBanner({ job }: { job: object | null | undefined }) {
  const j = job as { backout_notice?: BackoutNotice; payment_status?: string | null } | null;
  const notice = j?.backout_notice;
  return notice ? <BackoutBannerBody notice={notice} moneyHeld={j?.payment_status === "escrow"} /> : null;
}

/**
 * Board 144 (copy only): when the Helpr cancels a paid job, say where the
 * money is. The helper_cancelled notice is written by the record_backout_notice
 * trigger on a reopen of a confirmed job the poster did not make (helper_cancel_booking,
 * helper_abort_job, settle_one_off_jobs_for_banned_account, a Helpr's
 * block_user_and_settle; A2-B15), and every one of those leaves payment_status alone
 * (lh-money-escrow review, 2026-10-21). Shown only while the job's payment
 * really is held (`escrow`), read live from the job.
 */
export function backoutMoneyLine(kind: BackoutNotice["backout_kind"], moneyHeld: boolean): string | null {
  return kind === "helper_cancelled" && moneyHeld ? "Your payment stays held for whoever you hire next." : null;
}

function BackoutBannerBody({ notice, moneyHeld }: { notice: BackoutNotice; moneyHeld: boolean }) {
  const moneyLine = backoutMoneyLine(notice.backout_kind, moneyHeld);
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  return (
    <div
      role="alert"
      data-backout-banner
      onClick={(e) => e.stopPropagation()}
      className="mx-3 mt-3 flex items-center gap-2 rounded-ds-md px-3 py-2"
      style={{ background: "hsl(var(--destructive) / 0.12)", border: "1px solid hsl(var(--destructive) / 0.45)" }}
    >
      <AlertTriangle className="h-4 w-4 shrink-0" style={{ color: "hsl(var(--destructive-ink))" }} aria-hidden />
      <p className="flex-1 min-w-0 text-ds-12 font-semibold" style={{ color: "hsl(var(--destructive-ink))" }}>
        {backoutBannerText(notice)}
        {moneyLine ? (
          <span className="block mt-0.5 font-medium" style={{ color: "hsl(var(--accent-ink))" }}>{moneyLine}</span>
        ) : null}
      </p>
      <Button
        size="sm"
        variant="outline"
        disabled={busy}
        className="shrink-0"
        onClick={async () => {
          setBusy(true);
          try {
            await ackBackoutNotice(notice.id);
            await queryClient.invalidateQueries({ queryKey: ["activity"] });
          } catch (err) {
            toast.error(userFacingError(err, "Couldn't clear that — try again."));
          } finally {
            setBusy(false);
          }
        }}
      >
        Got it
      </Button>
    </div>
  );
}
