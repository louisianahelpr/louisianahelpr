/**
 * Louisiana Verified — circular wax-seal badge.
 *
 * Two concentric Heritage-Gold rings, with editorial micro-serif text
 * orbiting along the outer ring and a Fraunces "LA" monogram in the center.
 * A 3° rotation gives it the off-axis feel of a real pressed seal.
 */
const LouisianaVerifiedBadge = ({ className = "" }: { className?: string }) => {
  const gold = "hsl(var(--heritage-gold))";

  return (
    <svg
      viewBox="0 0 100 100"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="Louisiana Verified"
      className={`seal-spin ${className}`}
      style={{
        filter:
          "drop-shadow(0 1px 0 rgba(255,255,255,0.6)) drop-shadow(0 4px 8px rgba(20,20,18,0.18))",
      }}
    >
      <defs>
        {/* Path for the top arc text — runs left to right across the upper
            half of the seal so "LOUISIANA · VERIFIED" reads upright. */}
        <path
          id="seal-arc-top"
          d="M 18 50 A 32 32 0 0 1 82 50"
          fill="none"
        />
        {/* Path for the bottom arc text — runs left to right across the lower
            half via a flipped sweep so "EST 2026" reads upright too. */}
        <path
          id="seal-arc-bottom"
          d="M 18 51 A 32 32 0 0 0 82 51"
          fill="none"
        />
      </defs>

      {/* Cream linen disc behind the seal so the text doesn't have to fight
          the photo. Subtle inner shadow gives it a "pressed wax" depth. */}
      <circle cx="50" cy="50" r="46" fill="hsl(var(--background) / 0.92)" />

      {/* Outer ring */}
      <circle
        cx="50"
        cy="50"
        r="45.5"
        fill="none"
        stroke={gold}
        strokeWidth="1.5"
      />
      {/* Inner ring */}
      <circle
        cx="50"
        cy="50"
        r="38"
        fill="none"
        stroke={gold}
        strokeWidth="0.6"
      />

      {/* Top arc text */}
      <text
        fontFamily="Fraunces, Georgia, serif"
        fontSize="6.2"
        fontWeight="700"
        letterSpacing="2"
        fill={gold}
      >
        <textPath
          href="#seal-arc-top"
          startOffset="50%"
          textAnchor="middle"
        >
          LOUISIANA · VERIFIED
        </textPath>
      </text>

      {/* Bottom arc text */}
      <text
        fontFamily="Fraunces, Georgia, serif"
        fontSize="5.4"
        fontWeight="600"
        letterSpacing="3"
        fill={gold}
      >
        <textPath
          href="#seal-arc-bottom"
          startOffset="50%"
          textAnchor="middle"
        >
          ESTATE STANDARD
        </textPath>
      </text>

      {/* Center monogram */}
      <text
        x="50"
        y="58"
        fontFamily="Fraunces, Georgia, serif"
        fontSize="22"
        fontWeight="900"
        letterSpacing="-1"
        textAnchor="middle"
        fill={gold}
      >
        LA
      </text>

      {/* Tiny ornament dots flanking the monogram */}
      <circle cx="32" cy="50" r="0.9" fill={gold} />
      <circle cx="68" cy="50" r="0.9" fill={gold} />
    </svg>
  );
};

export default LouisianaVerifiedBadge;
