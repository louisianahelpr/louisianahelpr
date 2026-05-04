import { forwardRef, type SVGProps } from "react";

/**
 * Property-mark logo, detailed edition. Garden District ironwork meets
 * Louisiana civic emblem.
 *
 *   · Two stone-block pillars with vertical fluting lines and stepped
 *     stone-joint divisions
 *   · Capitals + bases rendered as dental molding (a Greek-revival
 *     architectural motif common in New Orleans) — three short teeth
 *     under the horizontal cap line
 *   · Bark-green crossbar (the connection between two parties), broken
 *     by a center fleur-de-lis (the Louisiana state symbol) painted in
 *     Burnt Sienna
 *   · A small Burnt-Sienna keystone star floats above the crossbar
 *
 * Color note: pillars + capitals + bases use `currentColor` so the icon
 * still inherits text color from Tailwind `text-*` classes. The crossbar
 * (Bark) and the fleur-de-lis + keystone (Burnt Sienna) are hard-coded so
 * they stay on-brand regardless of context.
 */
const ConnectedHIcon = forwardRef<SVGSVGElement, SVGProps<SVGSVGElement>>(
  (props, ref) => (
    <svg
      ref={ref}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      {...props}
    >
      {/* ── LEFT PILLAR ─────────────────────────────── */}
      {/* Main shaft */}
      <line
        x1="8" y1="7" x2="8" y2="25"
        stroke="currentColor" strokeWidth="3.75" strokeLinecap="round"
      />
      {/* Inner fluting line — hairline accent inside the column */}
      <line
        x1="9.5" y1="9" x2="9.5" y2="23"
        stroke="currentColor" strokeWidth="0.75" strokeLinecap="round"
        opacity="0.4"
      />
      {/* Stone joint divisions — small horizontal cuts breaking the
          shaft into masonry blocks */}
      <line
        x1="6.5" y1="11" x2="9.5" y2="11"
        stroke="currentColor" strokeWidth="0.6" strokeLinecap="round"
        opacity="0.5"
      />
      <line
        x1="6.5" y1="21" x2="9.5" y2="21"
        stroke="currentColor" strokeWidth="0.6" strokeLinecap="round"
        opacity="0.5"
      />

      {/* Capital — wider cap line + dental molding (3 teeth) */}
      <line
        x1="5.5" y1="6" x2="10.5" y2="6"
        stroke="currentColor" strokeWidth="2" strokeLinecap="round"
      />
      <line
        x1="6.25" y1="7.25" x2="6.25" y2="8.25"
        stroke="currentColor" strokeWidth="1" strokeLinecap="round"
      />
      <line
        x1="8" y1="7.25" x2="8" y2="8.25"
        stroke="currentColor" strokeWidth="1" strokeLinecap="round"
      />
      <line
        x1="9.75" y1="7.25" x2="9.75" y2="8.25"
        stroke="currentColor" strokeWidth="1" strokeLinecap="round"
      />

      {/* Base — mirrored capital */}
      <line
        x1="5.5" y1="26" x2="10.5" y2="26"
        stroke="currentColor" strokeWidth="2" strokeLinecap="round"
      />
      <line
        x1="6.25" y1="23.75" x2="6.25" y2="24.75"
        stroke="currentColor" strokeWidth="1" strokeLinecap="round"
      />
      <line
        x1="8" y1="23.75" x2="8" y2="24.75"
        stroke="currentColor" strokeWidth="1" strokeLinecap="round"
      />
      <line
        x1="9.75" y1="23.75" x2="9.75" y2="24.75"
        stroke="currentColor" strokeWidth="1" strokeLinecap="round"
      />

      {/* ── RIGHT PILLAR ────────────────────────────── */}
      <line
        x1="24" y1="7" x2="24" y2="25"
        stroke="currentColor" strokeWidth="3.75" strokeLinecap="round"
      />
      <line
        x1="22.5" y1="9" x2="22.5" y2="23"
        stroke="currentColor" strokeWidth="0.75" strokeLinecap="round"
        opacity="0.4"
      />
      <line
        x1="22.5" y1="11" x2="25.5" y2="11"
        stroke="currentColor" strokeWidth="0.6" strokeLinecap="round"
        opacity="0.5"
      />
      <line
        x1="22.5" y1="21" x2="25.5" y2="21"
        stroke="currentColor" strokeWidth="0.6" strokeLinecap="round"
        opacity="0.5"
      />

      <line
        x1="21.5" y1="6" x2="26.5" y2="6"
        stroke="currentColor" strokeWidth="2" strokeLinecap="round"
      />
      <line
        x1="22.25" y1="7.25" x2="22.25" y2="8.25"
        stroke="currentColor" strokeWidth="1" strokeLinecap="round"
      />
      <line
        x1="24" y1="7.25" x2="24" y2="8.25"
        stroke="currentColor" strokeWidth="1" strokeLinecap="round"
      />
      <line
        x1="25.75" y1="7.25" x2="25.75" y2="8.25"
        stroke="currentColor" strokeWidth="1" strokeLinecap="round"
      />

      <line
        x1="21.5" y1="26" x2="26.5" y2="26"
        stroke="currentColor" strokeWidth="2" strokeLinecap="round"
      />
      <line
        x1="22.25" y1="23.75" x2="22.25" y2="24.75"
        stroke="currentColor" strokeWidth="1" strokeLinecap="round"
      />
      <line
        x1="24" y1="23.75" x2="24" y2="24.75"
        stroke="currentColor" strokeWidth="1" strokeLinecap="round"
      />
      <line
        x1="25.75" y1="23.75" x2="25.75" y2="24.75"
        stroke="currentColor" strokeWidth="1" strokeLinecap="round"
      />

      {/* ── KEYSTONE STAR ───────────────────────────── */}
      {/* Tiny 4-point star floating above the crossbar — civic ornament */}
      <path
        d="M16 9 L16.6 10.4 L18 11 L16.6 11.6 L16 13 L15.4 11.6 L14 11 L15.4 10.4 Z"
        fill="hsl(19 75% 35%)"
        opacity="0.55"
      />

      {/* ── CROSSBAR (Bark green connection) ────────── */}
      <line
        x1="9.75" y1="16" x2="13.25" y2="16"
        stroke="hsl(70 20% 33%)" strokeWidth="3.75" strokeLinecap="round"
      />
      <line
        x1="18.75" y1="16" x2="22.25" y2="16"
        stroke="hsl(70 20% 33%)" strokeWidth="3.75" strokeLinecap="round"
      />

      {/* ── FLEUR-DE-LIS NODE ───────────────────────── */}
      {/* Stylized 3-petal Louisiana fleur-de-lis at the center of the
          handshake, painted in Burnt Sienna. Built from an outer
          diamond (the petals' bulk) + a vertical center spine + two
          small side curl ticks. */}
      {/* Center spine */}
      <line
        x1="16" y1="13.4" x2="16" y2="18.6"
        stroke="hsl(19 75% 35%)" strokeWidth="1.6" strokeLinecap="round"
      />
      {/* Diamond body of the fleur */}
      <path
        d="M16 14 L18 16 L16 18 L14 16 Z"
        fill="hsl(19 75% 35%)"
      />
      {/* Side petal curls — small ticks on the horizontal axis */}
      <line
        x1="14" y1="16" x2="13" y2="14.8"
        stroke="hsl(19 75% 35%)" strokeWidth="1.2" strokeLinecap="round"
      />
      <line
        x1="18" y1="16" x2="19" y2="14.8"
        stroke="hsl(19 75% 35%)" strokeWidth="1.2" strokeLinecap="round"
      />
      {/* Crossbar tie — small horizontal line through the fleur */}
      <line
        x1="14.4" y1="17.4" x2="17.6" y2="17.4"
        stroke="hsl(19 75% 35%)" strokeWidth="0.8" strokeLinecap="round"
      />
    </svg>
  ),
);

ConnectedHIcon.displayName = "ConnectedHIcon";

export default ConnectedHIcon;
