import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { CheckCircle2, Clock, AlertTriangle, ShieldCheck } from "lucide-react";
import { parseLocalDate } from "@/lib/dateUtils";
import { toast } from "sonner";

export function JobConfirmation({
  jobId,
  isOwner,
  isHelper,
  posterConfirmedAt,
  helperConfirmedAt,
  dateNeeded,
  jobStatus,
  helperOnTheWayAt,
  onConfirm,
}: {
  jobId: string;
  isOwner: boolean;
  isHelper: boolean;
  posterConfirmedAt: string | null;
  helperConfirmedAt: string | null;
  dateNeeded: string;
  jobStatus?: string;
  helperOnTheWayAt?: string | null;
  onConfirm?: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const [localConfirmedAt, setLocalConfirmedAt] = useState<string | null>(null);

  const jobDate = parseLocalDate(dateNeeded);
  const now = new Date();
  const hoursUntilJob = (jobDate.getTime() - now.getTime()) / (1000 * 60 * 60);

  // Hide once helper is on the way or beyond
  if (helperOnTheWayAt) return null;

  // Show for accepted/in_progress jobs within 24 hours of job date
  const showConfirmation = (jobStatus === "accepted" || jobStatus === "in_progress") && hoursUntilJob <= 24 && hoursUntilJob > -12;
  if (!showConfirmation) return null;

  const handleConfirm = async () => {
    setConfirming(true);
    const field = isOwner ? "poster_confirmed_at" : "helper_confirmed_at";
    // Cast: Supabase generated types reject computed-key updates because the
    // index signature widens to `[x: string]: never`. Runtime accepts any
    // valid column name; the `field` variable is constrained above to one of
    // two known column names.
    const { error } = await supabase
      .from("jobs")
      .update({ [field]: new Date().toISOString() } as never)
      .eq("id", jobId);
    if (error) {
      toast.error("Failed to confirm");
    } else {
      toast.success("Confirmed! You're committed to this job.");
      setLocalConfirmedAt(new Date().toISOString());
      onConfirm?.();
      // Notify the other party
      const { data: job } = await supabase.from("jobs").select("title, customer_id, helper_id").eq("id", jobId).single();
      if (job) {
        const recipientId = isOwner ? job.helper_id : job.customer_id;
        if (recipientId) {
          const { createNotification } = await import("@/lib/notifications");
          await createNotification({
            user_id: recipientId,
            title: isOwner ? "Poster confirmed the job!" : "Helpr confirmed the job!",
            message: `${isOwner ? "The poster" : "The helpr"} confirmed they're committed to "${job.title}". Tap to confirm your side too.`,
            type: "info",
            link: isOwner ? `/my-jobs?filter=offered` : `/my-posts?filter=offered`,
          });
        }
      }
    }
    setConfirming(false);
    setShowConfirmDialog(false);
  };

  const myConfirmed = localConfirmedAt || (isOwner ? posterConfirmedAt : helperConfirmedAt);
  const otherConfirmed = isOwner ? helperConfirmedAt : posterConfirmedAt;
  const otherLabel = isOwner ? "Helpr" : "Poster";

  const urgencyText = hoursUntilJob <= 0
    ? "Job date has passed"
    : hoursUntilJob < 24
    ? "less than 24 hours"
    : `${Math.round(hoursUntilJob)} hours`;

  return (
    <>
      <div
        className="rounded-2xl liquid-glass p-4 space-y-3"
        style={{
          background:
            "radial-gradient(80% 100% at 50% 0%, hsl(var(--burnt-sienna) / 0.08) 0%, transparent 60%)",
        }}
      >
        <div>
          <span
            className="font-serif italic uppercase inline-flex items-center gap-1.5"
            style={{ fontSize: "0.62rem", color: "hsl(var(--burnt-sienna) / 0.78)", letterSpacing: "0.18em" }}
          >
            <AlertTriangle className="w-3 h-3" /> Quick check-in
          </span>
          <h3
            className="font-display italic font-bold leading-tight mt-1"
            style={{ fontSize: "1.05rem", color: "hsl(var(--ink-deep))", letterSpacing: "-0.015em" }}
          >
            Still on for this one?
          </h3>
        </div>
        <p
          className="font-serif italic leading-relaxed"
          style={{ fontSize: "0.85rem", color: "hsl(var(--olivewood) / 0.85)" }}
        >
          Tap to let the other party know it's a go.
          {hoursUntilJob > 0 && ` Scheduled in ${urgencyText}.`}
        </p>
        <p
          className="font-serif italic"
          style={{ fontSize: "0.74rem", color: "hsl(var(--olivewood) / 0.65)" }}
        >
          {jobDate.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" })}
          {hoursUntilJob > 0 && ` · ${urgencyText} away`}
        </p>

        <div className="flex items-center gap-2">
          <span
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[0.7rem] font-sans font-semibold"
            style={
              myConfirmed
                ? { background: "hsl(var(--bark) / 0.10)", color: "hsl(var(--bark))", border: "0.5px solid hsl(var(--bark) / 0.22)" }
                : { background: "hsl(var(--olivewood) / 0.08)", color: "hsl(var(--olivewood) / 0.75)" }
            }
          >
            {myConfirmed ? <CheckCircle2 className="w-3 h-3" /> : <Clock className="w-3 h-3" />}
            You: {myConfirmed ? "Confirmed" : "Pending"}
          </span>
          <span
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[0.7rem] font-sans font-semibold"
            style={
              otherConfirmed
                ? { background: "hsl(var(--bark) / 0.10)", color: "hsl(var(--bark))", border: "0.5px solid hsl(var(--bark) / 0.22)" }
                : { background: "hsl(var(--olivewood) / 0.08)", color: "hsl(var(--olivewood) / 0.75)" }
            }
          >
            {otherConfirmed ? <CheckCircle2 className="w-3 h-3" /> : <Clock className="w-3 h-3" />}
            {otherLabel}: {otherConfirmed ? "Confirmed" : "Pending"}
          </span>
        </div>

        {myConfirmed && (
          <p className="font-serif italic inline-flex items-center gap-1" style={{ fontSize: "0.7rem", color: "hsl(var(--bark) / 0.85)" }}>
            <ShieldCheck className="w-3 h-3" />
            Confirmed {new Date(myConfirmed).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
          </p>
        )}

        {!myConfirmed && (isOwner || isHelper) && (
          <Button
            size="sm"
            onClick={() => setShowConfirmDialog(true)}
            className="w-full rounded-ds-md"
            style={{
              background: "hsl(var(--bark))",
              backgroundImage: "none",
              border: "1px solid hsl(var(--bark))",
              color: "hsl(var(--parchment))",
              fontFamily: "Montserrat, system-ui, sans-serif",
              fontWeight: 600,
              letterSpacing: "0.01em",
              boxShadow: "0 1px 2px hsl(var(--bark) / 0.18), 0 8px 20px -6px hsl(var(--bark) / 0.34)",
            }}
          >
            <CheckCircle2 className="w-4 h-4 mr-1" />
            I'm still on
          </Button>
        )}
      </div>

      {/* Confirmation popup */}
      <Dialog open={showConfirmDialog} onOpenChange={setShowConfirmDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="font-display flex items-center gap-2">
              <ShieldCheck className="w-5 h-5 text-primary" />
              Confirm This Job
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-ds-11 text-muted-foreground">
              By confirming, you're letting the other party know this job is still on and you'll be ready on the scheduled date.
            </p>
            <div className="rounded-lg bg-muted/50 p-3 space-y-1">
              <p className="text-ds-11 text-muted-foreground">📅 Scheduled for</p>
              <p className="text-ds-13 font-medium text-foreground">
                {jobDate.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" })}
              </p>
            </div>
            <div className="rounded-lg bg-amber-500/10 border border-amber-500/20 p-3">
              <p className="text-ds-11 text-amber-700 flex items-center gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                No-shows or last-minute cancellations after confirming may result in a warning or account restrictions.
              </p>
            </div>
          </div>
          <DialogFooter className="!gap-2">
            <Button variant="ghost" onClick={() => setShowConfirmDialog(false)} className="rounded-ds-md">Cancel</Button>
            <Button
              onClick={handleConfirm}
              disabled={confirming}
              className="rounded-ds-md"
              style={{
                background: "hsl(var(--bark))",
                backgroundImage: "none",
                border: "1px solid hsl(var(--bark))",
                color: "hsl(var(--parchment))",
                fontFamily: "Montserrat, system-ui, sans-serif",
                fontWeight: 600,
                letterSpacing: "0.01em",
                boxShadow: "0 1px 2px hsl(var(--bark) / 0.18), 0 8px 20px -6px hsl(var(--bark) / 0.34)",
              }}
            >
              {confirming ? "Confirming…" : "Yes, I confirm"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
