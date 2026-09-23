import { Pencil } from "lucide-react";
import UserAvatar from "@/components/UserAvatar";
import { Badge } from "@/components/ui/badge";
import { formatName } from "@/lib/utils";
import { openableDocumentUrl, safeDocumentUrl } from "@/lib/storagePath";
import { type Profile, statusBadge, stripeBadge } from "../adminUserHelpers";

// The "Move to Pending" / "Resend denial email" row for denied accounts was
// removed with the denied state itself (Q193, owner 2026-09-23).
interface DetailHeaderProps {
  viewProfile: Profile;
  setEditEmailProfile: (profile: Profile | null) => void;
}

export function DetailHeader({
  viewProfile,
  setEditEmailProfile,
}: DetailHeaderProps) {
  return (
    <div className="flex gap-3 sm:gap-4">
      {/* Migrated onto the shared `<UserAvatar>` (2026-08-31), with the link
          to the ORIGINAL file kept. This is a moderation surface, so the two
          requirements pull against each other: the admin must not be shown a
          blank coloured block in place of a person (the defect), and must
          still be able to inspect exactly what the member uploaded (the
          evidence). Rendering the guarded avatar inside the existing
          `<a href={avatar_url}>` satisfies both — the header identifies the
          account, and one click opens the raw object at full fidelity.
          `rounded-ds-md`, not the avatar squircle: this frame is deliberately
          document-shaped on the admin screens.

          The bare `<img>` this replaces had no error path, and its fallback (a
          flat `bg-secondary` square with ONE letter) only rendered when
          `avatar_url` was null. See `src/lib/avatarImage.ts`. */}
      {safeDocumentUrl(viewProfile.avatar_url) ? (
        <a
          href={openableDocumentUrl(viewProfile.avatar_url) ?? undefined}
          target="_blank"
          rel="noopener noreferrer"
          className="flex-shrink-0"
          aria-label={`Open ${formatName(viewProfile.full_name, "this user")}'s profile photo file`}
        >
          <UserAvatar
            userId={viewProfile.user_id}
            src={viewProfile.avatar_url}
            name={viewProfile.full_name}
            pixelSize={96}
            aria-hidden
            className="w-20 h-20 sm:w-24 sm:h-24 rounded-ds-md border-2 border-border hover:border-primary transition-colors cursor-pointer"
            fallbackClassName="rounded-ds-md text-ds-24 ring-0"
          />
        </a>
      ) : (
        <UserAvatar
          userId={viewProfile.user_id}
          src={null}
          name={viewProfile.full_name}
          aria-hidden
          className="w-20 h-20 sm:w-24 sm:h-24 rounded-ds-md border-2 border-border flex-shrink-0"
          fallbackClassName="rounded-ds-md text-ds-24 ring-0"
        />
      )}
      <div className="flex-1 min-w-0 space-y-1.5">
        <div className="flex items-center gap-1.5 flex-wrap">
          <h3 className="text-ds-15 sm:text-ds-17 font-bold text-foreground truncate">{formatName(viewProfile.full_name, "—")}</h3>
          {statusBadge(viewProfile)}
          {stripeBadge(viewProfile)}

          {(viewProfile.application_count || 1) > 1 && (
            <Badge variant="outline" className="text-ds-10 bg-accent/10 text-[hsl(var(--accent-ink))] border-accent/30">
              Applied {viewProfile.application_count}x
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-1.5 min-w-0">
          {/* `break-all`, not `truncate`. This is a moderation surface: the
              email is the primary identifier an admin uses to decide whether to
              warn, verify or ban someone, and truncating it to
              "helpr-audit-helper-2026-07-08@mailin…" hides exactly the part
              that distinguishes one account from another. Wrapping costs a line;
              guessing costs the wrong person getting banned. */}
          <p className="text-ds-11 sm:text-ds-11 text-muted-foreground break-all">{viewProfile.email || "No email"}</p>
          <button
            onClick={() => setEditEmailProfile(viewProfile)}
            className="text-muted-foreground hover:text-primary transition-colors flex-shrink-0 p-1 -m-1 rounded"
            aria-label="Edit email"
          >
            <Pencil className="w-3 h-3" />
          </button>
        </div>
      </div>
    </div>
  );
}
