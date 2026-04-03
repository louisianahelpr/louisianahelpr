import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";

const reasons = [
  "Spam or scam",
  "Inappropriate content",
  "Harassment or abuse",
  "Fake profile",
  "Other",
];

interface ReportDialogProps {
  open: boolean;
  onClose: () => void;
  reportedType: "job" | "message" | "user" | "profile" | "review";
  reportedId: string;
}

const ReportDialog = ({ open, onClose, reportedType, reportedId }: ReportDialogProps) => {
  const [reason, setReason] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!reason) { toast.error("Please select a reason"); return; }
    if (!description || description.trim().length < 10) { toast.error("Please provide details (at least 10 characters)"); return; }
    setSubmitting(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { toast.error("You must be logged in"); setSubmitting(false); return; }

    const { error } = await supabase.from("reports").insert({
      reporter_id: user.id,
      reported_type: reportedType,
      reported_id: reportedId,
      reason,
      description: description || null,
    });

    if (error) {
      toast.error("Failed to submit report");
    } else {
      toast.success("Report submitted. We'll review it shortly.");
      onClose();
    }
    setSubmitting(false);
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="font-display">Report {reportedType}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">Why are you reporting this?</p>
            <div className="flex flex-wrap gap-2">
              {reasons.map((r) => (
                <button
                  key={r}
                  onClick={() => setReason(r)}
                  className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                    reason === r
                      ? "bg-primary text-primary-foreground"
                      : "bg-secondary text-secondary-foreground hover:bg-secondary/80"
                  }`}
                >
                  {r}
                </button>
              ))}
            </div>
          </div>
          <Textarea
            placeholder="Please describe the issue (required, at least 10 characters)…"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            required
          />
          {description.length > 0 && description.trim().length < 10 && (
            <p className="text-xs text-destructive">At least 10 characters required</p>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={submitting || !reason || description.trim().length < 10}>
            {submitting ? "Submitting…" : "Submit report"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default ReportDialog;
