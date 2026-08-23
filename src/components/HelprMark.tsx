import { Link } from "react-router-dom";
import helprLogoSm from "@/assets/helpr-logo-96.webp";
import helprLogoMd from "@/assets/helpr-logo-256.webp";

interface HelprMarkProps {
  /** Optional link target. Pass `null` to render as a static span (e.g. inside dialogs). */
  to?: string | null;
  /** "sm" (~h-7) for compact navbars, "md" (~h-9) for primary nav, "lg" (~h-11) for splash. */
  size?: "sm" | "md" | "lg";
  /** Hide the "·LA" suffix when space is tight. */
  hideSuffix?: boolean;
  /** Render only the wrought-iron H emblem, without the "Helpr·LA"
   *  wordmark — used as a standalone brand crest (e.g. auth screens). */
  emblemOnly?: boolean;
  /** Render only the wordmark, without the H emblem — used in the
   *  footer where the emblem would double up with the nav. */
  hideEmblem?: boolean;
  className?: string;
}

const sizeMap = {
  sm: { logo: "h-5", helpr: "1.15rem", la: "0.8rem" },
  md: { logo: "h-6", helpr: "1.45rem", la: "0.95rem" },
  lg: { logo: "h-9", helpr: "1.85rem", la: "1.2rem" },
};

// Standalone-crest heights — the emblem carries the whole mark on its
// own here, so it's sized up a step from its inline-wordmark height.
const emblemSizeMap = { sm: "h-8", md: "h-10", lg: "h-14" };

/**
 * Helpr·LA wordmark — wrought-iron H emblem (Garden District ironwork
 * with a verdigris fleur-de-lis center) followed by italic EB Garamond
 * "Helpr" and a Burnt-Sienna "·LA" tail.
 *
 * The H emblem is a real photograph; we use the trimmed transparent PNG
 * via webp at the right resolution per size. No surrounding frosted-glass
 * tile — the wrought iron is detailed enough to hold its own.
 */
export const HelprMark = ({ to = "/", size = "md", hideSuffix = false, emblemOnly = false, hideEmblem = false, className = "" }: HelprMarkProps) => {
  const s = sizeMap[size];
  const logoClass = emblemOnly ? emblemSizeMap[size] : s.logo;
  const inner = (
    <>
      {!hideEmblem && (
      <img
        src={size === "lg" || emblemOnly ? helprLogoMd : helprLogoSm}
        srcSet={`${helprLogoSm} 96w, ${helprLogoMd} 256w`}
        sizes={size === "lg" ? "56px" : size === "md" ? "40px" : "32px"}
        alt="Helpr"
        // `.helpr-emblem` owns the filter (see index.css). It was an inline
        // `style` here, which is exactly why the mark vanished on dark
        // screens: an inline filter always wins over a stylesheet rule, so no
        // `[data-theme="dark"]` override could ever take effect.
        className={`helpr-emblem ${logoClass} w-auto select-none transition-transform duration-200 group-hover:scale-105`}
        draggable={false}
      />
      )}
      {!emblemOnly && (
      <span className="inline-flex items-baseline gap-0.5">
        <span
          className="font-serif leading-none"
          style={{
            fontSize: s.helpr,
            fontWeight: 500,
            color: "hsl(var(--ink-deep))",
            letterSpacing: "-0.005em",
          }}
        >
          Helpr
        </span>
        {!hideSuffix && (
          <span
            className="font-serif italic leading-none"
            style={{
              fontSize: s.la,
              fontWeight: 400,
              color: "hsl(var(--burnt-sienna))",
              // Same airy small-caps tracking we use for metadata
              // throughout the app — high-end editorial feel.
              letterSpacing: "0.22em",
              marginLeft: "0.18em",
            }}
          >
            · LA
          </span>
        )}
      </span>
      )}
    </>
  );

  const cls = `flex items-center gap-2.5 group ${className}`.trim();

  if (to === null) {
    return <span className={cls}>{inner}</span>;
  }
  // `min-h-11` = the 44px minimum, on the LINK BOX only. The mark was measured
  // at 23–24px tall across 61 screens because the box shrink-wrapped a
  // `h-5`/`h-6` logo. Nothing changes visually: the emblem and wordmark keep
  // their exact sizes and their left alignment, so the extra height is simply
  // centred around them. Every consumer sits in a flex row with `items-center`
  // inside a 56px bar, so a 44px box has room and moves nothing.
  //
  // HEIGHT ONLY — deliberately no `min-w-11`. Height was the failing axis (the
  // wordmark variant is already ~100px wide). Width is also the axis this mark
  // must stay free to LOSE: it is the one element in DashboardTitleBar without
  // `shrink-0`, so when that row runs short the crest collapses inside the
  // card's `overflow-hidden` and every control beside it stays reachable.
  // Pinning it to 44px would turn that graceful degradation into horizontal
  // overflow. (Re-measured 2026-08-18: the row does not currently run short —
  // at 320 it holds the 37px crest, a 96px job pill and the bell with 49px to
  // spare, now that the feed's four action icons sit in the toolbar row below.
  // The floor stays off because the yield ORDER is the point, not because the
  // fit is tight today.)
  //
  // Applied ONLY to the interactive variant — the `to === null` span above is
  // decorative chrome inside dialogs, not a tap target.
  return (
    // Explicit accessible name. Most link call sites pass `emblemOnly`, so the
    // anchor wrapped nothing but `<img alt="Helpr">` — a screen reader
    // announced "Helpr, link", naming the logo instead of where it goes, on
    // every authed screen. Labelling the anchor REPLACES its inner text rather
    // than adding to it, so the wordmark variants stop reading "Helpr Helpr
    // · LA" too. One label covers every consumer: `to` is only ever "/" or
    // "/dashboard", both of which are home.
    <Link to={to} aria-label="Helpr home" className={`${cls} min-h-11`}>
      {inner}
    </Link>
  );
};

export default HelprMark;
