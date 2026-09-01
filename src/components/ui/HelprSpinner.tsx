/**
 * HelprSpinner — the branded loading indicator.
 *
 * Why this exists
 * ---------------
 * We were using lucide's `Loader2` (a thin generic spinning ring) on full-page
 * loaders, route guards, payment processing, and other "wait a beat" surfaces.
 * It looks identical to every other React app. This component swaps in the
 * wrought-iron Helpr H emblem (the same mark in our navbar and app icon) so
 * the brand is reinforced during the small dead moments of the app instead of
 * a generic Tailwind UI lookalike.
 *
 * Why the 600ms delay
 * -------------------
 * Most loading states resolve in well under half a second on a warm
 * cache. Flashing a spinner up for ~150ms and then ripping it back down
 * actually feels *worse* than no spinner at all — the user reads it as
 * jank, not feedback. The conventional perceptual threshold for "this
 * is taking a moment" is around 400-1000ms, so 600ms is a sweet spot:
 * anything faster than that and the user already has their answer, so we
 * deliberately render NOTHING during that grace period. Only loads that
 * actually take long enough to register get the branded spinner.
 *
 * Override `delay={0}` only for surfaces where you have prior knowledge
 * the operation always takes >1s (e.g. Stripe payout creation) and you
 * want immediate "we got it" feedback.
 *
 * Why a slow rotation (1.4s linear)
 * ---------------------------------
 * The default `animate-spin` is 1s, which feels impatient and a little
 * cheap for a premium brand. 1.4s linear is calm and confident — it
 * reads as "we're working on it" rather than "hurry up".
 */

import { useEffect, useState } from "react";
import helprLogoSm from "@/assets/helpr-logo-96.webp";

interface HelprSpinnerProps {
  /** Pixel size of the mark. Default 24. */
  size?: number;
  /** Extra wrapper classes. */
  className?: string;
  /**
   * Milliseconds to wait before rendering anything. Loads that resolve
   * faster than this never paint a spinner at all (perceptually faster).
   * Default 600ms. Pass 0 to opt out.
   */
  delay?: number;
}

/**
 * Tiny hook: returns true only after `delay` ms have elapsed since mount.
 * Inlined here so the spinner is fully self-contained and tree-shakeable.
 */
function useDelayedRender(delay: number): boolean {
  const [ready, setReady] = useState(delay <= 0);
  useEffect(() => {
    if (delay <= 0) return;
    const id = window.setTimeout(() => setReady(true), delay);
    return () => window.clearTimeout(id);
  }, [delay]);
  return ready;
}

export const HelprSpinner = ({
  size = 24,
  className = "",
  delay = 600,
}: HelprSpinnerProps) => {
  const ready = useDelayedRender(delay);
  if (!ready) return null;

  return (
    <span
      role="status"
      aria-live="polite"
      className={`inline-flex items-center justify-center ${className}`.trim()}
    >
      <img
        src={helprLogoSm}
        alt=""
        aria-hidden="true"
        draggable={false}
        width={size}
        height={size}
        className="select-none motion-safe:animate-[spin_1.4s_linear_infinite]"
        style={{
          width: size,
          height: size,
          // Same warm Olivewood lift we use on the static mark so the
          // wrought iron reads as wrought iron, not a flat icon.
          filter:
            "drop-shadow(0 1px 1px rgba(46, 47, 34, 0.18)) drop-shadow(0 2px 6px rgba(46, 47, 34, 0.1))",
        }}
      />
      <span className="sr-only">Loading…</span>
    </span>
  );
};
