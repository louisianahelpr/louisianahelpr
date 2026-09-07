import { useState } from "react";
import { ChevronRight as ChevronRightIcon, Hourglass, ShieldCheck } from "lucide-react";
import { IDVPromptDialog } from "@/components/IDVPromptDialog";
import { useOnboardingFeeCents, formatFeeLabel } from "@/hooks/useOnboardingFee";
import {
  verificationPromptFor,
  verificationPromptCopy,
  type VerificationPrompt,
} from "./verificationPrompt";
import type { Profile } from "./types";

/**
 * Same box geometry as `PayoutStatusRow` — these two sit in one card and are
 * the same kind of statement ("here is what still stands between you and
 * working"), so they must not be two different shapes.
 */
const BOX =
  "w-full flex items-center gap-2.5 rounded-ds-md border px-3 py-2.5 text-left transition-all";

/**
 * The ID-verification slot on the Profile landing.
 *
 * This is the surface that did not exist. See `verificationPrompt.ts` for what
 * was measured and why identity blocks both posting and being hired.
 *
 * Three deliberate choices:
 *
 *  1. It renders NOTHING once `idv_status = 'verified'`. A permanent green
 *     "you're verified" row would be a trophy case on a settings screen; the
 *     earned badge in `IdentityHeader` already says it.
 *  2. The waiting states are rows, not buttons, and carry no CTA — there is
 *     genuinely nothing to press, and offering one would be the "affordance
 *     for an action that will be refused" this codebase keeps shipping.
 *  3. The setup fee is named in the row, before the tap. It used to arrive as
 *     a 402 from `stripe-idv-start` after the member had already committed to
 *     the flow.
 */
export function VerificationStatusRow({ profile }: { profile: Profile | null }) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const feeLabel = formatFeeLabel(useOnboardingFeeCents());
  const prompt = verificationPromptFor(profile);
  const copy = verificationPromptCopy(prompt, feeLabel);

  if (!copy) return null;

  const waiting = prompt.kind === "in_progress" || prompt.kind === "manual_review";
  const Icon = waiting ? Hourglass : ShieldCheck;

  // Sienna for the actionable state, matching PayoutStatusRow: nothing is
  // WRONG, something is unfinished. The waiting states go quiet olivewood —
  // they are information, not a nudge, and painting them the same amber as an
  // outstanding task would ask for an action that does not exist.
  const tone = waiting
    ? { borderColor: "hsl(var(--olivewood) / 0.18)", background: "hsl(var(--olivewood) / 0.06)" }
    : { borderColor: "hsl(var(--burnt-sienna) / 0.3)", background: "hsl(var(--burnt-sienna) / 0.06)" };
  const accent = waiting ? "hsl(var(--olivewood))" : "hsl(var(--burnt-sienna))";

  const content = (
    <>
      <Icon className="w-4 h-4 shrink-0" style={{ color: accent }} strokeWidth={2.25} />
      <p className="flex-1 min-w-0 text-ds-11 text-foreground leading-snug">
        <span className="font-semibold">{copy.headline}</span> {copy.body}
      </p>
      {copy.action && (
        <span
          className="shrink-0 text-ds-11 font-semibold inline-flex items-center gap-0.5"
          style={{ color: accent }}
        >
          {copy.action} <ChevronRightIcon className="w-3.5 h-3.5" strokeWidth={2.25} />
        </span>
      )}
    </>
  );

  return (
    <>
      {copy.action ? (
        <button
          type="button"
          onClick={() => setDialogOpen(true)}
          className={`${BOX} active:scale-[0.99]`}
          style={tone}
        >
          {content}
        </button>
      ) : (
        // A div, not a disabled button: there is no action here, and a
        // 44px-tall control that does nothing when tapped reads as broken.
        <div className={BOX} style={tone} role="status">
          {content}
        </div>
      )}

      <IDVPromptDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        // `undefined` for the start/resume states so the dialog shows its
        // first-run "here is what we'll ask for" body with a Start button —
        // which is also the resume path, because `stripe-idv-start` reuses an
        // existing `requires_input` session before it reaches the cost gate.
        status={prompt.kind === "start" ? undefined : prompt.kind === "in_progress" ? "processing" : "manual_review"}
        failureReason={profile?.idv_failure_reason ?? undefined}
        // Disclosed up front rather than discovered as a 402. NOT passed as
        // `context: "job_post"` — that flag makes the server SKIP the fee gate
        // because the $2 rides on a job payment being collected in the same
        // breath, and there is no job payment here.
        feeDue={prompt.kind === "start" && prompt.feeDue}
        feeLabel={feeLabel}
        reason={reasonFor(prompt)}
      />
    </>
  );
}

/** Why the dialog is open, in the member's own terms. */
function reasonFor(prompt: VerificationPrompt): string | undefined {
  if (prompt.kind !== "start") return undefined;
  return prompt.hireOnlyCleared
    ? "Helpr needs a quick ID + selfie check before you can post a job. It's the same check every member does."
    : "Helpr needs a quick ID + selfie check before you can post a job or accept one. It protects everyone letting a stranger into their home.";
}
