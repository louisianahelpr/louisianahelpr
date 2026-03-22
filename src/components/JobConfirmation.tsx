import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { CheckCircle2, Clock, AlertTriangle } from "lucide-react";
import { toast } from "sonner";

export function JobConfirmation({
  jobId,
  isOwner,
  isHelper,
  posterConfirmedAt,
  helperConfirmedAt,
  dateNeeded,
}: {
  jobId: string;
  isOwner: boolean;
  isHelper: boolean;
  posterConfirmedAt: string | null;
  helperConfirmedAt: string | null;
  dateNeeded: string;
}) {
  const [confirming, setConfirming] = useState(false);

  const jobDate = new Date(dateNeeded + "T00:00");
  const now = new Date();
  const hoursUntilJob = (jobDate.getTime() - now.getTime()) / (1000 * 60 * 60);
  const showConfirmation = hoursUntilJob <= 48 && hoursUntilJob > 0;

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
      toast.success("Confirmed! See you there.");
    }
    setConfirming(false);
  };

  const myConfirmed = isOwner ? posterConfirmedAt : helperConfirmedAt;
  const otherConfirmed = isOwner ? helperConfirmedAt : posterConfirmedAt;
  const otherLabel = isOwner ? "Helpr" : "Poster";

  return (
    <div className="rounded-xl border border-primary/30 bg-primary/5 p-4 space-y-3">
      <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
        <AlertTriangle className="w-4 h-4 text-primary" /> 24hr Check-in
      </h3>
      <p className="text-xs text-muted-foreground">
        Job is in {hoursUntilJob < 24 ? "less than 24 hours" : `${Math.round(hoursUntilJob)} hours`}. {isOwner ? "Please confirm this job is still on." : "Please confirm you're still available."}
      </p>

      <div className="flex items-center gap-3 text-xs">
        <span className={`flex items-center gap-1 ${myConfirmed ? "text-primary" : "text-muted-foreground"}`}>
          {myConfirmed ? <CheckCircle2 className="w-3.5 h-3.5" /> : <Clock className="w-3.5 h-3.5" />}
          You: {myConfirmed ? "Confirmed" : "Not confirmed"}
        </span>
        <span className={`flex items-center gap-1 ${otherConfirmed ? "text-primary" : "text-muted-foreground"}`}>
          {otherConfirmed ? <CheckCircle2 className="w-3.5 h-3.5" /> : <Clock className="w-3.5 h-3.5" />}
          {otherLabel}: {otherConfirmed ? "Confirmed" : "Not confirmed"}
        </span>
      </div>

      {!myConfirmed && (isOwner || isHelper) && (
        <Button size="sm" onClick={handleConfirm} disabled={confirming} className="w-full">
          <CheckCircle2 className="w-4 h-4 mr-1" />
          {confirming ? "Confirming…" : "Confirm I'm Available"}
        </Button>
      )}
    </div>
  );
}
