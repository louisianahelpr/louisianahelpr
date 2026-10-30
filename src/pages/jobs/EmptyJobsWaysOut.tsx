import { Bell, Share2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useProfile } from "@/hooks/useProfile";
import { useNotifyWhenWorkLands } from "@/hooks/useNotifyWhenWorkLands";
import { firstNameOf, shareBookMe } from "@/lib/bookMe";

/**
 * UX-4 (owner approved 2026-10-29, Q2484): the empty "jobs I'm doing" list offers two more ways to get work
 * besides browsing: share your own Book me link (/book/<your id>, the same share sheet as the profile's
 * "Book me link" button) and "Notify me when one lands" (the one shared job-alert handler,
 * useNotifyWhenWorkLands). Both are the shared pill Button; Browse stays the primary.
 * Guard: src/test/emptyJobsListBookMeAndNotify.test.tsx.
 */
export function EmptyJobsWaysOut({ userId }: { userId: string }) {
  const { data: profile } = useProfile(userId || null);
  const notify = useNotifyWhenWorkLands();
  return (
    <div className="mt-3 flex flex-wrap items-center justify-center gap-2" data-testid="empty-jobs-ways-out">
      {userId && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => void shareBookMe(userId, firstNameOf(profile?.full_name))}
          className="gap-1.5"
        >
          <Share2 className="w-4 h-4" aria-hidden="true" />
          Share your Book me link
        </Button>
      )}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => void notify()}
        className="gap-1.5 font-sans font-medium"
        style={{ color: "hsl(var(--olivewood) / 0.8)" }}
      >
        <Bell className="w-4 h-4" aria-hidden="true" />
        Notify me when one lands
      </Button>
    </div>
  );
}
