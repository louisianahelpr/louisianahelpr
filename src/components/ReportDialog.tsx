import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHero } from "@/components/ui/dialog";
import {
  ShieldAlert,
  AlertTriangle,
  EyeOff,
  UserX,
  UserMinus,
  MoreHorizontal,
  Loader2,
  Check,
  ChevronLeft,
  Copy,
} from "lucide-react";
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

type Step = "reason" | "details" | "confirmation";

interface ReportDialogProps {
  open: boolean;
  onClose: () => void;
  reportedType: "job" | "message" | "user" | "profile" | "review";
  reportedId: string;
}

/**
 * Multi-step report flow:
 *   1) Reason picker — single tap, advances to details automatically so
 *      the user never wonders "what's next" after picking.
 *   2) Details — required free-text with the same 10/500-char guardrails
 *      the old flow had, plus a back button so the picker is reversible.
 *   3) Confirmation — visible case # + "what happens next" copy. The
 *      case # is the first 8 chars of the inserted report row's UUID
 *      (uppercased), giving the user something concrete to reference if
 *      they DM support. The dialog auto-closes after a successful
 *      confirmation only when the user explicitly taps "Done".
 *
 * Kept inside the existing Dialog primitive so a) screen-reader focus
 * traps and b) the brand visual style are unchanged. Only the body
 * morphs as the user progresses.
 */
