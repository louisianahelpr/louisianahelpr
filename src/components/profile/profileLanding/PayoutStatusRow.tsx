import { AlertTriangle, ChevronRight as ChevronRightIcon, RefreshCw } from "lucide-react";
import type { PayoutPrompt } from "@/hooks/useStripeConnectStatus";

interface PayoutStatusRowProps {
  prompt: PayoutPrompt;
  /** Open Payment Settings (the payout-setup destination). */
  onSetUp: () => void;
  /** Re-ask Stripe after a failed status check. */
  onRetry: () => void;
}

/**
 * Shared box geometry for every state of this slot. It is deliberately ONE
 * string used by all three rendered variants, including the invisible
 * placeholder: the whole point of reserving the slot is that the reserved
 * height equals the real height exactly, and the only way to guarantee that
 * is for the placeholder to be the same element with the same padding, the
 * same border width, and the same text at the same size. (Both are
 * `<button>`, so they also share the global 44px min tap target — a `<div>`
 * spacer would silently come out shorter.)
 */
const BOX =
  "w-full flex items-center gap-2.5 rounded-ds-md border px-3 py-2.5 text-left transition-all";

/**
 * The payout slot at the top of the Profile settings card.
 *
 * This used to be an inline `stripeConnectStatus && !payouts_enabled` check
 * in `SettingsSection`, which had two problems the owner hit on device:
 *
 *  1. `null` (status unknown) rendered NOTHING, so the whole landing painted
 *     and settled and then the banner appeared at the top and shoved every
 *     row below it down. See the `reserve` state below.
 *  2. A failed status call was indistinguishable from a healthy account.
 *     "We couldn't check" is now its own visible state — an unpaid user is
 *     never told, by silence, that everything is fine.
 */
export function PayoutStatusRow({ prompt, onSetUp, onRetry }: PayoutStatusRowProps) {
  if (prompt.kind === "none") return null;

  if (prompt.kind === "error") {
    // Burnt-sienna, not destructive red: we have NOT established that
    // anything is wrong with the account — only that we couldn't ask. The
    // row claims exactly that much, and its action is to ask again.
    return (
      <button
        type="button"
        onClick={onRetry}
        className={`${BOX} active:scale-[0.99]`}
        style={{
          borderColor: "hsl(var(--burnt-sienna) / 0.3)",
          background: "hsl(var(--burnt-sienna) / 0.06)",
        }}
      >
        <AlertTriangle className="w-4 h-4 shrink-0" style={{ color: "hsl(var(--burnt-sienna))" }} />
        <p className="flex-1 min-w-0 text-ds-11 text-foreground leading-snug">
          <span className="font-semibold">We couldn't check your payout account.</span> Check it before you count on getting paid.
        </p>
        <span
          className="shrink-0 text-ds-11 font-semibold inline-flex items-center gap-0.5"
          style={{ color: "hsl(var(--burnt-sienna))" }}
        >
          Retry <RefreshCw className="w-3.5 h-3.5" strokeWidth={2.25} />
        </span>
      </button>
    );
  }

  // `reserve` renders the SETUP banner's exact markup, held open but wearing
  // a neutral loading fill with its contents hidden — so it occupies the
  // right height while asserting nothing. It is only ever rendered when the
  // last answer this device saw said payouts were off, i.e. when the banner
  // is genuinely about to appear; see `useStripeConnectStatus`.
  const reserving = prompt.kind === "reserve";

  return (
    <button
      type="button"
      disabled={reserving}
      aria-hidden={reserving || undefined}
      tabIndex={reserving ? -1 : undefined}
      onClick={reserving ? undefined : onSetUp}
      className={
        reserving
          ? `${BOX} border-transparent [&>*]:invisible motion-safe:animate-pulse`
          : `${BOX} active:scale-[0.99]`
      }
      style={
        reserving
          ? { background: "hsl(var(--olivewood) / 0.07)" }
          // Sienna, not destructive red (owner, 2026-08-24: "calm the
          // alarms") — nothing is WRONG, something is unfinished. Red on
          // this screen now belongs to Warnings & Strikes alone.
          : {
              borderColor: "hsl(var(--burnt-sienna) / 0.3)",
              background: "hsl(var(--burnt-sienna) / 0.06)",
            }
      }
    >
      <AlertTriangle className="w-4 h-4 shrink-0" style={{ color: "hsl(var(--burnt-sienna))" }} />
      <p className="flex-1 min-w-0 text-ds-11 text-foreground leading-snug">
        <span className="font-semibold">Finish setting up</span> — add your payout account to accept jobs and get paid.
      </p>
      <span
        className="shrink-0 text-ds-11 font-semibold inline-flex items-center gap-0.5"
        style={{ color: "hsl(var(--burnt-sienna))" }}
      >
        Set Up <ChevronRightIcon className="w-3.5 h-3.5" strokeWidth={2.25} />
      </span>
    </button>
  );
}
