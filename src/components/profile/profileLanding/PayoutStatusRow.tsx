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
  "w-full flex items-center gap-2.5 rounded-ds-md border px-3 py-2.5 text-left";

type Shown = "setup" | "error";

/**
 * EVERY STATE IS THE SAME HEIGHT (reds, 2026-10-17). The box above was shared,
 * but the WORDS were not: the error copy is longer than the setup copy, and
 * "Retry" is narrower than "Set Up", so at 375 the error row wrapped to three
 * lines (67px) while the reserve, the setup row and the landing skeleton's
 * placeholder were two (52px). A failed status check therefore shoved the
 * settings list down 15px after the page had painted: page-settle /profile
 * 375 cls 0.0111 (~/.lh-shots/reds-1017/prof/).
 *
 * So the text and the action are each a one-cell grid holding BOTH states'
 * words, the one not shown `invisible` (hidden from sight and from the
 * button's accessible name). The cell is as tall as the taller copy and the
 * action as wide as the wider label, at every width, in every state, including
 * the reserve and the skeleton (which renders this row's reserve). Change a
 * copy and every state follows by construction.
 */
function StackedCopy({ shown }: { shown: Shown | null }) {
  const cell = (s: Shown) => `[grid-area:1/1] ${shown === s ? "" : "invisible"}`.trim();
  return (
    <>
      <p className="flex-1 min-w-0 grid items-center text-ds-11 text-foreground leading-snug psr-body">
        {/* Accept-first (owner, 2026-10-07, Q1399): payouts are how you get
            PAID; they never stand between a Helpr and accepting a job. */}
        <span className={cell("setup")} data-payout-copy="setup">
          <span className="font-semibold">Finish setting up</span> — add your payout account so you can get paid.
        </span>
        {/* Burnt-sienna, not destructive red: we have NOT established that
            anything is wrong with the account — only that we couldn't ask. The
            row claims exactly that much, and its action is to ask again. */}
        <span className={cell("error")} data-payout-copy="error">
          <span className="font-semibold">We couldn't check your payout account.</span> Check it before you count on getting paid.
        </span>
      </p>
      <span
        className="shrink-0 grid items-center text-ds-11 font-semibold psr-action"
        style={{ color: "hsl(var(--burnt-sienna))" }}
      >
        <span className={`${cell("setup")} inline-flex items-center gap-0.5 justify-end`} data-payout-action="setup">
          Set Up <ChevronRightIcon className="w-3.5 h-3.5" strokeWidth={2.25} />
        </span>
        <span className={`${cell("error")} inline-flex items-center gap-0.5 justify-end`} data-payout-action="error">
          Retry <RefreshCw className="w-3.5 h-3.5" strokeWidth={2.25} />
        </span>
      </span>
    </>
  );
}

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
        <StackedCopy shown="error" />
      </button>
    );
  }

  // `reserve` renders the SETUP banner's exact markup, held open but wearing
  // a neutral loading fill with its contents hidden — so it occupies the
  // right height while asserting nothing. It is rendered whenever the status
  // question is still open; see `useStripeConnectStatus`.
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
      <StackedCopy shown={reserving ? null : "setup"} />
    </button>
  );
}
