import { useNavigate } from "react-router-dom";
import { Briefcase } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Board 40's bottom bar on someone else's profile: "Invite to a job" (it was
 * "Offer a job directly" in the ... menu), shown on the same gate (the member
 * has done work, decided by the caller). NO Message button (owner: only the
 * poster messages, from the application). Sticky above the bottom nav, like
 * Post-a-Job's Continue.
 */
export function InviteToJobBar({ userId }: { userId: string }) {
  const navigate = useNavigate();
  return (
    <div data-invite-bar className="sticky bottom-safe-nav z-10 bg-premium-page pt-3 pb-2 mt-6">
      <Button
        variant="primary"
        type="button"
        size="lg"
        className="w-full rounded-full text-ds-16"
        onClick={() => navigate(`/post-job?offerTo=${userId}`)}
      >
        <Briefcase className="w-4 h-4 mr-2" aria-hidden /> Invite to a job
      </Button>
    </div>
  );
}
