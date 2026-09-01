import {
  MapPin,
  Award, BadgeCheck, Camera, Crown,
  Star, Share2, Edit, Eye,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import UserAvatar from "@/components/UserAvatar";
import { isPlaceholderAvatarUrl } from "@/lib/avatarImage";
import HelperTierBadge from "@/components/profile/HelperTierBadge";
import { TIER_PERKS } from "@/lib/subscriptionTiers";
import { hapticLight } from "@/lib/haptics";
import { shareNative } from "@/lib/nativeShare";
import type { Profile } from "./types";

interface IdentityHeaderProps {
  profile: Profile | null;
  userId?: string | null;
  displayName: string;
  initials: string;
  /**
   * Retained for the caller's prop shape (Profile.tsx → ProfileLanding still
   * threads it) but deliberately NOT read here any more. The `<img onError>`
   * that used to call it was the whole of this header's photo guard, and an
   * `onError`-only guard is unreachable for the defect that actually ships:
   * an avatar that returns 200 and decodes to a blank block. `<UserAvatar>`
   * owns load failure, placeholder-URL rejection and blank-bitmap rejection
   * internally now — see `src/lib/avatarImage.ts`.
   */
  setAvatarBroken: (v: boolean) => void;
  avgRating: number | null;
  reviewCount: number;
  completedCount: number;
  onSelectTab: (key: string) => void;
  tier: string;
  hasPhoto: boolean;
  memberSinceLabel: string | null;
  earnedBadges: { ok: boolean; label: string }[];
}

export function IdentityHeader({
  profile,
  userId,
  displayName,
  initials,
  avgRating,
  reviewCount,
  completedCount,
  onSelectTab,
  tier,
  hasPhoto,
  memberSinceLabel,
  earnedBadges,
}: IdentityHeaderProps) {
  const navigate = useNavigate();

  // `hasPhoto` upstream means only "the column is non-null and the <img> did
  // not fire onError". A DiceBear / ui-avatars / `?d=mp` gravatar URL is a
  // monogram GENERATOR, not a photograph — it loads fine, so it satisfied
  // `hasPhoto`, which suppressed the "Add a profile photo" affordance and put
  // an "ID verified" badge on the corner of a generated block. The check is
  // free and synchronous (no network), so it is applied here as well as inside
  // `<UserAvatar>`, which is what actually decides whether to paint it.
  //
  // The bitmap-level verdict (a 200 that decodes to a flat colour) is NOT
  // reachable from here — it lives inside `<UserAvatar>` and has no callback —
  // so a blank upload still reads as `showsPhoto`. The monogram renders
  // correctly either way; only the corner badge is affected.
  const showsPhoto = hasPhoto && !isPlaceholderAvatarUrl(profile?.avatar_url);

  return (
    <>
      {/* ── Identity header ──────────────────────────────────────────
          A confident profile header: avatar with the ID-verified badge,
          name + tier, location/tenure, bio, earned trust badges, and a
          four-up affordance row (Reviews · Share · Edit · Preview). The same
          radial Sienna→Verdigris backdrop as the Dashboard greeting
          card. */}
      <div
        className="relative liquid-glass shrink-0 p-4 overflow-hidden"
        style={{
          backgroundImage:
            "radial-gradient(70% 90% at 100% 0%, hsl(var(--burnt-sienna) / 0.08) 0%, transparent 55%), " +
            "radial-gradient(60% 80% at 0% 100%, hsl(165 18% 78% / 0.18) 0%, transparent 60%)",
          boxShadow:
            "inset 0 1px 1px 0 rgba(255, 255, 255, 0.4), " +
            "inset 0 -1px 1px 0 rgba(0, 0, 0, 0.04), " +
            "0 1px 2px hsl(var(--olivewood) / 0.05), " +
            "0 8px 18px -6px hsl(var(--olivewood) / 0.1), " +
            "0 18px 32px -10px hsl(var(--olivewood) / 0.12)",
        }}
      >
        <div className="flex flex-row items-center gap-4">
          {/* Avatar — a real focal point on this applicant-facing page.
              Tier-styled ring uses gold for elite, sienna for pro,
              bark for everyone else. ID-verified checkmark sits on the
              bottom-right as a trust signal visible at a glance. */}
          <div className="relative shrink-0">
            {/* Migrated onto the shared `<UserAvatar>` (2026-08-31). This is
                the member's own profile avatar — the single most visible one
                in the app, and the surface the owner screenshotted as "a solid
                red square with no letters on it".

                What was here: a bare `<img>` whose ONLY guard was
                `onError={() => setAvatarBroken(true)}`. That guard cannot fire
                for the defect that actually ships, because the broken avatars
                on prod return HTTP 200 and decode perfectly — they just
                contain nothing (a 240×240 frame of one colour, a 16×16
                `#c04040`, a smooth brown→olive gradient, a DiceBear frame that
                is 88% one flat red). `onError` never runs, so the monogram
                behind it was unreachable for exactly the avatars that needed
                it. See the measured prod evidence in `src/lib/avatarImage.ts`.

                `<UserAvatar>` carries all three guards — placeholder-URL,
                decoded-bitmap (luma range AND mean-absolute-Laplacian, because
                a linear gradient passes a range test at any sane threshold),
                and a real load error — plus the mandatory
                retry-without-`crossOrigin` path so a genuine photo on a
                non-CORS host is never hidden by a check that could not run.

                The button stays the frame: size, the tier ring, and the tap
                target are all still owned here. `ring-0` on the fallback
                cancels `UserAvatar`'s own hairline ring, which would otherwise
                sit a second edge just inside the tier ring. */}
            <button
              type="button"
              onClick={() => onSelectTab("profile")}
              aria-label={showsPhoto ? "Edit profile" : "Add a profile photo"}
              className="w-[88px] h-[88px] rounded-ds-avatar squircle overflow-hidden active:scale-[0.98] transition-transform"
              style={{
                boxShadow:
                  tier === "elite"
                    ? "0 0 0 2.5px hsl(var(--gold-warm))"
                    : tier === "pro"
                      ? "0 0 0 2.5px hsl(var(--burnt-sienna))"
                      : "0 0 0 2px hsl(var(--bark) / 0.18)",
              }}
            >
              <UserAvatar
                userId={userId ?? profile?.user_id}
                src={profile?.avatar_url}
                name={displayName}
                initials={initials}
                pixelSize={88}
                aria-hidden
                className="w-full h-full rounded-ds-avatar squircle"
                fallbackClassName="text-ds-24 ring-0 drop-shadow-sm"
              />
            </button>
            {/* role="img" on the badge below is load-bearing, not decoration:
                aria-label is PROHIBITED on a bare <div> (an implicit
                role=generic), so without a role the label is dropped and this
                badge conveys "ID verified" to sighted users only. axe flags it
                as aria-prohibited-attr. role="img" makes it a labelled graphic,
                which is what it actually is — a status glyph whose entire
                meaning lives in the label. */}
            {/* Stripe's verdict, not `idv_status` — see
                useProfileLandingDerived and
                supabase/functions/_shared/stripeIdentity.ts. */}
            {showsPhoto && profile?.stripe_identity_verified === true && (
              <div
                role="img"
                aria-label="ID verified by Stripe"
                className="absolute -bottom-1 -right-1 w-7 h-7 rounded-full flex items-center justify-center pointer-events-none"
                style={{
                  background: "hsl(var(--bark))",
                  border: "2px solid hsl(var(--parchment))",
                }}
              >
                <BadgeCheck className="w-4 h-4" style={{ color: "hsl(var(--parchment))" }} strokeWidth={2.5} />
              </div>
            )}
            {!showsPhoto && (
              <div
                aria-hidden
                className="absolute -bottom-1 -right-1 w-7 h-7 rounded-full flex items-center justify-center pointer-events-none"
                style={{
                  background: "hsl(var(--bark))",
                  border: "2px solid hsl(var(--parchment))",
                }}
              >
                <Camera className="w-3.5 h-3.5" style={{ color: "hsl(var(--parchment))" }} strokeWidth={2.25} />
              </div>
            )}
          </div>

          {/* Name + tier + location, vertically centered against the avatar */}
          <div className="flex-1 min-w-0 text-left">
            <div className="flex items-center gap-2 flex-wrap">
              <h1
                className="font-display italic font-bold leading-tight"
                style={{
                  fontSize: "clamp(1.4rem, 2vw + 0.4rem, 1.75rem)",
                  color: "hsl(var(--ink-deep))",
                  letterSpacing: "-0.025em",
                }}
              >
                {displayName || "Welcome back"}
              </h1>
              {/* Subscription tier badge — only shown when tier is not free.
                  Basic = neutral bark (gold is reserved for the earned
                  Pro/Elite prestige, per HelperBadges), Pro = sienna,
                  Elite = gold-warm. */}
              {tier === "basic" && (
                <span
                  className="text-ds-9 font-sans font-bold uppercase tracking-wider px-1.5 py-0.5 rounded inline-flex items-center gap-1"
                  style={{
                    color: "hsl(var(--bark))",
                    background: "hsl(var(--bark) / 0.10)",
                    letterSpacing: "0.08em",
                  }}
                >
                  <Star className="w-2.5 h-2.5" /> {TIER_PERKS.basic.name}
                </span>
              )}
              {tier === "pro" && (
                <span
                  className="text-ds-9 font-sans font-bold uppercase tracking-wider px-1.5 py-0.5 rounded inline-flex items-center gap-1"
                  style={{
                    color: "hsl(var(--burnt-sienna))",
                    background: "hsl(var(--burnt-sienna) / 0.12)",
                    letterSpacing: "0.08em",
                  }}
                >
                  {/* Pro was the only rung without a glyph — Basic has a Star and
                      Elite a Crown, so a bare word read as a different kind of
                      chip rather than the middle of one ladder. Award sits
                      naturally between the two. */}
                  <Award className="w-2.5 h-2.5" /> {TIER_PERKS.pro.name}
                </span>
              )}
              {tier === "elite" && (
                <span
                  className="text-ds-9 font-sans font-bold uppercase tracking-wider px-1.5 py-0.5 rounded inline-flex items-center gap-1"
                  style={{
                    color: "hsl(var(--gold-warm))",
                    background: "hsl(var(--gold-warm) / 0.14)",
                    letterSpacing: "0.08em",
                  }}
                >
                  <Crown className="w-2.5 h-2.5" /> {TIER_PERKS.elite.name}
                </span>
              )}
            </div>
            {profile?.location && (
              // Wraps to a second line on a narrow column instead of
              // double-truncating; only an unusually long city ever
              // ellipsizes, and the short "New member"/"Since …" tenure
              // stays intact (it travels as one shrink-0 group).
              <p className="text-ds-11 text-muted-foreground flex flex-wrap items-center gap-x-1 gap-y-0.5 mt-1">
                <MapPin className="w-3 h-3 shrink-0" />
                <span className="break-words">{profile.location}</span>
                {memberSinceLabel && (
                  <span className="shrink-0 inline-flex items-center gap-1">
                    <span className="opacity-50">·</span>
                    <span>{memberSinceLabel}</span>
                  </span>
                )}
              </p>
            )}
            {/* Bio sits directly under the location / member-since line —
                with the rest of WHO THIS PERSON IS. It had drifted below the
                stat row, separating it from the name it describes.

                No top rule. The divider that used to sit here was drawn when
                the bio was a separate section further down; now that it's part
                of the identity block, a line between the name and the bio
                implied they were unrelated.

                A SIBLING of the location line, not a child of it. This block
                used to sit INSIDE that <p>, which put a <div> — and a second
                <p> — inside a paragraph. React logged it on every profile
                render (`validateDOMNesting: <div> cannot appear as a
                descendant of <p>`), and the HTML parser silently closed the
                paragraph early to cope, so the DOM the browser built was not
                the tree the code described. It happened to look right because
                the parser's repair produced these same siblings; React
                reconciling against a tree the parser rewrote is not something
                to leave to luck. Nothing moves — this is the arrangement that
                was already being rendered, now actually written down.

                It is also OUTSIDE the `profile?.location` guard now, where it
                belongs: a profile with no location still has a bio, and used
                to lose it along with the location line. */}
            <div className="mt-2">
              {profile?.bio?.trim() ? (
                <p
                  className="font-serif italic text-ds-13 leading-snug line-clamp-3"
                  style={{ color: "hsl(var(--olivewood) / 0.85)" }}
                >
                  {profile.bio}
                </p>
              ) : (
                <button
                  type="button"
                  onClick={() => onSelectTab("profile")}
                  className="w-full text-left font-serif italic text-ds-13 leading-snug active:opacity-70 transition-opacity"
                  style={{ color: "hsl(var(--olivewood) / 0.8)" }}
                >+ Add a short bio so applicants know who they're hiring.</button>
              )}
            </div>
            {/* Earned trust badges — only the EARNED ones render, so the
                row reads as proof, not a checklist of gaps. The
                verification-ladder badge (#112) lives alongside them as
                the headline trust signal — tap reveals what the tier
                means and the exact gap to the next rung, which makes
                this the one self-facing surface where progression hints
                drive behavior. Self-hides at tier 0. */}
            {(earnedBadges.length > 0 || profile) && (
              <div className="flex flex-wrap items-center gap-1.5 mt-2">
                <HelperTierBadge
                  profile={{
                    approval_status: profile?.approval_status ?? null,
                    stripe_identity_verified: profile?.stripe_identity_verified ?? null,
                    stripe_account_id: profile?.stripe_account_id ?? null,
                  }}
                  stats={{
                    completedJobs: completedCount,
                    avgRating: avgRating ?? 0,
                    reviewCount,
                  }}
                  size="sm"
                />
                {earnedBadges.map((b) => (
                  <span
                    key={b.label}
                    className="inline-flex items-center gap-1 text-ds-9 font-sans font-medium px-1.5 py-0.5 rounded-full bg-primary/10 text-primary"
                  >
                    <BadgeCheck className="w-2.5 h-2.5" />
                    {b.label}
                  </span>
                ))}
              </div>
            )}
            {!profile?.full_name?.trim() && (
              <button
                onClick={() => onSelectTab("profile")}
                className="mt-1.5 text-ds-11 font-semibold text-primary hover:underline"
              >
                + Add Your Name
              </button>
            )}
          </div>
        </div>

        {/* Affordance row — Share · Reviews · Edit · Preview, side by side in
            four even boxes. The Reviews box keeps the star + rating so the
            headline trust signal stays visible; the other three are the
            profile's primary self-actions.

            ORDER (owner, 2026-08-27). It used to run Reviews · Share · Edit ·
            Preview, which put Share — the thing you do LAST, once the profile
            is worth sending — in front of the two controls that get it into
            that state. Edit then Preview now read in workflow order: change it,
            then check what you changed. Share leads the row by the owner's
            call. Reorder only: every box keeps its existing styling, sizing
            and behaviour. */}
        <div className="mt-3.5 grid grid-cols-4 gap-2">
          <button
            type="button"
            aria-label="Share your profile"
            disabled={!userId}
            onClick={() => {
              hapticLight();
              const ratingText = avgRating ? avgRating.toFixed(1) + "★" : "New Helpr";
              const url = `https://www.louisianahelpr.com/user/${userId}`;
              const text = `${displayName} · ${completedCount} job${completedCount === 1 ? "" : "s"} · ${ratingText}\n\nHire me on Helpr:`;
              /**
               * KNOWN LIMITATION — `/user/:userId` IS BEHIND A LOGIN WALL.
               *
               * Verified against production, signed out: this URL 302s in-app
               * to `/login?redirect=%2Fuser%2F<id>` and renders "That page
               * needs an account." So a recipient who is not already a Helpr
               * user does not see the profile they were sent.
               *
               * The URL is nonetheless kept, and this is a deliberate call
               * rather than an oversight:
               *  - It is not FILLER. Unlike the Work Record bug (which sent
               *    the marketing homepage) and Helpr Wrapped (which sent the
               *    same), this URL is the exact resource being shared. The
               *    link preview a recipient gets is generic either way — the
               *    site is a client-rendered SPA with one static index.html,
               *    so every route serves identical `og:` tags — but the
               *    destination is right.
               *  - `/login` preserves `?redirect=`, so the journey completes:
               *    sign up, land on the profile. Hiring requires an account
               *    regardless, so the wall is on the path either way.
               *  - Dropping the URL would leave the text ending on a dangling
               *    "Hire me on Helpr:" with nothing after it, and would give
               *    the recipient no way to reach the person at all.
               *
               * The real fix is a public, guest-readable profile preview —
               * the treatment `/jobs/:id` already gets via `JobDetail`
               * (read-only for guests, Apply routed to `/signup`). That is a
               * routing + privacy decision about what of a member's profile
               * may be shown to a stranger, so it belongs to whoever owns
               * `App.tsx` and `UserProfile.tsx`, not to this button.
               */
              void shareNative({
                title: `${displayName} on Helpr`,
                text,
                url,
                dialogTitle: "Share your profile",
                clipboardText: `${text}\n${url}`,
              });
            }}
            className="flex flex-col items-center justify-center gap-1 min-h-[64px] rounded-ds-md px-1 py-2 active:scale-95 transition-transform disabled:opacity-50"
            style={{ background: "hsl(var(--bark) / 0.06)" }}
          >
            <Share2 className="w-4 h-4" style={{ color: "hsl(var(--bark))" }} />
            <span className="text-ds-9 font-sans font-semibold" style={{ color: "hsl(var(--olivewood) / 0.85)" }}>
              Share
            </span>
          </button>

          <button
            type="button"
            onClick={() => { hapticLight(); onSelectTab("reviews"); }}
            className="flex flex-col items-center justify-center gap-1 min-h-[64px] rounded-ds-md px-1 py-2 active:scale-95 transition-transform"
            style={{ background: "hsl(var(--bark) / 0.06)" }}
          >
            <span className="inline-flex items-center gap-1" style={{ color: "hsl(var(--ink-deep))" }}>
              {/* Gold is reserved for prestige that was actually EARNED (P1).
                  This star was unconditionally filled gold, so a brand-new
                  account rendered a gold star directly above the words
                  "0 reviews" — the exact inverse of what gold is supposed to
                  signal, and it cheapens the badge for helprs who did earn it.
                  With no rating yet it is an outline star in the muted ink,
                  which reads as "nothing here yet" rather than as an award. */}
              <Star
                className={`w-3.5 h-3.5 ${avgRating ? "fill-current" : ""}`}
                style={{ color: avgRating ? "hsl(var(--gold-warm))" : "hsl(var(--olivewood) / 0.8)" }}
              />
              <span className="text-ds-13 font-bold leading-none">
                {avgRating ? avgRating.toFixed(1) : "New"}
              </span>
            </span>
            <span className="text-ds-9 font-sans font-semibold" style={{ color: "hsl(var(--olivewood) / 0.85)" }}>
              {reviewCount === 1 ? "1 review" : `${reviewCount} reviews`}
            </span>
          </button>

          <button
            type="button"
            aria-label="Edit profile"
            onClick={() => { hapticLight(); onSelectTab("profile"); }}
            className="flex flex-col items-center justify-center gap-1 min-h-[64px] rounded-ds-md px-1 py-2 active:scale-95 transition-transform"
            style={{ background: "hsl(var(--bark) / 0.06)" }}
          >
            <Edit className="w-4 h-4" style={{ color: "hsl(var(--bark))" }} />
            <span className="text-ds-9 font-sans font-semibold" style={{ color: "hsl(var(--olivewood) / 0.85)" }}>
              Edit
            </span>
          </button>

          {/* Preview — your own public profile, exactly as an applicant or a
              poster sees it (`/user/:id`, the same page the Share link above
              points at). Share hands the link to someone ELSE; there was no way
              to look at it yourself without copying the link out and pasting it
              back in. Owner-approved as the fourth affordance.

              The row was already `grid-cols-4` with three children, so this
              fills the column that was sitting empty — nothing else changes
              size. Disabled with no id for the same reason Share is: the
              destination does not exist yet. */}
          <button
            type="button"
            aria-label="Preview your public profile"
            disabled={!userId}
            onClick={() => { hapticLight(); if (userId) navigate(`/user/${userId}`); }}
            className="flex flex-col items-center justify-center gap-1 min-h-[64px] rounded-ds-md px-1 py-2 active:scale-95 transition-transform disabled:opacity-50"
            style={{ background: "hsl(var(--bark) / 0.06)" }}
          >
            <Eye className="w-4 h-4" style={{ color: "hsl(var(--bark))" }} />
            <span className="text-ds-9 font-sans font-semibold" style={{ color: "hsl(var(--olivewood) / 0.85)" }}>
              Preview
            </span>
          </button>
        </div>

        {/* Earnings · Last 6 Weeks used to sit here — a sparkline teaser that
            tapped through to the Earnings tab. Removed 2026-08-27 (owner:
            "remove earnings last 6 weeks entirely from the profile view, it's
            already in a tab"). Same reasoning that moved the activity trend
            out below: the landing is identity, and the number already has a
            home one tap away. `earningsSparkline`/`totalEarnings` left the
            prop surface with it; Profile.tsx still computes totalEarnings for
            the Earnings tab, which takes it directly. */}

        {/* Activity trend used to sit here. Moved to the Earnings tab's
            analytics section (owner decision): the Profile landing is
            identity — who you are, what you've done, how to reach you — and
            a self-fetching area chart of your own job volume is analysis,
            not identity. It also kept recharts (~107 kB gzip) off the
            landing's import chain. */}

        {/* "Work & reviews" disclosure removed 2026-08-19 (owner request).
            It rendered as an eyebrow + a "View" chevron above a ~90pt gap and
            no content for most accounts, because the portfolio strip and the
            review preview it wrapped are already reachable from the Edit
            profile and My reviews rows below. */}
      </div>
    </>
  );
}
