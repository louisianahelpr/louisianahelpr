import { useMemo, useState } from "react";
import { Shield, ShieldCheck, Award, type LucideIcon } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  computeHelperTier,
  describeTierProgress,
  type HelperTier,
  type HelperTierProfile,
  type HelperTierStats,
} from "@/lib/helperTier";

/**
 * HelperTierBadge (#112) — pill that surfaces the four-step verification
 * ladder (Verified → Trusted → Elite). Hidden entirely at tier 0, since
 * fresh-signup helprs are a high-volume cohort and an "unverified" chip
 * everywhere would clutter the feed without adding signal.
 *
 * Tap → popover explaining what the tier means and exactly what's needed
 * to reach the next rung. The popover is the helpr-progression story —
 * customers see "what makes this trustworthy", helprs see "here's the
 * concrete next step" (e.g. "3 more reviews to reach Elite").
 *
 * Props accept either a precomputed `tier` (cheaper when many helprs
 * render in a list) or a `{ profile, stats }` pair (the function call
 * happens here so callers don't have to import the lib themselves).
 */

interface TierMeta {
  label: string;
  description: string;
  icon: LucideIcon;
  /** CSS var (without `hsl(var(--…))` wrapping) for the badge accent. */
  colorVar: string;
}

// Keeping descriptions short — they fit a 280px popover and read as a
// plain answer to "what does this mean?". Colors map to the task spec:
// olivewood for the entry rung (calm trust), bark for established
// (the same warm brown used for completion CTAs), gold-warm for the
// prestige tier (matches Elite/Pro elsewhere).
const TIER_META: Record<Exclude<HelperTier, 0>, TierMeta> = {
  1: {
    label: "Verified",
    description: "ID confirmed and payouts connected.",
    icon: Shield,
    colorVar: "--olivewood",
  },
  2: {
    label: "Trusted",
    description: "Strong track record with steady 4.5+ ratings.",
    icon: ShieldCheck,
    colorVar: "--bark",
  },
  3: {
    label: "Elite",
    description: "Top tier — 25+ jobs delivered at a 4.8+ average.",
    icon: Award,
    colorVar: "--gold-warm",
  },
};

type Size = "sm" | "md";

interface TierBadgeBaseProps {
  size?: Size;
  /**
   * Whether to render the progression hint ("X more reviews to reach
   * Elite") inside the popover. Defaults to true; turn off for surfaces
   * where the customer can't act on it (e.g. browse listings — the helpr
   * isn't reading their own card there).
   */
  showProgress?: boolean;
  /** Optional className passed through to the trigger pill. */
  className?: string;
}

type HelperTierBadgeProps = TierBadgeBaseProps &
  (
    | { tier: HelperTier; profile?: HelperTierProfile | null; stats?: HelperTierStats | null }
    | { tier?: undefined; profile: HelperTierProfile | null | undefined; stats: HelperTierStats | null | undefined }
  );

const sizeStyles: Record<Size, { pill: string; icon: string }> = {
  sm: { pill: "text-ds-10 px-2 py-0.5 gap-1", icon: "w-3 h-3" },
  md: { pill: "text-ds-11 px-2.5 py-1 gap-1.5", icon: "w-3.5 h-3.5" },
};

export function HelperTierBadge(props: HelperTierBadgeProps) {
  const { size = "sm", showProgress = true, className, profile, stats } = props;
  const [open, setOpen] = useState(false);

  // When the caller hands us a precomputed tier, trust it — that's the
  // contract for list surfaces where the parent batched the computation.
  // Otherwise compute here from the profile/stats pair.
  const tier: HelperTier = useMemo(() => {
    if (typeof props.tier === "number") return props.tier;
    return computeHelperTier(profile ?? null, stats ?? null);
  }, [props.tier, profile, stats]);

  // Compute progress unconditionally (before the early return) so the
  // hook order stays stable across renders that flip between tier 0 and
  // tier 1+. The progress block is only rendered when tier > 0 anyway.
  const progress = useMemo(
    () => (showProgress ? describeTierProgress(tier, profile ?? null, stats ?? null) : null),
    [tier, profile, stats, showProgress],
  );

  // Tier 0 hides the badge entirely. The empty render is the whole
  // point — never a "Not verified" chip on a fresh signup.
  if (tier === 0) return null;

  const meta = TIER_META[tier];
  const Icon = meta.icon;
  const sz = sizeStyles[size];

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`Verification tier: ${meta.label} — tap for details`}
          className={`inline-flex items-center rounded-full font-semibold transition-opacity active:opacity-70 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring ${sz.pill} ${className ?? ""}`}
          style={{
            background: `hsl(var(${meta.colorVar}) / 0.12)`,
            color: `hsl(var(${meta.colorVar}))`,
            border: `0.5px solid hsl(var(${meta.colorVar}) / 0.32)`,
          }}
        >
          <Icon className={sz.icon} strokeWidth={2.25} aria-hidden />
          {meta.label}
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
          <div className="flex items-center gap-2">
            <span
              className="inline-flex items-center justify-center w-7 h-7 rounded-full shrink-0"
              style={{
                background: `hsl(var(${meta.colorVar}) / 0.14)`,
                color: `hsl(var(${meta.colorVar}))`,
              }}
            >
              <Icon className="w-4 h-4" strokeWidth={2.25} aria-hidden />
            </span>
            <p
              className="font-sans font-semibold text-ds-13"
              style={{ color: "hsl(var(--ink-deep))" }}
            >
              {meta.label} Helpr
            </p>
          </div>
          <p
            className="text-ds-11 leading-snug"
            style={{ color: "hsl(var(--bark))" }}
          >
            {meta.description}
          </p>
          {progress && progress.nextTier !== null && progress.nextTier !== 0 && progress.missing.length > 0 && (
            <div
              className="rounded-ds-sm px-2.5 py-2 mt-1"
              style={{
                background: "hsl(var(--olivewood) / 0.06)",
                border: "0.5px solid hsl(var(--olivewood) / 0.18)",
              }}
            >
              <p
                className="font-sans uppercase tracking-wider mb-1"
                style={{ fontSize: "0.6rem", color: "hsl(var(--olivewood) / 0.8)", letterSpacing: "0.14em" }}
              >
                To reach {TIER_META[progress.nextTier as Exclude<HelperTier, 0>].label}
              </p>
              <ul className="space-y-0.5">
                {progress.missing.map((line) => (
                  <li
                    key={line}
                    className="text-ds-11 leading-snug"
                    style={{ color: "hsl(var(--ink-deep) / 0.85)" }}
                  >
                    · {line}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {progress && progress.nextTier === null && (
            <p
              className="text-ds-11 italic"
              style={{ color: "hsl(var(--olivewood) / 0.85)" }}
            >
              You&apos;re at the top of the ladder. Stay on it.
            </p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

export default HelperTierBadge;
