import UserAvatar from "@/components/UserAvatar";

/**
 * Migrated onto the shared `<UserAvatar>` (2026-08-31): a hiring decision gave a
 * candidate whose upload is a flat block NO identity (every blank avatar on prod
 * returns 200, so the initials never showed). See `src/lib/avatarImage.ts`.
 *
 * The <a> keeps the link, the halo ring (top-pick /
 * verified) and the 44px tap target; the avatar
 * inside is now the app-wide one. `ring-0` cancels
 * `UserAvatar`'s own hairline so the halo is the
 * only edge.
 */
export function ApplicantAvatarLink({ helperId, avatarUrl, helperName, initials, haloColor }: {
  helperId: string;
  avatarUrl: string | null | undefined;
  helperName: string;
  initials: string;
  haloColor: string | null;
}) {
  return (
    <a
      href={`/user/${helperId}`}
      // The avatar inside is `aria-hidden`, so this label is the
      // link's only accessible name (it had none with a photo before).
      aria-label={`View ${helperName}'s profile`}
      className="shrink-0 w-11 h-11 rounded-full overflow-hidden inline-flex items-center justify-center"
      style={{
        boxShadow: haloColor
          ? `0 0 0 2.5px ${haloColor}`
          : "0 0 0 1px hsl(var(--olivewood) / 0.18)",
      }}
    >
      <UserAvatar
        userId={helperId}
        src={avatarUrl}
        name={helperName}
        initials={initials}
        pixelSize={44}
        aria-hidden
        className="w-full h-full"
        fallbackClassName="text-ds-14 ring-0"
      />
    </a>
  );
}
