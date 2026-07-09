import { useEffect, useMemo, useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHero,
} from "@/components/ui/alert-dialog";
import { Textarea } from "@/components/ui/textarea";
import { FileText, Paperclip, Trash2, WifiOff, Sparkles, BookmarkCheck, ChevronDown, Plus } from "lucide-react";
import { toast } from "sonner";
import { errorToast } from "@/lib/toast";
import { hapticMedium, hapticLight } from "@/lib/haptics";
import { useOnlineStatus } from "@/lib/useOnlineStatus";
import { safeStorage } from "@/lib/safeStorage";
import type { ApplyConfirmDialogProps } from "@/components/dashboard/applyConfirmDialog/types";
import { ApplyEarningsBreakdown } from "@/components/dashboard/applyConfirmDialog/ApplyEarningsBreakdown";
import {
  MAX_PITCH_LENGTH,
  SOFT_MIN_PITCH_LENGTH,
  pitchDraftKey,
  LEGACY_PITCH_DRAFT_KEY,
  TEMPLATE_KEY,
  buildStarterSentences,
  getApplyTips,
} from "@/components/dashboard/applyConfirmDialog/applyConfirmDialogHelpers";

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
  bidPrice,
  setBidPrice,
  handleApplyConfirm,
}: ApplyConfirmDialogProps) {
  const { online } = useOnlineStatus();
  const charsLeft = MAX_PITCH_LENGTH - applyMessage.length;
  const isBidMode = confirmApplyJob?.pricing_mode === "accept_bids";
  // In bid mode the price is REQUIRED — apply_to_job raises
  // "A price is required for bid-mode jobs" on an empty submit. Gate the
  // action button on a valid positive number so the empty-bid submit can't
  // happen (it previously fell through to a generic failure toast).
  const bidValue = parseFloat(bidPrice);
  const bidPriceValid = !isBidMode || (bidPrice.trim() !== "" && Number.isFinite(bidValue) && bidValue >= 1);
  const isInstantBook = !!(confirmApplyJob as any)?.instant_book;
  const trimmedLen = applyMessage.trim().length;
  const underMin = trimmedLen > 0 && trimmedLen < SOFT_MIN_PITCH_LENGTH;
  const jobId = confirmApplyJob?.id ?? null;
  const draftKey = pitchDraftKey(jobId);
  const starterSentences = useMemo(() => buildStarterSentences(confirmApplyJob), [confirmApplyJob]);
  const [saveAsTemplate, setSaveAsTemplate] = useState(false);
  // The attachments section is optional; it made the modal taller on small
  // phones, so it stays collapsed behind one "Add attachments" disclosure by
  // default (earnings → bid → pitch → Apply). Auto-expand when a file is
  // already attached so a restored/in-progress application never hides state
  // the helpr already chose.
  const [showMoreOptions, setShowMoreOptions] = useState(false);
  const optionsExpanded = showMoreOptions || applyFiles.length > 0;

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

  // When the dialog opens and no draft was found, pre-fill from the saved
  // pitch template so the helpr doesn't start from a blank field every time.
  // We only pre-fill when the message is empty — if the draft-restore above
  // already loaded something, we leave it untouched.
  useEffect(() => {
    if (!open) return;
    const template = localStorage.getItem(TEMPLATE_KEY);
    if (template && !applyMessage) {
      setApplyMessage(template);
    }
    // Fire once per open; applyMessage intentionally omitted so we don't loop.
     
  }, [open]);

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
    if (saveAsTemplate && applyMessage.trim()) {
      localStorage.setItem(TEMPLATE_KEY, applyMessage.trim());
    }
    setSaveAsTemplate(false);
    handleApplyConfirm();
  };

  return (
    <AlertDialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <AlertDialogContent className="!gap-3">
        <div className="!text-left space-y-0">
          <AlertDialogHero
            eyebrow={isBidMode ? "You're bidding" : isInstantBook ? "You're booking" : "You're applying"}
            title={confirmApplyJob ? `"${confirmApplyJob.title}"` : isBidMode ? "Submit a bid" : isInstantBook ? "Book this job" : "Apply for this job"}
            subtitle={confirmApplyJob ? undefined : "Are you sure you want to apply for this job?"}
          />
          {confirmApplyJob && (
            <div className="pt-3">
              <ApplyEarningsBreakdown confirmApplyJob={confirmApplyJob} platformFee={platformFee} />
            </div>
          )}
          {/* Bid price — only shown when the job uses "Accept bids" pricing */}
          {isBidMode && (
            <div className="space-y-1 mt-3">
              <label
                htmlFor="bid-price"
                className="font-serif italic uppercase block"
                style={{ fontSize: "0.62rem", color: "hsl(var(--burnt-sienna))", letterSpacing: "0.18em" }}
              >
                Your bid price
              </label>
              <div className="relative">
                <span
                  className="absolute left-3 top-1/2 -translate-y-1/2 font-sans"
                  style={{ fontSize: "0.84rem", color: "hsl(var(--olivewood) / 0.8)" }}
                >
                  $
                </span>
                <input
                  id="bid-price"
                  type="number"
                  min="1"
                  step="1"
                  placeholder="0"
                  value={bidPrice}
                  onChange={(e) => setBidPrice(e.target.value)}
                  className="w-full min-h-[44px] rounded-ds-md border border-input bg-background pl-7 pr-3 py-2 text-ds-13 focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
              </div>
              {confirmApplyJob && (confirmApplyJob.budget ?? 0) > 0 && (
                <p
                  className="font-serif italic"
                  style={{ fontSize: "0.7rem", color: "hsl(var(--olivewood) / 0.8)" }}
                >
                  Poster's budget: ${confirmApplyJob.budget}
                </p>
              )}
            </div>
          )}

          <div className="space-y-1.5 mt-3">
            <label
              htmlFor="apply-message"
              className="font-serif italic uppercase block"
              style={{ fontSize: "0.62rem", color: "hsl(var(--burnt-sienna))", letterSpacing: "0.18em" }}
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
            {/* "Use saved pitch" chip — shown when a template is saved but the
                current message differs, so the helpr can one-tap restore it. */}
            {(() => {
              const template = localStorage.getItem(TEMPLATE_KEY);
              if (!template || applyMessage === template) return null;
              return (
                <button
                  type="button"
                  onClick={() => setApplyMessage(template)}
                  className="text-ds-12 flex items-center gap-1 hover:opacity-80"
                  style={{ color: "hsl(var(--sage))" }}
                >
                  <BookmarkCheck className="w-3.5 h-3.5" />
                  Use saved pitch
                </button>
              );
            })()}
            <Textarea
              id="apply-message"
              value={applyMessage}
              onChange={(e) => setApplyMessage(e.target.value.slice(0, MAX_PITCH_LENGTH))}
              maxLength={MAX_PITCH_LENGTH}
              placeholder="Introduce yourself or share relevant experience…"
              rows={3}
              className="rounded-ds-md bg-background/60 border-border/60 focus-visible:bg-background focus-visible:border-primary/40 font-serif italic text-[0.88rem] leading-relaxed"
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
                  : "Nice — that reads personal"}
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
            {/* Save as default template — lets helprs reuse a good pitch
                across applications without retyping it every time. */}
            <label className="flex items-center gap-2 cursor-pointer min-h-[44px] -my-1">
              <input
                type="checkbox"
                checked={saveAsTemplate}
                onChange={(e) => setSaveAsTemplate(e.target.checked)}
                className="rounded w-[18px] h-[18px] shrink-0"
              />
              <span className="text-ds-12 text-muted-foreground">Save as my default pitch</span>
            </label>
          </div>
          {/* Smart apply tips — context-aware nudges based on job attributes */}
          {(() => {
            const tips = getApplyTips({
              is_urgent: confirmApplyJob?.is_urgent,
              budget: confirmApplyJob?.budget,
              pricing_mode: confirmApplyJob?.pricing_mode,
              date_needed: confirmApplyJob?.date_needed,
              category: confirmApplyJob?.category,
            });
            if (tips.length === 0) return null;
            return (
              <div
                className="rounded-ds-md px-3 py-2.5 space-y-1 mt-3"
                style={{ background: "hsl(var(--sage) / 0.07)", border: "1px solid hsl(var(--sage) / 0.18)" }}
              >
                <p className="text-ds-11 font-semibold uppercase tracking-[0.1em]" style={{ color: "hsl(var(--sage))" }}>
                  Tips
                </p>
                {tips.map((tip, i) => (
                  <p key={i} className="text-ds-12 flex items-start gap-1.5" style={{ color: "hsl(var(--ink-deep) / 0.7)" }}>
                    <span style={{ color: "hsl(var(--sage))", marginTop: "2px" }}>›</span>
                    {tip}
                  </p>
                ))}
              </div>
            );
          })()}

          {/* Attachments disclosure — keeps the default modal short by hiding
              the (optional) attachments section behind one tasteful toggle.
              Hidden once expanded or when a file is already attached. */}
          {!optionsExpanded && (
            <button
              type="button"
              onClick={() => { hapticLight(); setShowMoreOptions(true); }}
              className="mt-3.5 w-full min-h-[44px] flex items-center justify-center gap-1.5 rounded-ds-md font-serif italic text-ds-12 active:scale-[0.99] transition-transform"
              style={{
                background: "hsl(var(--bark) / 0.05)",
                border: "0.5px dashed hsl(var(--bark) / 0.25)",
                color: "hsl(var(--bark))",
              }}
              aria-expanded={false}
            >
              <Plus className="w-3.5 h-3.5" strokeWidth={2.25} aria-hidden />
              <span>Add attachments</span>
              <span className="text-ds-11" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
                certs · previous work
              </span>
            </button>
          )}

          {optionsExpanded && (
            <>
              {showMoreOptions && applyFiles.length === 0 && (
                <button
                  type="button"
                  onClick={() => { hapticLight(); setShowMoreOptions(false); }}
                  className="mt-3.5 w-full min-h-[44px] flex items-center justify-center gap-1.5 rounded-ds-md font-serif italic text-ds-12 active:scale-[0.99] transition-transform"
                  style={{
                    background: "hsl(var(--bark) / 0.05)",
                    border: "0.5px dashed hsl(var(--bark) / 0.25)",
                    color: "hsl(var(--bark))",
                  }}
                  aria-expanded
                >
                  <ChevronDown className="w-3.5 h-3.5 rotate-180" strokeWidth={2.25} aria-hidden />
                  <span>Hide attachments</span>
                </button>
              )}

          {/* File attachments */}
          <div
            className="space-y-1.5 mt-3.5"
          >
            {/* Was a bare <label> with no `htmlFor` — that fails the form-
                control association rule. The file input below is wrapped
                in its own inner <label> (which is the real picker
                affordance), so this outer text is a section heading, not
                an input label. Render as <p> so screen readers don't
                announce it as an unfulfilled label promise. */}
            <p
              className="font-serif italic uppercase block"
              style={{ fontSize: "0.62rem", color: "hsl(var(--burnt-sienna))", letterSpacing: "0.18em" }}
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
                  <span className="font-sans tabular-nums shrink-0" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>{(file.size / 1024).toFixed(0)}KB</span>
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
            </>
          )}
        </div>
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
            disabled={applyLoading || !bidPriceValid}
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
            {applyLoading
              ? isBidMode ? "Submitting bid…" : isInstantBook ? "Booking…" : "Applying…"
              : !online ? "Try again" : isBidMode ? "Submit bid" : isInstantBook ? "Book now" : "Apply now"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
