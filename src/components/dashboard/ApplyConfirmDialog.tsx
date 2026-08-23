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
import { Checkbox } from "@/components/ui/checkbox";
import { FileText, Paperclip, Trash2, WifiOff, Sparkles, BookmarkCheck, ChevronDown, Plus, X } from "lucide-react";
import { toast } from "sonner";
import { errorToast } from "@/lib/toast";
import { hapticMedium, hapticLight } from "@/lib/haptics";
import { useOnlineStatus } from "@/lib/useOnlineStatus";
import { safeStorage } from "@/lib/safeStorage";
import { formatPrice } from "@/lib/format";
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
 * Originally extracted verbatim from Dashboard.tsx; the body has since been
 * reorganised. Two things it must keep doing:
 *
 *  1. The pitch is OPTIONAL. Nothing here may read as a required form — a
 *     helpr who just wants to apply has to be able to hit the action without
 *     passing through anything.
 *  2. The earnings breakdown is the anchor. It is the only card in the dialog
 *     on purpose (the "TIPS" panel and the dashed attachments panel were
 *     dissolved to keep it that way), and it carries the escrow line — the
 *     trust statement that belongs on a money surface.
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
  // Bidding was removed (PRICING_MODE_REMOVED in BudgetSection), so there is
  // no bid-price field to gate the submit on any more — a helper applies to a
  // job at the poster's stated budget.
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
    const template = safeStorage.getItem(TEMPLATE_KEY);
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
      safeStorage.setItem(TEMPLATE_KEY, applyMessage.trim());
    }
    setSaveAsTemplate(false);
    handleApplyConfirm();
  };

  return (
    <AlertDialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      {/* Height cap + row template. Once the body stops overflowing sideways its
          text wraps properly, which makes the dialog TALLER — measured 768px →
          838px at 375×812, i.e. 13px of the job title clipped off the top of the
          screen and 13px off the bottom; the bid and urgent variants were
          already past the viewport before that. AlertDialogContent ships no
          height cap, so cap it here (scoped to this dialog, not the shared
          primitive). `grid-rows-[minmax(0,1fr)_auto]` puts the overflow in the
          BODY rather than the whole box, so the footer stays pinned and visible
          instead of scrolling below the fold — which is the bug this dialog is
          being fixed for. The two rows are still (body, footer); the offline
          notice, when it renders, takes a third implicit `auto` track. */}
      <AlertDialogContent className="grid-rows-[minmax(0,1fr)_auto] lg:max-w-3xl xl:max-w-4xl">
        {/* `min-w-0` is load-bearing, not decoration. AlertDialogContent is a
            CSS *grid*, so this body is a grid item whose default
            `min-width: auto` makes the implicit column's minimum equal the
            item's content-based minimum. The suggested-opener chip row used to
            be `overflow-x-auto` with `shrink-0 whitespace-nowrap` chips
            labelled by a 32-character slice of the full sentence — and a
            horizontal scroller still contributes its full max-content width to
            that minimum — so the single grid column measured 674px inside a
            341px box, and EVERY row (title, earnings, pitch counter, Cancel /
            Apply now) stretched to 674px and ran ~356px off the right edge of
            the screen. Measured at 320/375/414: the action buttons sat at
            right=687 in a 375px viewport. `min-w-0` drops the item's minimum
            contribution to 0 and the column tracks the dialog width.

            The chip row has since been shortened and switched to `flex-wrap`,
            so it no longer contributes a runaway minimum of its own — but
            `min-w-0` STAYS. It is the structural guard for this grid item
            against any future wide child (a long unbroken job title, a pasted
            URL in the pitch, a new chip); without it the whole column re-opens
            the same failure mode. Do not remove it. */}
        <div className="min-w-0 overflow-y-auto overflow-x-hidden overscroll-contain !text-left space-y-0">
          <AlertDialogHero
            eyebrow={isInstantBook ? "You're booking" : "You're applying"}
            title={confirmApplyJob ? `"${confirmApplyJob.title}"` : isInstantBook ? "Book This Job" : "Apply for This Job"}
          />
          {/* Restored into the body after the app-wide "one main title" sweep
              stripped `subtitle` from every hero. Everywhere else that copy was
              decorative; HERE it was the only sentence telling you what you are
              confirming, and it renders exactly when there is no job context to
              show a breakdown for — so the dialog became a title and two
              buttons with nothing explaining the action. A regression test
              already covered it, which is how it was caught. */}
          {!confirmApplyJob && (
            <p
              className="pt-2 font-sans text-ds-13 leading-relaxed"
              style={{ color: "hsl(var(--olivewood) / 0.85)" }}
            >
              Are you sure you want to proceed?
            </p>
          )}
          {confirmApplyJob && (
            <div className="pt-3">
              <ApplyEarningsBreakdown confirmApplyJob={confirmApplyJob} platformFee={platformFee} />
            </div>
          )}
          <div className="space-y-1.5 mt-3">
            {/* ONE prompt for the pitch, not three.
                This block used to open with an eyebrow ("YOUR PITCH —
                OPTIONAL"), then a second prose row ("Tap a suggested
                opener"), then the field's own placeholder — three separate
                invitations to write the same optional sentence, stacked. The
                Sparkles that marked the opener row now rides this label, so
                the "suggestions live here" cue survives while the row it used
                to sit on is gone. The label keeps `htmlFor` (it is still the
                field's accessible name) and keeps the word "optional" — the
                pitch is not required and the dialog must not read as a form
                you have to fill in. */}
            <label
              htmlFor="apply-message"
              className="flex items-center gap-1.5 font-serif italic uppercase text-ds-10"
              style={{ color: "hsl(var(--burnt-sienna))", letterSpacing: "0.18em" }}
            >
              <Sparkles className="w-3 h-3 shrink-0" strokeWidth={2.25} aria-hidden />
              Your pitch — optional
            </label>
            {/* Job-specific guidance — the former "TIPS" card, dissolved.
                It used to be a bordered sage panel titled "TIPS" sitting one
                row under a counter line that began "Tip:" — the same word,
                two meanings, adjacent. Pitch guidance now has exactly one
                home: here, above the field, as plain lines. Losing the panel
                also leaves the earnings breakdown as the ONLY card in the
                dialog, which is what makes it read as the anchor. */}
            {(() => {
              const tips = getApplyTips({
                is_urgent: confirmApplyJob?.is_urgent,
                budget: confirmApplyJob?.budget,
                date_needed: confirmApplyJob?.date_needed,
                category: confirmApplyJob?.category,
              });
              if (tips.length === 0) return null;
              return (
                <ul className="space-y-0.5">
                  {tips.map((tip, i) => (
                    <li
                      key={i}
                      className="flex items-start gap-1.5 font-serif italic text-ds-11 leading-snug"
                      style={{ color: "hsl(var(--olivewood) / 0.85)" }}
                    >
                      <span aria-hidden style={{ color: "hsl(var(--sage))" }}>›</span>
                      <span className="min-w-0">{tip}</span>
                    </li>
                  ))}
                </ul>
              );
            })()}
            {/* Starter chips — tap to insert. They WRAP; they no longer
                scroll. The old row was `overflow-x-auto` with chips labelled
                by a 32-char slice of the sentence, so the pill at the
                scrollport edge was sliced mid-word — and that same
                max-content width is what blew the dialog 356px off the right
                edge in f0d11d0b. Short intent labels fit the box at 320, so
                the row wraps to a second line instead and nothing is cut.
                No `whitespace-nowrap` and no `max-w-full` on the pills either:
                a chip that somehow outgrew the line must wrap its own text,
                not spill past a capped box or push the row wide. */}
            {applyMessage.length < MAX_PITCH_LENGTH - 20 && (
              <div className="flex flex-wrap gap-1.5" role="group" aria-label="Suggested openers — tap to insert">
                {starterSentences.map(({ label, sentence }) => (
                  <button
                    key={sentence}
                    type="button"
                    onClick={() => handleStarterTap(sentence)}
                    className="text-ds-12 font-serif italic px-2.5 py-1 rounded-full transition-colors active:scale-[0.97]"
                    style={{
                      background: "hsl(var(--bark) / 0.07)",
                      color: "hsl(var(--ink-deep) / 0.88)",
                      border: "0.5px solid hsl(var(--bark) / 0.24)",
                      boxShadow: "inset 0 1px 1px 0 rgba(255,255,255,0.5)",
                    }}
                    aria-label={`Insert: ${sentence}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}
            {/* "Use saved pitch" chip — shown when a template is saved but the
                current message differs, so the helpr can one-tap restore it. */}
            {(() => {
              const template = safeStorage.getItem(TEMPLATE_KEY);
              if (!template || applyMessage === template) return null;
              return (
                <button
                  type="button"
                  onClick={() => setApplyMessage(template)}
                  className="text-ds-12 flex items-center gap-1 hover:opacity-80"
                  style={{ color: "hsl(var(--sage))" }}
                >
                  <BookmarkCheck className="w-3.5 h-3.5" />
                  Use Saved Pitch
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
              className="rounded-ds-md bg-background/60 border-border/60 focus-visible:bg-background focus-visible:border-primary/40 font-serif italic text-ds-14 leading-relaxed"
            />
            <div className="flex items-center justify-between gap-2 text-ds-11">
              {/* Soft min counter — surfaces the "30+ chars feels real"
                  guidance without blocking shorter pitches.
                  The leading "Tip:" is gone: it sat one row above a panel
                  headed "TIPS" that meant something else entirely, so the
                  screen used the same word for two different things back to
                  back. Length guidance belongs to the counter; what to SAY is
                  now the job of the guidance lines under the label. */}
              <span
                className="min-w-0"
                style={{
                  color: underMin
                    ? "hsl(var(--burnt-sienna))"
                    : "hsl(var(--muted-foreground))",
                }}
              >
                {trimmedLen === 0
                  ? `${SOFT_MIN_PITCH_LENGTH}+ characters feels personal`
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
                across applications without retyping it every time.

                The control is the SHARED <Checkbox> (Radix), not a raw
                <input type="checkbox">, and that is the whole fix for the
                "~48px white square" this row used to show. index.css enforces
                the 44×44 HIG minimum with
                  `input[type="checkbox"] { min-height:44px; min-width:44px }`
                and min-* beats width/height, so the old `w-[18px] h-[18px]`
                was overridden and the box rendered 44px — bigger than the
                label beside it, reading as an empty input rather than a
                checkbox. That rule deliberately EXCLUDES `[role="checkbox"]`,
                which is what Radix renders, so the shared control keeps its
                designed 20×20 box. The tap target is unchanged: the wrapping
                label still carries `min-h-[44px]`, which is exactly the
                "reach the target via the surrounding <label>" contract that
                rule's comment describes. */}
            <label htmlFor="save-default-pitch" className="flex items-center gap-2 cursor-pointer min-h-[44px] -my-1">
              <Checkbox
                id="save-default-pitch"
                checked={saveAsTemplate}
                onCheckedChange={(checked) => setSaveAsTemplate(checked === true)}
              />
              <span className="text-ds-12 text-muted-foreground">Save as my default pitch</span>
            </label>
            {/* Attachments disclosure — optional, and now sized like it.
                It was a full-width dashed panel with its own "certs ·
                previous work" sub-label, so an optional extra carried more
                chrome than the pitch field above it and competed with the
                earnings card for weight. Demoted to an inline text control on
                its own line inside the pitch group; the sub-label is folded
                into the accessible name rather than painted. Still ≥44px
                tall, still one tap. Hidden once expanded or when a file is
                already attached. */}
            {!optionsExpanded && (
              <button
                type="button"
                onClick={() => { hapticLight(); setShowMoreOptions(true); }}
                className="inline-flex items-center gap-1.5 min-h-[44px] -my-1 font-serif italic text-ds-12 active:opacity-70 transition-opacity"
                style={{ color: "hsl(var(--bark))" }}
                aria-expanded={false}
                aria-label="Add attachments — certificates or previous work"
              >
                <Plus className="w-3.5 h-3.5 shrink-0" strokeWidth={2.25} aria-hidden />
                <span>Add attachments</span>
              </button>
            )}
          </div>

          {optionsExpanded && (
            <>
              {showMoreOptions && applyFiles.length === 0 && (
                <button
                  type="button"
                  onClick={() => { hapticLight(); setShowMoreOptions(false); }}
                  className="mt-2 inline-flex items-center gap-1.5 min-h-[44px] font-serif italic text-ds-12 active:opacity-70 transition-opacity"
                  style={{ color: "hsl(var(--bark))" }}
                  aria-expanded
                >
                  <ChevronDown className="w-3.5 h-3.5 rotate-180" strokeWidth={2.25} aria-hidden />
                  <span>Hide Attachments</span>
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
              className="font-serif italic uppercase block text-ds-10"
              style={{ color: "hsl(var(--burnt-sienna))", letterSpacing: "0.18em" }}
            >
              Certs or previous work — optional
            </p>
            <div className="space-y-1.5">
              {applyFiles.map((file, i) => (
                <div
                  key={i}
                  className="flex items-center gap-2 text-ds-12 rounded-ds-md px-2.5 py-1.5"
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
                  className="inline-flex items-center gap-1.5 text-ds-12 font-sans font-semibold cursor-pointer active:opacity-70"
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
                        if (file.size > 5 * 1024 * 1024) { toast.error("File must be under 5 MB"); return; }
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
            className="flex items-center gap-1.5 font-serif italic text-ds-12 leading-snug -mt-1"
            style={{ color: "hsl(var(--burnt-sienna))" }}
            role="status"
          >
            <WifiOff className="w-3.5 h-3.5 shrink-0" />
            You're offline. We'll hold onto your pitch — apply again once you're back online.
          </p>
        )}
        {/* ONE footer row: dismiss on the left, commit on the right.
            It was two stacked full-width buttons (AlertDialogFooter is
            `flex-col-reverse` until `sm`), which gave a dismiss affordance the
            same visual weight as the action and cost a whole extra ~56px row
            on the smallest screens this dialog has to fit.

            Grid note for the fit spec: the footer is still the SECOND child of
            AlertDialogContent's grid and still lands in the `auto` track of
            `grid-rows-[minmax(0,1fr)_auto]` — that template is untouched, as is
            `min-w-0` on the body. Only this row's own flex direction changed.
            `!flex-row` overrides the primitive's mobile `flex-col-reverse`,
            `sm:!space-x-0` neutralises its `sm:space-x-2` so `gap-3` is the
            single source of spacing, and `justify-between` replaces the
            primitive's `sm:justify-end`. */}
        <AlertDialogFooter className="!flex-row !items-center !justify-between sm:!space-x-0">
          <AlertDialogCancel
            disabled={applyLoading}
            aria-label="Cancel"
            /* An icon, not a word — but named for what it DOES ("Cancel"), not
               for its glyph. `!w-11 h-11 p-0` overrides the primitive's
               `w-full sm:w-auto` + `size="lg"` padding; 44×44 is the HIG touch
               minimum, so the visual shrinks to an icon without the target
               shrinking with it. */
            className="rounded-full !w-11 h-11 p-0 shrink-0 bg-transparent border-transparent shadow-none text-muted-foreground hover:bg-secondary/60 hover:text-foreground active:translate-y-0"
          >
            <X className="w-5 h-5" strokeWidth={2} aria-hidden />
          </AlertDialogCancel>
          {/* `type="button"`: when offline we keep the dialog open (don't let
              AlertDialogAction's default close fire), so the held pitch stays
              on screen for an immediate retry. */}
          <AlertDialogAction
            type="button"
            onClick={(e) => { if (!online) e.preventDefault(); handleConfirm(); }}
            disabled={applyLoading}
            /* `!w-auto` drops the primitive's mobile `w-full` now that the two
               actions share a row; `flex-1` lets it take everything the 44px
               dismiss button leaves. `size="lg"` ships `px-8`, which is a lot
               of the width budget once 44px + a gap are spoken for — at 320 the
               dialog's content box is 232px, so the label would be left ~124px.
               `!px-4` on phones returns 32px of that; `sm:!px-8` restores the
               roomier padding as soon as there is room for it. `min-w-0` is the
               deliberate failure mode: if a label ever does outgrow the row it
               degrades inside its own box rather than pushing the footer past
               the dialog's right edge, which is the regression f0d11d0b fixed
               and apply-dialog-fit.spec.ts guards. */
            className="rounded-ds-md !w-auto flex-1 min-w-0 !px-4 sm:!px-8"
            style={{
              background: "hsl(var(--bark))",
              backgroundImage: "none",
              border: "1px solid hsl(var(--bark))",
              color: "hsl(var(--parchment))",
              fontFamily: "Montserrat, system-ui, sans-serif",
              fontWeight: 600,
              letterSpacing: "0.01em",
              boxShadow: "var(--elev-bark-raised)",
            }}
          >
            {applyLoading
              ? isInstantBook ? "Booking…" : "Applying…"
              : !online ? "Try Again" : isInstantBook ? "Book Now" : "Apply Now"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
