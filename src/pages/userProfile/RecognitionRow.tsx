import {
  Star,
  TrendingUp,
  ShieldCheck,
  Award,
  Users,
  Crown,
  BadgeCheck,
  Gem,
  Clock,
} from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  getEarnedMilestones,
  type CareerMilestone,
  type MilestoneStats,
} from "@/lib/careerLadder";
import {
  computeHelperTier,
  describeTierProgress,
  type HelperTier,
  type HelperTierProfile,
  type HelperTierStats,
} from "@/lib/helperTier";
import { TIER_META } from "@/components/profile/HelperTierBadge";
import { ProfileBadge, PROFILE_BADGE_PILL } from "./ProfileBadge";

/**
 * THE BADGE ROW — the earned badges on the public profile, capped.
 *
 * Owner, 2026-09-11: the subscription tier is the ONLY badge that stays in
 * the header beside the name; every other badge lives here, in one row under
 * the identity and above the record.
 *
 * TWO further owner rulings shape this file, both from 2026-09-11:
 *
 * 1. **The performance-badge group is GONE** — Highly Rated, Trusted, On
 *    Fire, Fast Responder, Community Fav and Reliable are not rendered on
 *    this page at all. The word "Trusted" existed three times on one profile
 *    at three different thresholds (ladder rung, "Trusted Helpr" milestone,
 *    performance badge), and the collision is resolved by deletion: CAREER
 *    MILESTONES (`careerLadder.ts`) is the earned system that survives.
 *    "Reliable" was additionally dead — its `cancellations` input was never
 *    passed by any caller, so it had never fired for anyone; the cancellation
 *    rate is already a stat tile in `AtAGlanceCard`.
 *
 * 2. **Hard cap of four visible badges.** The highest verification-ladder
 *    rung plus at most three more; the remainder goes behind a "+N more"
 *    affordance built on the SHARED `Popover`, never a hand-rolled one. A
 *    strong profile wore ~15 chips in one wrapped row at 375 before this.
 *
 * Presence ("active 10 min ago") is NOT here any more either — it is live
 * state, not an achievement, and now renders as a status dot on the identity
 * line in `ProfileHeaderCard` beside "Baton Rouge · Since Sep 2026".
 *
 * Every chip is a `<ProfileBadge>`: one size, one 44px tap target, one
 * hover-or-tap popover saying what it means and how it was earned. Their
 * shared treatments are untouched: the ladder rung reads `TIER_META` from
 * HelperTierBadge and the credential seal keeps the `tier-gold-elite` class
 * CredentialBadge wears everywhere.
 *
 * Self-hides entirely when there is nothing to show, so a brand-new member
 * looks like a profile without decorations rather than a broken section.
 */

const ICON_MAP: Record<
  string,
  React.ComponentType<{ className?: string; style?: React.CSSProperties }>
> = { Star, TrendingUp, ShieldCheck, Award, Users, Crown, BadgeCheck, Gem };

function MilestoneIcon({ name, color }: { name: string; color: string }) {
  const Icon = ICON_MAP[name] ?? Star;
  return <Icon style={{ color }} />;
}

/**
 * ONE badge as DATA rather than as a node, so the same chip can be rendered
 * either as a pill in the row or as a labelled row inside the "+N more"
 * popover without two copies of its copy existing.
 */
type BadgeSpec = {
  key: string;
  label: string;
  title?: string;
  icon: ReactNode;
  description: string;
  className?: string;
  style?: CSSProperties;
  /** Extra popover body (the ladder's "to reach …" list). */
  extra?: ReactNode;
};

function milestoneSpec(milestone: CareerMilestone): BadgeSpec {
  // ONE colour was doing three jobs: the 12% fill, the 28% border, and the
  // LABEL. The milestone palette is tuned as accents — "First Job" is
  // hsl(40 60% 55%), a light gold, and as 12px/600 text on its own 12% tint
  // it measured 2.12:1. So the label takes --foreground and the identity
  // stays in the fill, the border and the icon.
  return {
    key: `milestone_${milestone.id}`,
    label: milestone.label,
    icon: <MilestoneIcon name={milestone.icon} color={milestone.color} />,
    description: `Career milestone — ${milestone.description}.`,
    style: {
      background: milestone.color.replace(")", " / 0.12)"),
      border: `0.5px solid ${milestone.color.replace(")", " / 0.28)")}`,
      color: "hsl(var(--foreground))",
    },
  };
}

