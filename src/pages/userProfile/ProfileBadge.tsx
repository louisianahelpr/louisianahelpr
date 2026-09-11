import {
  cloneElement,
  isValidElement,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { tierBadgeStyle } from "@/lib/tierBadgeStyle";
import { TIER_PERKS, tierDisplayName, toSubscriptionTier } from "@/lib/subscriptionTiers";

/**
 * ONE badge, ONE size, ONE affordance — for every pill on the public profile.
 *
 * Owner, 2026-09-11, pointing at the masthead: "these need to be the same
 * size" (the Stripe-verified pill measured 24.5px next to a 26px Pro pill),
 * and "hover and click should show the info for all badges". Before this,
 * six different pill recipes lived on this one page — three hand-rolled
 * spans in the header, HelperTierBadge's `md`, CredentialBadge's `md`, and
 * the two RecognitionRow chips — and only the milestone and ladder chips
 * could explain themselves.
 *
 * Every badge now renders through this component:
 *   - the SAME pill box (`px-2.5 py-1.5 text-ds-12`, the Pro pill's own size,
 *     so the tier treatment from `tierBadgeStyle` / `.tier-gold-*` is the
 *     reference and is not touched);
 *   - the same 44px tap target, extended with a pseudo-element so the visual
 *     rhythm of the row does not grow;
 *   - the same popover: opens on click/tap (the only event a touch screen
 *     has) AND on hover where a hover-capable pointer exists, so a desktop
 *     reader gets the answer without committing to a click.
 *
 * It is the shared `Popover`, not a hand-rolled tooltip: portalled to
 * `document.body` (the masthead is a frosted `.liquid-glass` surface, which
 * would otherwise become the containing block), dismissable, and keyboard
 * reachable through the trigger button.
 */

export const PROFILE_BADGE_PILL =
  "inline-flex items-center gap-1.5 rounded-ds-pill px-2.5 py-1.5 text-ds-12 font-sans font-semibold leading-none whitespace-nowrap " +
  "transition-opacity active:opacity-70 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring " +
  "relative after:absolute after:inset-x-0 after:top-1/2 after:-translate-y-1/2 after:h-11 after:content-['']";

const ICON_CLASS = "w-3.5 h-3.5 shrink-0";

export type ProfileBadgeProps = {
  label: string;
  /** Lucide element — re-sized here so every badge's mark is 14px. */
  icon: ReactNode;
  /** What this badge means and how it was earned. Plain sentence. */
  description: string;
  /** Popover heading; defaults to the label. */
  title?: string;
  /** Chip treatment (e.g. `tier-gold-pro`). Sizing must NOT be passed here. */
  className?: string;
  style?: CSSProperties;
  /** Optional extra popover body (e.g. the ladder's "to reach …" list). */
  children?: ReactNode;
};

function sizeIcon(icon: ReactNode): ReactNode {
  if (!isValidElement<{ className?: string }>(icon)) return icon;
  const own = (icon.props.className ?? "").replace(/\bw-\S+|\bh-\S+/g, "").trim();
  return cloneElement(icon, { className: `${ICON_CLASS} ${own}`.trim() });
}

export function ProfileBadge({
  label,
  icon,
  description,
  title,
  className,
  style,
  children,
}: ProfileBadgeProps) {
  const [open, setOpen] = useState(false);
  const closeTimer = useRef<number | undefined>(undefined);
  // Hover only where a hover exists. On touch, `pointerenter` fires on the
  // tap itself and would race the click toggle — so the tap is the only
  // opener there, and this branch stays inert.
  const canHover = () =>
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(hover: hover) and (pointer: fine)").matches;
  const hoverIn = () => {
    if (!canHover()) return;
    window.clearTimeout(closeTimer.current);
    setOpen(true);
  };
  const hoverOut = () => {
    if (!canHover()) return;
    window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(() => setOpen(false), 150);
  };
  const sizedIcon = sizeIcon(icon);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`${label} — what this means`}
          className={`${PROFILE_BADGE_PILL} ${className ?? ""}`}
          style={style}
          onPointerEnter={hoverIn}
          onPointerLeave={hoverOut}
        >
          {sizedIcon}
          {label}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={6}
        className="w-64 rounded-2xl shadow-lg"
        style={{
          background: "hsl(var(--parchment))",
          color: "hsl(var(--bark))",
          border: "0.5px solid hsl(var(--bark) / 0.28)",
        }}
        onPointerEnter={hoverIn}
        onPointerLeave={hoverOut}
      >
        <div className="flex items-center gap-2 mb-1.5">
          {sizedIcon}
          <p className="font-sans font-semibold text-ds-13" style={{ color: "hsl(var(--ink-deep))" }}>
            {title ?? label}
          </p>
        </div>
        <p className="text-ds-11 leading-snug" style={{ color: "hsl(var(--bark))" }}>
          {description}
        </p>
        {children}
      </PopoverContent>
    </Popover>
  );
}

/**
 * The SUBSCRIPTION-TIER badge — the only badge that lives in the header,
 * beside the name (owner: "their subscription tier should be the ONLY badge
 * with the info [in the header]. move the others down"). Renders nothing for
 * free / unknown tiers, so a member with no tier has no badge in the header
 * at all. Treatment comes from `tierBadgeStyle`, shared with every other
 * tier chip in the app; only the box is this page's.
 */
export function SubscriptionTierBadge({ tier }: { tier: string | null | undefined }) {
  const tierStyle = tierBadgeStyle(tier);
  if (!tierStyle) return null;
  const Icon = tierStyle.icon;
  const name = tierDisplayName(tier);
  const perks = TIER_PERKS[toSubscriptionTier(tier)];
  return (
    <ProfileBadge
      label={name}
      icon={<Icon style={tierStyle.chipIconColor ? { color: tierStyle.chipIconColor } : undefined} />}
      className={tierStyle.chipClass}
      title={`${name} member`}
      description={`A paid Helpr membership — ${perks.tagline.toLowerCase()}. Members choose a plan from their Profile; it is bought, not earned.`}
    />
  );
}
