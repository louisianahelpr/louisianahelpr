import { Link } from "react-router-dom";

interface PayItForwardTeaserProps {
  /** Count of funded, unspent, unexpired gift cards addressed to this user. */
  pifCount: number;
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
 */
const PayItForwardTeaser = ({ pifCount }: PayItForwardTeaserProps) => {
  if (pifCount <= 0) return null;
  return (
    <div
      className="mx-4 mb-3 rounded-ds-md p-3"
      style={{
        background: "hsl(var(--gift-tint) / 0.08)",
        border: "0.5px solid hsl(var(--gift-tint) / 0.2)",
      }}
    >
      <p
        className="font-sans font-semibold text-ds-14"
        style={{ color: "hsl(var(--success-ink))" }}
      >
        {pifCount} Helpr gift card{pifCount > 1 ? "s" : ""} waiting for you
      </p>
      <p
        className="font-serif italic text-ds-12 mt-0.5"
        style={{ color: "hsl(var(--gift-green-soft))" }}
      >
        Ready to spend on your next job ·{" "}
        <Link to="/gift-card" className="underline">
          {pifCount > 1 ? "See them" : "See it"}
        </Link>
      </p>
    </div>
  );
};

export default PayItForwardTeaser;
