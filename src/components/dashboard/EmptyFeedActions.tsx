import { useNavigate } from "react-router-dom";
import { Plus, Bell } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAgeGate } from "@/hooks/useAgeGate";

/**
 * The empty Browse feed's two ways out: Post Your First Job, then Notify Me
 * When One Lands. Moved out of BrowseTasksFeed unchanged except for the
 * under-18 grey-out on the post button (owner, 2026-10-12, Q1586(c)).
 *
 * Both actions used to be `ghost` at the same olivewood/80, so the screen's
 * only real primary was an unlabelled floating "+" and the two visible options
 * were indistinguishable. The old comment reasoned that keeping them quiet
 * avoided duplicating the FAB — sound, but the outcome was a screen with no
 * primary at all.
 *
 * The fork itself stays (every account can post AND work — this product has no
 * roles). Equal importance does not require equal visual weight: an empty feed
 * is itself proof there is no work to take, so posting leads and Notify is the
 * quiet second line.
 */
export function EmptyFeedActions({ onNotify }: { onNotify: () => void }) {
  const navigate = useNavigate();
  const { gate, gatedProps } = useAgeGate();
  return (
    <div className="flex flex-col items-center gap-3">
      <Button onClick={gate("post", () => navigate("/post-job"))} {...gatedProps("post")} className="rounded-ds-md">
        <Plus className="w-4 h-4 mr-1" strokeWidth={2.25} />
        Post Your First Job
      </Button>
      <Button
        variant="ghost" size="wrap"
        onClick={onNotify}
        className="rounded-ds-md font-sans font-medium max-w-full"
        style={{ color: "hsl(var(--olivewood) / 0.8)" }}
      >
        <Bell className="w-4 h-4 mr-1" strokeWidth={2.25} />
        Notify Me When One Lands
      </Button>
    </div>
  );
}
