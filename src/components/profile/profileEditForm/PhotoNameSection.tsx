import { useState } from "react";
import { Loader2, Camera, Globe } from "lucide-react";
import UserAvatar from "@/components/UserAvatar";
import type { AvatarPhotoRejection } from "@/lib/avatarImage";
import type { Profile } from "./types";

/**
 * What to say under the name, given `<UserAvatar>`'s verdict on the photo.
 *
 * Split out and exported so the copy is testable without mounting the form,
 * and so all four branches are visible in one place rather than as nested
 * ternaries in JSX.
 *
 * Every non-null branch is ACTIONABLE and says what actually happened. The
 * distinction that matters to a member is "did my upload not take?" versus
 * "have I not uploaded yet?" — before `onPhotoRejected` existed this surface
 * could not tell those apart and said "Tap the photo to change it" to a
 * member staring at a coloured square where their face should be, which reads
 * as though the square IS their photo.
 */
export function avatarCaption(rejection: AvatarPhotoRejection | null): string {
  switch (rejection) {
    case "no-photo":
      return "Add a photo so people know who they're hiring.";
    case "blank-bitmap":
    case "placeholder-url":
      // Deliberately not "your photo is blank" — the member chose a file and
      // it uploaded, so blaming the photo without saying what to do next
      // leaves them with no move. Naming the outcome ("came through blank")
      // and the fix ("pick another") is one short line that does both.
      return "That photo came through blank — tap to pick another.";
    case "load-error":
      // Not the member's fault and not fixable by them, so this does not
      // scold; it offers the one thing that might work.
      return "We couldn't load your photo — tap to try another.";
    default:
      return "Tap the photo to change it.";
  }
}

interface PhotoNameSectionProps {
  profile: Profile | null;
  firstName: string;
  lastName: string;
  initials: string;
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
  // `null` until `<UserAvatar>` reaches a verdict — see its `onPhotoRejected`
  // docs. Starting at `null` means the caption says "Tap the photo to change
  // it" for the one frame before a cold fetch resolves, which is the right
  // default: promising a photo we then remove is better than accusing a
  // member of having a blank one that turns out to be fine.
  const [photoRejection, setPhotoRejection] = useState<AvatarPhotoRejection | null>(null);

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
            onPhotoRejected={setPhotoRejection}
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
          {/* `aria-live="polite"`: the verdict arrives asynchronously, after
              the bitmap decodes, so a screen-reader user who has already
              moved past this line would otherwise never learn that their
              upload came through blank. It is polite, not assertive — this
              never interrupts. */}
          <p
            aria-live="polite"
            className="font-serif italic mt-1 leading-snug text-ds-12"
            style={{ color: "hsl(var(--olivewood) / 0.8)" }}
          >
            {avatarCaption(photoRejection)}
          </p>
          {/* ── THE PUBLIC-VISIBILITY NOTICE (2026-08-31) ──────────────────
              Added after a member uploaded a photograph of their driver's
              licence as their avatar and it sat anonymously fetchable in the
              public `avatars` bucket: no login, no token, no Helpr account.

              This is the guard that actually addresses the cause. It is worth
              being explicit about why there is no clever detector here
              instead: the two identity documents found on prod were 2502×1407
              (16:9) and 1093×1491 (portrait), so an ID-card aspect-ratio test
              — the obvious heuristic, ID-1 is 1.585 — would have caught
              NEITHER. They are phone photos of a document, framed like phone
              photos of anything else. Nothing cheap and client-side separates
              a picture of a card from a picture of a face, and a heuristic
              that blocks uploads it cannot justify is worse than none.

              What was actually missing was that nobody told the member the
              photo is public. `<input type=file>` is a silent, one-tap
              publish. So: say so, at the control, before the tap, always —
              zero false positives, and it is the only version of this that
              costs a member nothing when it is wrong.

              Always rendered, not only when a photo exists: the moment it
              needs to be read is BEFORE the first upload. */}
          <p
            className="font-sans mt-1.5 leading-snug text-ds-11 flex items-start gap-1"
            style={{ color: "hsl(var(--olivewood) / 0.75)" }}
          >
            <Globe className="w-3 h-3 shrink-0 mt-[2px]" aria-hidden />
            <span className="min-w-0">
              Anyone can see this photo — never use a photo of an ID, licence or document.
            </span>
          </p>
        </div>
      </div>
    </div>
  );
}
