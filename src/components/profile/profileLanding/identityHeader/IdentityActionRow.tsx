import { Edit, Share2 } from "lucide-react";
import { shareNative } from "@/lib/nativeShare";

interface IdentityActionRowProps {
  userId?: string | null;
  displayName: string;
  avgRating: number | null;
  completedCount: number;
  onSelectTab: (key: string) => void;
}

/**
 * Top-right action row — Share icon + Edit pill. Pure presentational: the
 * share payload is derived only from props and `shareNative` is a global
 * util (no component state/hooks). Extracted verbatim from IdentityHeader.
 */
export function IdentityActionRow({
  userId,
  displayName,
  avgRating,
  completedCount,
  onSelectTab,
}: IdentityActionRowProps) {
  return (
    <div className="absolute top-3.5 right-3 flex items-center gap-1.5">
      {/* Share profile — only shown when we have a userId to build
          the deep-link from. Opens the OS share sheet on native. */}
      {userId && (
        <button
          type="button"
          aria-label="Share your profile"
          onClick={() => {
            const ratingText = avgRating
              ? avgRating.toFixed(1) + "★"
              : "New helper";
            void shareNative({
              title: `${displayName} on Helpr`,
              text: `${displayName} · ${completedCount} job${completedCount === 1 ? "" : "s"} · ${ratingText}\n\nHire me on Helpr:`,
              url: `https://www.louisianahelpr.com/user/${userId}`,
              dialogTitle: "Share your profile",
            });
          }}
          className="h-10 w-10 rounded-full bg-[hsl(var(--bark)/0.10)] hover:bg-[hsl(var(--bark)/0.16)] active:scale-95 inline-flex items-center justify-center text-[hsl(var(--bark))] transition-all"
        >
          <Share2 className="w-3.5 h-3.5" />
        </button>
      )}
      <button
        onClick={() => onSelectTab("profile")}
        aria-label="Edit profile"
        // h-10 hits the iOS/Android 40pt minimum tap target; nudged
        // down half a step so it doesn't crowd the status bar inset.
        className="h-10 pl-2.5 pr-3 rounded-full bg-[hsl(var(--bark)/0.10)] hover:bg-[hsl(var(--bark)/0.16)] active:scale-95 inline-flex items-center gap-1 text-[hsl(var(--bark))] transition-all"
      >
        <Edit className="w-3.5 h-3.5" />
        <span className="text-ds-11 font-sans font-semibold">Edit</span>
      </button>
    </div>
  );
}
