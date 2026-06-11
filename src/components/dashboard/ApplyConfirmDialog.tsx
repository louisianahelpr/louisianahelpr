import { useEffect, useMemo, type Dispatch, type SetStateAction } from "react";
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
import { FileText, Paperclip, Trash2, WifiOff, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { errorToast } from "@/lib/toast";
import { hapticMedium, hapticLight } from "@/lib/haptics";
import { useOnlineStatus } from "@/lib/useOnlineStatus";
import { safeStorage } from "@/lib/safeStorage";
import type { EnrichedJob } from "@/components/dashboard/types";

/** Mirror ReportDialog's pitch cap so the backend never silently truncates. */
const MAX_PITCH_LENGTH = 500;
/** Soft minimum — short pitches read as "lol sure" to posters. We don't
 *  block submission below this (an empty pitch is still allowed), but
 *  we surface the count to nudge the helpr toward a useful intro. */
const SOFT_MIN_PITCH_LENGTH = 30;

/**
 * Per-job draft key — old single-key behavior meant moving to a different
 * job overwrote your half-written pitch. Scoping by job id keeps each
 * application independent. The `helpr_` prefix is mirrored to Capacitor
 * Preferences (see safeStorage) so a force-quit doesn't lose the draft.
 */
function pitchDraftKey(jobId: string | undefined | null) {
  return `helpr_apply_pitch_draft_${jobId ?? "unknown"}`;
}

/** Legacy single-key draft from before drafts were per-job. We migrate
 *  it once into the current job's key so an in-flight pitch from the
 *  pre-update build isn't dropped. */
const LEGACY_PITCH_DRAFT_KEY = "helpr_apply_pitch_draft";

/** Two-to-three sentence starters — clickable to insert/replace. We
 *  swap in time-of-day on the first one so the greeting feels live. */
function greetingByHour(hour: number) {
  if (hour < 5) return "Hi"; // late night
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Hi";
  return "Good evening";
}
function buildStarterSentences(job: EnrichedJob | null): string[] {
  const greet = greetingByHour(new Date().getHours());
  const cat = (job?.category ?? "this kind of work").toLowerCase().replace(/_/g, " ");
  const dayLabel = (() => {
    if (!job?.date_needed) return "";
    const d = new Date(job.date_needed + "T00:00:00");
    if (isNaN(d.getTime())) return "";
    return d.toLocaleDateString(undefined, { weekday: "long" });
  })();
  return [
    `${greet}, I'm available ${dayLabel ? dayLabel : "the day you need"}${job?.start_time ? ` at ${job.start_time}` : ""} and ready to go.`,
    `I've done ${cat} before and can bring the right tools for the job.`,
    `Happy to send a quick quote or answer any questions before you decide.`,
  ];
}

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
  const { online } = useOnlineStatus();
  const charsLeft = MAX_PITCH_LENGTH - applyMessage.length;
  const trimmedLen = applyMessage.trim().length;
  const underMin = trimmedLen > 0 && trimmedLen < SOFT_MIN_PITCH_LENGTH;
  const jobId = confirmApplyJob?.id ?? null;
  const draftKey = pitchDraftKey(jobId);
  const starterSentences = useMemo(() => buildStarterSentences(confirmApplyJob), [confirmApplyJob]);

  // Restore a saved draft for THIS job when the dialog (re)opens with an
  // empty field — per-job scoping so switching jobs doesn't bleed text
  // between unrelated pitches. We also one-time migrate the legacy single
  // draft key so a pre-update in-flight pitch isn't lost on the upgrade.
  useEffect(() => {
    if (!open) return;
    if (applyMessage) return;
    if (!jobId) return;
    const saved = safeStorage.getItem(draftKey);
    if (saved) {
      setApplyMessage(saved);
      return;
    }
    const legacy = safeStorage.getItem(LEGACY_PITCH_DRAFT_KEY);
    if (legacy) {
      setApplyMessage(legacy);
      // Move it into the per-job slot and clear the legacy key.
      safeStorage.setItem(draftKey, legacy);
      safeStorage.removeItem(LEGACY_PITCH_DRAFT_KEY);
    }
    // Intentionally keyed on `open` + jobId only — restore once per open.

  }, [open, jobId]);

  // Auto-save the in-progress pitch on every change, so the back button or
  // an accidental dialog dismiss never loses what the helpr typed. Save is
  // debounced via a microtask so a fast typer doesn't thrash safeStorage.
  useEffect(() => {
    if (!open || !jobId) return;
    if (applyMessage.length === 0) {
      // Empty message → clear the draft so we don't perpetually re-hydrate.
      safeStorage.removeItem(draftKey);
      return;
    }
    const handle = setTimeout(() => safeStorage.setItem(draftKey, applyMessage), 200);
    return () => clearTimeout(handle);
  }, [open, jobId, draftKey, applyMessage]);

  const handleStarterTap = (sentence: string) => {
    hapticLight();
    // If the textarea is empty, just drop the sentence in. If it has
    // text, append a space + sentence so chips become composable.
    setApplyMessage(
      applyMessage.length === 0
        ? sentence.slice(0, MAX_PITCH_LENGTH)
        : `${applyMessage.trimEnd()} ${sentence}`.slice(0, MAX_PITCH_LENGTH),
    );
  };

  const handleConfirm = () => {
    hapticMedium();
    // Offline: don't let the parent close the dialog and fire a mutation that
    // rolls back silently. Persist the pitch and keep the dialog up with a
    // clear retry affordance instead.
    if (!online) {
      if (applyMessage) safeStorage.setItem(draftKey, applyMessage);
      // Critical offline state → persistent toast with an explicit Retry
      // action that re-runs the apply once the user gets back online (or
      // wants to try optimistically). The Sonner toast persists until
      // dismissed so the user can't miss it while scrolling other content.
      errorToast("You're offline", {
        description: "We saved your pitch. Try again once you're back online.",
        critical: true,
        id: "apply-offline",
        onRetry: () => {
          // Re-attempt: if we're back online by now, run the confirm; otherwise
          // surface the same toast again so the user knows nothing changed.
          if (navigator.onLine) {
            safeStorage.removeItem(draftKey);
            handleApplyConfirm();
          }
        },
      });
      return;
    }
    safeStorage.removeItem(draftKey);
    handleApplyConfirm();
  };

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
            {/* Starter sentences — clickable to insert. Surfaces the
                "what should I even say?" question by showing concrete,
                time-aware openers. Tapping one appends to the current
                draft so chips compose. A labelled header makes it read as
                "tap a suggestion," and the chips scroll horizontally on one
                row so they don't stack three-tall and balloon the dialog. */}
            {applyMessage.length < MAX_PITCH_LENGTH - 20 && (
              <div role="group" aria-label="Suggested opening sentences">
                <div
                  className="flex items-center gap-1 mb-1.5 font-serif italic"
                  style={{ fontSize: "0.66rem", color: "hsl(var(--burnt-sienna) / 0.75)", letterSpacing: "0.04em" }}
                >
                  <Sparkles className="w-3 h-3 shrink-0" strokeWidth={2.25} aria-hidden />
                  <span>Tap a suggested opener</span>
                </div>
                <div className="flex gap-1.5 overflow-x-auto scrollbar-hide -mx-1 px-1 pb-0.5">
                  {starterSentences.map((sentence) => {
                    // Show a truncated preview as the chip label —
                    // tapping inserts the full sentence.
                    const preview = sentence.length > 34 ? `${sentence.slice(0, 32)}…` : sentence;
                    return (
                      <button
                        key={sentence}
                        type="button"
                        onClick={() => handleStarterTap(sentence)}
                        className="shrink-0 whitespace-nowrap text-[0.72rem] font-serif italic px-2.5 py-1 rounded-full transition-colors active:scale-[0.97]"
                        style={{
                          background: "hsl(var(--bark) / 0.07)",
                          color: "hsl(var(--ink-deep) / 0.88)",
                          border: "0.5px solid hsl(var(--bark) / 0.24)",
                          boxShadow: "inset 0 1px 1px 0 rgba(255,255,255,0.5)",
                        }}
                        aria-label={`Insert: ${sentence}`}
                      >
                        {preview}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
            <Textarea
              id="apply-message"
              value={applyMessage}
              onChange={(e) => setApplyMessage(e.target.value.slice(0, MAX_PITCH_LENGTH))}
              maxLength={MAX_PITCH_LENGTH}
              placeholder="Introduce yourself or share relevant experience…"
              rows={3}
              className="rounded-ds-md bg-white/60 border-border/60 focus-visible:bg-white focus-visible:border-primary/40 font-serif italic text-[0.88rem] leading-relaxed"
            />
            <div className="flex items-center justify-between text-ds-11">
              {/* Soft min counter — surfaces the "30+ chars feels real"
                  guidance without blocking shorter pitches. Mirrors the
                  ReportDialog's hint copy so the UX is consistent. */}
              <span
                style={{
                  color: underMin
                    ? "hsl(var(--burnt-sienna))"
                    : "hsl(var(--muted-foreground))",
                }}
              >
                {trimmedLen === 0
                  ? `Tip: ${SOFT_MIN_PITCH_LENGTH}+ characters feels personal`
                  : underMin
                  ? `${SOFT_MIN_PITCH_LENGTH - trimmedLen} more to feel personal`
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
                {applyMessage.length}/{MAX_PITCH_LENGTH}
              </span>
            </div>
          </div>
          {/* File attachments */}
          <div
            className="space-y-1.5 mt-3.5 pt-3.5"
            style={{ borderTop: "0.5px solid hsl(var(--olivewood) / 0.10)" }}
          >
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
        {!online && (
          <p
            className="flex items-center gap-1.5 font-serif italic text-[0.78rem] leading-snug -mt-1"
            style={{ color: "hsl(var(--burnt-sienna))" }}
            role="status"
          >
            <WifiOff className="w-3.5 h-3.5 shrink-0" />
            You're offline. We'll hold onto your pitch — apply again once you're back online.
          </p>
        )}
        <AlertDialogFooter className="!gap-2">
          <AlertDialogCancel
            disabled={applyLoading}
            className="rounded-ds-md bg-transparent border-transparent shadow-none text-muted-foreground hover:bg-secondary/60 hover:text-foreground active:translate-y-0"
          >
            Cancel
          </AlertDialogCancel>
          {/* `type="button"`: when offline we keep the dialog open (don't let
              AlertDialogAction's default close fire), so the held pitch stays
              on screen for an immediate retry. */}
          <AlertDialogAction
            type="button"
            onClick={(e) => { if (!online) e.preventDefault(); handleConfirm(); }}
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
            {applyLoading ? "Applying…" : !online ? "Try again" : "Apply now"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
