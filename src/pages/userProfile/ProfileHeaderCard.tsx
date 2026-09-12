import type { ReactNode } from "react";
import { Briefcase, MapPin, Users } from "lucide-react";
import UserAvatar from "@/components/UserAvatar";
import type { Database } from "@/integrations/supabase/types";
import type { LastActiveLabel } from "./types";

type Profile = Database["public"]["Tables"]["profiles"]["Row"];

type Props = {
  profile: Profile;
  userId: string;
  displayName: string;
  initials: string;
  isOwnProfile: boolean;
  isIdVerified: boolean;
  mutualJobsCount: number;
  /**
   * The subscription-tier pill — the ONLY badge in the header, beside the
   * name (owner, 2026-09-11). Null/undefined when the member has no tier, and
   * then the header carries no badge at all.
   */
  tierBadge?: ReactNode;
  /**
   * EVERY other badge — trust, ladder, credentials, milestones — as one
   * capped row under the identity, above the record. The header's own trust
   * row is gone; see RecognitionRow. Presence is NOT in here (see
   * `lastActiveLabel`), and the performance-badge group no longer exists.
   */
  recognition?: ReactNode;
  /**
   * PRESENCE — "active 10 min ago" / "last seen 3d". Owner, 2026-09-11: this
   * is live state, not an achievement, so it left the badge row and renders
   * as a status dot on the identity line beside place and tenure. NULL when
   * the member has not been seen inside the window the label covers.
   */
  lastActiveLabel?: LastActiveLabel | null;
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
  isIdVerified: _isIdVerified,
  mutualJobsCount,
  tierBadge,
  recognition,
  lastActiveLabel,
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

     THAT GAP WAS CLOSED (2026-08-31) by `<UserAvatar>` reporting its verdict
     through `onPhotoRejected`, which let this card stop painting an
     "ID verified" shield over a monogram. The shield itself is gone now
     (2026-09-11, one form for ID verification), so nothing here consumes the
     verdict any more — but `<UserAvatar>` still uses it internally to choose
     photo vs monogram, which is the half that mattered. */

  /* `idVerified` and the `photoRejection` state that gated it are GONE with
     the avatar shield above — `isIdVerified` stays on the props (its callers
     are unchanged, and the badge row is what publishes the claim now). The
     whole "is this a real photograph?" question was asked here only so the
     shield would not certify a monogram; `<UserAvatar>` still answers it for
     itself when choosing photo vs monogram, which is the part that mattered. */

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
            />
            {/* NO ID-VERIFIED SHIELD ON THE AVATAR ANY MORE.
                ID verification rendered four ways across the app; the owner's
                ruling (2026-09-11) is that it renders ONE way — the gold
                pill + shield, which this very page already paints ~40px below
                this avatar in the badge row (`RecognitionRow`). A bark disc
                with a white shield stamped on the corner of the portrait was
                a second treatment of that one fact, and the weaker of the
                two: it decorated the PICTURE rather than saying anything
                about the person, which is why it needed `showsPhoto` to stop
                it certifying a generated monogram in the first place. The
                claim is unchanged and still on screen; see
                `components/profile/IdVerifiedPill.tsx`. */}
          </div>

          {/* ── Place, verification, bio, skills ── */}
          <div className="min-w-0 flex-1">
            {/* THE NAME — back in the box, beside the avatar, and the only
                place it appears on screen. `break-words` rather than
                `truncate`: at 320 a long name has to be readable, and an
                ellipsised person is worse than a two-line one. */}
            {/* NAME + TIER. The tier pill is the one badge allowed up here
                (owner, 2026-09-11); it wraps under the name when the column
                is too narrow for both, never truncating either. */}
            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 mb-1">
              <h2
                className="font-display italic font-bold text-ds-22 leading-tight break-words min-w-0"
                style={{ color: "hsl(var(--ink-deep))" }}
              >
                {displayName}
              </h2>
              {tierBadge}
            </div>

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
            {(location || memberSinceLabel || lastActiveLabel) && (
              // STACKED below `sm`, one row from `sm` up — and the separator
              // only exists in the row form. As a wrappable flex child the "·"
              // could end a line ("Lafayette ·" at 375) or start one ("· Since
              // May 2026" at 320); both were seen in Chrome. A separator that
              // cannot wrap cannot dangle.
              <div
                className="font-sans text-ds-13 mb-1.5 flex flex-col sm:flex-row sm:items-center sm:gap-1.5"
                style={{ color: "hsl(var(--olivewood) / 0.8)" }}
              >
                {location && (
                  <span className="inline-flex items-center gap-1 min-w-0">
                    <MapPin className="w-3 h-3 shrink-0" aria-hidden />
                    <span className="truncate">{location}</span>
                  </span>
                )}
                {location && memberSinceLabel && (
                  // Inherits the row's own --olivewood/0.8 rather than
                  // painting --burnt-sienna at 0.35. At 0.35 the separator
                  // measured 1.77:1 light / 1.63:1 dark — the two lowest
                  // numbers on the whole public surface. `aria-hidden` is
                  // right (a screen reader gets the two facts as separate
                  // nodes and does not need the dot read out) but it says
                  // nothing about whether a sighted reader can see it, and at
                  // 1.7:1 they cannot: "Lafayette" and "Since May 2026" ran
                  // together with an invisible mark between them.
                  <span aria-hidden className="hidden sm:inline">
                    ·
                  </span>
                )}
                {memberSinceLabel && <span>Since {memberSinceLabel}</span>}
                {/* PRESENCE — a dot and a phrase on the identity line, not a
                    pill in the badge row (owner, 2026-09-11: it is live
                    state, not something earned). Same separator discipline as
                    above: the "·" only exists in the row form, so it can
                    never dangle at the end of a wrapped line at 375. */}
                {lastActiveLabel && (location || memberSinceLabel) && (
                  <span aria-hidden className="hidden sm:inline">
                    ·
                  </span>
                )}
                {lastActiveLabel && (
                  <span
                    className="inline-flex items-center gap-1.5 min-w-0"
                    style={{
                      color: lastActiveLabel.isLive
                        ? "hsl(var(--live))"
                        : "hsl(var(--olivewood) / 0.8)",
                    }}
                  >
                    <span
                      aria-hidden
                      className="rounded-full shrink-0"
                      style={{
                        width: 7,
                        height: 7,
                        background: lastActiveLabel.isLive
                          ? "hsl(var(--live))"
                          : "hsl(var(--olivewood) / 0.7)",
                        boxShadow: lastActiveLabel.isLive
                          ? "0 0 0 3px hsl(var(--live) / 0.18)"
                          : "none",
                      }}
                    />
                    <span className="truncate">{lastActiveLabel.text}</span>
                  </span>
                )}
              </div>
            )}

            {/* BIO — capped to a reading measure. Without the cap it ran the
                full 1100px card width on a desktop frame, which is unreadable
                even though it "fills". */}
            {profile.bio && (
              <p
                className="font-sans mt-2.5 leading-relaxed text-ds-15 max-w-[62ch]"
                style={{ color: "hsl(var(--ink-deep) / 0.88)" }}
              >
                {profile.bio}
              </p>
            )}

            {/* WHAT THEY DO */}
            {/* WHAT THEY DO — deliberately NOT pill-shaped. Owner,
                2026-09-11: the skills row sat directly under the badge row in
                the same rounded-full tinted pill, so at a glance it read as
                six more badges. Skills are self-declared; badges are earned,
                and the profile must not dress the two the same. So this is a
                labelled, comma-separated text list on a square-cornered
                hairline strip: no radius, no per-item box, no icon, normal
                weight, and a caption naming what it is. */}
            {skills.length > 0 && (
              <div
                className="mt-3 pt-2.5"
                style={{ borderTop: "0.5px solid hsl(var(--olivewood) / 0.16)" }}
              >
                <p
                  className="font-sans uppercase tracking-wider text-ds-10 mb-1"
                  style={{ color: "hsl(var(--olivewood) / 0.75)", letterSpacing: "0.14em" }}
                >
                  Skills
                </p>
                <p
                  className="font-sans text-ds-13 leading-relaxed max-w-[62ch]"
                  style={{ color: "hsl(var(--ink-deep) / 0.85)" }}
                >
                  {skills.join(", ")}
                </p>
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
                className="font-sans text-ds-13 mt-3 flex items-start gap-1.5"
                style={{ color: "hsl(var(--olivewood) / 0.9)" }}
              >
                <Users className="w-3.5 h-3.5 shrink-0 mt-[3px]" aria-hidden />
                <span>
                  You&rsquo;ve worked together{" "}
                  <span className="font-sans font-bold tabular-nums">
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
