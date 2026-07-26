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
  /** Horizontally centre the form column and vertically centre it at lg+.
      Defaults to `!!desktopBrandPanel`, which is how this behaviour used to
      be derived. Split into its own prop because the two are unrelated: a
      screen can want a centred column WITHOUT a brand pane (Signup now folds
      its emblem into the heading row, and without this it snapped to
      `items-start` and pinned the card to the left edge). Callers that pass a
      brand pane are unaffected. */
  centerColumn?: boolean;
  /** Overlay the back control INSIDE the card's top-left corner instead of
      stacking it above the column. Once the heading moved into the card, a
      bare arrow sitting above it had nothing to attach to — it floated on the
      page background and read as unrelated chrome. Absolute, so it costs no
      vertical space and the heading stays optically centred. */
  backInCard?: boolean;
}

const widthMap = {
  sm: "max-w-sm",
  md: "max-w-md",
  // On desktop, widen the form column beyond the phone-first max-w-lg so
  // the card visually anchors the page instead of floating in a narrow
  // strip on 1440+ viewports (matches the "wider centered card" audit
  // direction the user picked for the ambient-bg auth pages).
  lg: "max-w-md sm:max-w-lg lg:max-w-xl",
  // Widest rung — the auth cards now carry their heading INSIDE the card, so
  // the card is the whole composition and a 576px column left it reading as a
  // narrow strip on a 1200+ viewport.
  "2xl": "max-w-md sm:max-w-lg md:max-w-2xl lg:max-w-5xl",
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
  centerColumn,
  backInCard = false,
}: AuthShellProps) => {
  const showCompactTopBar = compactHeader && !hideHeader;
  const showFullHeader = !compactHeader && !hideHeader;
  const alignClass = align === "center" ? "items-center" : "items-start";
  // Defaults to the old derivation so every existing caller renders identically.
  const centered = centerColumn ?? !!desktopBrandPanel;
  // Back returns to WHERE YOU CAME FROM. Auth pages are reached from all over
  // — a job card on /jobs, a gated tab, the nav CTA — so a hard-coded target
  // sent people somewhere they had never been. It previously forced "/" on web
  // (or /browse on native), which became obvious once guest job cards started
  // routing to /signup: backing out of signup dumped you on the landing page
  // instead of the job board you were browsing.
  //
  // Passing `to={backTo}` — undefined unless a caller sets it — lets BackButton
  // use its own history-back path, which already falls back to "/" when there
  // is no history to pop (a cold launch or a direct link). On native, "/" is
  // the NativeRedirect that lands on /browse, so the old native default is
  // preserved without hard-coding it here. An explicit `backTo` still wins.
  const backLink = <BackButton to={backTo} />;

  return (
    <div className="min-h-screen bg-premium-page relative overflow-hidden">
      {/* Ambient brand-wash decoration — desktop-only, sits behind the
          auth column. Two soft radial gradients in the brand palette
          (olivewood + burnt-sienna) fill the empty gutters on wide
          viewports so the page reads as intentional atmosphere rather
          than blank whitespace. Kept `pointer-events-none` + `aria-hidden`
          so it never intercepts input or announces to screen readers. */}
      {desktopBrandPanel && (
        <div
          aria-hidden
          className="hidden lg:block pointer-events-none absolute inset-0 z-0"
          style={{
            background: [
              "radial-gradient(60% 55% at 12% 22%, hsl(var(--olivewood) / 0.09) 0%, transparent 60%)",
              "radial-gradient(50% 45% at 88% 78%, hsl(var(--burnt-sienna) / 0.08) 0%, transparent 60%)",
              "radial-gradient(38% 32% at 92% 18%, hsl(var(--olivewood) / 0.05) 0%, transparent 65%)",
            ].join(", "),
          }}
        />
      )}
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
      {/* Desktop-brand-hero variant: pin the back button top-LEFT so it
          sits above the horizontal brand band rather than in the form
          column. Mobile keeps the in-flow back button inside the form
          column, unchanged. */}
      {desktopBrandPanel && align !== "center" && !hideBack && (
        <div className="hidden lg:block absolute left-8 top-8 z-20">
          {backLink}
        </div>
      )}
      <div className={`relative z-10 flex flex-col ${centered ? "items-center" : alignClass} ${centered ? "lg:justify-center" : ""} justify-center min-h-screen px-5 sm:px-8 ${align === "center" ? "pb-[30vh] sm:pb-[26vh]" : "pb-10 sm:pb-8 lg:pb-6"} ${compactHeader ? "pt-[calc(env(safe-area-inset-top)+10px)] sm:pt-10" : "pt-[calc(env(safe-area-inset-top)+24px)] sm:pt-12 lg:pt-6"}`}>
        {/* Brand mark hero — desktop-only. Sits as a sibling INSIDE the
            same vertically-centered flex column as the form so hero +
            form read as one composed unit centered on the viewport
            (fixes the "top-heavy, cut off at the bottom" imbalance). */}
        {desktopBrandPanel && (
          <div className="hidden lg:block mb-2">
            {desktopBrandPanel}
          </div>
        )}
        <div className={`w-full ${widthMap[maxWidth]} ${backInCard ? "relative" : ""}`}>
          {showCompactTopBar ? (
            <div className="relative mb-4 flex items-center justify-center min-h-7">
              {!hideBack && <div className="absolute left-0">{backLink}</div>}
              <HelprMark to={null} size="md" emblemOnly />
            </div>
          ) : (
            !hideBack && align !== "center" && (
              // Hide the in-flow back button at lg+ when a brand pane is
              // rendered — the pinned top-left back button covers desktop.
              // `backInCard` overlays it in the card's top-left corner (see the
              // prop docs); otherwise it stacks above the column as before.
              <div
                className={
                  backInCard
                    ? "absolute left-3 sm:left-4 top-3 sm:top-4 z-20"
                    : `mb-2 ${desktopBrandPanel ? "lg:hidden" : ""}`
                }
              >
                {backLink}
              </div>
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
