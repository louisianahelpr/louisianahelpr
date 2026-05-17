import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ShieldAlert, AlertTriangle, EyeOff, UserX, UserMinus, MoreHorizontal, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { hapticMedium, hapticSuccess, hapticError } from "@/lib/haptics";

const reasons = [
  { label: "Spam or scam", Icon: AlertTriangle },
  { label: "Inappropriate content", Icon: EyeOff },
  { label: "Harassment or abuse", Icon: UserX },
  { label: "Fake profile", Icon: UserMinus },
  { label: "Other", Icon: MoreHorizontal },
] as const;

const MIN_LENGTH = 10;
const MAX_LENGTH = 500;

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

  const trimmedLength = description.trim().length;
  const tooShort = trimmedLength > 0 && trimmedLength < MIN_LENGTH;
  const charsLeft = MAX_LENGTH - description.length;
  const canSubmit = !!reason && trimmedLength >= MIN_LENGTH && !submitting;

  const handleSubmit = async () => {
    if (!reason) { hapticError(); toast.error("Pick a reason first"); return; }
    if (trimmedLength < MIN_LENGTH) { hapticError(); toast.error(`Add at least ${MIN_LENGTH} characters of detail`); return; }
    hapticMedium();
    setSubmitting(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { toast.error("You must be logged in"); setSubmitting(false); return; }

    const { error } = await supabase.from("reports").insert({
      reporter_id: user.id,
      reported_type: reportedType,
      reported_id: reportedId,
      reason,
      description: description.trim() || null,
    });

    if (error) {
      hapticError();
      toast.error("Failed to submit report");
    } else {
      hapticSuccess();
      toast.success("Report submitted. We'll review it shortly.");
      setReason("");
      setDescription("");
      onClose();
    }
    setSubmitting(false);
  };

  const handleClose = () => {
    if (submitting) return;
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) handleClose(); }}>
      <DialogContent className="max-w-md gap-3">
        <DialogHeader className="!text-left space-y-0 pr-8">
          <span
            className="font-serif italic uppercase text-[0.62rem] inline-flex items-center gap-1.5"
            style={{ color: "hsl(var(--burnt-sienna) / 0.78)", letterSpacing: "0.18em" }}
          >
            <ShieldAlert className="w-3 h-3" strokeWidth={2} aria-hidden="true" />
            Safety &amp; trust
          </span>
          <DialogTitle
            className="font-display italic font-bold leading-tight mt-1"
            style={{
              fontSize: "clamp(1.35rem, 2vw + 0.4rem, 1.65rem)",
              color: "hsl(var(--ink-deep))",
              letterSpacing: "-0.025em",
            }}
          >
            Report {reportedType}
          </DialogTitle>
          <p
            className="font-serif italic mt-1 text-[0.82rem] leading-relaxed"
            style={{ color: "hsl(var(--olivewood) / 0.7)" }}
          >
            Tell us what's going on. Our trust team reviews every report.
          </p>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <p
              className="font-serif italic uppercase text-[0.6rem]"
              style={{ color: "hsl(var(--olivewood) / 0.65)", letterSpacing: "0.16em" }}
            >
              Why are you reporting this?
            </p>
            <div className="flex flex-wrap gap-1.5">
              {reasons.map(({ label, Icon }) => {
                const active = reason === label;
                return (
                  <button
                    key={label}
                    type="button"
                    onClick={() => setReason(label)}
                    aria-pressed={active}
                    className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-ds-md text-[12.5px] font-medium transition-all active:scale-[0.97] ${
                      active
                        ? "bg-primary/10 text-primary border border-primary/35 shadow-[0_1px_2px_hsl(var(--primary)/0.10)]"
                        : "bg-white text-foreground border border-border/60 hover:bg-secondary/40 hover:border-border"
                    }`}
                  >
                    <Icon
                      className={`w-3.5 h-3.5 shrink-0 ${active ? "text-primary" : "text-muted-foreground"}`}
                      strokeWidth={active ? 2.25 : 2}
                      aria-hidden="true"
                    />
                    {label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="space-y-1.5">
            <Textarea
              aria-label="Report description"
              placeholder="Share what happened — dates, screenshots references, anything specific helps our team."
              value={description}
              onChange={(e) => setDescription(e.target.value.slice(0, MAX_LENGTH))}
              rows={4}
              required
              className="rounded-ds-md border-border/60 bg-white/80 focus-visible:bg-white focus-visible:border-primary/40 focus-visible:ring-2 focus-visible:ring-primary/15 text-[14px] leading-relaxed resize-none"
            />
            <div className="flex items-center justify-between text-[11px]">
              <span
                className={
                  tooShort
                    ? "text-destructive font-medium"
                    : "text-muted-foreground"
                }
              >
                {tooShort
                  ? `${MIN_LENGTH - trimmedLength} more character${MIN_LENGTH - trimmedLength === 1 ? "" : "s"} required`
                  : trimmedLength === 0
                  ? `At least ${MIN_LENGTH} characters`
                  : "Looks good"}
              </span>
              <span
                className="tabular-nums"
                style={{
                  color: charsLeft < 50
                    ? "hsl(var(--burnt-sienna))"
                    : "hsl(var(--muted-foreground))",
                }}
              >
                {charsLeft}
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 pt-1">
          <Button
            type="button"
            variant="ghost"
            onClick={handleClose}
            disabled={submitting}
            className="h-10 px-4 rounded-ds-md"
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="h-10 px-4 rounded-ds-md"
            style={
              canSubmit
                ? {
                    background: "hsl(var(--bark))",
                    backgroundImage: "none",
                    border: "1px solid hsl(var(--bark))",
                    color: "hsl(var(--parchment))",
                    fontFamily: "Montserrat, system-ui, sans-serif",
                    fontWeight: 600,
                    letterSpacing: "0.01em",
                    boxShadow: "0 1px 2px hsl(var(--bark) / 0.18), 0 8px 20px -6px hsl(var(--bark) / 0.34)",
                  }
                : undefined
            }
          >
            {submitting ? (
              <span className="inline-flex items-center gap-1.5">
                <Loader2 className="w-4 h-4 animate-spin" />
                Submitting…
              </span>
            ) : (
              "Submit report"
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default ReportDialog;