const ReportDialog = ({ open, onClose, reportedType, reportedId }: ReportDialogProps) => {
  const [step, setStep] = useState<Step>("reason");
  const [reason, setReason] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [caseNumber, setCaseNumber] = useState<string | null>(null);

  // Reset the wizard whenever the dialog opens. Without this a second
  // open after a confirmation would still show the case # screen.
  useEffect(() => {
    if (open) {
      setStep("reason");
      setReason("");
      setDescription("");
      setCaseNumber(null);
      setSubmitting(false);
    }
  }, [open]);

  const trimmedLength = description.trim().length;
  const tooShort = trimmedLength > 0 && trimmedLength < MIN_LENGTH;
  const charsLeft = MAX_LENGTH - description.length;
  const canSubmit = !!reason && trimmedLength >= MIN_LENGTH && !submitting;

  const handleSubmit = async () => {
    if (!reason) { hapticError(); toast.error("Pick a reason first."); return; }
    if (trimmedLength < MIN_LENGTH) { hapticError(); toast.error(`Add at least ${MIN_LENGTH} characters of detail.`); return; }
    hapticMedium();
    setSubmitting(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { toast.error("You must be logged in."); setSubmitting(false); return; }

    const { data, error } = await supabase
      .from("reports")
      .insert({
        reporter_id: user.id,
        reported_type: reportedType,
        reported_id: reportedId,
        reason,
        description: description.trim() || null,
      })
      .select("id")
      .single();

    if (error || !data) {
      hapticError();
      toast.error("We couldn't send your report — please try again.");
      setSubmitting(false);
      return;
    }
    hapticSuccess();
    // Display-friendly case #: first 8 hex chars of the inserted UUID,
    // uppercased with an HLP- prefix so it reads as a reference number
    // rather than a half-leaked database id.
    const shortId = String(data.id).replace(/-/g, "").slice(0, 8).toUpperCase();
    setCaseNumber(`HLP-${shortId}`);
    setStep("confirmation");
    setSubmitting(false);
  };

  const handleClose = () => {
    if (submitting) return;
    onClose();
  };

  const copyCaseNumber = async () => {
    if (!caseNumber) return;
    try {
      await navigator.clipboard?.writeText(caseNumber);
      hapticSuccess();
    } catch {
      hapticError();
      toast.error("Couldn't copy — long-press the number to select it.");
    }
  };

  // Step header — eyebrow morphs by step so the user knows which slice
  // of the wizard they're in.
  const eyebrow =
    step === "reason" ? "Step 1 of 2 · Pick a reason" :
    step === "details" ? "Step 2 of 2 · Add details" :
    "Report submitted";
  // Title Case, per PLATFORM_CONVENTIONS §1 (popup titles). This is why the
  // 2026-08-24 casing sweep missed it: the title is COMPUTED from the
  // reportedType union, so the literal "Report User" never appears in source
  // for a lexical grep to find — it rendered "Report user", "Report job",
  // "Report message". Mapping the union to display nouns fixes every variant
  // at once and keeps the next sweep honest.
  const REPORTED_NOUN: Record<ReportDialogProps["reportedType"], string> = {
    job: "Job",
    message: "Message",
    user: "User",
    profile: "Profile",
    review: "Review",
  };
  const title =
    step === "confirmation" ? "Thanks — We've Got It" : `Report ${REPORTED_NOUN[reportedType]}`;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) handleClose(); }}>
      <DialogContent>
        <DialogHero
          eyebrow={<><ShieldAlert className="w-3 h-3" strokeWidth={2} aria-hidden="true" /> {eyebrow}</>}
          title={title}
        />

        {step === "reason" && (
          <div className="space-y-2">
            <div className="grid grid-cols-2 gap-1.5">
              {reasons.map(({ label, Icon }, i) => {
                const active = reason === label;
                const isLast = i === reasons.length - 1;
                return (
                  <button
                    key={label}
                    type="button"
                    onClick={() => {
                      hapticMedium();
                      setReason(label);
                      // Auto-advance — picking a reason is one tap and
                      // the next step is required anyway. Saves the user
                      // a "now what?" beat.
                      setTimeout(() => setStep("details"), 120);
                    }}
                    aria-pressed={active}
                    className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-ds-md text-ds-13 font-medium transition-all active:scale-[0.97] ${isLast && reasons.length % 2 === 1 ? "col-span-2 justify-center" : "justify-start"} ${
                      active
                        ? "bg-primary/10 text-primary border border-primary/35 shadow-[0_1px_2px_hsl(var(--primary)/0.10)]"
                        : "bg-card text-foreground border border-border/60 hover:bg-secondary/40 hover:border-border"
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
            <div className="flex items-center justify-end pt-1">
              <Button
                type="button"
                variant="ghost"
                onClick={handleClose}
                className="h-10 px-4 rounded-ds-md"
              >
                Cancel
              </Button>
            </div>
          </div>
        )}

        {step === "details" && (
          <div className="space-y-4">
            <div
              className="rounded-ds-md px-3 py-2.5 flex items-center justify-between"
              style={{
                background: "hsl(var(--primary) / 0.06)",
                border: "0.5px solid hsl(var(--primary) / 0.22)",
              }}
            >
              <span
                className="font-sans text-ds-13 font-medium"
                style={{ color: "hsl(var(--primary))" }}
              >
                {reason}
              </span>
              <button
                type="button"
                onClick={() => setStep("reason")}
                className="text-ds-11 font-sans font-medium underline-offset-2 hover:underline"
                style={{ color: "hsl(var(--primary))" }}
              >
                Change
              </button>
            </div>

            <div className="space-y-1.5">
              <Textarea
                aria-label="Report description"
                placeholder="Share what happened — dates, screenshot references, anything specific helps our team."
                value={description}
                onChange={(e) => setDescription(e.target.value.slice(0, MAX_LENGTH))}
                rows={4}
                required
                className="rounded-ds-md border-border/60 bg-background/80 focus-visible:bg-background focus-visible:border-primary/40 focus-visible:ring-2 focus-visible:ring-primary/15 text-ds-14 leading-relaxed resize-none"
              />
              <div className="flex items-center justify-between text-ds-11">
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

            <div className="flex items-center justify-between gap-2 pt-1">
              <Button
                type="button"
                variant="ghost"
                onClick={() => setStep("reason")}
                disabled={submitting}
                className="h-10 px-3 rounded-ds-md"
              >
                <ChevronLeft className="w-4 h-4 mr-1" />
                Back
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
                        boxShadow: "var(--elev-bark-raised)",
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
                  "Submit Report"
                )}
              </Button>
            </div>
          </div>
        )}

        {step === "confirmation" && caseNumber && (
          <div className="space-y-4">
            <div
              className="rounded-ds-md p-4 text-center space-y-3"
              style={{
                background: "hsl(var(--success-tint))",
                border: "0.5px solid hsl(var(--success-border) / 0.35)",
              }}
            >
              <div className="flex justify-center">
                <div
                  className="w-12 h-12 rounded-full flex items-center justify-center"
                  style={{
                    background: "hsl(var(--success-tint-strong))",
                    border: "1px solid hsl(var(--success-border-strong) / 0.35)",
                  }}
                >
                  <Check
                    className="w-6 h-6"
                    style={{ color: "hsl(var(--success-ink))" }}
                    strokeWidth={2.5}
                  />
                </div>
              </div>
              <p
                className="font-serif italic text-ds-15 leading-relaxed"
                style={{ color: "hsl(var(--ink-deep))" }}
              >
                Our trust team reviews every report. Most are handled within
                24 hours; complex cases can take up to 3 business days.
              </p>
              <div className="space-y-1">
                <p
                  className="font-serif italic uppercase text-ds-10"
                  style={{
                    color: "hsl(var(--olivewood) / 0.8)",
                    letterSpacing: "0.16em",
                  }}
                >
                  Your case number
                </p>
                <button
                  type="button"
                  onClick={copyCaseNumber}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-ds-sm font-mono tabular-nums text-ds-15 font-semibold transition-colors hover:bg-secondary/40"
                  style={{
                    color: "hsl(var(--ink-deep))",
                    background: "var(--surface-premium)",
                    border: "0.5px solid hsl(var(--olivewood) / 0.2)",
                    letterSpacing: "0.04em",
                  }}
                  aria-label={`Copy case number ${caseNumber}`}
                >
                  {caseNumber}
                  <Copy className="w-3.5 h-3.5 opacity-60" />
                </button>
              </div>
              <p
                className="text-ds-11 text-muted-foreground"
              >
                Email <a href="mailto:admin@louisianahelpr.com" className="underline">admin@louisianahelpr.com</a> with this number if you have more to add.
              </p>
            </div>
            <div className="flex items-center justify-end gap-2">
              <Button
                type="button"
                onClick={handleClose}
                className="h-10 px-4 rounded-ds-md"
                style={{
                  background: "hsl(var(--bark))",
                  backgroundImage: "none",
                  border: "1px solid hsl(var(--bark))",
                  color: "hsl(var(--parchment))",
                  boxShadow: "var(--elev-bark-raised)",
                }}
              >
                Done
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default ReportDialog;
