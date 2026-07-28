import { useEffect, useState } from "react";
import { Info, Lock } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { safeStorage } from "@/lib/safeStorage";

/**
 * Storage key tracked by safeStorage's `helpr_` prefix, so the
 * "seen" flag survives WebKit eviction on iOS Capacitor and the
 * customer doesn't get re-nudged forever.
 */
export const ESCROW_EXPLAINER_SEEN_KEY = "helpr_escrow_explainer_seen_at";

interface EscrowExplainerProps {
  /**
   * Optional ARIA label override for the info trigger. Mostly here so
   * tests can grab it deterministically.
   */
  triggerLabel?: string;
  /**
   * Force the auto-open nudge state for storybook / tests. When omitted
   * we derive it from `safeStorage` (first-time customer → true).
   */
  forceFirstTime?: boolean;
}

/**
 * First-time escrow reassurance.
 *
 * Renders an inline "Held in escrow until complete" pill (always shown —
 * passive reassurance for everyone) plus a small info button that
 * auto-opens a popover the FIRST time a customer reaches the payment
 * confirmation step. Once opened or dismissed, we stamp localStorage so
 * the auto-open nudge doesn't fire again. The info button itself stays
 * available for repeat customers who want a refresher.
 *
 * Suppression is purely client-side: there's no `jobs_paid_count`
 * column on `profiles`, so reaching for the DB here would be over-built.
 * localStorage (mirrored via safeStorage to Capacitor Preferences for
 * iOS durability) is the right granularity for a soft nudge.
 */
export function EscrowExplainer({
  triggerLabel = "How payment works",
  forceFirstTime,
}: EscrowExplainerProps = {}) {
  // Lazy-init from storage so we don't flash the popover on remount.
  // `forceFirstTime` takes precedence when explicitly supplied.
  const [open, setOpen] = useState<boolean>(() => {
    if (typeof forceFirstTime === "boolean") return forceFirstTime;
    return safeStorage.getItem(ESCROW_EXPLAINER_SEEN_KEY) === null;
  });

  // Stamp "seen" as soon as the popover opens. We do it on open (not on
  // first render) so users who never see the trigger — e.g. they bail
  // before the checkout step finishes mounting — still get nudged next
  // time. Idempotent: overwriting the timestamp is fine.
  useEffect(() => {
    if (!open) return;
    if (safeStorage.getItem(ESCROW_EXPLAINER_SEEN_KEY) !== null) return;
    safeStorage.setItem(ESCROW_EXPLAINER_SEEN_KEY, Date.now().toString());
  }, [open]);

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {/* Inline pill — passive reassurance, stays for everyone. */}
      <span
        className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-ds-11 font-medium"
        style={{
          background: "hsl(var(--parchment))",
          color: "hsl(var(--bark))",
          border: "0.5px solid hsl(var(--bark) / 0.28)",
        }}
      >
        <Lock className="w-3 h-3" strokeWidth={2.25} aria-hidden />
        Held securely until complete
      </span>

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label={triggerLabel}
            className="inline-flex items-center justify-center w-10 h-10 rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            style={{ color: "hsl(var(--bark))" }}
          >
            <Info className="w-4 h-4" strokeWidth={2.25} aria-hidden />
          </button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          sideOffset={6}
          className="w-72 rounded-2xl shadow-lg"
          style={{
            background: "hsl(var(--parchment))",
            color: "hsl(var(--bark))",
            border: "0.5px solid hsl(var(--bark) / 0.28)",
          }}
        >
          <div className="space-y-2">
            <p
              className="font-display font-semibold text-ds-13"
              style={{ color: "hsl(var(--olivewood))" }}
            >
              How payment works
            </p>
            <p
              className="text-ds-11 leading-snug"
              style={{ color: "hsl(var(--bark))" }}
            >
              Your payment is held securely until the job is verified
              complete — then it&apos;s released to your Helpr.
              You&apos;re never charged for unfinished work.
            </p>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
