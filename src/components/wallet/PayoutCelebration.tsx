/**
 * PayoutCelebration — a one-time "you got paid" moment.
 *
 * When a helper opens the Wallet/Earnings screen and one or more
 * payouts have been credited (status === "paid") since their last
 * visit, this surfaces a subtle, brand-tinted celebration card with
 * the total amount and the most recent job's title.
 *
 * Persistence
 * - `helpr_last_seen_payout_at` (ms epoch) lives in safeStorage. The
 *   `helpr_` prefix is auto-tracked, so it mirrors to Capacitor
 *   Preferences on native (durable across WebKit eviction).
 * - On show, we advance the marker to the latest paid_at among the
 *   celebrated rows — so the same payout never celebrates twice.
 *
 * Accessibility
 * - Honors `useReducedMotion()`: no particle confetti, no scale
 *   spring; just a flat fade. The card still auto-dismisses.
 *
 * Brand tokens (gold-warm, bark, burnt-sienna) are CSS variables in
 * `src/index.css`, NOT in tailwind theme.colors. Use the hsl(var(...))
 * form, never bare class names like `bg-gold-warm`.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Sparkles } from "lucide-react";
import { safeStorage } from "@/lib/safeStorage";
import { useReducedMotion } from "@/lib/accessibility";
import { formatPrice } from "@/lib/format";

/** Subset of payout_transfers we need for the celebration. */
export interface CelebratablePayout {
  id: string;
  amount_cents: number;
  status: string;
  paid_at: string | null;
  created_at: string;
  jobs?: { title?: string } | null;
}

interface PayoutCelebrationProps {
  /** Recent payouts (already fetched by parent — we do NOT re-query). */
  payouts: CelebratablePayout[];
  /** Optional click handler for "View details" — typically scrolls/opens detail. */
  onViewDetails?: () => void;
}

const STORAGE_KEY = "helpr_last_seen_payout_at";
const AUTO_DISMISS_MS = 4000;

/** Brand palette for the confetti dots. Pulled from CSS variables. */
const PARTICLE_TOKENS = [
  "--gold-warm",
  "--bark",
  "--burnt-sienna",
] as const;

/** Returns the epoch ms timestamp the user last "saw" payouts, or 0. */
function readLastSeen(): number {
  const raw = safeStorage.getItem(STORAGE_KEY);
  if (!raw) return 0;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? n : 0;
}

/** Treat paid_at as authoritative; fall back to created_at if missing. */
function payoutTimestampMs(p: CelebratablePayout): number {
  const stamp = p.paid_at ?? p.created_at;
  const t = stamp ? new Date(stamp).getTime() : NaN;
  return Number.isFinite(t) ? t : 0;
}

function formatUsdCents(cents: number): string {
  return `$${formatPrice(cents / 100)}`;
}

