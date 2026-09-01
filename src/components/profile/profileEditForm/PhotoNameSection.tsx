import { Loader2, Camera } from "lucide-react";
import UserAvatar from "@/components/UserAvatar";
import type { Profile } from "./types";

interface PhotoNameSectionProps {
  profile: Profile | null;
  firstName: string;
  lastName: string;
  initials: string;
  /**
   * Both retained for the caller's prop shape (ProfileEditForm still threads
   * them) but no longer read here. They implemented an `onError`-only photo
   * guard, which is unreachable for the defect that actually ships — an
   * avatar that returns HTTP 200 and decodes to a flat block. `<UserAvatar>`
   * owns every guard now; see `src/lib/avatarImage.ts`.
   */
  avatarBroken: boolean;
  setAvatarBroken: (v: boolean) => void;
  avatarUploading: boolean;
  onAvatarUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
}

export function PhotoNameSection({
  profile,
  firstName,
  lastName,
  initials,
  avatarUploading,
  onAvatarUpload,
}: PhotoNameSectionProps) {
  return (
    <div className="rounded-2xl liquid-glass p-5 space-y-4">
      <div className="flex items-center gap-4">
        {/* Avatar always shows the actual photo (previously hidden behind
            a full-coverage Camera overlay at opacity-100 on mobile).
            Upload trigger moved to a small floating chip at the bottom-
            right of the avatar so the user always sees their photo. */}
        <div className="relative shrink-0">
          {/* Squircle (rounded-ds-avatar) to match the avatar on the
              Profile landing hero exactly — both use the same 26px
              curve so the avatar reads identically across pages. */}
          {/* Migrated onto the shared `<UserAvatar>` (2026-08-31). The two
              branches this replaces were the same unreachable guard the rest
              of the app had: the photo rendered whenever `avatar_url` was
              non-null and the `<img>` had not fired `onError`, and the flat
              `bg-primary/10` initials block rendered otherwise. Every broken
              avatar measured on prod returns 200 and decodes fine — they just
              contain nothing — so `onError` never fired and the initials
              branch was unreachable for exactly the rows that needed it. The
              member editing their profile saw a blank coloured square where
              their face should be, with no way to tell whether the upload had
              worked. See `src/lib/avatarImage.ts`.

              This is also the surface where the fix is most legible: a
              monogram here means "we cannot show a photo", which is a true and
              actionable statement right next to the camera chip that fixes it.
              A cache-busted `?t=` lands on `avatar_url` after every upload, so
              `<UserAvatar>`'s src-change reset re-evaluates a fresh photo
              immediately rather than staying on a stale verdict. */}
          <UserAvatar
            userId={profile?.user_id}
            src={profile?.avatar_url}
            name={`${firstName} ${lastName}`.trim()}
            initials={initials}
            pixelSize={80}
            aria-hidden
            className="w-20 h-20 rounded-ds-avatar squircle border-2 border-primary/20"
            fallbackClassName="text-ds-24 ring-0"
          />
          <label
            className="absolute -bottom-2 -right-2 w-10 h-10 rounded-full flex items-center justify-center cursor-pointer active:scale-95 transition-transform"
            style={{
              background: "hsl(var(--bark))",
              border: "2px solid hsl(var(--parchment))",
              boxShadow:
                "0 1px 2px hsl(70 20% 18% / 0.22), " +
                "0 4px 10px -2px hsl(var(--bark) / 0.4)",
            }}
          >
            {avatarUploading ? (
              <Loader2 className="w-4 h-4 animate-spin" style={{ color: "hsl(var(--parchment))" }} />
            ) : (
              <Camera className="w-4 h-4" style={{ color: "hsl(var(--parchment))" }} />
            )}
            {/* The accessible name lives on the INPUT, not the <label>.
                axe flags `aria-label` on a bare <label> as aria-prohibited-attr
                and it is not a nitpick: <label> has no implicit ARIA role, so
                assistive tech IGNORES the attribute outright. The control was
                effectively unnamed — a screen reader announced only "button".
                A <label> names the control it wraps, so an sr-only child names
                the file input properly and works everywhere. */}
            <span className="sr-only">Change profile photo</span>
            <input type="file" accept="image/*" className="hidden" onChange={onAvatarUpload} disabled={avatarUploading} />
          </label>
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-display italic font-bold leading-tight truncate text-headline-section" style={{ color: "hsl(var(--ink-deep))", letterSpacing: "-0.015em" }}>
            {`${firstName} ${lastName}`.trim() || "Your name"}
          </p>
          <p className="font-serif italic mt-1 leading-snug text-ds-12" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
            Tap the photo to change it.
          </p>
        </div>
      </div>
    </div>
  );
}
