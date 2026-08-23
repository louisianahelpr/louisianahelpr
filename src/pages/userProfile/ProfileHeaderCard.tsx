import { useState } from "react";
import { MapPin, Clock, CheckCircle, Phone, ClipboardList, ShieldCheck, Users, Timer, RotateCcw } from "lucide-react";
import { HelperBadges, type HelperBadge } from "@/components/HelperBadges";
import CredentialBadge from "@/components/CredentialBadge";
import BusinessBadge from "@/components/BusinessBadge";
import HelperTierBadge from "@/components/profile/HelperTierBadge";
import type { Database } from "@/integrations/supabase/types";
import { cn } from "@/lib/utils";
import { avatarGradientFor } from "@/lib/avatarGradient";
import type { GeoState } from "@/hooks/useUserLocation";
import type {
  ProfileJob,
  ProfileStatsShape,
  ResponseMetrics,
  CancellationRate,
  LastActiveLabel,
  PetCareSignal,
} from "./types";

type Profile = Database["public"]["Tables"]["profiles"]["Row"];

type Props = {
  profile: Profile;
  userId: string;
  displayName: string;
  initials: string;
  isOwnProfile: boolean;
  isIdVerified: boolean;
  lastActiveLabel: LastActiveLabel | null;
  mutualJobsCount: number;
  responseMetrics: ResponseMetrics;
  onTimeArrivalRate: number | null;
  revisionFrequency: number | null;
  cancellationRate: CancellationRate;
  hasCleanRecord: boolean;
  petCareSignal: PetCareSignal | null | undefined;
  badges: HelperBadge[];
  tierProfile: { approval_status: string | null; idv_status: string | null; stripe_account_id: string | null } | null;
  stats: ProfileStatsShape;
  hasSubmittedCredentials: boolean;
  workedJobs: ProfileJob[];
  showNearbyProof: boolean;
  onShowNearbyProof: () => void;
  viewerLoc: GeoState;
  jobsNearbyCount: number | null;
  nearbyRadiusMi: number;
};