/** The verification ladder rung (#112), drawn at this page's badge size. */
function ladderSpec(
  profile: HelperTierProfile | null,
  stats: HelperTierStats | null,
): BadgeSpec | null {
  const tier: HelperTier = computeHelperTier(profile, stats);
  // Tier 0 hides the badge entirely — never a "Not verified" chip.
  if (tier === 0) return null;
  const meta = TIER_META[tier];
  const Icon = meta.icon;
  const progress = describeTierProgress(tier, profile, stats);
  const next =
    progress.nextTier !== null && progress.nextTier !== 0 && progress.missing.length > 0
      ? TIER_META[progress.nextTier as Exclude<HelperTier, 0>]
      : null;
  return {
    key: "ladder",
    label: meta.label,
    title: `${meta.label} Helpr`,
    icon: <Icon strokeWidth={2.25} />,
    description: `Verification ladder — ${meta.description}`,
    style: {
      background: `hsl(var(${meta.colorVar}) / 0.12)`,
      color: `hsl(var(${meta.colorVar}))`,
      border: `0.5px solid hsl(var(${meta.colorVar}) / 0.32)`,
    },
    extra: (
      <>
        {next && (
          <div
            className="rounded-ds-sm px-2.5 py-2 mt-2"
            style={{
              background: "hsl(var(--olivewood) / 0.06)",
              border: "0.5px solid hsl(var(--olivewood) / 0.18)",
            }}
          >
            <p
              className="font-sans uppercase tracking-wider mb-1 text-ds-10"
              style={{ color: "hsl(var(--olivewood) / 0.8)", letterSpacing: "0.14em" }}
            >
              To reach {next.label}
            </p>
            <ul className="space-y-0.5">
              {progress.missing.map((line) => (
                <li key={line} className="text-ds-11 leading-snug" style={{ color: "hsl(var(--ink-deep) / 0.85)" }}>
                  · {line}
                </li>
              ))}
            </ul>
          </div>
        )}
        {progress.nextTier === null && (
          <p className="text-ds-11 mt-1.5" style={{ color: "hsl(var(--olivewood) / 0.85)" }}>
            Top of the ladder.
          </p>
        )}
      </>
    ),
  };
}

/**
 * Licensed / insured credentials — the same four states CredentialBadge
 * draws app-wide, at this page's size. `business_name` is deliberately NOT
 * appended: the masthead prints the trading name under the person's name.
 */
type CredentialFields = {
  is_licensed?: boolean | null;
  is_insured?: boolean | null;
  license_status?: string | null;
  insurance_status?: string | null;
};

function credentialSpec(credentials: CredentialFields): BadgeSpec | null {
  const licenseVerified = !!credentials.is_licensed && credentials.license_status === "verified";
  const insuranceVerified = !!credentials.is_insured && credentials.insurance_status === "verified";
  const licensePending = !!credentials.is_licensed && credentials.license_status === "pending";
  const insurancePending = !!credentials.is_insured && credentials.insurance_status === "pending";

  if (licenseVerified && insuranceVerified) {
    return {
      key: "credential",
      label: "Licensed & Insured",
      icon: <ShieldCheck className="verified-gold" />,
      className: "tier-gold-elite",
      description:
        "Both a trade licence and a certificate of insurance are on file and have been checked by Helpr.",
    };
  }
  if (licenseVerified || insuranceVerified) {
    const which = licenseVerified ? "Licensed" : "Insured";
    const pendingOther = licenseVerified ? insurancePending : licensePending;
    return {
      key: "credential",
      label: which,
      icon: <BadgeCheck />,
      className: "border bg-primary/10 text-primary border-primary/30",
      description:
        (licenseVerified
          ? "A trade licence is on file and has been checked by Helpr."
          : "A certificate of insurance is on file and has been checked by Helpr.") +
        (pendingOther ? ` ${licenseVerified ? "Insurance" : "Licence"} is still under review.` : ""),
    };
  }
  if (licensePending || insurancePending) {
    const label =
      licensePending && insurancePending
        ? "Verification pending"
        : licensePending
          ? "License pending"
          : "Insurance pending";
    return {
      key: "credential",
      label,
      icon: <Clock />,
      className: "border bg-muted/50 text-muted-foreground border-border",
      description:
        "A credential has been submitted and is waiting for Helpr to review it. Nothing is verified yet.",
    };
  }
  return null;
}

/**
 * "+N more" — the overflow affordance. The SHARED `Popover` (portalled to
 * `document.body`, because the masthead is a frosted `.liquid-glass` surface
 * that would otherwise become the containing block), wearing the SHARED
 * `PROFILE_BADGE_PILL` box so the overflow control is the same size and the
 * same 44px tap target as the badges it hides. Hidden badges are listed as
 * labelled rows rather than as nested pills — a popover inside a popover is
 * a trap on touch, and the row form can give each one its full sentence.
 */
