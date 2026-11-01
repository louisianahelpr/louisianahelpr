import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Timer, XCircle, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import BrandConfirmDialog from "@/components/ui/BrandConfirmDialog";
import { supabase } from "@/integrations/supabase/client";
import { withCardHoldCapture } from "@/lib/cardHoldCapture";
import { queryKeys } from "@/lib/queryKeys";
import { BOOKING_ENDED_COPY, declineTimeLeft, declineUntilClock, INSTANT_BOOK_GENERIC_ERROR } from "@/lib/instantBook";
import { rpcErrorCode, rpcErrorMessage } from "@/lib/lifecycleErrors";

export type InstantBookingOutcome = "confirmed" | "declined" | "ended" | "booked_now";

/** What the card says after an answer, in plain words. */
export const INSTANT_OUTCOME_COPY: Record<InstantBookingOutcome, { title: string; body: string }> = {
  confirmed: { title: "You're booked", body: "You confirmed. The job is yours. It's on your schedule now." },
  declined: { title: "Booking declined", body: "No strike, and nothing is owed. You won't be booked for this job again." },
  ended: { title: "Your booking ended", body: BOOKING_ENDED_COPY },
  booked_now: { title: "You're booked", body: "The 2 hours to decline have ended, so you're booked." },
};

/**
 * CMP-4, the Helpr's side: an instant booking waiting out its 2-hour decline
 * window. Confirm is the direct-offer accept (respond_to_direct_offer through
 * create-payment capture_hold: the poster's held card is charged then, and the
 * hire completes). Decline is rpc_instant_book_decline: no strike, nothing
 * charged, the job opens again for other Helprs. The countdown ticks each
 * minute; past it the buttons go (the sweep hires them).
 */
export function InstantBookingCard({ jobId, title, declineUntil, now: fixedNow }: { jobId: string; title: string; declineUntil: string; now?: number }) {
  const qc = useQueryClient();
  const [now, setNow] = useState(() => fixedNow ?? Date.now());
  useEffect(() => {
    if (fixedNow != null) return;
    const t = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(t);
  }, [fixedNow]);
  const [busy, setBusy] = useState<"confirm" | "decline" | null>(null);
  const [confirmDecline, setConfirmDecline] = useState(false);
  const [outcome, setOutcome] = useState<InstantBookingOutcome | null>(null);
  const [error, setError] = useState<string | null>(null);
  const left = declineTimeLeft(declineUntil, now);

  const done = (o: InstantBookingOutcome) => {
    setOutcome(o);
    setError(null);
    void qc.invalidateQueries({ queryKey: queryKeys.jobs.all });
  };

  const onConfirm = async () => {
    setBusy("confirm");
    const res = await withCardHoldCapture(jobId, () => supabase.rpc("respond_to_direct_offer", { p_job_id: jobId, p_accept: true }), { knownHeld: true });
    setBusy(null);
    if (!res.error) return done("confirmed");
    if (res.holdMessage === BOOKING_ENDED_COPY) return done("ended");
    setError(res.holdMessage ?? rpcErrorMessage("respond_to_direct_offer", res.error) ?? INSTANT_BOOK_GENERIC_ERROR);
  };

  const onDecline = async () => {
    setBusy("decline");
    const { error: e } = await supabase.rpc("rpc_instant_book_decline", { p_job_id: jobId });
    setBusy(null);
    setConfirmDecline(false);
    if (!e) return done("declined");
    if (rpcErrorCode("rpc_instant_book_decline", e) === "decline_window_closed") return done("booked_now");
    setError(rpcErrorMessage("rpc_instant_book_decline", e) ?? INSTANT_BOOK_GENERIC_ERROR);
  };

  if (outcome) {
    const c = INSTANT_OUTCOME_COPY[outcome];
    const Icon = outcome === "confirmed" || outcome === "booked_now" ? CheckCircle2 : XCircle;
    return (
      <div data-instant-outcome={outcome} role="status" className="rounded-2xl border border-border bg-card p-4 space-y-1">
        <p className="flex items-center gap-2 text-ds-15 font-semibold"><Icon className="h-4 w-4 text-primary" aria-hidden /> {c.title}</p>
        <p className="text-ds-14 text-muted-foreground">{c.body}</p>
      </div>
    );
  }

  return (
    <div data-instant-booking={jobId} className="rounded-2xl border border-border bg-card p-4 space-y-3">
      <div className="space-y-1">
        <p className="flex items-center gap-2 text-ds-15 font-semibold"><Zap className="h-4 w-4 text-primary" aria-hidden /> You&apos;re booked</p>
        <p className="text-ds-14 text-muted-foreground">
          You were booked for &ldquo;{title}&rdquo;.{" "}
          {left
            ? <>Can&apos;t make it? Decline by {declineUntilClock(declineUntil)}. No strike, and nothing is charged.</>
            : null}
        </p>
      </div>
      <p data-instant-countdown="" className="flex items-center gap-1.5 rounded-ds-sm px-2 py-1.5 text-ds-13 font-semibold tabular-nums"
        style={{ background: "hsl(var(--amber-tint) / 0.15)", color: "hsl(var(--amber-ink))" }}>
        <Timer className="h-4 w-4 shrink-0" aria-hidden />
        {left ? `${left} to decline` : "The 2 hours to decline have ended, so you're booked."}
      </p>
      {error && <p role="alert" className="text-ds-14" style={{ color: "hsl(var(--destructive-ink))" }}>{error}</p>}
      {left && (
        <div className="flex gap-2">
          <Button className="flex-1 rounded-full" disabled={busy !== null} onClick={() => void onConfirm()}>
            {busy === "confirm" ? "Confirming…" : "Confirm"}
          </Button>
          <Button variant="outline" className="flex-1 rounded-full" disabled={busy !== null} onClick={() => setConfirmDecline(true)}>
            {busy === "decline" ? "Declining…" : "Decline"}
          </Button>
        </div>
      )}
      <BrandConfirmDialog
        open={confirmDecline}
        onOpenChange={setConfirmDecline}
        title="Decline this booking?"
        description="No strike, and nothing is charged. The job opens again for other Helprs, and you won't be booked for it again."
        primaryLabel={busy === "decline" ? "Declining…" : "Decline"}
        primaryDisabled={busy !== null}
        onPrimary={(e) => { e.preventDefault(); void onDecline(); }}
        secondaryLabel="Keep it"
      />
    </div>
  );
}
