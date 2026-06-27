import { Link } from "react-router-dom";

interface PayItForwardTeaserProps {
  /** Count of available credits in the user's parish. */
  pifCount: number;
}

/**
 * Pay It Forward teaser — only rendered when credits exist in the user's
 * parish. Pure presentation lifted verbatim out of Dashboard's panel body.
 */
const PayItForwardTeaser = ({ pifCount }: PayItForwardTeaserProps) => {
  if (pifCount <= 0) return null;
  return (
    <div
      className="mx-4 mb-3 rounded-ds-md p-3"
      style={{
        background: "hsl(var(--pif-tint) / 0.08)",
        border: "0.5px solid hsl(var(--pif-tint) / 0.2)",
      }}
    >
      <p
        className="font-display italic font-semibold text-ds-14"
        style={{ color: "hsl(var(--pif-green))" }}
      >
        {pifCount} neighbor{pifCount > 1 ? "s" : ""} paid it forward
      </p>
      <p
        className="font-serif italic text-ds-12 mt-0.5"
        style={{ color: "hsl(var(--pif-green-soft))" }}
      >
        Free job credits available in your parish ·{" "}
        <Link to="/pay-it-forward" className="underline">
          See them
        </Link>
      </p>
    </div>
  );
};

export default PayItForwardTeaser;
