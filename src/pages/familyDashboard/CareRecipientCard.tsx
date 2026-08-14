import { useNavigate } from "react-router-dom";
import { hapticLight } from "@/lib/haptics";
import { toast } from "sonner";
import {
  UserPlus,
  Briefcase,
  CheckCircle2,
  Clock,
  X,
} from "lucide-react";
import type { CareRelationship, ProfileStub } from "./types";

/** A single card for one care-recipient that this caregiver manages. */
export function CareRecipientCard({
  relationship,
  recipientProfile,
  onRevokeAccess,
}: {
  relationship: CareRelationship;
  recipientProfile: ProfileStub | undefined;
  onRevokeAccess: (id: string) => void;
}) {
  const navigate = useNavigate();
  const name = recipientProfile?.full_name ?? "Your family member";
  const isPending = relationship.status === "pending";

  return (
    <div
      className="rounded-ds-md overflow-hidden"
      style={{
        background: "hsl(var(--ivory-sand))",
        border: "0.5px solid hsl(var(--sand) / 0.6)",
        boxShadow: "0 1px 4px hsl(var(--olivewood) / 0.06)",
      }}
    >
      {/* Header */}
      <div className="flex items-center gap-3 px-4 pt-4 pb-3">
        <div
          className="w-10 h-10 rounded-[12px] flex items-center justify-center shrink-0 text-ds-14 font-sans font-semibold"
          style={{
            background: "hsl(var(--bark) / 0.12)",
            color: "hsl(var(--bark))",
          }}
        >
          {name.slice(0, 1).toUpperCase()}
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-sans font-semibold text-ds-15 truncate" style={{ color: "hsl(var(--ink-deep))" }}>
            {name}
          </p>
          <div className="flex items-center gap-1 mt-0.5">
            {isPending ? (
              <>
                <Clock className="w-3 h-3" style={{ color: "hsl(var(--burnt-sienna))" }} />
                <span className="text-ds-11 font-serif italic" style={{ color: "hsl(var(--burnt-sienna))" }}>
                  Invite pending
                </span>
              </>
            ) : (
              <>
                <CheckCircle2 className="w-3 h-3" style={{ color: "hsl(var(--sage))" }} />
                <span className="text-ds-11 font-serif italic" style={{ color: "hsl(var(--sage))" }}>
                  Active
                </span>
              </>
            )}
          </div>
        </div>
        <button
          aria-label="Remove access"
          onClick={() => onRevokeAccess(relationship.id)}
          className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-destructive/10 active:scale-95 transition-all"
          style={{ color: "hsl(var(--destructive))" }}
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Actions — only shown when relationship is active */}
      {!isPending && (
        <div className="flex gap-2 px-4 pb-4">
          <button
            onClick={() => {
              hapticLight();
              navigate(`/my-posts?for=${relationship.care_recipient_id}`);
            }}
            className="flex-1 flex items-center justify-center gap-1.5 h-9 rounded-ds-sm text-ds-12 font-sans font-medium transition-all active:scale-[0.98]"
            style={{
              background: "hsl(var(--bark) / 0.08)",
              color: "hsl(var(--bark))",
            }}
          >
            <Briefcase className="w-3.5 h-3.5" />
            View jobs
          </button>
          <button
            onClick={() => {
              hapticLight();
              navigate(`/post-job?for=${relationship.care_recipient_id}`);
            }}
            className="flex-1 flex items-center justify-center gap-1.5 h-9 rounded-ds-sm text-ds-12 font-sans font-medium transition-all active:scale-[0.98]"
            style={{
              background: "hsl(var(--burnt-sienna) / 0.1)",
              color: "hsl(var(--burnt-sienna))",
            }}
          >
            <UserPlus className="w-3.5 h-3.5" />
            Post job
          </button>
        </div>
      )}

      {/* Pending — show invite copy link */}
      {isPending && relationship.invite_token && (
        <div className="px-4 pb-4">
          <button
            onClick={() => {
              hapticLight();
              const url = `${window.location.origin}/family/accept/${relationship.invite_token}`;
              void navigator.clipboard.writeText(url).then(() => {
                toast.success("Invite link copied");
              });
            }}
            className="w-full flex items-center justify-center gap-1.5 h-9 rounded-ds-sm text-ds-12 font-sans font-medium transition-all active:scale-[0.98]"
            style={{
              background: "hsl(var(--burnt-sienna) / 0.1)",
              color: "hsl(var(--burnt-sienna))",
            }}
          >
            Copy invite link
          </button>
        </div>
      )}
    </div>
  );
}
