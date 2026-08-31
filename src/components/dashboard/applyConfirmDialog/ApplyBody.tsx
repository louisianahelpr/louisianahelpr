import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { WifiOff, BookmarkCheck, ChevronLeft } from "lucide-react";
import { errorToast } from "@/lib/toast";
import { hapticMedium } from "@/lib/haptics";
import { useOnlineStatus } from "@/lib/useOnlineStatus";
import { safeStorage } from "@/lib/safeStorage";
import type { ApplyConfirmDialogProps } from "./types";
import { ApplyEarningsBreakdown } from "./ApplyEarningsBreakdown";
import {
  MAX_PITCH_LENGTH,
  pitchDraftKey,
  LEGACY_PITCH_DRAFT_KEY,
  TEMPLATE_KEY,
} from "./applyConfirmDialogHelpers";

/**
 * ApplyBody — everything on the apply step except the surface it sits on.
 *
 * Extracted from ApplyConfirmDialog so the SAME markup can render in two
 * places: in-place as the second step of the job-detail sheet (the normal
 * route, see JobDetailDialog), and inside a standalone sheet for the
 * QuickApply deep link, where there is no detail sheet to step out of.
 *
 * What changed when it moved (owner, 2026-08-28 — "I don't like this"):
 *
 *  - THE CHIPS ARE GONE. Three pills ("Free Sunday", "Done this before", "Any
 *    questions?") sat above the field, and two hint bullets sat above them,
 *    and the field had a placeholder of its own — three separate invitations
 *    to write the same optional sentence, in the densest part of the screen.
 *    The one genuinely job-specific hint survives as the PLACEHOLDER, which is
 *    where you are already looking when you decide what to type.
 *  - The "30+ characters feels personal" line is gone. It coached the helper
 *    on a threshold nothing enforces, in a slot that then had to also say
 *    "Nice — that reads personal", which is the app congratulating someone for
 *    typing.
 *  - The counter only appears near the cap, where it is information rather
 *    than pressure.
 *
 * Two things this must keep doing, unchanged from the dialog it came from:
 *  1. The pitch is OPTIONAL. Nothing here may read as a required form.
 *  2. The earnings block is the anchor — the only card on the step.
 */

type Props = ApplyConfirmDialogProps & {
  /** Renders the submit button; the sheet chrome supplies nothing. */
  submitLabelIdle?: string;
  /** Called after a successful local confirm, so a host sheet can step back. */
  className?: string;
  /**
   * Skip the "You earn $X" earnings card. Set by JobDetailDialog, which now
   * renders this inline on the SAME screen as the job's own price pill
   * (owner, 2026-08-30: "delete [the separate apply step]" — merged into
   * one screen) — showing the payout twice on one screen read as
   * redundant. The standalone QuickApply sheet has no price shown
   * elsewhere, so it keeps the card (this defaults to false).
   */
  hideEarnings?: boolean;
  /**
   * Collapses the inline form back to the plain footer (owner, 2026-08-30:
   * "add back button to left" — the merged-into-one-screen apply form still
   * needs a way to back out of it besides closing the whole sheet). Renders
   * a small icon button to the left of Apply Now when supplied; omitted
   * entirely for the standalone QuickApply sheet, which has no "back" state
   * to return to.
   */
  onBack?: () => void;
};

/** Counter appears with this much room left, not before. */
const COUNTER_VISIBLE_FROM = MAX_PITCH_LENGTH - 100;

