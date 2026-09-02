import { useState, type ComponentProps, type ReactNode } from "react";
import { Briefcase, Clock, MapPin, ShieldCheck, Users } from "lucide-react";
import CredentialBadge from "@/components/CredentialBadge";
import HelperTierBadge from "@/components/profile/HelperTierBadge";
import UserAvatar from "@/components/UserAvatar";
import type { AvatarPhotoRejection } from "@/lib/avatarImage";
import type { Database } from "@/integrations/supabase/types";
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
  /** Earned milestone + badge chips — one row, rendered under the identity. */
  recognition?: ReactNode;
  /** The "At a glance" metric grid, rendered inside this same card. */
  atAGlance?: ReactNode;
};

/**
 * THE MASTHEAD — one card that answers "who is this, and what is their
 * record?", instead of four cards that each answered a third of it.
 *
 * What changed on 2026-08-31 (owner: "already said this needs to be better and
 * updated and polished"), and why:
 *
 * 1. **The corner pill stack is gone.** The Stripe-verified ribbon, the
 *    presence chip and the "Worked together N times" pill lived in an
 *    `absolute top-3 right-3` column with `z-10`, over an identity block that
 *    reserved no space for them. They did not merely crowd the name — measured
 *    in Chrome at 375 AND 1440, on both a sparse and a rich profile, they
 *    painted directly ON TOP of the name, the location line and the first line
 *    of the bio. Verification now sits in a normal wrapped chip row in the
 *    flow, where nothing can collide with anything.
 *
 * 2. **The name lives HERE, in the box, beside the avatar** (owner,
 *    2026-08-31: "put the name back in the box and profile back where it was
 *    to the right of back"). An earlier pass moved it up into the
 *    `<PageHeader>` h1 and left this card headless — an avatar next to a bare
 *    "Since May 2026" and nothing else. The header title is the literal string
 *    "Profile" again, sitting to the right of the back button where it was,
 *    and the person's name is the first thing in the identity column. It
 *    appears exactly ONCE on screen: here.
 *
 *    The trading name sits directly under it when there is one. It arrives
 *    pre-gated: `get_safe_profiles` emits `business_name` only once an admin
 *    has verified the licence or the COI and NULL otherwise, so there is
 *    deliberately no client-side status check here — duplicating the rule is
 *    how the two drift apart. NULL is the overwhelmingly common case, so the
 *    line renders nothing at all when absent (no empty row, no reserved gap),
 *    and the name is stripped from CredentialBadge's own suffix so the same
 *    string is not printed twice a few pixels apart.
 *
 * 3. **"Worked together" is demoted.** It is a genuinely useful trust signal
 *    and a genuinely minor one; it was wearing the loudest treatment on the
 *    card. It is now a quiet serif line under the bio, the same weight as the
 *    rest of the meta.
 *
 * 4. **The dead phone branch is deleted.** `profile.phone` was rendered here
 *    but is not returned by `get_safe_profiles` — the only read path for
 *    another member's profile — so the branch could never fire. Had it ever
 *    started returning, this card would have published a stranger's phone
 *    number. Deleted rather than left armed.
 *
 * 5. **ID verification now actually shows on other people's profiles.** The
 *    `isIdVerified` prop is derived from a direct `profiles` select, which RLS
 *    only permits on your OWN row, so it was permanently `false` for every
 *    visitor. `get_safe_profiles` returns a public `is_id_verified` column for
 *    exactly this purpose; both are consulted now.
 */
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
  recognition,
  atAGlance,
}: Props) => {
  /* ── AVATAR: MIGRATED ONTO THE SHARED `<UserAvatar>` (2026-09-01) ───────
     This card was the LAST holdout of the owner's original defect — an avatar
     rendering as a solid coloured block with no letters. It carried a local
     fork of the guard, written by the lane that first diagnosed the bug and
     deliberately never updated while the shared implementation moved on, and
     that fork was strictly weaker in three ways:

       1. Its placeholder-URL matcher covered only `?d=(blank|identicon|mp|
          mystery)`; the shared one also covers `monsterid|retro|robohash|
          wavatar`.
       2. It had the luma-RANGE check and nothing else. A linear gradient has
          an arbitrarily wide range and still carries no information, and prod
          row 6b472670 (Camille Testeur) is exactly that — a smooth brown→olive
          wash measuring range 16.8, detail 0.73 — so it sailed past a range
          test and rendered here, today, as the flat coloured square the owner
          reported. `isBlankAvatarBitmap` adds the mean-absolute-Laplacian
          test, which is identically zero for ANY linear gradient however wide
          its stops, and that is what catches it.
       3. No transparency handling: no alpha skip on the detail pass and no
          `opaque === 0` case, so a fully transparent PNG read as a photo.

     The two things the fork got RIGHT are why `<UserAvatar>` is a safe
     replacement rather than a regression — it keeps both. It retries once
     without `crossOrigin` before calling a load failure a verdict (a host with
     no `access-control-allow-origin` fails the CORS load outright, and a real
     photograph must not become a monogram because of it), and it treats a
     tainted canvas as "cannot judge → show it". Hiding a real photo is worse
     than showing a blank one.

     `avatarInitials` inside `<UserAvatar>` also subsumes the hand-rolled
     `monogram` derivation this file used to keep, including its
     never-render-an-empty-block guarantee.

     THAT GAP IS NOW CLOSED (2026-08-31). `<UserAvatar>` reports its verdict
     through `onPhotoRejected`, so this card can tell a photograph from a
     rejected block and stops painting the "ID verified" shield over a
     monogram. See `photoRejection` below. */

  // See (5) above: the private, own-row-only flag OR the public column that
  // `get_safe_profiles` exposes precisely so visitors can see this.
  const idVerified =
    isIdVerified || (profile as unknown as { is_id_verified?: boolean }).is_id_verified === true;

  // `null` while a photo is (or may still turn out to be) showing.
  const [photoRejection, setPhotoRejection] = useState<AvatarPhotoRejection | null>(null);
  const showsPhoto = photoRejection === null;

  const location = profile.location ?? null;
  const memberSinceLabel = profile.created_at
    ? new Date(profile.created_at).toLocaleDateString("en-US", { month: "short", year: "numeric" })
    : null;

  // Server-gated: NULL unless an admin has verified the licence or the COI.
  const businessName =
    (profile as unknown as { business_name?: string | null }).business_name?.trim() || null;

  const skills = (profile.skills ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  return (
    <div
      className="rounded-2xl liquid-glass overflow-hidden"
      style={{
        backgroundImage:
          "radial-gradient(70% 90% at 100% 0%, hsl(var(--burnt-sienna) / 0.08) 0%, transparent 55%), " +
          "radial-gradient(60% 80% at 0% 100%, hsl(165 18% 78% / 0.18) 0%, transparent 60%)",
      }}
    >
      <div className="p-5 sm:p-6 lg:p-7">
        <div className="flex flex-row items-start gap-4">
          {/* ── Avatar ── */}
          <div className="relative inline-block shrink-0">
            {/* The bark hairline moves onto the Avatar ROOT so it frames the
                photo and the monogram identically — it used to be duplicated
                on the two branches. `ring-0` on the fallback suppresses
                `<UserAvatar>`'s own olivewood hairline so there is one ring,
                not two, and `text-ds-24` preserves this card's large monogram
                (the shared fallback inherits a list-sized default). Sizing
                and radius tokens are unchanged from the markup they replace,
                and match IdentityHeader / PhotoNameSection. */}
            <UserAvatar
              userId={userId}
              src={profile.avatar_url}
              name={displayName}
              initials={initials}
              pixelSize={112}
              alt={`${displayName} profile picture`}
              className="w-20 h-20 sm:w-28 sm:h-28 rounded-ds-avatar squircle"
              // `rounded-ds-avatar squircle` is repeated on the FALLBACK, not
              // just the root: `AvatarFallback` ships `rounded-full`, so
              // without it the gradient is a circle sitting inside a squircle
              // frame with four pale corner gaps — measured at 1440, it reads
              // as a misaligned inlay. The same repetition is why the admin
              // migrations pass `rounded-ds-md` here.
              fallbackClassName="rounded-ds-avatar squircle text-ds-24 ring-0 drop-shadow-sm"
              style={{ boxShadow: "0 0 0 2px hsl(var(--bark) / 0.18)" }}
              onPhotoRejected={setPhotoRejection}
            />
            {/* `showsPhoto` gates the CORNER badge only, and deliberately not
                the "Stripe verified" pill in the trust row below.

                The two are not the same claim. This badge is an overlay on a
                PORTRAIT — a checkmark on the corner of a face, asserting that
                THAT face was identity-checked. Over a monogram it has no
                referent: it decorates a generated block, which is precisely
                how a flat upload came to look more trustworthy than a member
                with no photo at all. The pill in the trust row states the same
                fact in words, about the person rather than the picture, so
                suppressing the overlay costs the profile nothing — a verified
                member with a blank avatar still reads "Stripe verified" one
                line down. Verify that pill is still there before ever
                extending this gate to it. */}
            {idVerified && showsPhoto && (
              <div
                // role="img" is required for the label to survive: aria-label is
                // PROHIBITED on a bare <div> (implicit role=generic), so without
                // it the badge reads as "ID verified" to sighted users only.
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

          {/* ── Place, verification, bio, skills ── */}
          <div className="min-w-0 flex-1">
            {/* THE NAME — back in the box, beside the avatar, and the only
                place it appears on screen. `break-words` rather than
                `truncate`: at 320 a long name has to be readable, and an
                ellipsised person is worse than a two-line one. */}
            <h2
              className="font-display italic font-bold text-ds-22 leading-tight break-words mb-1"
              style={{ color: "hsl(var(--ink-deep))" }}
            >
              {displayName}
            </h2>

            {/* TRADING NAME — nothing at all when there is none. See (2). */}
            {businessName && (
              <p
                className="font-sans font-semibold text-ds-13 leading-snug mb-1 flex items-start gap-1.5 break-words"
                style={{ color: "hsl(var(--bark))" }}
              >
                <Briefcase className="w-3.5 h-3.5 shrink-0 mt-[3px]" aria-hidden />
                <span className="min-w-0">{businessName}</span>
              </p>
            )}

            {/* PLACE + TENURE — directly under the name it qualifies. It has
                to live here and nowhere else: PageHeader deliberately paints
                neither `eyebrow` nor `meta` (both retired app-wide by owner
                decision, see the note in PageHeader.tsx), so anything passed
                there is silently dropped. Verified in Chrome — those props
                render nothing. */}
            {(location || memberSinceLabel) && (
              // STACKED below `sm`, one row from `sm` up — and the separator
              // only exists in the row form. As a wrappable flex child the "·"
              // could end a line ("Lafayette ·" at 375) or start one ("· Since
              // May 2026" at 320); both were seen in Chrome. A separator that
              // cannot wrap cannot dangle.
              <div
                className="font-serif italic text-ds-13 mb-1.5 flex flex-col sm:flex-row sm:items-center sm:gap-1.5"
                style={{ color: "hsl(var(--olivewood) / 0.8)" }}
              >
                {location && (
                  <span className="inline-flex items-center gap-1 min-w-0">
                    <MapPin className="w-3 h-3 shrink-0" aria-hidden />
                    <span className="truncate">{location}</span>
                  </span>
                )}
                {location && memberSinceLabel && (
                  <span
                    aria-hidden
                    className="hidden sm:inline"
                    style={{ color: "hsl(var(--burnt-sienna) / 0.35)" }}
                  >
                    ·
                  </span>
                )}
                {memberSinceLabel && <span>Since {memberSinceLabel}</span>}
              </div>
            )}

            {/* TRUST ROW — in the flow, wrapped, never absolutely positioned.
                Presence rides here too: it is the same kind of object (a small
                fact about this profile), and giving it its own corner is what
                started the overlap. */}
            <div className="flex flex-wrap items-center gap-1.5">
              {idVerified && (
                <span
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full"
                  style={{
                    background: "hsl(var(--gold-warm) / 0.14)",
                    border: "0.5px solid hsl(var(--gold-warm) / 0.36)",
                  }}
                >
                  <ShieldCheck className="w-3 h-3" style={{ color: "hsl(var(--gold-warm))" }} strokeWidth={2.5} />
                  <span
                    className="font-sans font-bold uppercase text-ds-10"
                    style={{ color: "hsl(var(--gold-warm))", letterSpacing: "0.16em" }}
                  >
                    Stripe verified
                  </span>
                </span>
              )}

              {/* Verification ladder (#112) — self-hides at tier 0, so fresh
                  signups get no placeholder pill. */}
              <HelperTierBadge profile={tierProfile} stats={stats} size="md" />
              <CredentialBadge
                credentials={
                  // `profiles.Row` and CredentialBadge's own (unexported)
                  // CredentialState are structurally unrelated, so a direct
                  // cast is a type error and `as never` is not comparable —
                  // route it through the component's own prop type.
                  //
                  // business_name is nulled ON PURPOSE. The badge appends
                  // "· <name>" to its own label, and this card now prints the
                  // trading name as a line under the person's name (see (2)),
                  // so leaving it in renders the same string twice about 60px
                  // apart. The badge keeps its job — "Licensed & Insured" —
                  // and the identity block keeps the name. Every OTHER surface
                  // in the app still gets the suffix; the component is
                  // untouched.
                  {
                    ...(profile as unknown as Record<string, unknown>),
                    business_name: null,
                  } as ComponentProps<typeof CredentialBadge>["credentials"]
                }
                size="md"
              />

              {/* Background-Checked — flipped by the verification trigger once a
                  paid screening clears. */}
              {(profile as unknown as { background_check_status?: string }).background_check_status === "verified" && (
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

              {/* Presence (#28) — quiet by design; it should never out-shout a
                  verification badge. Green dot inside 10 minutes, olivewood
                  otherwise, hidden entirely once stale (>7d). */}
              {lastActiveLabel && (
                <span
                  className="inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-ds-11"
                  style={{
                    background: lastActiveLabel.isLive
                      ? "hsl(var(--live) / 0.10)"
                      : "hsl(var(--olivewood) / 0.08)",
                    border: `0.5px solid ${
                      lastActiveLabel.isLive ? "hsl(var(--live) / 0.35)" : "hsl(var(--olivewood) / 0.20)"
                    }`,
                    color: lastActiveLabel.isLive ? "hsl(var(--live))" : "hsl(var(--olivewood))",
                  }}
                >
                  <span
                    className="w-1.5 h-1.5 rounded-full"
                    style={{
                      background: lastActiveLabel.isLive
                        ? "hsl(var(--live))"
                        : "hsl(var(--olivewood) / 0.8)",
                      boxShadow: lastActiveLabel.isLive ? "0 0 0 3px hsl(var(--live) / 0.18)" : "none",
                    }}
                    aria-hidden
                  />
                  <span className="font-medium">{lastActiveLabel.text}</span>
                </span>
              )}
            </div>

            {/* BIO — capped to a reading measure. Without the cap it ran the
                full 1100px card width on a desktop frame, which is unreadable
                even though it "fills". */}
            {profile.bio && (
              <p
                className="font-serif italic mt-2.5 leading-relaxed text-ds-15 max-w-[62ch]"
                style={{ color: "hsl(var(--ink-deep) / 0.88)" }}
              >
                {profile.bio}
              </p>
            )}

            {/* WHAT THEY DO */}
            {skills.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-3">
                {skills.map((s, i) => (
                  <span
                    key={`${s}-${i}`}
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

            {/* SHARED HISTORY — quiet, in the flow, under everything it
                qualifies. See (3) in the block comment above. */}
            {!isOwnProfile && mutualJobsCount > 0 && (
              // ONE text node inside the flex row. It was `inline-flex` with
              // the icon, the sentence, the number and the unit as four
              // separate children, so `gap-1.5` + wrapping spread them across
              // the full card width ("You've worked / together   12   times").
              <p
                className="font-serif italic text-ds-13 mt-3 flex items-start gap-1.5"
                style={{ color: "hsl(var(--olivewood) / 0.9)" }}
              >
                <Users className="w-3.5 h-3.5 shrink-0 mt-[3px]" aria-hidden />
                <span>
                  You&rsquo;ve worked together{" "}
                  <span className="font-display font-bold tabular-nums not-italic">
                    {mutualJobsCount}
                  </span>{" "}
                  {mutualJobsCount === 1 ? "time" : "times"}
                </span>
              </p>
            )}
          </div>
        </div>

        {/* EARNED — milestones and performance badges as ONE row, no section
            heading of its own. Self-hides when nothing is earned. */}
        {recognition && <div className="mt-4">{recognition}</div>}
      </div>

      {/* THE RECORD — same card, hairline rule, so identity and numbers read
          as one masthead rather than two widgets stacked by accident. */}
      {atAGlance && (
        <div
          className="px-5 py-4 sm:px-6 sm:py-5 lg:px-7"
          style={{
            borderTop: "0.5px solid hsl(var(--olivewood) / 0.14)",
            background: "hsl(var(--parchment) / 0.35)",
          }}
        >
          {atAGlance}
        </div>
      )}
    </div>
  );
};