export function PayoutCelebration({ payouts, onViewDetails }: PayoutCelebrationProps) {
  const reducedMotion = useReducedMotion();
  // Snapshot the last-seen marker at mount so prop updates during the
  // celebration don't re-evaluate the "new" set mid-animation.
  const lastSeenRef = useRef<number | null>(null);
  if (lastSeenRef.current === null) lastSeenRef.current = readLastSeen();

  // Determine which payouts are "new" since lastSeen. Only count
  // status === "paid" — pending/failed/reversed shouldn't celebrate.
  const newPayouts = useMemo(() => {
    const lastSeen = lastSeenRef.current ?? 0;
    return payouts
      .filter((p) => p.status === "paid" && payoutTimestampMs(p) > lastSeen)
      .sort((a, b) => payoutTimestampMs(b) - payoutTimestampMs(a));
  }, [payouts]);

  const totalCents = useMemo(
    () => newPayouts.reduce((sum, p) => sum + (p.amount_cents ?? 0), 0),
    [newPayouts],
  );

  const headlineJobTitle =
    newPayouts[0]?.jobs?.title?.trim() ||
    (newPayouts.length > 1 ? `${newPayouts.length} jobs` : "your latest job");

  const [open, setOpen] = useState<boolean>(false);
  const advancedRef = useRef(false);

  // Open on mount if there's something to celebrate. Advance the
  // last-seen marker immediately so a re-mount (tab switch, parent
  // re-render) does not re-celebrate. Auto-dismiss after AUTO_DISMISS_MS.
  useEffect(() => {
    if (newPayouts.length === 0) return;
    if (totalCents <= 0) return;
    setOpen(true);

    if (!advancedRef.current) {
      const latest = newPayouts.reduce(
        (max, p) => Math.max(max, payoutTimestampMs(p)),
        0,
      );
      if (latest > 0) {
        safeStorage.setItem(STORAGE_KEY, String(latest));
        advancedRef.current = true;
      }
    }

    const t = window.setTimeout(() => setOpen(false), AUTO_DISMISS_MS);
    return () => window.clearTimeout(t);
  }, [newPayouts, totalCents]);

  const dismiss = () => setOpen(false);

  // Pre-compute particle layout once per render so the AnimatePresence
  // child does not re-randomize on every animation tick.
  // iPhone SE and other ≤375 px devices get half as many particles and
  // a shorter animation duration to stay jank-free under load.
  const { particles, particleDuration } = useMemo(() => {
    if (reducedMotion) return { particles: [], particleDuration: 2.4 };
    const isSmallDevice =
      typeof window !== "undefined" && window.screen.width <= 375;
    const count = isSmallDevice ? 7 : 14;
    const duration = isSmallDevice ? 1.6 : 2.4;
    return {
      particleDuration: duration,
      particles: Array.from({ length: count }, (_, i) => ({
        id: i,
        // Spread horizontally across the card, biased toward edges.
        x: (i / Math.max(count - 1, 1)) * 100 + (Math.random() - 0.5) * 8,
        // Stagger fall delay slightly for a wave feel.
        delay: (i % 7) * 0.04,
        // Final Y is well below the card so they fall offscreen.
        yEnd: 120 + Math.random() * 80,
        tokenIdx: i % PARTICLE_TOKENS.length,
        size: 6 + (i % 3) * 2,
      })),
    };
  }, [reducedMotion]);

  if (newPayouts.length === 0 || totalCents <= 0) return null;

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="payout-celebration"
          role="status"
          aria-live="polite"
          aria-label={`You earned ${formatUsdCents(totalCents)}`}
          initial={reducedMotion ? { opacity: 0 } : { opacity: 0, y: -8, scale: 0.98 }}
          animate={reducedMotion ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1 }}
          exit={reducedMotion ? { opacity: 0 } : { opacity: 0, y: -8, scale: 0.98 }}
          transition={
            reducedMotion
              ? { duration: 0.15 }
              : { type: "spring", damping: 22, stiffness: 280 }
          }
          className="relative rounded-2xl liquid-glass p-4 overflow-hidden"
          style={{
            backgroundImage:
              "radial-gradient(60% 90% at 100% 0%, hsl(var(--gold-warm) / 0.18) 0%, transparent 55%), " +
              "radial-gradient(70% 90% at 0% 100%, hsl(var(--burnt-sienna) / 0.12) 0%, transparent 60%)",
            boxShadow:
              "inset 0 1px 1px 0 rgba(255, 255, 255, 0.5), " +
              "0 1px 2px hsl(var(--olivewood) / 0.06), " +
              "0 16px 36px -10px hsl(var(--gold-warm) / 0.32)",
          }}
          onClick={dismiss}
        >
          {/* Confetti layer — absolutely-positioned brand-colored dots that
              fall from the top of the card. Skipped entirely when the user
              prefers reduced motion. */}
          {!reducedMotion && particles.length > 0 && (
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0 overflow-hidden"
              data-testid="payout-celebration-particles"
            >
              {particles.map((p) => (
                <motion.span
                  key={p.id}
                  initial={{ y: -16, opacity: 0 }}
                  animate={{ y: p.yEnd, opacity: [0, 1, 1, 0] }}
                  transition={{
                    duration: particleDuration,
                    delay: p.delay,
                    ease: "easeOut",
                    times: [0, 0.1, 0.7, 1],
                  }}
                  style={{
                    position: "absolute",
                    left: `${p.x}%`,
                    width: p.size,
                    height: p.size,
                    borderRadius: "9999px",
                    background: `hsl(var(${PARTICLE_TOKENS[p.tokenIdx]}))`,
                    boxShadow: `0 0 8px hsl(var(${PARTICLE_TOKENS[p.tokenIdx]}) / 0.45)`,
                  }}
                />
              ))}
            </div>
          )}

          {/* Close button — top-right, also auto-dismissed in 4s. */}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              dismiss();
            }}
            className="absolute top-2 right-2 p-1 rounded-full transition-colors active:opacity-70"
            style={{ color: "hsl(var(--olivewood) / 0.8)" }}
            aria-label="Dismiss"
          >
            <X className="w-3.5 h-3.5" />
          </button>

          <div className="relative flex items-center gap-3">
            <div
              className="w-11 h-11 rounded-full flex items-center justify-center shrink-0"
              style={{
                background: "hsl(var(--gold-warm) / 0.18)",
                color: "hsl(var(--gold-warm))",
                border: "0.5px solid hsl(var(--gold-warm) / 0.34)",
                boxShadow:
                  "inset 0 1px 1px 0 rgba(255,255,255,0.55), " +
                  "0 8px 18px -6px hsl(var(--gold-warm) / 0.32)",
              }}
            >
              <Sparkles className="w-5 h-5" strokeWidth={1.75} />
            </div>

            <div className="flex-1 min-w-0">
              <p
                className="font-serif italic uppercase"
                style={{
                  fontSize: "0.6rem",
                  color: "hsl(var(--burnt-sienna))",
                  letterSpacing: "0.18em",
                }}
              >
                {newPayouts.length > 1 ? "New payouts" : "New payout"}
              </p>
              <h3
                className="font-display italic font-bold leading-tight"
                style={{
                  fontSize: "1.15rem",
                  color: "hsl(var(--ink-deep))",
                  letterSpacing: "-0.02em",
                }}
              >
                You earned {formatUsdCents(totalCents)}
              </h3>
              <p
                className="font-serif italic truncate"
                style={{
                  fontSize: "0.74rem",
                  color: "hsl(var(--olivewood) / 0.8)",
                }}
              >
                {newPayouts.length > 1
                  ? `Across ${newPayouts.length} jobs · latest: ${headlineJobTitle}`
                  : `From ${headlineJobTitle}`}
              </p>
            </div>

            {onViewDetails && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onViewDetails();
                  dismiss();
                }}
                className="shrink-0 px-3 h-8 rounded-full active:scale-[0.97] transition-transform"
                style={{
                  background: "hsl(var(--bark))",
                  color: "hsl(var(--parchment))",
                  border: "1px solid hsl(70 22% 24%)",
                  fontFamily: "Montserrat, system-ui, sans-serif",
                  fontWeight: 600,
                  fontSize: "0.72rem",
                  letterSpacing: "0.01em",
                  boxShadow:
                    "inset 0 1px 0 0 rgba(255,255,255,0.12), " +
                    "0 1px 2px hsl(var(--bark) / 0.18), " +
                    "0 6px 14px -6px hsl(var(--bark) / 0.45)",
                }}
              >
                View details
              </button>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export default PayoutCelebration;
