import { toast } from "sonner";
import { Pencil, RefreshCw, MailIcon } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { unwrapMutation, mutationErrorMessage } from "@/lib/mutationResult";
import UserAvatar from "@/components/UserAvatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatName } from "@/lib/utils";
import { type Profile, statusBadge, stripeBadge } from "../adminUserHelpers";

interface DetailHeaderProps {
  viewProfile: Profile;
  setViewProfile: (profile: Profile | null) => void;
  resending: string | null;
  loadProfiles: () => void;
  resendDenialEmail: (profile: Profile) => void;
  setEditEmailProfile: (profile: Profile | null) => void;
}

export function DetailHeader({
  viewProfile,
  setViewProfile,
  resending,
  loadProfiles,
  resendDenialEmail,
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
      {viewProfile.avatar_url ? (
        <a
          href={viewProfile.avatar_url}
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
        {viewProfile.approval_status === "denied" && (
          <div className="flex flex-wrap gap-2 items-center pt-1">
            <Button
              size="sm"
              variant="outline"
              className="h-8"
              onClick={async () => {
                const currentCount = viewProfile.application_count || 1;
                // .select("id"): this write was entirely unchecked — neither an
                // error nor a zero-row result stopped the panel from closing as
                // if the account had been moved back to Pending.
                try {
                  unwrapMutation(
                    await supabase.from("profiles").update({
                      approval_status: "pending",
                      denial_reason: null,
                      application_count: currentCount + 1,
                    }).eq("id", viewProfile.id).select("id"),
                    {
                      action: "move this account back to Pending",
                      rejectedMessage: "This account wasn't moved to Pending — nothing was changed. Check your admin permissions and try again.",
                      context: { profileId: viewProfile.id },
                    },
                  );
                } catch (err) {
                  toast.error(mutationErrorMessage(err, "Couldn't move that account to Pending — try again."));
                  return;
                }
                loadProfiles();
                setViewProfile(null);
              }}
            >
              <RefreshCw className="w-3.5 h-3.5 mr-1.5" /> Move to Pending
            </Button>
            {(() => {
              const sent = viewProfile.denial_email_count || 0;
              const maxReached = sent >= 3;
              return (
                <>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8"
                    disabled={resending === viewProfile.id || maxReached}
                    onClick={async () => {
                      await resendDenialEmail(viewProfile);
                      // refresh local view state count
                      setViewProfile({ ...viewProfile, denial_email_count: sent + 1, last_denial_email_at: new Date().toISOString() });
                    }}
                    title={maxReached ? "Max 3 reminder emails reached" : "Send denial reminder email"}
                  >
                    {resending === viewProfile.id
                      ? <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      : <><MailIcon className="w-3.5 h-3.5 mr-1.5" /> Resend Email</>}
                  </Button>
                  <Badge variant="outline" className={`text-ds-10 ${maxReached ? "bg-destructive/10 text-destructive border-destructive/30" : "bg-muted text-muted-foreground"}`}>
                    Sent {sent}/3
                  </Badge>
                </>
              );
            })()}
          </div>
        )}
      </div>
    </div>
  );
}