export function ApplyBody({
  open,
  confirmApplyJob,
  platformFee,
  applyMessage,
  setApplyMessage,
  applyLoading,
  handleApplyConfirm,
  hideEarnings = false,
  onBack,
}: Props) {
  const { online } = useOnlineStatus();
  const isInstantBook = !!(confirmApplyJob as any)?.instant_book;
  const jobId = confirmApplyJob?.id ?? null;
  const draftKey = pitchDraftKey(jobId);
  const [saveAsTemplate, setSaveAsTemplate] = useState(false);

  const savedTemplate = safeStorage.getItem(TEMPLATE_KEY);
  const differsFromTemplate = !!applyMessage.trim() && applyMessage !== savedTemplate;

  // No placeholder on the note field (owner, 2026-08-29). It carried a coaching
  // tip ("Higher-budget jobs go to Helprs who mention relevant experience"),
  // which is the app telling someone how to win a job inside the box where they
  // are trying to write. The label already says "Add a note (optional)".

  // Restore a saved draft for THIS job when the step (re)opens with an empty
  // field — per-job scoping so switching jobs doesn't bleed text between
  // unrelated pitches. One-time migration of the legacy single draft key so a
  // pre-update in-flight pitch isn't lost on the upgrade.
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
      safeStorage.setItem(draftKey, legacy);
      safeStorage.removeItem(LEGACY_PITCH_DRAFT_KEY);
    }
    // Intentionally keyed on `open` + jobId only — restore once per open.

  }, [open, jobId]);

  // When no draft was found, pre-fill from the saved pitch template so the
  // helpr doesn't start from a blank field every time.
  useEffect(() => {
    if (!open) return;
    const template = safeStorage.getItem(TEMPLATE_KEY);
    if (template && !applyMessage) {
      setApplyMessage(template);
    }
    // Fire once per open; applyMessage intentionally omitted so we don't loop.

  }, [open]);

  // Auto-save the in-progress pitch, so stepping back or dismissing the sheet
  // never loses what the helpr typed.
  useEffect(() => {
    if (!open || !jobId) return;
    if (applyMessage.length === 0) {
      safeStorage.removeItem(draftKey);
      return;
    }
    const handle = setTimeout(() => safeStorage.setItem(draftKey, applyMessage), 200);
    return () => clearTimeout(handle);
  }, [open, jobId, draftKey, applyMessage]);

  const handleConfirm = () => {
    hapticMedium();
    // Offline: don't fire a mutation that rolls back silently. Persist the
    // pitch and keep the step up with a clear retry affordance instead.
    if (!online) {
      if (applyMessage) safeStorage.setItem(draftKey, applyMessage);
      errorToast("You're offline", {
        description: "We saved your pitch. Try again once you're back online.",
        critical: true,
        id: "apply-offline",
        onRetry: () => {
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
    <div className="min-w-0 flex flex-col gap-3.5">
      {!confirmApplyJob && (
        <p className="font-sans text-ds-13 leading-relaxed" style={{ color: "hsl(var(--olivewood) / 0.85)" }}>
          Are you sure you want to proceed?
        </p>
      )}

      {confirmApplyJob && !hideEarnings && (
        <ApplyEarningsBreakdown confirmApplyJob={confirmApplyJob} platformFee={platformFee} />
      )}

      <div className="space-y-1.5">
        {/* ONE prompt for the pitch. Sans, sentence case — the small-caps
            italic burnt-sienna eyebrow it replaces was styled like a section
            masthead for what is an optional note field. */}
        <div className="flex items-baseline justify-between gap-2">
          <label htmlFor="apply-message" className="font-sans font-semibold text-ds-13" style={{ color: "hsl(var(--ink-deep))" }}>
            Note to the poster{" "}
            <span className="font-normal" style={{ color: "hsl(var(--olivewood) / 0.7)" }}>
              (optional)
            </span>
          </label>
          {applyMessage.length >= COUNTER_VISIBLE_FROM && (
            <span
              className="font-sans tabular-nums text-ds-11 shrink-0"
              style={{
                color: MAX_PITCH_LENGTH - applyMessage.length < 50
                  ? "hsl(var(--burnt-sienna))"
                  : "hsl(var(--muted-foreground))",
              }}
            >
              {applyMessage.length}/{MAX_PITCH_LENGTH}
            </span>
          )}
        </div>

        <Textarea
          id="apply-message"
          value={applyMessage}
          onChange={(e) => setApplyMessage(e.target.value.slice(0, MAX_PITCH_LENGTH))}
          maxLength={MAX_PITCH_LENGTH}
          rows={3}
          className="rounded-ds-md bg-background/60 border-border/60 focus-visible:bg-background focus-visible:border-primary/40 font-sans text-ds-14 leading-relaxed"
        />

        {/* Saved pitch, as ONE control instead of two. Restoring the template
            and saving a new one used to be a sage text button above the field
            and a checkbox below it, both visible at once even when they
            contradicted each other. Now only the applicable one renders. */}
        {savedTemplate && applyMessage !== savedTemplate && (
          <button
            type="button"
            onClick={() => setApplyMessage(savedTemplate)}
            className="inline-flex items-center gap-1.5 font-sans text-ds-12 min-h-[32px] active:opacity-70"
            style={{ color: "hsl(var(--bark))" }}
          >
            <BookmarkCheck className="w-3.5 h-3.5" />
            Use saved pitch
          </button>
        )}
        {differsFromTemplate && (
          <label htmlFor="save-default-pitch" className="flex items-center gap-2 cursor-pointer min-h-[44px] -my-1">
            <Checkbox
              id="save-default-pitch"
              checked={saveAsTemplate}
              onCheckedChange={(checked) => setSaveAsTemplate(checked === true)}
            />
            <span className="font-sans text-ds-12 text-muted-foreground">Save as my default pitch</span>
          </label>
        )}

      </div>

      {/* NO per-application file picker (owner, 2026-08-29). Certificates and
          work photos are uploaded ONCE on the profile (Edit Profile → Recent
          work) and posters see them on the applicant's profile via
          HelperWorkPhotos — so re-attaching the same file on every application
          was pure repeated work. Existing applications keep their stored
          `attachment_urls`; ApplicantsPanel still renders them. */}

      {!online && (
        <p
          className="flex items-center gap-1.5 font-sans text-ds-12 leading-snug"
          style={{ color: "hsl(var(--burnt-sienna))" }}
          role="status"
        >
          <WifiOff className="w-3.5 h-3.5 shrink-0" />
          You're offline. We'll hold onto your pitch — apply again once you're back online.
        </p>
      )}

      <div className="flex gap-1.5">
        {/* Back — collapses the inline form to the plain footer instead of
            closing the whole sheet (owner: "add back button to left"). Only
            JobDetailDialog's merged-into-one-screen flow passes `onBack`;
            the standalone QuickApply sheet has nothing to collapse back to. */}
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            aria-label="Back"
            className="shrink-0 w-11 h-11 sm:w-12 sm:h-12 rounded-ds-md flex items-center justify-center btn-press"
            style={{ border: "0.5px solid hsl(var(--bark) / 0.28)", color: "hsl(var(--bark))" }}
          >
            <ChevronLeft className="w-4 h-4" strokeWidth={2.25} />
          </button>
        )}
        {/* Same primitive and surface as the "Continue" CTA that leads here
            (JobDetailFooter) — one button, one set of effects: the gradient
            wash, the hover brighten/lift/glow and the active press collapse
            all come from <Button>'s primary variant. */}
        <Button
          size="lg"
          type="button"
          onClick={handleConfirm}
          disabled={applyLoading}
          className="btn-liquid-fill flex-1 min-w-0 rounded-ds-md h-11 sm:h-12 px-4 group relative overflow-hidden disabled:opacity-60"
          style={{
            background:
              "linear-gradient(180deg, hsl(var(--bark)) 0%, hsl(var(--bark) / 0.86) 100%)",
            border: "0.5px solid hsl(var(--bark))",
            fontFamily: "Montserrat, system-ui, sans-serif",
            fontWeight: 600,
            letterSpacing: "0.01em",
            boxShadow:
              "inset 0 1px 1px 0 rgba(255, 255, 255, 0.25), " +
              "inset 0 -1px 1px 0 rgba(0, 0, 0, 0.18), " +
              "0 1px 2px hsl(var(--olivewood) / 0.12), " +
              "0 8px 22px -6px hsl(var(--bark) / 0.45)",
          }}
        >
          <span
            className="relative z-10"
            style={{ color: "white", textShadow: "0 1px 2px rgba(0, 0, 0, 0.28)" }}
          >
            {applyLoading
              ? isInstantBook ? "Booking…" : "Applying…"
              : !online ? "Try Again" : isInstantBook ? "Book Now" : "Apply Now"}
          </span>
        </Button>
      </div>
    </div>
  );
}
