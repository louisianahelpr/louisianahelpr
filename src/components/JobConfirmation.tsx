import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHero, DialogFooter } from "@/components/ui/dialog";
import { CheckCircle2, Clock, AlertTriangle, ShieldCheck } from "lucide-react";
import { parseLocalDate } from "@/lib/dateUtils";
import { toast } from "sonner";
import { hapticError, hapticSuccess } from "@/lib/haptics";

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
      hapticError();
      toast.error("We couldn't confirm just now — please try again.");
    } else {
      hapticSuccess();
      toast.success("Confirmed! You're committed to this job.");
      setLocalConfirmedAt(new Date().toISOString());
      onConfirm?.();
      // Notify the other party
      const { data: job, error: jobFetchErr } = await supabase.from("jobs").select("title, customer_id, helper_id").eq("id", jobId).single();
      if (jobFetchErr) {
        console.error("[JobConfirmation] Failed to fetch job for notification:", jobFetchErr.message);
      }
      if (job) {
        const recipientId = isOwner ? job.helper_id : job.customer_id;
        if (recipientId) {
          const { createNotification } = await import("@/lib/notifications");
          await createNotification({
            user_id: recipientId,
            title: isOwner ? "Poster confirmed the job!" : "Helpr confirmed the job!",
            message: `${isOwner ? "The poster" : "The Helpr"} confirmed they're committed to "${job.title}". Tap to confirm your side too.`,
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
        className="rounded-2xl liquid-glass p-5 space-y-3"
        style={{
          background:
            "radial-gradient(80% 100% at 50% 0%, hsl(var(--burnt-sienna) / 0.08) 0%, transparent 60%)",
        }}
      >
        <div>
          <h3
            className="font-display italic font-bold leading-tight text-headline-card"
            style={{ color: "hsl(var(--ink-deep))", letterSpacing: "-0.015em" }}
          >
            Still on for this one?
          </h3>
        </div>
        <p
          className="font-serif italic leading-relaxed text-ds-14"
          style={{ color: "hsl(var(--olivewood) / 0.85)" }}
        >
          Tap to let the other party know it's a go.
          {hoursUntilJob > 0 && ` Scheduled in ${urgencyText}.`}
        </p>
        <p
          className="font-serif italic text-ds-12"
          style={{ color: "hsl(var(--olivewood) / 0.8)" }}
        >
          {jobDate.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" })}
          {hoursUntilJob > 0 && ` · ${urgencyText} away`}
        </p>

        <div className="flex items-center gap-2">
          <span
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-ds-11 font-sans font-semibold"
            style={
              myConfirmed
                ? { background: "hsl(var(--bark) / 0.10)", color: "hsl(var(--bark))", border: "0.5px solid hsl(var(--bark) / 0.22)" }
                : { background: "hsl(var(--olivewood) / 0.08)", color: "hsl(var(--olivewood) / 0.8)" }
            }
          >
            {myConfirmed ? <CheckCircle2 className="w-3 h-3" /> : <Clock className="w-3 h-3" />}
            You: {myConfirmed ? "Confirmed" : "Pending"}
          </span>
          <span
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-ds-11 font-sans font-semibold"
            style={
              otherConfirmed
                ? { background: "hsl(var(--bark) / 0.10)", color: "hsl(var(--bark))", border: "0.5px solid hsl(var(--bark) / 0.22)" }
                : { background: "hsl(var(--olivewood) / 0.08)", color: "hsl(var(--olivewood) / 0.8)" }
            }
          >
            {otherConfirmed ? <CheckCircle2 className="w-3 h-3" /> : <Clock className="w-3 h-3" />}
            {otherLabel}: {otherConfirmed ? "Confirmed" : "Pending"}
          </span>
        </div>

        {myConfirmed && (
          <p className="font-serif italic inline-flex items-center gap-1 text-ds-11" style={{ color: "hsl(var(--bark) / 0.85)" }}>
            <ShieldCheck className="w-3 h-3" />
            Confirmed {new Date(myConfirmed).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
          </p>
        )}

        {!myConfirmed && (isOwner || isHelper) && (
          <Button
            variant="primary"
            size="sm"
            onClick={() => setShowConfirmDialog(true)}
            className="w-full rounded-ds-md"
          >
            <CheckCircle2 className="w-4 h-4 mr-1" />
            I'm Still On
          </Button>
        )}
      </div>

      {/* Confirmation popup */}
      <Dialog open={showConfirmDialog} onOpenChange={setShowConfirmDialog}>
        <DialogContent>
          <DialogHero
            eyebrowClassName="inline-flex items-center gap-1.5"
            eyebrow={
              <>
                <ShieldCheck className="w-3 h-3" /> Locking it in
              </>
            }
            title="Commit to This Job?"
          />
          <div className="space-y-3">
            <div
              className="rounded-ds-md p-3"
              style={{
                background: "hsl(var(--ivory-sand) / 0.4)",
                border: "0.5px solid hsl(var(--olivewood) / 0.10)",
              }}
            >
              <p
                className="font-serif italic uppercase mb-0.5 text-ds-10"
                style={{ color: "hsl(var(--burnt-sienna))", letterSpacing: "0.18em" }}
              >
                Scheduled for
              </p>
              <p
                className="font-display italic font-bold leading-tight text-ds-16"
                style={{ color: "hsl(var(--ink-deep))", letterSpacing: "-0.012em" }}
              >
                {jobDate.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })}
              </p>
            </div>
            <div
              className="rounded-ds-md p-3"
              style={{
                background: "hsl(var(--burnt-sienna) / 0.08)",
                border: "0.5px solid hsl(var(--burnt-sienna) / 0.22)",
              }}
            >
              <p
                className="font-serif italic leading-snug flex items-start gap-2 text-ds-12"
                style={{ color: "hsl(var(--burnt-sienna))" }}
              >
                <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                <span>No-shows or last-minute cancellations after confirming may result in a warning or account restrictions.</span>
              </p>
            </div>
          </div>
          <DialogFooter className="!gap-2">
            <Button variant="ghost" onClick={() => setShowConfirmDialog(false)} className="rounded-ds-md">Cancel</Button>
            <Button
              variant="primary"
              onClick={handleConfirm}
              disabled={confirming}
              className="rounded-ds-md"
            >
              {confirming ? "Confirming…" : "Yes, I Confirm"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
