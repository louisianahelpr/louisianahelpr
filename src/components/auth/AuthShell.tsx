import { Link } from "react-router-dom";
import { isNativePlatform } from "@/lib/nativeInit";
import { ReactNode } from "react";
import HelprMark from "@/components/HelprMark";
import BackButton from "@/components/BackButton";

interface AuthShellProps {
  children: ReactNode;
  eyebrow?: string;
  hideBack?: boolean;
  /** Override the Back link target. Defaults to home ("/" on web,
      "/browse" on native). */
  backTo?: string;
  /** When true, hides the Helpr·LA wordmark + eyebrow block above
      the slot. Useful when the inner card has its own headline. */
  hideHeader?: boolean;
  /** When true, renders a compact top bar: small wordmark inline with
      the Back link instead of the large centered wordmark + eyebrow.
      Saves vertical space on mobile multi-step flows. */
  compactHeader?: boolean;
  /** Vertical anchoring of the content column. Defaults to "start"
      (heading sits just below Back). "center" balances a short card
      in the viewport so it doesn't float high with dead space below —
      use only for genuinely short, single-card screens. */
  align?: "start" | "center";
  maxWidth?: "sm" | "md" | "lg" | "2xl";
  /** Desktop-only (lg+) companion pane rendered to the LEFT of the
      form column so the auth page fills wide viewports instead of
      stranding the form in a 500px column with huge empty gutters.
      Mobile is unchanged — the pane is `hidden` below lg. Passing
      `null`/undefined preserves the original narrow-centered layout. */
  desktopBrandPanel?: ReactNode;
}

const widthMap = {
  sm: "max-w-sm",
  md: "max-w-md",
  lg: "max-w-md sm:max-w-lg",
  "2xl": "max-w-md sm:max-w-lg md:max-w-2xl",
};

const AuthShell = ({
  children,
  eyebrow = "Louisiana's Local Job Partner",
  hideBack = false,
  backTo,
  hideHeader = false,
  compactHeader = false,
  align = "start",
  maxWidth = "lg",
  desktopBrandPanel,
}: AuthShellProps) => {
  const showCompactTopBar = compactHeader && !hideHeader;
  const showFullHeader = !compactHeader && !hideHeader;
  const alignClass = align === "center" ? "items-center" : "items-start";
  const resolvedBackTo = backTo ?? (isNativePlatform ? "/browse" : "/");

  // Use the standard frosted circular BackButton so back navigation looks
  // identical across auth pages and the rest of the app. Preserve the
  // resolved target (home on web, /browse on native, or an explicit `backTo`).
  const backLink = <BackButton to={resolvedBackTo} />;

  return (
    <div className="min-h-screen bg-premium-page relative">
      {/* Anchor the content to the TOP on every viewport. A prior
          `sm:items-center` vertically-centered the whole block on tablet/
          desktop, leaving the heading floating in dead space well below
          the Back link. `items-start` keeps the heading sitting just
          below Back with consistent, intentional spacing — and the top
          padding is trimmed on `sm:` so the gap stays tight there too. */}
      {/* When the column is vertically centered the in-flow Back link
          would drift to the middle with it, so pin it to the top-left
          of the viewport instead. */}
      {align === "center" && !hideBack && (
        <div className="absolute left-5 sm:left-8 top-[calc(env(safe-area-inset-top)+24px)] sm:top-12 z-20">
          {backLink}
        </div>
      )}
      <div className={`relative z-10 flex ${alignClass} justify-center min-h-screen px-5 sm:px-8 ${align === "center" ? "pb-[30vh] sm:pb-[26vh]" : "pb-10 sm:pb-16"} ${compactHeader ? "pt-[calc(env(safe-area-inset-top)+10px)] sm:pt-10" : "pt-[calc(env(safe-area-inset-top)+24px)] sm:pt-12"}`}>
        {desktopBrandPanel && (
          <aside className="hidden lg:flex lg:w-1/2 lg:max-w-2xl lg:pr-12 lg:items-center">
            {desktopBrandPanel}
          </aside>
        )}
        <div className={`w-full ${widthMap[maxWidth]}`}>
          {showCompactTopBar ? (
            <div className="relative mb-4 flex items-center justify-center min-h-7">
              {!hideBack && <div className="absolute left-0">{backLink}</div>}
              <HelprMark to={null} size="md" emblemOnly />
            </div>
          ) : (
            !hideBack && align !== "center" && (
              <div className="mb-5">{backLink}</div>
            )
          )}

          {showFullHeader && (
            <div className="text-center mb-7">
              <Link to="/" className="inline-flex items-baseline gap-1">
                <span
                  className="font-display italic font-bold leading-none"
                  style={{
                    fontSize: "2.25rem",
                    color: "hsl(var(--olivewood))",
                    letterSpacing: "-0.02em",
                  }}
                >
                  Helpr
                </span>
                <span
                  className="font-display italic font-bold leading-none"
                  style={{
                    fontSize: "1.4rem",
                    color: "hsl(var(--burnt-sienna))",
                    letterSpacing: "0.22em",
                    marginLeft: "0.12em",
                  }}
                >
                  · LA
                </span>
              </Link>
              <p
                className="mt-2 text-ds-11 tracking-[0.18em] uppercase font-serif italic"
                style={{ color: "hsl(var(--burnt-sienna) / 0.7)" }}
              >
                {eyebrow}
              </p>
            </div>
          )}

          {children}
        </div>
      </div>
    </div>
  );
};

export default AuthShell;
