import { useState } from "react";
import { createNotification } from "@/lib/notifications";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { AlertTriangle, Upload, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

const DISPUTE_REASONS = [
  { value: "work_not_done", label: "Work was not done" },
  { value: "poor_quality", label: "Poor quality work" },
  { value: "no_show", label: "Helpr didn't show up" },
  { value: "incomplete", label: "Work was left incomplete" },
  { value: "other", label: "Other" },
];

interface DisputeDialogProps {
  jobId: string;
  jobTitle: string;
  userId: string;
  open: boolean;
  onClose: () => void;
  onDisputed: () => void;
}

export const DisputeDialog = ({ jobId, jobTitle, userId, open, onClose, onDisputed }: DisputeDialogProps) => {
  const [reason, setReason] = useState("");
  const [details, setDetails] = useState("");
  const [evidenceFiles, setEvidenceFiles] = useState<File[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    setEvidenceFiles((prev) => [...prev, ...files].slice(0, 5));
  };

  const removeFile = (index: number) => {
    setEvidenceFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = async () => {
    if (!reason) {
      toast.error("Please select a reason");
      return;
    }
    setSubmitting(true);
    try {
      // Upload evidence photos
      const evidenceUrls: string[] = [];
      for (const file of evidenceFiles) {
        const ext = file.name.split(".").pop();
        const path = `disputes/${jobId}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
        const { error: uploadError } = await supabase.storage.from("proof-photos").upload(path, file);
        if (uploadError) {
          console.error("Upload error:", uploadError);
          continue;
        }
        const { data: urlData } = supabase.storage.from("proof-photos").getPublicUrl(path);
        evidenceUrls.push(urlData.publicUrl);
      }

      // Update job status to disputed
      const { error } = await supabase.from("jobs").update({
        status: "disputed" as any,
        dispute_reason: `${DISPUTE_REASONS.find((r) => r.value === reason)?.label}: ${details}`.trim(),
        dispute_evidence_urls: evidenceUrls,
        disputed_at: new Date().toISOString(),
        disputed_by: userId,
      } as any).eq("id", jobId);

      if (error) throw error;

      // Notify admins
      const { data: adminRoles } = await supabase.from("user_roles").select("user_id").eq("role", "admin");
      if (adminRoles) {
        for (const admin of adminRoles) {
          await supabase.from("notifications").insert({
            user_id: admin.user_id,
            title: "🚨 Job disputed",
            message: `"${jobTitle}" has been disputed. Reason: ${DISPUTE_REASONS.find((r) => r.value === reason)?.label}. Payment is on hold pending review.`,
            type: "warning",
            link: "/admin",
          });
        }
      }

      toast.success("Dispute submitted. Payment is on hold pending admin review.");
      onDisputed();
      onClose();
    } catch (err: any) {
      toast.error(err.message || "Failed to submit dispute");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="font-display flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-destructive" /> Dispute Job
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Disputing this job will put the payment on hold until an admin reviews it. Please provide details about the issue.
          </p>

          <div className="space-y-2">
            <Label>Reason</Label>
            <Select value={reason} onValueChange={setReason}>
              <SelectTrigger>
                <SelectValue placeholder="Select a reason..." />
              </SelectTrigger>
              <SelectContent>
                {DISPUTE_REASONS.map((r) => (
                  <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Details (optional)</Label>
            <Textarea
              value={details}
              onChange={(e) => setDetails(e.target.value)}
              placeholder="Describe what happened..."
              rows={3}
              maxLength={1000}
            />
          </div>

          <div className="space-y-2">
            <Label>Photo evidence (optional, up to 5)</Label>
            <div className="flex flex-wrap gap-2">
              {evidenceFiles.map((file, i) => (
                <div key={i} className="flex items-center gap-1 text-xs bg-secondary px-2 py-1 rounded-md">
                  <span className="truncate max-w-[120px]">{file.name}</span>
                  <button onClick={() => removeFile(i)} className="text-muted-foreground hover:text-destructive">
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
            {evidenceFiles.length < 5 && (
              <label className="inline-flex items-center gap-1.5 text-sm text-primary cursor-pointer hover:underline">
                <Upload className="w-4 h-4" /> Add photos
                <input type="file" accept="image/*" multiple onChange={handleFileChange} className="hidden" />
              </label>
            )}
          </div>

          <div className="p-3 rounded-lg bg-destructive/5 border border-destructive/20">
            <p className="text-xs text-destructive font-medium">What happens next:</p>
            <ul className="text-xs text-muted-foreground mt-1 space-y-0.5 list-disc pl-4">
              <li>Payment stays on hold (no capture or transfer)</li>
              <li>An admin will review and reach a resolution</li>
              <li>Both parties will be notified of the outcome</li>
            </ul>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="destructive" onClick={handleSubmit} disabled={submitting || !reason}>
            {submitting ? "Submitting…" : "Submit Dispute"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
