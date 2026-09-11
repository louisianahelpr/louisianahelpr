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
import type { HelperBadge } from "@/components/HelperBadges";
import type { LastActiveLabel } from "./types";
import { ProfileBadge } from "./ProfileBadge";

/**
 * THE BADGE ROW — every badge on the public profile except the subscription
 * tier, in one wrapped row under the identity and above the record.
 *
 * Owner, 2026-09-11: the subscription tier is the ONLY badge that stays in
 * the header beside the name; "move the others down". So the trust pills
 * that used to sit in the header's own trust row (Stripe verified, the
 * verification-ladder rung, Licensed & Insured, Background-Checked,
 * Verification in progress, presence) now live here, followed by the earned
 * career milestones and performance badges that this row already carried.
 *
 * Every chip is a `<ProfileBadge>`: one size, one 44px tap target, one
 * hover-or-tap popover saying what it means and how it was earned. The
 * hand-written trust spans, `HelperTierBadge` (`md`) and `CredentialBadge`
 * (`md`) each drew their own box at their own size on this page — that is
 * the "these need to be the same size" the owner pointed at. Their shared
 * treatments are untouched: the ladder rung reads `TIER_META` from
 * HelperTierBadge, the tier chip reads `tierBadgeStyle`, and the credential
 * seal keeps the `tier-gold-elite` class CredentialBadge wears everywhere.
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

function MilestoneChip({ milestone }: { milestone: CareerMilestone }) {
  // ONE colour was doing three jobs: the 12% fill, the 28% border, and the
  // LABEL. The milestone palette is tuned as accents — "First Job" is
  // hsl(40 60% 55%), a light gold, and as 12px/600 text on its own 12% tint
  // it measured 2.12:1. So the label takes --foreground and the identity
  // stays in the fill, the border and the icon.
  return (
    <ProfileBadge
      label={milestone.label}
      icon={<MilestoneIcon name={milestone.icon} color={milestone.color} />}
      description={`Career milestone — ${milestone.description}.`}
      style={{
        background: milestone.color.replace(")", " / 0.12)"),
        border: `0.5px solid ${milestone.color.replace(")", " / 0.28)")}`,
        color: "hsl(var(--foreground))",
      }}
    />
  );
}

/** The verification ladder rung (#112), drawn at this page's badge size. */
function LadderBadge({
  profile,
  stats,
}: {
  profile: HelperTierProfile | null;
  stats: HelperTierStats | null;
}) {
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
  return (
    <ProfileBadge
      label={meta.label}
      title={`${meta.label} Helpr`}
      icon={<Icon strokeWidth={2.25} />}
      description={`Verification ladder — ${meta.description}`}
      style={{
        background: `hsl(var(${meta.colorVar}) / 0.12)`,
        color: `hsl(var(${meta.colorVar}))`,
        border: `0.5px solid hsl(var(${meta.colorVar}) / 0.32)`,
      }}
    >
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
    </ProfileBadge>
  );
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

function CredentialChip({ credentials }: { credentials: CredentialFields }) {
  const licenseVerified = !!credentials.is_licensed && credentials.license_status === "verified";
  const insuranceVerified = !!credentials.is_insured && credentials.insurance_status === "verified";
  const licensePending = !!credentials.is_licensed && credentials.license_status === "pending";
  const insurancePending = !!credentials.is_insured && credentials.insurance_status === "pending";

  if (licenseVerified && insuranceVerified) {
    return (
      <ProfileBadge
        label="Licensed & Insured"
        icon={<ShieldCheck className="verified-gold" />}
        className="tier-gold-elite"
        description="Both a trade licence and a certificate of insurance are on file and have been checked by Helpr."
      />
    );
  }
  if (licenseVerified || insuranceVerified) {
    const which = licenseVerified ? "Licensed" : "Insured";
    const pendingOther = licenseVerified ? insurancePending : licensePending;
    return (
      <ProfileBadge
        label={which}
        icon={<BadgeCheck />}
        className="border bg-primary/10 text-primary border-primary/30"
        description={
          (licenseVerified
            ? "A trade licence is on file and has been checked by Helpr."
            : "A certificate of insurance is on file and has been checked by Helpr.") +
          (pendingOther ? ` ${licenseVerified ? "Insurance" : "Licence"} is still under review.` : "")
        }
      />
    );
  }
  if (licensePending || insurancePending) {
    const label =
      licensePending && insurancePending
        ? "Verification pending"
        : licensePending
          ? "License pending"
          : "Insurance pending";
    return (
      <ProfileBadge
        label={label}
        icon={<Clock />}
        className="border bg-muted/50 text-muted-foreground border-border"
        description="A credential has been submitted and is waiting for Helpr to review it. Nothing is verified yet."
      />
    );
  }
  return null;
}

type Props = {
  milestoneStats: MilestoneStats;
  /** Earned performance badges — the subscription tier is NOT in this list. */
  badges: HelperBadge[];
  idVerified: boolean;
  ladderProfile: HelperTierProfile | null;
  ladderStats: HelperTierStats | null;
  credentials: CredentialFields;
  backgroundChecked: boolean;
  hasSubmittedCredentials: boolean;
  lastActiveLabel: LastActiveLabel | null;
};

export const RecognitionRow = ({
  milestoneStats,
  badges,
  idVerified,
  ladderProfile,
  ladderStats,
  credentials,
  backgroundChecked,
  hasSubmittedCredentials,
  lastActiveLabel,
}: Props) => {
  const earned = getEarnedMilestones(milestoneStats);
  const ladderTier = computeHelperTier(ladderProfile, ladderStats);
  const hasCredential =
    (!!credentials.is_licensed && ["verified", "pending"].includes(credentials.license_status ?? "")) ||
    (!!credentials.is_insured && ["verified", "pending"].includes(credentials.insurance_status ?? ""));
  const anything =
    idVerified ||
    ladderTier !== 0 ||
    hasCredential ||
    backgroundChecked ||
    hasSubmittedCredentials ||
    !!lastActiveLabel ||
    earned.length > 0 ||
    badges.length > 0;
  if (!anything) return null;

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {idVerified && (
        <ProfileBadge
          label="Stripe verified"
          icon={<ShieldCheck strokeWidth={2.5} style={{ color: "hsl(var(--gold-warm))" }} />}
          description="A government ID was checked by Stripe Identity and matched this member. Earned by completing ID verification in Profile."
          style={{
            background: "hsl(var(--gold-warm) / 0.14)",
            border: "0.5px solid hsl(var(--gold-warm) / 0.36)",
            color: "hsl(var(--gold-ink))",
          }}
        />
      )}
      <LadderBadge profile={ladderProfile} stats={ladderStats} />
      <CredentialChip credentials={credentials} />
      {backgroundChecked && (
        <ProfileBadge
          label="Background-Checked"
          icon={<ShieldCheck />}
          description="A paid background screening was completed and cleared. Earned by ordering a background check from Profile."
          className="border"
          style={{
            background: "hsl(var(--sage) / 0.16)",
            color: "hsl(var(--success-ink))",
            borderColor: "hsl(var(--sage) / 0.4)",
          }}
        />
      )}
      {hasSubmittedCredentials && (
        <ProfileBadge
          label="Verification in progress"
          icon={<Clock />}
          description="A credential has been submitted and Helpr is reviewing it. It becomes a badge once it clears."
          className="border"
          style={{
            backgroundColor: "hsl(var(--amber-tint) / 0.15)",
            color: "hsl(var(--amber-ink))",
            borderColor: "hsl(var(--amber-tint) / 0.4)",
          }}
        />
      )}
      {lastActiveLabel && (
        <ProfileBadge
          label={lastActiveLabel.text}
          title="Recently active"
          icon={
            <span
              aria-hidden
              className="rounded-full"
              style={{
                width: 8,
                height: 8,
                background: lastActiveLabel.isLive ? "hsl(var(--live))" : "hsl(var(--olivewood) / 0.8)",
                boxShadow: lastActiveLabel.isLive ? "0 0 0 3px hsl(var(--live) / 0.18)" : "none",
              }}
            />
          }
          description={
            lastActiveLabel.isLive
              ? "This member used Helpr in the last ten minutes, so a message is likely to get a quick answer."
              : "When this member last used Helpr. Shown for a week after their last visit, then hidden."
          }
          style={{
            background: lastActiveLabel.isLive ? "hsl(var(--live) / 0.10)" : "hsl(var(--olivewood) / 0.08)",
            border: `0.5px solid ${lastActiveLabel.isLive ? "hsl(var(--live) / 0.35)" : "hsl(var(--olivewood) / 0.20)"}`,
            color: lastActiveLabel.isLive ? "hsl(var(--live))" : "hsl(var(--olivewood))",
          }}
        />
      )}
      {earned.map((m) => (
        <MilestoneChip key={m.id} milestone={m} />
      ))}
      {badges.map((badge) => (
        <ProfileBadge
          key={badge.key}
          label={badge.label}
          icon={badge.icon}
          description={`Performance badge — ${badge.description}`}
          className={badge.color}
        />
      ))}
    </div>
  );
};
