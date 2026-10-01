import { useState } from "react";
import { Link } from "react-router-dom";
import { X } from "lucide-react";
import { safeStorage } from "@/lib/safeStorage";

interface GiftCardTeaserProps {
  /** The viewer — dismissal is remembered per user on this device. */
  userId: string;
  /** Ids of the spendable gift cards (useSpendableGiftCards), sorted. */
  ids: string[];
}

/** One key per user; the value is the set of gift ids that was dismissed. */
export const giftBannerDismissKey = (userId: string) => `helpr_gift_banner_dismissed_${userId}`;

/**
 * Gift card banner — rendered only when this user is actually holding a gift
 * card they can spend.
 *
 * It sits at the top of Post a Job's entry screen, where the gift gets spent
 * (owner, 2026-10-01: off /home, onto Post a Job, with an X to dismiss it).
 * It used to ride at the head of the /home feed.
 *
 * The X is per viewer and per SET of gifts: the stored value is the sorted
 * ids that were showing when it was dismissed, so a NEW gift (a different
 * set) brings the banner back, while the same gifts stay dismissed.
 * safeStorage wraps every localStorage read and write in try/catch.
 *
 * "See them" goes to the gift card tab, not straight into a post with the
 * gift applied: the count includes gifts sent to this user's email that are
 * not yet claimed (recipient_id null), which the post-job gift apply refuses
 * until claimed. The gift tab is where a gift is claimed and "Use This Gift"
 * starts a post with it.
 */
const GiftCardTeaser = ({ userId, ids }: GiftCardTeaserProps) => {
  const signature = ids.join(",");
  const [dismissed, setDismissed] = useState<string | null>(() =>
    safeStorage.getItem(giftBannerDismissKey(userId)),
  );
  const count = ids.length;
  if (count <= 0 || dismissed === signature) return null;

  const dismiss = () => {
    safeStorage.setItem(giftBannerDismissKey(userId), signature);
    setDismissed(signature);
  };

  return (
    <div
      className="rounded-ds-md p-3 flex items-start gap-2"
      style={{
        background: "hsl(var(--gift-tint) / 0.08)",
        border: "0.5px solid hsl(var(--gift-tint) / 0.2)",
      }}
    >
      <div className="flex-1 min-w-0">
        <p
          className="font-sans font-semibold text-ds-14"
          style={{ color: "hsl(var(--success-ink))" }}
        >
          {count} Helpr gift card{count > 1 ? "s" : ""} waiting for you
        </p>
        <p
          className="font-sans text-ds-12 mt-0.5"
          style={{ color: "hsl(var(--gift-green-soft))" }}
        >
          Ready to spend on your next job ·{" "}
          <Link to="/profile?tab=gift_card" className="underline">
            {count > 1 ? "See them" : "See it"}
          </Link>
        </p>
      </div>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss"
        className="shrink-0 -mr-2 -my-2 w-11 h-11 inline-flex items-center justify-center rounded-full active:bg-secondary/40 transition-colors"
        style={{ color: "hsl(var(--success-ink))" }}
      >
        <X className="w-4 h-4" aria-hidden="true" />
      </button>
    </div>
  );
};

export default GiftCardTeaser;
