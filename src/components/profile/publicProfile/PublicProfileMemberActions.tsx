/**
 * H5 last slice (share-profile audit 11-05, owner: /u/<handle> is the ONE full profile). A signed-in member on someone
 * else's /u page gets the same title-row actions /user/<id> gives them: Save, and the More menu's Report user and
 * Block user, through the SAME components (VisitorProfileActions, ReportDialog, BlockUserDialog). Invite to a job is
 * Hire me on this page: both open /post-job?offerTo=<id> (hireOfferPath, InviteToJobBar), and Hire me stays the one
 * primary. There is no Message button on any profile (owner: "only the poster can message", VisitorProfileActions).
 *
 * The page knows only the handle; the member's id comes from rpc_hire_target_by_handle (signed-in only, the page's own
 * visibility rules, never your own id, nothing when either of you blocked the other). Guests and your own page render
 * nothing here.
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import ReportDialog from "@/components/ReportDialog";
import { BlockUserDialog } from "@/components/BlockUserDialog";
import { VisitorProfileActions } from "@/pages/user/VisitorProfileActions";
import { hireTargetByHandle } from "@/lib/hireMe";

export function PublicProfileMemberActions({ handle, name, currentUserId }: { handle: string; name: string; currentUserId: string }) {
  const navigate = useNavigate();
  const [showReport, setShowReport] = useState(false);
  const [showBlock, setShowBlock] = useState(false);
  const q = useQuery({
    queryKey: ["public-profile-member-id", handle, currentUserId],
    queryFn: () => hireTargetByHandle(handle),
    staleTime: 5 * 60_000,
  });
  const userId = q.data?.id;
  if (!userId) return null;
  return (
    <div className="flex items-center gap-1" data-testid="pp-member-actions">
      <VisitorProfileActions userId={userId} currentUserId={currentUserId} onReport={() => setShowReport(true)} onBlock={() => setShowBlock(true)} />
      {showReport && (
        <ReportDialog
          open={showReport}
          onClose={() => setShowReport(false)}
          reportedType="user" reportedId={userId}
          alsoBlock={{ name: name || "this person", onBlock: () => setShowBlock(true) }}
        />
      )}
      {showBlock && (
        <BlockUserDialog
          open={showBlock}
          onClose={() => setShowBlock(false)}
          blockedUserId={userId}
          blockedUserName={name || "this user"}
          onBlocked={() => navigate("/home", { replace: true })}
        />
      )}
    </div>
  );
}
