import { useNavigate } from "react-router-dom";
import { Bell } from "lucide-react";
import { EmptyStateActions } from "@/components/ui/EmptyStateActions";
import { useAgeGate } from "@/hooks/useAgeGate";

/**
 * The empty Browse feed's two ways out: Post a job, then Notify me when one
 * lands (J8, Cowork audit 2026-10-20: it said "Post Your First Job" to people
 * who had posted, in Title Case; sentence case per HELPR-DESIGN-SPEC). Moved out of BrowseTasksFeed unchanged except for the
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
  // Owner 11-02 (1.0.4): the same layout as Declutter's empty Browse (EmptyStateActions).
  return (
    <EmptyStateActions
      primary={{ label: "Post a job", onClick: gate("post", () => navigate("/post-job")), buttonProps: gatedProps("post") }}
      secondary={{ label: "Notify me when one lands", onClick: onNotify }}
      secondaryIcon={Bell}
    />
  );
}