function MoreBadges({ hidden }: { hidden: BadgeSpec[] }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`See all ${hidden.length} more badges`}
          className={`${PROFILE_BADGE_PILL} border`}
          style={{
            background: "hsl(var(--olivewood) / 0.08)",
            color: "hsl(var(--olivewood))",
            borderColor: "hsl(var(--olivewood) / 0.24)",
          }}
        >
          +{hidden.length} more
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={6}
        className="w-72 rounded-2xl shadow-lg max-h-[60vh] overflow-y-auto"
        style={{
          background: "hsl(var(--parchment))",
          color: "hsl(var(--bark))",
          border: "0.5px solid hsl(var(--bark) / 0.28)",
        }}
      >
        <p
          className="font-sans uppercase tracking-wider mb-2 text-ds-10"
          style={{ color: "hsl(var(--olivewood) / 0.8)", letterSpacing: "0.14em" }}
        >
          Also earned
        </p>
        <ul className="space-y-2.5">
          {hidden.map((spec) => (
            <li key={spec.key}>
              <div className="flex items-center gap-2">
                <span className="shrink-0 inline-flex items-center [&>svg]:w-3.5 [&>svg]:h-3.5">
                  {spec.icon}
                </span>
                <p
                  className="font-sans font-semibold text-ds-13"
                  style={{ color: "hsl(var(--ink-deep))" }}
                >
                  {spec.title ?? spec.label}
                </p>
              </div>
              <p className="text-ds-11 leading-snug mt-0.5" style={{ color: "hsl(var(--bark))" }}>
                {spec.description}
              </p>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}

/** Owner ruling: the ladder rung plus at most three more badges on screen. */
const VISIBLE_BADGE_CAP = 4;

type Props = {
  milestoneStats: MilestoneStats;
  idVerified: boolean;
  ladderProfile: HelperTierProfile | null;
  ladderStats: HelperTierStats | null;
  credentials: CredentialFields;
  backgroundChecked: boolean;
  hasSubmittedCredentials: boolean;
};

export const RecognitionRow = ({
  milestoneStats,
  idVerified,
  ladderProfile,
  ladderStats,
  credentials,
  backgroundChecked,
  hasSubmittedCredentials,
}: Props) => {
  // ORDER IS THE CAP'S ONLY POLICY. The ladder rung is first because the
  // owner named it as always-visible; then the hardest-won trust signals; then
  // career milestones NEWEST-FIRST (`getEarnedMilestones` returns them
  // ascending, so "Master Helpr" is last in that array and must be first
  // here — showing "First Job" and hiding "Master Helpr" would be exactly
  // backwards); and "Verification in progress" last, because a thing that has
  // not cleared yet is the least impressive item on the profile.
  const specs: BadgeSpec[] = [];

  const ladder = ladderSpec(ladderProfile, ladderStats);
  if (ladder) specs.push(ladder);

  const credential = credentialSpec(credentials);
  if (credential) specs.push(credential);

  if (backgroundChecked) {
    specs.push({
      key: "background_check",
      label: "Background-Checked",
      icon: <ShieldCheck />,
      description:
        "A paid background screening was completed and cleared. Earned by ordering a background check from Profile.",
      className: "border",
      style: {
        background: "hsl(var(--sage) / 0.16)",
        color: "hsl(var(--success-ink))",
        borderColor: "hsl(var(--sage) / 0.4)",
      },
    });
  }

  if (idVerified) {
    specs.push({
      key: "stripe_verified",
      label: "Stripe verified",
      icon: <ShieldCheck strokeWidth={2.5} style={{ color: "hsl(var(--gold-warm))" }} />,
      description:
        "A government ID was checked by Stripe Identity and matched this member. Earned by completing ID verification in Profile.",
      style: {
        background: "hsl(var(--gold-warm) / 0.14)",
        border: "0.5px solid hsl(var(--gold-warm) / 0.36)",
        color: "hsl(var(--gold-ink))",
      },
    });
  }

  for (const milestone of [...getEarnedMilestones(milestoneStats)].reverse()) {
    specs.push(milestoneSpec(milestone));
  }

  if (hasSubmittedCredentials) {
    specs.push({
      key: "verification_in_progress",
      label: "Verification in progress",
      icon: <Clock />,
      description:
        "A credential has been submitted and Helpr is reviewing it. It becomes a badge once it clears.",
      className: "border",
      style: {
        backgroundColor: "hsl(var(--amber-tint) / 0.15)",
        color: "hsl(var(--amber-ink))",
        borderColor: "hsl(var(--amber-tint) / 0.4)",
      },
    });
  }

  if (specs.length === 0) return null;

  // A single leftover does NOT go behind "+1 more": the affordance would
  // occupy the same slot as the badge it hides while telling the reader less.
  const overflows = specs.length > VISIBLE_BADGE_CAP + 1;
  const visible = overflows ? specs.slice(0, VISIBLE_BADGE_CAP) : specs;
  const hidden = overflows ? specs.slice(VISIBLE_BADGE_CAP) : [];

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {visible.map((spec) => (
        <ProfileBadge
          key={spec.key}
          label={spec.label}
          title={spec.title}
          icon={spec.icon}
          description={spec.description}
          className={spec.className}
          style={spec.style}
        >
          {spec.extra}
        </ProfileBadge>
      ))}
      {hidden.length > 0 && <MoreBadges hidden={hidden} />}
    </div>
  );
};
