import { Loader2, Camera } from "lucide-react";
import type { Profile } from "./types";

interface PhotoNameSectionProps {
  profile: Profile | null;
  firstName: string;
  lastName: string;
  initials: string;
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
  avatarBroken,
  setAvatarBroken,
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
          {profile?.avatar_url && !avatarBroken ? (
            <img
              loading="lazy"
              decoding="async"
              src={profile.avatar_url}
              alt=""
              className="w-20 h-20 rounded-ds-avatar squircle object-cover border-2 border-primary/20"
              onError={() => setAvatarBroken(true)}
            />
          ) : (
            <div className="w-20 h-20 rounded-ds-avatar squircle bg-primary/10 text-primary flex items-center justify-center text-ds-24 font-display italic font-bold border-2 border-primary/20">
              {initials}
            </div>
          )}
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
