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
  onConfirm,
}: {
  jobId: string;
  isOwner: boolean;
  isHelper: boolean;
  posterConfirmedAt: string | null;
  helperConfirmedAt: string | null;
  dateNeeded: string;
  jobStatus?: string;
  onConfirm?: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const [localConfirmedAt, setLocalConfirmedAt] = useState<string | null>(null);

  const jobDate = parseLocalDate(dateNeeded);
  const now = new Date();
  const hoursUntilJob = (jobDate.getTime() - now.getTime()) / (1000 * 60 * 60);

  // Show for accepted/in_progress jobs within 24 hours of job date
  const showConfirmation = (jobStatus === "accepted" || jobStatus === "in_progress") && hoursUntilJob <= 24 && hoursUntilJob > -12;
  if (!showConfirmation) return null;

  const handleConfirm = async () => {
    setConfirming(true);
    const field = isOwner ? "poster_confirmed_at" : "helper_confirmed_at";
    const { error } = await supabase
      .from("jobs")
      .update({ [field]: new Date().toISOString() } as any)
      .eq("id", jobId);
    if (error) {
      toast.error("Failed to confirm");
    } else {
      toast.success("Confirmed! You're committed to this job.");
      setLocalConfirmedAt(new Date().toISOString());
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
      <div className="rounded-xl border border-primary/30 bg-primary/5 p-4 space-y-3">
        <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-primary" /> Job Confirmation
        </h3>
        <p className="text-xs text-muted-foreground">
          Please confirm this job is still on so both parties know everything is good to go.
          {hoursUntilJob > 0 && ` Job is in ${urgencyText}.`}
        </p>
        <p className="text-[10px] text-muted-foreground italic">
          This is a reminder — if you don't confirm, the job is still scheduled as planned. However, not confirming may signal to the other party that you're uncertain, and repeated no-shows or last-minute cancellations can result in warnings or account restrictions.
        </p>
        <p className="text-[10px] text-muted-foreground">
          Scheduled: {jobDate.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" })}
          {hoursUntilJob > 0 && ` · ${urgencyText} away`}
        </p>

        <div className="flex items-center gap-3 text-xs">
          <span className={`flex items-center gap-1.5 px-2 py-1 rounded-full ${myConfirmed ? "bg-primary/10 text-primary" : "bg-secondary text-muted-foreground"}`}>
            {myConfirmed ? <CheckCircle2 className="w-3.5 h-3.5" /> : <Clock className="w-3.5 h-3.5" />}
            You: {myConfirmed ? "Confirmed ✓" : "Not confirmed"}
          </span>
          <span className={`flex items-center gap-1.5 px-2 py-1 rounded-full ${otherConfirmed ? "bg-primary/10 text-primary" : "bg-secondary text-muted-foreground"}`}>
            {otherConfirmed ? <CheckCircle2 className="w-3.5 h-3.5" /> : <Clock className="w-3.5 h-3.5" />}
            {otherLabel}: {otherConfirmed ? "Confirmed ✓" : "Not confirmed"}
          </span>
        </div>

        {myConfirmed && (
          <p className="text-[10px] text-primary flex items-center gap-1">
            <ShieldCheck className="w-3 h-3" />
            Confirmed at {new Date(myConfirmed).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
          </p>
        )}

        {!myConfirmed && (isOwner || isHelper) && (
          <Button size="sm" onClick={() => setShowConfirmDialog(true)} className="w-full">
            <CheckCircle2 className="w-4 h-4 mr-1" />
            Confirm Job
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
            <p className="text-sm text-muted-foreground">
              By confirming, you're letting the other party know this job is still on and you'll be ready on the scheduled date.
            </p>
            <div className="rounded-lg bg-muted/50 p-3 space-y-1">
              <p className="text-xs text-muted-foreground">📅 Scheduled for</p>
              <p className="text-sm font-medium text-foreground">
                {jobDate.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" })}
              </p>
            </div>
            <div className="rounded-lg bg-amber-500/10 border border-amber-500/20 p-3">
              <p className="text-xs text-amber-700 flex items-center gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                No-shows or last-minute cancellations after confirming may result in a warning or account restrictions.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setShowConfirmDialog(false)}>Cancel</Button>
            <Button onClick={handleConfirm} disabled={confirming}>
              {confirming ? "Confirming…" : "Yes, I Confirm"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
