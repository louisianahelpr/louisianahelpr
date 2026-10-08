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
  const notice = (job as { backout_notice?: BackoutNotice } | null)?.backout_notice;
  return notice ? <BackoutBannerBody notice={notice} /> : null;
}

function BackoutBannerBody({ notice }: { notice: BackoutNotice }) {
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
      <AlertTriangle className="h-4 w-4 shrink-0" style={{ color: "hsl(var(--destructive))" }} aria-hidden />
      <p className="flex-1 min-w-0 text-ds-12 font-semibold" style={{ color: "hsl(var(--destructive))" }}>
        {backoutBannerText(notice)}
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
        Got It
      </Button>
    </div>
  );
}
