/**
 * 25 Days page decorations: original, simple inline SVGs drawn for this page
 * (string lights, sparkles, fleur-de-lis, magnolia, gift box) and the small
 * line icons on the cards. No clip-art, no characters, no other brand's logo.
 * All are decorative (aria-hidden) unless a label is passed.
 */
import type { CSSProperties, ReactNode } from "react";

const BULBS = ["#C8102E", "#D4AF37", "#1E8E3E", "#5B2A86"];

/** The string-light garland across the top of the page. */
export function Garland({ count = 18 }: { count?: number }) {
  const w = 1200;
  const step = w / count;
  const sag = (x: number) => 18 + 14 * Math.sin((x / w) * Math.PI * 6 - Math.PI / 2);
  let d = `M 0 ${sag(0)}`;
  for (let x = 20; x <= w; x += 20) d += ` L ${x} ${sag(x).toFixed(1)}`;
  return (
    <svg className="lh25-garland" viewBox={`0 0 ${w} 70`} preserveAspectRatio="none" aria-hidden="true" focusable="false">
      <path className="lh25-wire" d={d} fill="none" stroke="#2f5d3a" />
      {Array.from({ length: count }, (_, i) => {
        const x = step * i + step / 2;
        const y = sag(x);
        const color = BULBS[i % BULBS.length];
        return (
          <g key={i} transform={`translate(${x.toFixed(1)} ${y.toFixed(1)})`}>
            <rect x="-3" y="0" width="6" height="6" rx="1.5" fill="#6b6b6b" />
            <ellipse className="lh25-bulb" style={{ "--lh25-delay": `${(i % 5) * 0.37}s` } as CSSProperties} cx="0" cy="15" rx="6.5" ry="10" fill={color} />
          </g>
        );
      })}
    </svg>
  );
}

export function Sparkle({ size = 18, color = "#D4AF37", className = "", style }: { size?: number; color?: string; className?: string; style?: CSSProperties }) {
  return (
    <svg className={`lh25-sparkle ${className}`} style={style} width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M12 1 C13 8 16 11 23 12 C16 13 13 16 12 23 C11 16 8 13 1 12 C8 11 11 8 12 1 Z" fill={color} />
    </svg>
  );
}

/** A simple fleur-de-lis built from three petals and a band. */
export function FleurDeLis({ size = 28, color = "#D4AF37", className = "" }: { size?: number; color?: string; className?: string }) {
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

/** A five-petal magnolia bloom. */
export function Magnolia({ size = 44, className = "" }: { size?: number; className?: string }) {
  const petals = [0, 72, 144, 216, 288];
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" focusable="false">
      <g transform="translate(32 32)">
        {petals.map((a) => (
          <path key={a} transform={`rotate(${a})`} d="M0 0 C-10 -8 -9 -26 0 -29 C9 -26 10 -8 0 0 Z" className="lh25-petal" fill="#fffaf2" stroke="#e8d9c4" />
        ))}
        <circle r="6" fill="#D4AF37" />
        <circle r="3" fill="#b8932a" />
      </g>
    </svg>
  );
}

export function GiftBox({ size = 44, box = "#C8102E", ribbon = "#D4AF37", className = "" }: { size?: number; box?: string; ribbon?: string; className?: string }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" focusable="false">
      <rect x="8" y="26" width="48" height="32" rx="5" fill={box} />
      <rect x="5" y="18" width="54" height="11" rx="4" fill={box} style={{ filter: "brightness(1.12)" }} />
      <rect x="28" y="18" width="8" height="40" fill={ribbon} />
      <path d="M32 18 C24 6 12 10 18 17 C21 20 28 19 32 18 Z M32 18 C40 6 52 10 46 17 C43 20 36 19 32 18 Z" fill={ribbon} />
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
