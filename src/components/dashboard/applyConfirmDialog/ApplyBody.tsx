import { useEffect, useState } from "react";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { FileText, Paperclip, Trash2, WifiOff, BookmarkCheck, ChevronDown, Plus } from "lucide-react";
import { toast } from "sonner";
import { errorToast } from "@/lib/toast";
import { hapticMedium, hapticLight } from "@/lib/haptics";
import { useOnlineStatus } from "@/lib/useOnlineStatus";
import { safeStorage } from "@/lib/safeStorage";
import type { ApplyConfirmDialogProps } from "./types";
import { ApplyEarningsBreakdown } from "./ApplyEarningsBreakdown";
import {
  MAX_PITCH_LENGTH,
  pitchDraftKey,
  LEGACY_PITCH_DRAFT_KEY,
  TEMPLATE_KEY,
  getApplyTips,
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
};

/** Counter appears with this much room left, not before. */
const COUNTER_VISIBLE_FROM = MAX_PITCH_LENGTH - 100;

export function ApplyBody({
  open,
  confirmApplyJob,
  platformFee,
  applyMessage,
  setApplyMessage,
  applyFiles,
  setApplyFiles,
  applyLoading,
  handleApplyConfirm,
}: Props) {
  const { online } = useOnlineStatus();
  const isInstantBook = !!(confirmApplyJob as any)?.instant_book;
  const jobId = confirmApplyJob?.id ?? null;
  const draftKey = pitchDraftKey(jobId);
  const [saveAsTemplate, setSaveAsTemplate] = useState(false);
  const [showMoreOptions, setShowMoreOptions] = useState(false);
  const optionsExpanded = showMoreOptions || applyFiles.length > 0;

  const savedTemplate = safeStorage.getItem(TEMPLATE_KEY);
  const differsFromTemplate = !!applyMessage.trim() && applyMessage !== savedTemplate;

  // The single job-specific hint, as the field's placeholder. getApplyTips can
  // return two; the second was always the weaker of the pair and a placeholder
  // holds one sentence.
  const tips = getApplyTips({
    is_urgent: confirmApplyJob?.is_urgent,
    budget: confirmApplyJob?.budget,
    date_needed: confirmApplyJob?.date_needed,
    category: confirmApplyJob?.category,
  });
  const placeholder = tips[0] ?? "Introduce yourself or share relevant experience…";

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

      {confirmApplyJob && (
        <ApplyEarningsBreakdown confirmApplyJob={confirmApplyJob} platformFee={platformFee} />
      )}

      <div className="space-y-1.5">
        {/* ONE prompt for the pitch. Sans, sentence case — the small-caps
            italic burnt-sienna eyebrow it replaces was styled like a section
            masthead for what is an optional note field. */}
        <div className="flex items-baseline justify-between gap-2">
          <label htmlFor="apply-message" className="font-sans font-semibold text-ds-13" style={{ color: "hsl(var(--ink-deep))" }}>
            Add a note{" "}
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
          placeholder={placeholder}
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

        {!optionsExpanded && (
          <button
            type="button"
            onClick={() => { hapticLight(); setShowMoreOptions(true); }}
            className="inline-flex items-center gap-1.5 min-h-[44px] -my-1 font-sans text-ds-12 active:opacity-70 transition-opacity"
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
        <div className="space-y-1.5">
          {showMoreOptions && applyFiles.length === 0 && (
            <button
              type="button"
              onClick={() => { hapticLight(); setShowMoreOptions(false); }}
              className="inline-flex items-center gap-1.5 min-h-[44px] font-sans text-ds-12 active:opacity-70 transition-opacity"
              style={{ color: "hsl(var(--bark))" }}
              aria-expanded
            >
              <ChevronDown className="w-3.5 h-3.5 rotate-180" strokeWidth={2.25} aria-hidden />
              <span>Hide attachments</span>
            </button>
          )}
          {/* Section heading, not a label: the file input below is wrapped in
              its own inner <label>, which is the real picker affordance. */}
          <p className="font-sans font-semibold text-ds-12" style={{ color: "hsl(var(--ink-deep))" }}>
            Certs or previous work{" "}
            <span className="font-normal" style={{ color: "hsl(var(--olivewood) / 0.7)" }}>
              (optional)
            </span>
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
                      if (file.size > 5 * 1024 * 1024) { toast.error("File must be under 5 MB."); return; }
                      setApplyFiles(f => [...f, file]);
                    }
                    e.target.value = "";
                  }}
                />
              </label>
            )}
          </div>
        </div>
      )}

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

      <button
        type="button"
        onClick={handleConfirm}
        disabled={applyLoading}
        className="w-full min-w-0 rounded-ds-md px-4 disabled:opacity-60"
        style={{
          /* Inline, not `min-h-[52px]`. index.css sets a bare
             `button { min-height: 44px }` for the HIG touch minimum and that
             base rule wins over the Tailwind arbitrary utility here, so the
             class silently rendered a 44px button — measured. This is the
             step's single commit action and reads as one. */
          minHeight: "52px",
          background: "hsl(var(--bark))",
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
      </button>
    </div>
  );
}