export const ProfileHeaderCard = ({
  profile,
  userId,
  displayName,
  initials,
  isOwnProfile,
  isIdVerified,
  lastActiveLabel,
  mutualJobsCount,
  responseMetrics,
  onTimeArrivalRate,
  revisionFrequency,
  cancellationRate,
  hasCleanRecord,
  petCareSignal,
  badges,
  tierProfile,
  stats,
  hasSubmittedCredentials,
  workedJobs,
  showNearbyProof,
  onShowNearbyProof,
  viewerLoc,
  jobsNearbyCount,
  nearbyRadiusMi,
}: Props) => {
  // A truthy-but-broken avatar_url (stale storage path, 404) would otherwise
  // pass the null/empty guard below, fail to load, and paint the alt text.
  // Treat a load error as "no photo" so we fall through to the initials block.
  const [avatarFailed, setAvatarFailed] = useState(false);
  return (
    <div
      className="rounded-2xl liquid-glass p-5 text-center space-y-3 relative overflow-hidden"
      style={{
        backgroundImage:
          "radial-gradient(70% 90% at 100% 0%, hsl(var(--burnt-sienna) / 0.08) 0%, transparent 55%), " +
          "radial-gradient(60% 80% at 0% 100%, hsl(165 18% 78% / 0.18) 0%, transparent 60%)",
      }}
    >
      {/* Verified Helpr ribbon — visible top-right corner badge
          for ID-verified helpers. Promotes the trust signal from
          a small chip to a prominent marker posters see at first
          glance. Gold-warm so it reads as recognition, not status. */}
      {isIdVerified && (
        <div
          aria-label="Verified Helpr"
          className="absolute top-3 right-3 inline-flex items-center gap-1 px-2.5 py-1 rounded-full"
          style={{
            background: "hsl(var(--gold-warm) / 0.14)",
            border: "0.5px solid hsl(var(--gold-warm) / 0.36)",
            boxShadow:
              "inset 0 1px 1px 0 rgba(255, 255, 255, 0.55), " +
              "0 1px 2px hsl(var(--gold-warm) / 0.12), " +
              "0 4px 10px -3px hsl(var(--gold-warm) / 0.28)",
          }}
        >
          <ShieldCheck className="w-3 h-3" style={{ color: "hsl(var(--gold-warm))" }} strokeWidth={2.5} />
          <span
            className="font-sans font-bold uppercase tracking-wider text-ds-10"
            style={{ color: "hsl(var(--gold-warm))", letterSpacing: "0.16em" }}
          >
            Verified
          </span>
        </div>
      )}
      <div className="relative inline-block">
        {profile.avatar_url && !avatarFailed ? (
          <img
            loading="lazy"
            decoding="async"
            src={profile.avatar_url}
            alt={`${displayName} profile picture`}
            onError={() => setAvatarFailed(true)}
            className="w-24 h-24 rounded-ds-avatar squircle mx-auto object-cover"
            style={{ boxShadow: "0 0 0 2px hsl(var(--bark) / 0.18)" }}
          />
        ) : (
          <div
            className={cn(
              // Was a flat `bg-primary/10` — swap to the
              // deterministic warm-palette gradient hashed off the
              // helper's user id so each profile has a recognizable
              // signature when no avatar has been uploaded.
              // `rounded-ds-avatar squircle` is the app-wide avatar radius
              // (IdentityHeader, PhotoNameSection). Was `rounded-ds-pill`,
              // the 28px *pill* token — a pill radius stacked on squircle
              // corner-smoothing, the same conflict as the old
              // `rounded-full` + `squircle` pairing.
              "w-24 h-24 rounded-ds-avatar squircle bg-gradient-to-br text-[hsl(var(--ink-deep))] drop-shadow-sm flex items-center justify-center mx-auto text-ds-24 font-display italic font-bold",
              avatarGradientFor(userId),
            )}
            style={{ boxShadow: "0 0 0 2px hsl(var(--bark) / 0.18)" }}
          >
            {initials}
          </div>
        )}
        {isIdVerified && (
          <div
            // role="img" is required for the label to survive: aria-label is
            // PROHIBITED on a bare <div> (implicit role=generic), so without
            // it the badge reads as "ID verified" to sighted users only.
            // Same fix as the twin badge in
            // components/profile/profileLanding/IdentityHeader.tsx — this is
            // the public-profile copy of it.
            role="img"
            aria-label="ID verified"
            className="absolute -bottom-1 -right-1 w-7 h-7 rounded-full flex items-center justify-center"
            style={{
              background: "hsl(var(--bark))",
              border: "2px solid hsl(var(--parchment))",
            }}
          >
            <ShieldCheck className="w-4 h-4" style={{ color: "hsl(var(--parchment))" }} strokeWidth={2.5} />
          </div>
        )}
      </div>
      <div>
        {/* h2, not h1: UserProfile already renders a <PageHeader> whose title
            ("Profile" / "Profile Review") is this page's h1, so making the
            person's name a second h1 gave /user/:id TWO top-level headings and
            broke the document outline for screen readers. Purely a semantic
            change — `text-page-title` carries all the styling, and the only
            bare-tag rule in index.css is a print block that treats h1–h6
            identically, so nothing moves visually. */}
        <h2 className="text-page-title leading-tight">
          {displayName}
        </h2>
        {/* Meta row — place and tenure share one line so the identity block
            reads as a single unit. "Member since" used to sit orphaned at the
            very bottom of the page, far from the name it describes. */}
        {(profile.location || profile.created_at) && (
          <p
            className="font-serif italic flex flex-wrap items-center justify-center gap-x-1.5 gap-y-0.5 mt-0.5 text-ds-13"
            style={{ color: "hsl(var(--olivewood) / 0.8)" }}
          >
            {profile.location && (
              <span className="inline-flex items-center gap-1">
                <MapPin className="w-3 h-3 shrink-0" />{profile.location}
              </span>
            )}
            {profile.location && profile.created_at && (
              <span aria-hidden style={{ color: "hsl(var(--burnt-sienna) / 0.35)" }}>·</span>
            )}
            {profile.created_at && (
              <span>
                Since {new Date(profile.created_at).toLocaleDateString("en-US", { month: "short", year: "numeric" })}
              </span>
            )}
          </p>
        )}
        {/* Last-active presence chip (#28). Compact, low-weight —
            meant to read at-a-glance, not compete with the badges.
            Green dot when active within 10 minutes ("live"),
            olivewood for everything else. Hidden when stale (>7d). */}
        {lastActiveLabel && (
          <div
            className="inline-flex items-center gap-1.5 mt-1.5 px-2 py-0.5 rounded-full text-ds-11"
            style={{
              background: lastActiveLabel.isLive
                ? "hsl(var(--live) / 0.10)"
                : "hsl(var(--olivewood) / 0.08)",
              border: `0.5px solid ${
                lastActiveLabel.isLive
                  ? "hsl(var(--live) / 0.35)"
                  : "hsl(var(--olivewood) / 0.20)"
              }`,
              color: lastActiveLabel.isLive
                ? "hsl(var(--live))"
                : "hsl(var(--olivewood))",
            }}
          >
            <span
              className="w-1.5 h-1.5 rounded-full"
              style={{
                background: lastActiveLabel.isLive
                  ? "hsl(var(--live))"
                  : "hsl(var(--olivewood) / 0.8)",
                boxShadow: lastActiveLabel.isLive
                  ? "0 0 0 3px hsl(var(--live) / 0.18)"
                  : "none",
              }}
              aria-hidden
            />
            <span className="font-medium">{lastActiveLabel.text}</span>
          </div>
        )}
        {/* Mutual jobs pill (#1) — shown for viewers who have already
            worked with this user before, in either direction. A
            strong trust signal: prior shared history short-circuits
            the "who is this person?" calculus. Hidden at 0 (no
            history) or when viewing your own profile. */}
        {!isOwnProfile && mutualJobsCount > 0 && (
          <div
            className="inline-flex items-center gap-1.5 mt-1.5 ml-1.5 px-2 py-0.5 rounded-full text-ds-11"
            style={{
              background: "hsl(var(--bark) / 0.10)",
              border: "0.5px solid hsl(var(--bark) / 0.22)",
              color: "hsl(var(--bark))",
            }}
          >
            <Users className="w-3 h-3" />
            <span className="font-medium">
              You've worked together{" "}
              <span className="font-display italic font-bold tabular-nums">{mutualJobsCount}</span>{" "}
              {mutualJobsCount === 1 ? "time" : "times"}
            </span>
          </div>
        )}
        {/* Response Metrics inline */}
        {responseMetrics.totalApplications > 0 && (
          <div className="flex items-center justify-center gap-3 mt-2 text-ds-11" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
            {responseMetrics.avgResponseHours !== null && (
              <span className="flex items-center gap-1">
                <Clock className="w-3 h-3" />
                <span className="font-display italic font-bold tabular-nums" style={{ color: "hsl(var(--ink-deep))" }}>
                  {responseMetrics.avgResponseHours < 1
                    ? `${Math.round(responseMetrics.avgResponseHours * 60)}m`
                    : responseMetrics.avgResponseHours < 24
                    ? `${responseMetrics.avgResponseHours.toFixed(1)}h`
                    : `${Math.round(responseMetrics.avgResponseHours / 24)}d`}
                </span>
                <span>avg reply</span>
              </span>
            )}
            {responseMetrics.acceptanceRate !== null && (
              <>
                <span style={{ color: "hsl(var(--burnt-sienna) / 0.35)" }}>·</span>
                <span className="flex items-center gap-1">
                  <CheckCircle className="w-3 h-3" />
                  <span className="font-display italic font-bold tabular-nums" style={{ color: "hsl(var(--ink-deep))" }}>
                    {responseMetrics.acceptanceRate.toFixed(0)}%
                  </span>
                  <span>accept rate</span>
                </span>
              </>
            )}
          </div>
        )}
        {/* On-time arrival + revision frequency (#6). Derived from
            helper_arrived_at vs date_needed/start_time + revision_count
            on the last 50 completed jobs. Both require a minimum
            sample of 5 to surface, so they only appear once the
            helper has accumulated enough history to be meaningful.
            Skipped silently when the schema doesn't yield a usable
            signal (no arrived_at timestamps recorded yet). */}
        {(onTimeArrivalRate !== null || revisionFrequency !== null) && (
          <div className="flex items-center justify-center gap-3 mt-1.5 text-ds-11" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
            {onTimeArrivalRate !== null && (
              <span className="flex items-center gap-1">
                <Timer className="w-3 h-3" />
                <span
                  className="font-display italic font-bold tabular-nums"
                  style={{
                    color:
                      onTimeArrivalRate >= 85
                        ? "hsl(var(--ink-deep))"
                        : onTimeArrivalRate >= 65
                        ? "hsl(var(--gold-warm))"
                        : "hsl(var(--burnt-sienna))",
                  }}
                >
                  {onTimeArrivalRate.toFixed(0)}%
                </span>
                <span>on-time</span>
              </span>
            )}
            {onTimeArrivalRate !== null && revisionFrequency !== null && (
              <span style={{ color: "hsl(var(--burnt-sienna) / 0.35)" }}>·</span>
            )}
            {revisionFrequency !== null && (
              <span className="flex items-center gap-1">
                <RotateCcw className="w-3 h-3" />
                <span
                  className="font-display italic font-bold tabular-nums"
                  style={{
                    color:
                      revisionFrequency <= 10
                        ? "hsl(var(--ink-deep))"
                        : revisionFrequency <= 25
                        ? "hsl(var(--gold-warm))"
                        : "hsl(var(--burnt-sienna))",
                  }}
                >
                  {revisionFrequency.toFixed(0)}%
                </span>
                <span>revisions</span>
              </span>
            )}
          </div>
        )}
        {/* "Did N jobs nearby" social proof (#31). Two states:
            - opt-in pill when viewer hasn't granted geo yet AND the
              helper has at least one completed worked job with
              coords (otherwise the count would be 0).
            - rendered count once geolocation resolves. We always
              show the count even when zero — a "0 jobs near you"
              fact is a legitimate trust input. Hidden entirely on
              your own profile so you don't see your own count. */}
        {!isOwnProfile && (() => {
          const hasNearbyEligibleJobs = workedJobs.some(
            (j) => j.status === "completed" && typeof j.latitude === "number" && typeof j.longitude === "number",
          );
          if (!hasNearbyEligibleJobs) return null;
          if (!showNearbyProof) {
            return (
              <div className="mt-1.5 flex justify-center">
                <button
                  onClick={onShowNearbyProof}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-ds-11 font-medium transition-colors"
                  style={{
                    color: "hsl(var(--bark))",
                    background: "hsl(var(--bark) / 0.06)",
                    border: "0.5px solid hsl(var(--bark) / 0.18)",
                  }}
                >
                  <MapPin className="w-3 h-3" />
                  Show Jobs Near You
                </button>
              </div>
            );
          }
          if (viewerLoc.status === "loading") {
            return (
              <div className="mt-1.5 flex items-center justify-center gap-1 text-ds-11" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
                <MapPin className="w-3 h-3" />
                <span className="italic">Checking nearby…</span>
              </div>
            );
          }
          if (viewerLoc.status === "error") {
            return (
              <div className="mt-1.5 flex items-center justify-center gap-1 text-ds-11" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
                <MapPin className="w-3 h-3" />
                <span className="italic">Location unavailable</span>
              </div>
            );
          }
          if (jobsNearbyCount === null) return null;
          return (
            <div className="mt-1.5 flex items-center justify-center gap-1 text-ds-11" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
              <MapPin className="w-3 h-3" />
              <span className="font-display italic font-bold tabular-nums" style={{ color: "hsl(var(--ink-deep))" }}>
                {jobsNearbyCount}
              </span>
              <span>{jobsNearbyCount === 1 ? "job" : "jobs"} within {nearbyRadiusMi}mi of you</span>
            </div>
          );
        })()}
        {/* Cancellation rate (#30) — combined helper + poster jobs.
            Only renders once the user has >=5 lifetime jobs so a
            single early cancellation doesn't read as "100% cancel
            rate". Color shifts olive→amber→sienna at 5%/15% so the
            signal degrades gracefully rather than feeling punitive. */}
        {cancellationRate.rate !== null && (
          <div className="flex items-center justify-center gap-1 mt-1.5 text-ds-11" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
            <span
              className="font-display italic font-bold tabular-nums"
              style={{
                color:
                  cancellationRate.rate < 5
                    ? "hsl(var(--ink-deep))"
                    : cancellationRate.rate < 15
                    ? "hsl(var(--gold-warm))"
                    : "hsl(var(--burnt-sienna))",
              }}
            >
              {cancellationRate.rate.toFixed(0)}%
            </span>
            <span>cancel rate</span>
            <span style={{ color: "hsl(var(--olivewood) / 0.8)" }}>· {cancellationRate.cancelled}/{cancellationRate.total} jobs</span>
          </div>
        )}
        {/* "No disputes on record" trust signal — shown only when
            the dispute count query confirms 0 disputes. Hidden
            while the query is loading (to avoid flash of "clean"
            for accounts with disputes), and hidden entirely on
            own profile (already seeing yours). PGRST202 = table
            not deployed → query returns null → badge stays hidden. */}
        {!isOwnProfile && hasCleanRecord && (
          <div className="flex items-center justify-center mt-1.5">
            <span
              className="font-serif italic text-ds-12"
              style={{ color: "hsl(var(--success-ink))" }}
            >
              ✓ No disputes on record
            </span>
          </div>
        )}
        {/* Pet care trust signal — only shown when there's real history */}
        {petCareSignal && petCareSignal.distinctPets > 0 && (
          <div className="flex items-center justify-center mt-1.5">
            <span
              className="inline-flex items-center gap-1 font-serif italic text-ds-12"
              style={{ color: "hsl(var(--petcare-ink))" }}
            >
              <ClipboardList className="w-3 h-3" />
              Cared for {petCareSignal.distinctPets} {petCareSignal.distinctPets === 1 ? "pet" : "pets"} · {petCareSignal.reportCount} {petCareSignal.reportCount === 1 ? "report" : "reports"} sent
            </span>
          </div>
        )}
        {profile.phone && (
          <p className="font-serif italic mt-1.5 flex items-center justify-center gap-1 text-ds-12" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
            <Phone className="w-3 h-3" />{profile.phone}
          </p>
        )}
        {profile.bio && (
          <p
            className="font-serif italic mt-3 leading-relaxed text-left text-ds-14"
            style={{ color: "hsl(var(--ink-deep) / 0.88)" }}
          >
            {profile.bio}
          </p>
        )}
        {profile.skills && (
          <div className="flex flex-wrap gap-1.5 justify-center mt-3">
            {profile.skills.split(",").map(s => s.trim()).filter(Boolean).map((s, i) => (
              <span
                key={i}
                className="text-ds-11 font-sans font-semibold px-2 py-0.5 rounded-full"
                style={{
                  background: "hsl(var(--bark) / 0.10)",
                  color: "hsl(var(--bark))",
                  border: "0.5px solid hsl(var(--bark) / 0.20)",
                }}
              >
                {s}
              </span>
            ))}
          </div>
        )}
        {badges.length > 0 && (
          <div className="flex flex-wrap justify-center gap-1 mt-3">
            <HelperBadges badges={badges} />
          </div>
        )}
        <div className="pt-2 flex flex-wrap justify-center gap-1.5">
          {/* Verification ladder (#112) — sits with credentials
              because both answer "should I trust this person?",
              separate from the performance badges above. The
              component self-hides at tier 0, so fresh signups
              don't get a placeholder pill. */}
          <HelperTierBadge
            profile={tierProfile}
            stats={stats}
            size="md"
          />
          <CredentialBadge credentials={profile as any} size="md" />
          {/* Background-Checked badge — flipped to "verified" by the
              verification trigger once a paid background screening clears
              (see create-bgc-payment + sync_credential_from_check). Public:
              shown to any viewer as a trust signal. */}
          {(profile as any).background_check_status === "verified" && (
            <span
              className="inline-flex items-center rounded-full font-semibold border text-ds-11 px-2.5 py-1 gap-1"
              style={{
                background: "hsl(var(--sage) / 0.16)",
                color: "hsl(var(--success-ink))",
                borderColor: "hsl(var(--sage) / 0.4)",
              }}
              title="Background check passed — verified by Helpr"
            >
              <ShieldCheck className="w-3.5 h-3.5" />
              Background-Checked
            </span>
          )}
          {/* Verification in progress — shown only when the user has
              submitted a credential to a vendor but it hasn't resolved
              yet. Hides gracefully if helper_credentials table isn't
              deployed (PGRST202 returns null from the query). */}
          {hasSubmittedCredentials && (
            <span
              className="inline-flex items-center rounded-full font-medium border text-ds-11 px-2.5 py-1 gap-1"
              style={{
                backgroundColor: "hsl(var(--amber-tint) / 0.15)",
                color: "hsl(var(--amber-ink))",
                borderColor: "hsl(var(--amber-tint) / 0.4)",
              }}
              title="Credential submitted — verification in progress"
            >
              <Clock className="w-3.5 h-3.5" />
              Verification in progress
            </span>
          )}
          <BusinessBadge userId={userId} size="md" />
        </div>
      </div>
    </div>
  );
};
