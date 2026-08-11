/**
 * SuccessMoment — a small, premium "win" beat for the app's emotional
 * high points (job posted, applicant hired, job completed).
 *
 * It is a brief, non-blocking overlay: a brand-tinted radial glow with a
 * checkmark that draws itself in, then the whole thing fades out on its
 * own (~1.3s). It NEVER blocks navigation and needs no dismissal — the
 * underlying screen is already transitioning underneath it.
 *
 * Two ways to use it:
 *  1. Imperatively, from anywhere (mutation handlers, etc.) via
 *     `fireSuccessMoment()` in `@/lib/successMoment`, rendered by the
 *     global `<SuccessMomentHost />` mounted in App.tsx.
 *  2. Inline, as a decorated badge — pass `inline` to drop the overlay
 *     chrome and render just the glow+check (used by PaymentSuccess to
 *     animate its existing confirmation badge).
 *
 * Accessibility
 *  - Honors reduced motion: when on, there is NO draw-in, NO scale spring,
 *    NO glow pulse — just a static check that fades in. The haptic still
 *    fires at the call site (haptics are status, not motion).
 *
 * Brand tokens (bark, gold-warm, parchment, …) are CSS variables in
 * `src/index.css`, NOT tailwind theme.colors — always use the
 * `hsl(var(--token))` form, never bare classes like `bg-bark`.
 */
import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useReducedMotion } from "@/lib/accessibility";

/** How long the overlay stays up before it auto-fades. */
const OVERLAY_LIFETIME_MS = 1300;

interface SuccessCheckProps {
  /** Diameter of the badge in px. */
  size?: number;
  reducedMotion: boolean;
}

/** The glowing disc + drawing checkmark. Shared by overlay + inline use. */
function SuccessCheck({ size = 88, reducedMotion }: SuccessCheckProps) {
  const ring = Math.round(size * 0.62);
  return (
    <div
      className="relative flex items-center justify-center"
      style={{ width: size, height: size }}
    >
      {/* Soft radial glow behind the badge. Pulses once unless reduced. */}
      <motion.span
        aria-hidden
        className="absolute inset-0 rounded-full"
        style={{
          background:
            "radial-gradient(circle at 50% 50%, hsl(var(--burnt-sienna) / 0.45) 0%, hsl(var(--bark) / 0.18) 42%, transparent 72%)",
        }}
        initial={reducedMotion ? { opacity: 0.9, scale: 1 } : { opacity: 0, scale: 0.6 }}
        animate={
          reducedMotion
            ? { opacity: 0.9, scale: 1 }
            : { opacity: [0, 0.95, 0.55], scale: [0.6, 1.12, 1] }
        }
        transition={reducedMotion ? { duration: 0.15 } : { duration: 0.7, ease: "easeOut" }}
      />

      {/* The badge disc. */}
      <motion.span
        className="relative flex items-center justify-center rounded-full"
        style={{
          width: ring,
          height: ring,
          background: "hsl(var(--bark))",
          boxShadow:
            "inset 0 1px 1px 0 rgba(255,255,255,0.22), " +
            "0 10px 28px -8px hsl(var(--bark) / 0.55)",
        }}
        initial={reducedMotion ? { scale: 1 } : { scale: 0.4 }}
        animate={reducedMotion ? { scale: 1 } : { scale: 1 }}
        transition={
          reducedMotion
            ? { duration: 0 }
            : { type: "spring", damping: 14, stiffness: 320, delay: 0.04 }
        }
      >
        <svg
          width={Math.round(ring * 0.55)}
          height={Math.round(ring * 0.55)}
          viewBox="0 0 24 24"
          fill="none"
          aria-hidden
        >
          <motion.path
            d="M4 12.5L9.5 18L20 6.5"
            stroke="hsl(var(--parchment))"
            strokeWidth={2.6}
            strokeLinecap="round"
            strokeLinejoin="round"
            initial={reducedMotion ? { pathLength: 1, opacity: 1 } : { pathLength: 0, opacity: 0 }}
            animate={{ pathLength: 1, opacity: 1 }}
            transition={
              reducedMotion
                ? { duration: 0 }
                : { delay: 0.18, duration: 0.34, ease: "easeOut" }
            }
          />
        </svg>
      </motion.span>
    </div>
  );
}

interface InlineSuccessCheckProps {
  size?: number;
}

/** Inline variant — just the animated badge, no overlay chrome. */
export function InlineSuccessCheck({ size }: InlineSuccessCheckProps) {
  const reducedMotion = useReducedMotion();
  return <SuccessCheck size={size} reducedMotion={reducedMotion} />;
}

interface SuccessMomentProps {
  /** Unique key so re-firing replays the animation. */
  token: number;
  /** Short status label announced to screen readers. */
  label: string;
}

/** Full-screen, non-blocking, auto-dismissing overlay. */
function SuccessMoment({ token, label }: SuccessMomentProps) {
  const reducedMotion = useReducedMotion();
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    setVisible(true);
    const t = window.setTimeout(() => setVisible(false), OVERLAY_LIFETIME_MS);
    return () => window.clearTimeout(t);
  }, [token]);

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          key={token}
          role="status"
          aria-live="polite"
          aria-label={label}
          className="fixed inset-0 z-[120] flex items-center justify-center pointer-events-none"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: reducedMotion ? 0.12 : 0.22 }}
        >
          <SuccessCheck reducedMotion={reducedMotion} />
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export default SuccessMoment;
