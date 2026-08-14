import { Check } from "lucide-react";

interface CheckoutStepIndicatorProps {
  /** Jump back to step 1 (the form). */
  onBackToForm: () => void;
}

/**
 * Top-of-checkout step rail — "1 · Details ✓  →  2 · Pay (active)".
 *
 * Mirrors the SectionProgress rail's visual language so the poster sees
 * the same shape on both steps. Step 1 is a real button that takes the
 * poster back to the form (the only way back besides the page-header
 * back arrow), which directly solves "tap step 1 from step 2".
 *
 * Pure presentational — onBackToForm is wired by CheckoutStepView to
 * usePostJobForm.setStep("form").
 */
export function CheckoutStepIndicator({ onBackToForm }: CheckoutStepIndicatorProps) {
  return (
    <div
      role="group"
      aria-label="Post a job — step 2 of 2: review and pay"
      className="flex items-center"
    >
      {/* STEP 1 — Form (done, tappable to go back) */}
      <button
        type="button"
        onClick={onBackToForm}
        aria-label="Go back to edit job details"
        className="group flex min-h-[44px] items-center gap-1.5 rounded-full pr-1 transition-transform active:scale-[0.97]"
      >
        <span
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-ds-10 font-sans font-bold tabular-nums transition-all duration-300 ease-ds-out"
          style={{
            background: "hsl(var(--bark))",
            color: "hsl(var(--parchment))",
          }}
        >
          <Check className="h-3 w-3" strokeWidth={3} />
        </span>
        <span
          className="font-sans font-semibold uppercase tracking-wider text-ds-10"
          style={{
            color: "hsl(var(--bark))",
          }}
        >
          Details
        </span>
      </button>

      {/* Connector — filled because step 1 is done */}
      <span
        className="mx-1 h-px flex-1 rounded-full"
        style={{ background: "hsl(var(--bark) / 0.55)" }}
      />

      {/* STEP 2 — Pay (active, not tappable; user is already here) */}
      <div
        className="flex min-h-[44px] items-center gap-1.5 rounded-full pr-1"
        aria-current="step"
      >
        <span
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-ds-10 font-sans font-bold tabular-nums"
          style={{
            background: "hsla(0, 0%, 100%, 0.85)",
            color: "hsl(var(--bark))",
            boxShadow: "0 0 0 2px hsl(var(--bark) / 0.55)",
          }}
        >
          2
        </span>
        <span
          className="font-sans font-semibold uppercase tracking-wider text-ds-10"
          style={{
            color: "hsl(var(--ink-deep))",
          }}
        >
          Review and pay
        </span>
      </div>
    </div>
  );
}
