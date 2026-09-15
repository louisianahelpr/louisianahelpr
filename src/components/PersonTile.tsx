import type { MouseEvent, ReactNode } from "react";
import { Star, ChevronRight } from "lucide-react";
import { Link } from "react-router-dom";
import UserAvatar from "@/components/UserAvatar";

export interface PersonTileProps {
  /** Avatar hash seed and the person the tile is about. */
  userId: string;
  /** Where a tap goes — normally `/user/:id`. */
  to: string;
  name: string | null | undefined;
  avatarUrl?: string | null;
  /** Monogram override; UserAvatar derives one from `name` when omitted. */
  initials?: string;
  /** The small uppercase line above the name — "Posted by", "Helpr". */
  eyebrow: string;
  /** Printed beside the name only when `reviewCount > 0`. */
  rating?: number | null;
  reviewCount?: number | null;
  /** One quiet line under the name (e.g. "12 jobs"). */
  subline?: ReactNode;
  /** Rendered inside the tile under the identity row (e.g. a trust row). */
  children?: ReactNode;
  onClick?: (e: MouseEvent<HTMLAnchorElement>) => void;
}

/**
 * PersonTile — the mini-profile tile: avatar, eyebrow, name, rating, and a
 * chevron, the whole tile one link to the person's profile.
 *
 * Lifted out of JobPosterCard (the "Posted by" tile in JobDetailDialog) with
 * its markup unchanged, so the poster's Posts card can show the Helpr the same
 * way (owner, 2026-09-14, VN-22: "the profile for who's working the job should
 * be shown when the job is expanded under the job description"). One tile, two
 * callers — never a second hand-rolled profile row.
 */
export function PersonTile({
  userId,
  to,
  name,
  avatarUrl,
  initials,
  eyebrow,
  rating,
  reviewCount,
  subline,
  children,
  onClick,
}: PersonTileProps) {
  return (
    <Link
      to={to}
      onClick={onClick}
      className="relative block p-2.5 rounded-ds-md group glass-press transition-colors"
      style={{
        // `--surface-premium`, NOT a literal white. This was
        // `hsla(0, 0%, 100%, 0.55)` — 55%-opaque pure white with no dark
        // sibling — so in dark mode the "Posted by" tile painted as a bright
        // silver panel sitting among otherwise dark tiles (caught on the iOS
        // sim). That is the exact failure the token was introduced to fix; see
        // the note above --surface-premium in index.css. This tile was just
        // never migrated.
        background: "var(--surface-premium)",
        backdropFilter: "blur(16px) saturate(150%)",
        WebkitBackdropFilter: "blur(16px) saturate(150%)",
        border: "0.5px solid hsl(var(--bark) / 0.18)",
        boxShadow:
          "inset 0 1px 1px 0 rgba(255, 255, 255, 0.6), " +
          "0 1px 2px hsl(var(--olivewood) / 0.05)",
      }}
    >
      <div className="flex items-center gap-2.5">
        {/* THE SHARED `<UserAvatar>`, not a hand-rolled circle.

            This was a bare `<div>` whose monogram rendered only when
            `posterAvatarUrl` was falsy — so an avatar row that points at a
            file which loads perfectly and contains NOTHING (prod has these:
            f53663b1…/avatar.png is a 79-byte 16×16 solid block, HTTP 200)
            painted a flat coloured disc with no initials, while the very same
            member's profile page showed "RA". Two avatar treatments for one
            person, and the blank one on the tile where a helpr is deciding
            whether to trust them.

            `<UserAvatar>` already owns that verdict — it samples the decoded
            bitmap (`isBlankAvatarBitmap`) and falls through to the monogram —
            which is exactly why the profile page was right and this was not.
            The fork simply predated it.

            `pixelSize={40}` matches the rendered box so a multi-MB original
            is not fetched into a 40px circle. The bark hairline and inset
            highlight move onto the root so they frame photo and monogram
            identically, and `ring-0` suppresses the fallback's own olivewood
            hairline so there is one ring rather than two — same composition
            ProfileHeaderCard uses. */}
        <UserAvatar
          userId={userId}
          src={avatarUrl}
          name={name}
          initials={initials}
          pixelSize={40}
          alt=""
          className="shrink-0 w-10 h-10"
          fallbackClassName="text-ds-12 ring-0"
          style={{
            border: "1px solid hsl(var(--bark) / 0.22)",
            boxShadow: "inset 0 1px 1px 0 rgba(255, 255, 255, 0.5)",
          }}
        />
        <div className="min-w-0 flex-1">
          <p
            className="text-ds-10 font-sans font-semibold uppercase"
            style={{ color: "hsl(var(--olivewood) / 0.8)", letterSpacing: "0.06em" }}
          >
            {eyebrow}
          </p>
          <div className="flex items-baseline gap-2">
            <p className="font-sans font-semibold leading-tight truncate text-ds-16 min-w-0" style={{ color: "hsl(var(--ink-deep))" }}>
              {name}
            </p>
            {/* "New" (no reviews yet) and the relative post date were removed
                here (owner: "remove new and 5 days ago") — a rating only
                renders once there's one to show. */}
            {(reviewCount ?? 0) > 0 && (
              <span className="flex items-center gap-0.5 text-ds-11 shrink-0">
                <Star className="w-3.5 h-3.5 fill-accent text-accent" />
                <span className="font-display italic font-semibold" style={{ color: "hsl(var(--ink-deep))" }}>
                  {rating?.toFixed(1)}
                </span>
                <span className="font-sans" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
                  ({reviewCount})
                </span>
              </span>
            )}
          </div>
          {subline}
        </div>
        {/* "View profile" affordance — chevron on the right edge so the
            card visually reads as tappable. */}
        <ChevronRight
          className="shrink-0 w-4 h-4 transition-transform group-hover:translate-x-0.5"
          style={{ color: "hsl(var(--olivewood) / 0.8)" }}
          strokeWidth={2}
        />
      </div>
      {children}
    </Link>
  );
}
