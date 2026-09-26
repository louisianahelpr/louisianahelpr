import { Link } from "react-router-dom";

interface GiftCardTeaserProps {
  /** Count of funded, unspent, unexpired gift cards addressed to this user. */
  giftCardCount: number;
}

/**
 * Gift Card teaser — rendered only when this user is actually holding a gift
 * card they can spend.
 *
 * The copy used to say "in your parish", which described the retired
 * world-readable pool model, not the directed gifts the product ships. It
 * also could never appear: see the count's own comment in
 * useDashboardSideQueries. Naming the gift as THEIRS is both true now and the
 * point — the reported failure started with a recipient not realising the
 * money was already sitting in their account.
 *
 * It rides at the head of the /home feed (BrowseTasksFeed `lead`), with the
 * cards' own 8px pitch below it. It used to sit under the feed as the
 * panel's last child, where the bottom nav covered it: on prod, 2026-09-26,
 * poster-e2e's "2 Helpr gift cards waiting" card had its top at y=734 of an
 * 812px phone, entirely under the nav (prod-audit #1754, section gap -120).
 */
const GiftCardTeaser = ({ giftCardCount }: GiftCardTeaserProps) => {
  if (giftCardCount <= 0) return null;
  return (
    <div
      className="mb-2 rounded-ds-md p-3"
      style={{
        background: "hsl(var(--gift-tint) / 0.08)",
        border: "0.5px solid hsl(var(--gift-tint) / 0.2)",
      }}
    >
      <p
        className="font-sans font-semibold text-ds-14"
        style={{ color: "hsl(var(--success-ink))" }}
      >
        {giftCardCount} Helpr gift card{giftCardCount > 1 ? "s" : ""} waiting for you
      </p>
      <p
        className="font-sans text-ds-12 mt-0.5"
        style={{ color: "hsl(var(--gift-green-soft))" }}
      >
        Ready to spend on your next job ·{" "}
        <Link to="/profile?tab=gift_card" className="underline">
          {giftCardCount > 1 ? "See them" : "See it"}
        </Link>
      </p>
    </div>
  );
};

export default GiftCardTeaser;
