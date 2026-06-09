import type { Dispatch, SetStateAction } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Textarea } from "@/components/ui/textarea";
import { FileText, Paperclip, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { hapticMedium } from "@/lib/haptics";
import type { EnrichedJob } from "@/components/dashboard/types";

interface ApplyConfirmDialogProps {
  /** Whether the dialog is open — true once a feed job has been picked. */
  open: boolean;
  /** Closes the dialog (clears the parent's pending-apply job id). */
  onClose: () => void;
  /** The job being applied to, resolved from the loaded feed. May be null
   *  if the pending id isn't in the loaded pages — a generic prompt shows. */
  confirmApplyJob: EnrichedJob | null;
  /** Platform commission percentage, for the take-home breakdown. */
  platformFee: number;
  applyMessage: string;
  setApplyMessage: (value: string) => void;
  applyFiles: File[];
  setApplyFiles: Dispatch<SetStateAction<File[]>>;
  /** True while the application is being submitted — disables the controls. */
  applyLoading: boolean;
  /** Submits the application. */
  handleApplyConfirm: () => void;
}

/**
 * ApplyConfirmDialog — the "You're applying" confirmation modal opened
 * from the Dashboard feed: a take-home earnings breakdown for the picked
 * job, an optional pitch, and optional file attachments.
 *
 * Extracted verbatim from Dashboard.tsx — a faithful relocation. The
 * dialog body JSX is unchanged; every value it read from the page is
 * now a prop.
 */
export function ApplyConfirmDialog({
  open,
  onClose,
  confirmApplyJob,
  platformFee,
  applyMessage,
  setApplyMessage,
  applyFiles,
  setApplyFiles,
  applyLoading,
  handleApplyConfirm,
}: ApplyConfirmDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <AlertDialogContent className="!gap-3">
        <AlertDialogHeader className="!text-left space-y-0">
          <span
            className="font-serif italic uppercase"
            style={{ fontSize: "0.62rem", color: "hsl(var(--burnt-sienna) / 0.78)", letterSpacing: "0.18em" }}
          >
            You're applying
          </span>
          <AlertDialogTitle
            className="font-display italic font-bold leading-tight mt-1"
            style={{ fontSize: "clamp(1.35rem, 2vw + 0.4rem, 1.65rem)", color: "hsl(var(--ink-deep))", letterSpacing: "-0.025em" }}
          >
            {confirmApplyJob ? `"${confirmApplyJob.title}"` : "Apply for this task"}
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            {confirmApplyJob ? (
              <div className="mt-3">
                {(() => {
                  const helpers = confirmApplyJob.is_group_job && confirmApplyJob.helpers_needed ? confirmApplyJob.helpers_needed : 1;
                  const perHelper = confirmApplyJob.budget / helpers;
                  const commission = perHelper * platformFee / 100;
                  const payout = perHelper - commission + (confirmApplyJob.urgent_fee ?? 0);
                  return (
                    <div
                      className="rounded-ds-md p-3"
                      style={{
                        background:
                          "radial-gradient(circle at 20% 0%, hsla(0, 0%, 100%, 0.55) 0%, transparent 60%), " +
                          "linear-gradient(180deg, hsla(38, 50%, 96%, 0.92) 0%, hsla(38, 30%, 92%, 0.74) 100%)",
                        border: "0.5px solid hsl(var(--bark) / 0.22)",
                        boxShadow:
                          "inset 0 1px 1px 0 rgba(255,255,255,0.6), " +
                          "inset 0 0 0 0.5px hsl(var(--gold-warm) / 0.22)",
                      }}
                    >
                      <p
                        className="font-serif italic uppercase mb-1.5"
                        style={{ fontSize: "0.6rem", color: "hsl(var(--burnt-sienna) / 0.78)", letterSpacing: "0.18em" }}
                      >
                        You earn
                      </p>
                      <div className="space-y-1 text-[0.78rem]">
                        <div className="flex justify-between" style={{ color: "hsl(var(--olivewood) / 0.78)" }}>
                          <span className="font-serif italic">Budget{helpers > 1 ? ` ÷ ${helpers}` : ""}</span>
                          <span className="font-display italic tabular-nums" style={{ color: "hsl(var(--ink-deep))" }}>${perHelper.toFixed(2)}</span>
                        </div>
                        <div className="flex justify-between" style={{ color: "hsl(var(--olivewood) / 0.78)" }}>
                          <span className="font-serif italic">− {platformFee}% platform fee</span>
                          <span className="font-display italic tabular-nums" style={{ color: "hsl(var(--ink-deep))" }}>−${commission.toFixed(2)}</span>
                        </div>
                        {(confirmApplyJob.urgent_fee ?? 0) > 0 && (
                          <div className="flex justify-between">
                            <span className="font-serif italic" style={{ color: "hsl(var(--burnt-sienna))" }}>+ urgent bonus</span>
                            <span className="font-display italic tabular-nums" style={{ color: "hsl(var(--burnt-sienna))" }}>+${Number(confirmApplyJob.urgent_fee).toFixed(2)}</span>
                          </div>
                        )}
                        <div
                          className="flex justify-between pt-1.5 mt-1.5 items-baseline"
                          style={{ borderTop: "0.5px dashed hsl(var(--bark) / 0.22)" }}
                        >
                          <span className="font-display italic font-bold" style={{ fontSize: "0.85rem", color: "hsl(var(--ink-deep))" }}>Take-home</span>
                          <span
                            className="font-display italic font-bold tabular-nums"
                            style={{ fontSize: "1.15rem", color: "hsl(var(--bark))", letterSpacing: "-0.02em" }}
                          >
                            ${payout.toFixed(2)}
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })()}
              </div>
            ) : (
              <p className="font-serif italic mt-2" style={{ color: "hsl(var(--olivewood) / 0.7)" }}>
                Are you sure you want to apply for this task?
              </p>
            )}
          </AlertDialogDescription>
          <div className="space-y-1.5 mt-3">
            <label
              htmlFor="apply-message"
              className="font-serif italic uppercase block"
              style={{ fontSize: "0.62rem", color: "hsl(var(--burnt-sienna) / 0.78)", letterSpacing: "0.18em" }}
            >
              Your pitch — optional
            </label>
            <Textarea
              id="apply-message"
              value={applyMessage}
              onChange={(e) => setApplyMessage(e.target.value)}
              placeholder="Introduce yourself or share relevant experience…"
              rows={3}
              className="rounded-ds-md bg-white/60 border-border/60 focus-visible:bg-white focus-visible:border-primary/40 font-serif italic text-[0.88rem] leading-relaxed"
            />
          </div>
          {/* File attachments */}
          <div className="space-y-1.5 mt-2">
            {/* Was a bare <label> with no `htmlFor` — that fails the form-
                control association rule. The file input below is wrapped
                in its own inner <label> (which is the real picker
                affordance), so this outer text is a section heading, not
                an input label. Render as <p> so screen readers don't
                announce it as an unfulfilled label promise. */}
            <p
              className="font-serif italic uppercase block"
              style={{ fontSize: "0.62rem", color: "hsl(var(--burnt-sienna) / 0.78)", letterSpacing: "0.18em" }}
            >
              Certs or previous work — optional
            </p>
            <div className="space-y-1.5">
              {applyFiles.map((file, i) => (
                <div
                  key={i}
                  className="flex items-center gap-2 text-[0.72rem] rounded-ds-md px-2.5 py-1.5"
                  style={{ background: "hsl(var(--bark) / 0.08)", border: "0.5px solid hsl(var(--bark) / 0.18)" }}
                >
                  <FileText className="w-3.5 h-3.5 shrink-0" style={{ color: "hsl(var(--bark))" }} />
                  <span className="truncate flex-1 font-sans font-medium" style={{ color: "hsl(var(--ink-deep))" }}>{file.name}</span>
                  <span className="font-sans tabular-nums shrink-0" style={{ color: "hsl(var(--olivewood) / 0.6)" }}>{(file.size / 1024).toFixed(0)}KB</span>
                  <button type="button" onClick={() => setApplyFiles(f => f.filter((_, idx) => idx !== i))} aria-label="Remove attached file" style={{ color: "hsl(var(--burnt-sienna))" }} className="active:opacity-70">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
              {applyFiles.length < 5 && (
                <label
                  className="inline-flex items-center gap-1.5 text-[0.78rem] font-sans font-semibold cursor-pointer active:opacity-70"
                  style={{ color: "hsl(var(--bark))" }}
                >
                  <Paperclip className="w-3.5 h-3.5" strokeWidth={2.25} />
                  <span>{applyFiles.length === 0 ? "Add a file" : "Add another"}</span>
                  <input
                    type="file"
                    className="hidden"
                    accept="image/*,.pdf,.doc,.docx"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) {
                        if (file.size > 5 * 1024 * 1024) { toast.error("File must be under 5MB"); return; }
                        setApplyFiles(f => [...f, file]);
                      }
                      e.target.value = "";
                    }}
                  />
                </label>
              )}
            </div>
          </div>
        </AlertDialogHeader>
        <AlertDialogFooter className="!gap-2">
          <AlertDialogCancel
            disabled={applyLoading}
            className="rounded-ds-md bg-transparent border-transparent shadow-none text-muted-foreground hover:bg-secondary/60 hover:text-foreground active:translate-y-0"
          >
            Cancel
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={() => { hapticMedium(); handleApplyConfirm(); }}
            disabled={applyLoading}
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
            {applyLoading ? "Applying…" : "Apply now"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
