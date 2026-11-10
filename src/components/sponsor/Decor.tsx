/**
 * 25 Days page decorations, in the classic Christmas look of the sponsor
 * email (owner 2026-11-09): a thin plaid trim, small antique-gold four-point
 * stars and a gold star rule, plus a quiet fleur-de-lis and the small line
 * icons on the cards. No clip-art, no characters, no other brand's logo. All
 * are decorative (aria-hidden) unless a label is passed. The stars are SVG,
 * not a text glyph, so antique gold never counts as text for contrast.
 */
import type { CSSProperties, ReactNode } from "react";

/** The thin plaid band (hunter green and gold over oxblood) at the top and bottom of the page. */
export function PlaidTrim({ className = "" }: { className?: string }) {
  return <div className={`lh25-plaid ${className}`} aria-hidden="true" />;
}

/** A small four-point star, the page's one ornament. */
export function Sparkle({ size = 14, color = "#b08d57", className = "", style }: { size?: number; color?: string; className?: string; style?: CSSProperties }) {
  return (
    <svg className={`lh25-sparkle ${className}`} style={style} width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M12 1 C13 8 16 11 23 12 C16 13 13 16 12 23 C11 16 8 13 1 12 C8 11 11 8 12 1 Z" fill={color} />
    </svg>
  );
}

/** Two gold hairlines with a star between them: the divider under every heading. */
export function StarRule({ className = "" }: { className?: string }) {
  return (
    <span className={`lh25-star-rule ${className}`} aria-hidden="true">
      <span /> <Sparkle size={13} /> <span />
    </span>
  );
}

/** A simple fleur-de-lis built from three petals and a band. */
export function FleurDeLis({ size = 28, color = "#b08d57", className = "" }: { size?: number; color?: string; className?: string }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" focusable="false">
      <g fill={color}>
        <path d="M32 4 C24 14 24 26 32 36 C40 26 40 14 32 4 Z" />
        <path d="M30 36 C20 38 10 32 8 22 C14 20 20 22 22 28 C24 22 22 18 18 16 C26 14 32 24 30 36 Z" />
        <path d="M34 36 C44 38 54 32 56 22 C50 20 44 22 42 28 C40 22 42 18 46 16 C38 14 32 24 34 36 Z" />
        <rect x="20" y="36" width="24" height="5" rx="2.5" />
        <path d="M28 41 L36 41 L34 56 L30 56 Z" />
      </g>
    </svg>
  );
}

const ICON_PATHS: Record<string, ReactNode> = {
  briefcase: <><rect x="3" y="7" width="18" height="13" rx="3" /><path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2M3 13h18" /></>,
  home: <><path d="M3 11 12 4l9 7" /><path d="M5 10v10h14V10" /><path d="M10 20v-5h4v5" /></>,
  bag: <><path d="M5 8h14l-1 12H6L5 8Z" /><path d="M9 8a3 3 0 0 1 6 0" /></>,
  calendar: <><rect x="3" y="5" width="18" height="16" rx="3" /><path d="M3 10h18M8 3v4M16 3v4" /></>,
  gift: <><rect x="3" y="9" width="18" height="12" rx="2" /><path d="M12 9v12M3 13h18M12 9C10 5 6 5 7 8c.5 1.2 3 1 5 1Zm0 0c2-4 6-4 5-1-.5 1.2-3 1-5 1Z" /></>,
  sparkle: <path d="M12 3c.7 4.6 2.4 6.3 7 7-4.6.7-6.3 2.4-7 7-.7-4.6-2.4-6.3-7-7 4.6-.7 6.3-2.4 7-7Z" />,
  chart: <><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></>,
  star: <path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9L12 3Z" />,
  link: <><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" /><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" /></>,
  heart: <path d="M12 20s-7-4.4-9-9c-1.3-3.2 1-6 4-6 2 0 3.5 1.2 5 3 1.5-1.8 3-3 5-3 3 0 5.3 2.8 4 6-2 4.6-9 9-9 9Z" />,
  wall: <><rect x="3" y="4" width="8" height="7" rx="1.5" /><rect x="13" y="4" width="8" height="7" rx="1.5" /><rect x="3" y="13" width="8" height="7" rx="1.5" /><rect x="13" y="13" width="8" height="7" rx="1.5" /></>,
  facebook: <path d="M14 8h3V4h-3a4 4 0 0 0-4 4v2H7v4h3v7h4v-7h3l1-4h-4V8Z" />,
  globe: <><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c3 3.5 3 14.5 0 18M12 3c-3 3.5-3 14.5 0 18" /></>,
  mail: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3 7 9 6 9-6" /></>,
  check: <path d="m5 12 5 5 9-10" />,
  chevron: <path d="m6 9 6 6 6-6" />,
  upload: <><path d="M12 16V4M7 9l5-5 5 5" /><path d="M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" /></>,
};

export function Icon({ name, size = 22, label }: { name: string; size?: number; label?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      className="lh25-icon"
      strokeLinecap="round"
      strokeLinejoin="round"
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : "true"}
      focusable="false"
    >
      {ICON_PATHS[name] ?? ICON_PATHS.sparkle}
    </svg>
  );
}
