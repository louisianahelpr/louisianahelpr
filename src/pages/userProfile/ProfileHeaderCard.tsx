import { useState } from "react";
import { MapPin, Clock, Phone, ShieldCheck, Users } from "lucide-react";
import CredentialBadge from "@/components/CredentialBadge";
import HelperTierBadge from "@/components/profile/HelperTierBadge";
import type { Database } from "@/integrations/supabase/types";
import { cn } from "@/lib/utils";
import { avatarGradientFor } from "@/lib/avatarGradient";
import type { ProfileStatsShape, LastActiveLabel } from "./types";

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
  tierProfile: { approval_status: string | null; stripe_identity_verified: boolean | null; stripe_account_id: string | null } | null;
  stats: ProfileStatsShape;
  hasSubmittedCredentials: boolean;
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
  tierProfile,
  stats,
  hasSubmittedCredentials,
}: Props) => {
  // A truthy-but-broken avatar_url (stale storage path, 404) would otherwise
  // pass the null/empty guard below, fail to load, and paint the alt text.
  // Treat a load error as "no photo" so we fall through to the initials block.
  const [avatarFailed, setAvatarFailed] = useState(false);
  return (
    <div
      className="rounded-2xl liquid-glass p-5 relative overflow-hidden"
      style={{
        backgroundImage:
          "radial-gradient(70% 90% at 100% 0%, hsl(var(--burnt-sienna) / 0.08) 0%, transparent 55%), " +
          "radial-gradient(60% 80% at 0% 100%, hsl(165 18% 78% / 0.18) 0%, transparent 60%)",
      }}
    >
      {/* ID-verified ribbon — visible top-right corner badge for helpers
          whose identity STRIPE verified. Promotes the trust signal from a
          small chip to a prominent marker posters see at first glance.
          Gold-warm so it reads as recognition, not status.

          It used to fire on `!!id_document_url` — merely having UPLOADED a
          document earned a "Verified" ribbon in front of strangers deciding
          whether to let this person into their home, even though nobody
          reviews the upload. It now reads `stripe_identity_verified`; the
          label names Stripe so it claims exactly what was actually done. */}
      {/* Top-right corner stack (item 25, 2026-08-30): the Stripe-verified
          ribbon, "Active today"/"Active now" presence, and the mutual-jobs
          pill all live in ONE corner column now, instead of presence/mutual
          sitting inline under the name where they crowded the bio and wrapped
          on narrow phones. All three are the same kind of thing — a small
          corner-badge fact about this profile, not part of the identity row
          itself — so they read as one stack, top-aligned to the card. */}
      {(isIdVerified || lastActiveLabel || (!isOwnProfile && mutualJobsCount > 0)) && (
        <div className="absolute top-3 right-3 flex flex-col items-end gap-1.5 z-10">
          {isIdVerified && (
            <div
              aria-label="Identity verified by Stripe"
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full"
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
                Stripe verified
              </span>
            </div>
          )}
          {/* Last-active presence chip (#28). Compact, low-weight —
              meant to read at-a-glance, not compete with the badges.
              Green dot when active within 10 minutes ("live"),
              olivewood for everything else. Hidden when stale (>7d). */}
          {lastActiveLabel && (
            <div
              className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-ds-11"
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
              className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-ds-11"
              style={{
                background: "hsl(var(--bark) / 0.10)",
                border: "0.5px solid hsl(var(--bark) / 0.22)",
                color: "hsl(var(--bark))",
              }}
            >
              <Users className="w-3 h-3" />
              <span className="font-medium">
                Worked together{" "}
                <span className="font-display italic font-bold tabular-nums">{mutualJobsCount}</span>{" "}
                {mutualJobsCount === 1 ? "time" : "times"}
              </span>
            </div>
          )}
        </div>
      )}
      {/* WHO THEY ARE on the left, HOW THEY PERFORM on the right (owner:
          "orgnaize better. some om the left some on right").

          Everything in this card used to be one centred stack in a narrow
          column: a 96px avatar alone on its own line, then a name, then eight
          separate centred one-line stats under it, then a LEFT-aligned bio
          hanging off the bottom of a centred card. On a wide screen that left
          most of the card empty down both sides and still made the reader
          scroll past ten short lines to reach the bio.

          The split is by KIND, not to fill space. Left is identity and
          verification — avatar, name, place, tenure, presence, shared history,
          the trust badges: everything answering "who is this". Right is the
          record — reply time, accept rate, on-time, revisions, cancellations,
          disputes, what they do, and how they describe themselves.

          Below `sm` the two halves stack (identity above the record) rather
          than sitting side by side. The identity half itself is a row at every
          width now — see the note on it below. */}
      <div className="flex flex-col sm:flex-row sm:items-start gap-3 sm:gap-5">
        {/* ── IDENTITY ── */}
        {/* Avatar LEFT, name/place/tenure RIGHT — the same row the signed-in
            Profile tab uses (profileLanding/IdentityHeader: "flex flex-row
            items-center gap-4"). This column stacked the avatar ABOVE the name
            inside a fixed 212px rail, so the public profile and the owner's own
            profile presented the same identity two different ways (owner,
            2026-08-25: "name and location and since needs to be to the right of
            picture just like it in when they click profile tab").

            NOW ON PHONE TOO (owner, 2026-08-27). The row was `sm:` only, so the
            surface the owner actually looks at — the phone / the native app —
            still centred the avatar with the name stacked underneath, and the
            public profile went on presenting the same identity two different
            ways depending on the width. IdentityHeader is a bare
            `flex flex-row items-center gap-4` at every width on an 88px avatar
            in the same 375pt column, so "a row leaves the name no width" was
            never true; this is the same row on a 96px avatar.

            TWO children, not five. Avatar, then ONE column holding name, place,
            tenure, presence, shared history and the trust badges — the same
            shape IdentityHeader uses. They used to be five siblings of the flex
            container, which on `sm:flex-row` laid the presence chip, the mutual
            pill and the badge rail out as three more COLUMNS beside the name
            instead of stacking under it. */}
        <div className="flex flex-row items-center text-left gap-4 sm:w-[420px] sm:shrink-0">
          <div className="relative inline-block shrink-0">
            {profile.avatar_url && !avatarFailed ? (
              <img
                loading="lazy"
                decoding="async"
                src={profile.avatar_url}
                alt={`${displayName} profile picture`}
                onError={() => setAvatarFailed(true)}
                className="w-24 h-24 rounded-ds-avatar squircle object-cover"
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
                  "w-24 h-24 rounded-ds-avatar squircle bg-gradient-to-br text-[hsl(var(--ink-deep))] drop-shadow-sm flex items-center justify-center text-ds-24 font-display italic font-bold",
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
                aria-label="ID verified by Stripe"
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
          {/* The one info column that sits to the right of the avatar. */}
          <div className="min-w-0 flex-1">
          <div className="min-w-0">
            {/* h2, not h1: UserProfile already renders a <PageHeader> whose title
                ("Profile" / "Profile Review") is this page's h1, so making the
                person's name a second h1 gave /user/:id TWO top-level headings and
                broke the document outline for screen readers. Purely a semantic
                change — `text-page-title` carries all the styling, and the only
                bare-tag rule in index.css is a print block that treats h1–h6
                identically, so nothing moves visually. */}
            <h2 className="text-page-title leading-tight truncate min-w-0">
              {displayName}
            </h2>
            {/* Meta row — place and tenure share one line so the identity block
                reads as a single unit. "Member since" used to sit orphaned at the
                very bottom of the page, far from the name it describes. */}
            {(profile.location || profile.created_at) && (
              <p
                className="font-serif italic flex flex-wrap items-center justify-start gap-x-1.5 gap-y-0.5 mt-0.5 text-ds-13"
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
            {/* Bio sits with the identity block, directly under location
                (owner, 2026-08-29). It used to live in a separate column far
                below the badges and presence chip, so "who this person says
                they are" was split from their name and place by everything
                else on the card. */}
            {profile.bio && (
              <p
                className="font-serif italic mt-2 leading-relaxed text-ds-14"
                style={{ color: "hsl(var(--ink-deep) / 0.88)" }}
              >
                {profile.bio}
              </p>
            )}
          </div>
            <div className="pt-2 flex flex-wrap justify-start gap-1.5">
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
            </div>
          </div>
        </div>

        {/* ── BIO ── */}
        {/* What used to be "THE RECORD": nine performance stats, a nearby-jobs
            navigation button and the bio, all stacked in one column. The nine
            stats moved out to TrackRecordCard and the earned badges to
            CareerMilestones (owner, 2026-08-28: "this needs better
            reorganized"). This card holds IDENTITY only now — who they are and
            how they describe themselves — so the two halves of the row are
            finally the same kind of thing.

            Left-aligned at every width. It was `text-center sm:text-left`,
            which on a phone centred every child while the bio underneath them
            stayed left-aligned, so the card mixed two alignments in one
            column. */}
        <div className="flex-1 min-w-0 text-left">
            {profile.phone && (
              <p className="font-serif italic flex items-center gap-1 text-ds-12" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
                <Phone className="w-3 h-3" />{profile.phone}
              </p>
            )}
            {/* Bio moved up beside the name — see the identity block above. */}
            {profile.skills && (
              <div className="flex flex-wrap gap-1.5 mt-3">
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
        </div>
      </div>
    </div>
  );
};
