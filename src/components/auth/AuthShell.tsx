import { Link } from "react-router-dom";
import { isNativePlatform } from "@/lib/nativeInit";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { ReactNode } from "react";
import HelprMark from "@/components/HelprMark";
import BackButton from "@/components/BackButton";

interface AuthShellProps {
  /**
   * Drop the marketing Navbar + Footer on the WEB (native is always
   * chrome-less regardless of this prop). Off by default — every AuthShell
   * screen keeps the public site's nav/footer, deliberately, so a visitor who
   * lands mid-flow from search or a shared link isn't stuck with no way out.
   *
   * Login and Signup opt OUT of that (owner, 2026-08-23): those two are
   * reached by clicking "Log In" / "Get Started" FROM the site, not landed
   * on cold, so the exit-hatch argument doesn't apply the same way, and a
   * focused credential/create-account flow reads better without a nav bar
   * competing for attention above the form.
   *
   * ForgotPassword and ResetPassword joined them (owner, 2026-08-24, audit
   * V4). Both are reached from INSIDE the funnel — /login's "Forgot Password?"
   * link, or a link in the reset email — so the same reasoning holds, and the
   * split was the more visible problem: half the auth flow wore marketing
   * chrome and half didn't. The back chevron in the title row is the exit
   * hatch on all four. */
  noWebChrome?: boolean;
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
  /** Vertical placement of the content column within the viewport.
      "top" (default) anchors the card just under the safe area. "center"
      restores the old `justify-center` behaviour for a caller that wants it.

      Top is the default because centring is what produced the complaint that
      started this: on a 402x874 phone the Password-reset card sat with ~330pt
      of blank canvas above it and ~290pt below, and Sign in with ~200pt above.
      A card the user is about to read or type into should start where their
      eye starts, and every one of these screens is short enough that centring
      only ever moved it further from the top. Owner decision 2026-08-22, applied
      to all ten AuthShell screens. */
  anchor?: "center" | "top";
  /** Page title. When set, AuthShell renders the ONE canonical
      `[back] [title]` row above the card — chevron first in a `shrink-0`
      wrapper, heading to its RIGHT on the SAME row in a `flex-1 min-w-0`
      column. This is the pattern CLAUDE.md mandates globally (see
      PageHeader.tsx) and it now lives in one place instead of being
      hand-copied per page, which is how it drifted: Login rendered the row
      ABOVE the card while ForgotPassword rendered a near-identical one INSIDE
      it, at a larger font, under a comment claiming the two matched.

      `hideBack` still applies — a status screen (banned/denied/pending) gets
      the title with no chevron rather than a back route it must not offer. */
  title?: ReactNode;
  /** Click handler for the title row's back control, INSTEAD of a route.
      Signup's step-2 arrow walks the wizard back a step rather than leaving
      the page — exiting from step 2 would silently discard the email and
      password already typed. Without this the row could only host a
      route-back, which is why that one arrow stayed hand-rolled inside the
      card (at a different font size) after every other screen adopted the row. */
  backOnClick?: () => void;
}

const widthMap = {
  sm: "max-w-sm",
  md: "max-w-md",
  // On desktop, widen the form column beyond the phone-first max-w-lg so
  // the card visually anchors the page instead of floating in a narrow
  // strip on 1440+ viewports (matches the "wider centered card" audit
  // direction the user picked for the ambient-bg auth pages).
  lg: "max-w-md sm:max-w-lg lg:max-w-xl",
  // Widest rung — `page-measure`, the SAME measure every public page uses
  // (owner). It used to cap at max-w-5xl, so an auth screen sat in a 1024px
  // column while the nav directly above it ran to the window edge: the page's
  // own header and its content did not share an edge. No cap now; the column
  // runs to the wrapper's horizontal padding, exactly like /jobs and /legal.
  "2xl": "page-measure",
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
  anchor = "top",
  title,
  backOnClick,
  noWebChrome = false,
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
  const backLink = <BackButton to={backTo} onClick={backOnClick} />;

  // WEB: auth screens carry the same top nav and footer as every other public
  // page (owner). They are landing pages in their own right — reached from
  // search, from a shared link, from the App Store listing — and a page with no
  // way out of it is a dead end, not a focused flow.
  //
  // NATIVE is untouched: inside the app this is already a screen within the
  // shell, and a marketing footer offering an App Store download would be
  // nonsense there. Same split PublicLayout makes.
  const withWebChrome = (content: React.ReactNode) =>
    isNativePlatform || noWebChrome ? content : (
      <>
        <Navbar solid={false} />
        {/* Spacer clears the FIXED navbar. Without it the nav sat directly on
            top of the [back] [title] row — the title was in the DOM at y=31
            with a 56px fixed bar over it, so the page simply looked like it had
            lost its heading. Same height calc PublicLayout uses, so auth pages
            start at exactly the same offset as every other public page. */}
        <div
          aria-hidden
          style={{ height: "calc(max(var(--safe-area-top, 0px), 1.5rem) + 3rem)" }}
        />
        {content}
        <Footer />
      </>
    );

  return withWebChrome(
    <div className="min-h-screen bg-premium-page relative overflow-hidden">
      {/* Ambient brand-wash decoration — desktop-only, sits behind the
          auth column. Two soft radial gradients in the brand palette
          (olivewood + burnt-sienna) fill the empty gutters on wide
          viewports so the page reads as intentional atmosphere rather
          than blank whitespace. Kept `pointer-events-none` + `aria-hidden`
          so it never intercepts input or announces to screen readers. */}
      {/* Ambient wash is NOT tied to the brand pane. It was gated behind
          `desktopBrandPanel &&`, so dropping that pane from Login/Signup also
          killed the page atmosphere and left a white card on a near-white
          field — exactly the "blank whitespace" this was written to prevent.
          Same coupling bug as `centerColumn`. */}
      {(desktopBrandPanel || centerColumn) && (
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
        <div className="absolute left-5 sm:left-8 top-[calc(var(--safe-area-top,0px)_+_24px)] sm:top-12 z-20">
          {backLink}
        </div>
      )}
      {/* Desktop-brand-hero variant: pin the back button top-LEFT so it
          sits above the horizontal brand band rather than in the form
          column. Mobile keeps the in-flow back button inside the form
          column, unchanged.

          `!title` — same guard the standalone in-flow arrow below carries, and
          for the same reason. Without it a caller passing BOTH a brand pane and
          a title got two chevrons at lg+: this pinned one AND the canonical
          row's. That is exactly what /forgot-password shipped (audit V4). The
          row is the single owner of the back control whenever a title exists,
          on every branch — not just the one that happened to be guarded. */}
      {desktopBrandPanel && align !== "center" && !hideBack && !title && (
        <div className="hidden lg:block absolute left-8 top-8 z-20">
          {backLink}
        </div>
      )}
      <div className={`relative z-10 flex flex-col ${centered ? "items-center" : alignClass} ${anchor === "top" ? "justify-start" : `${centered ? "lg:justify-center" : ""} justify-center`} min-h-screen px-5 sm:px-8 lg:px-12 ${align === "center" ? "pb-[30vh] sm:pb-[26vh]" : "pb-10 sm:pb-8 lg:pb-6"} ${compactHeader ? "pt-[calc(var(--safe-area-top,0px)_+_10px)] sm:pt-10" : "pt-[calc(var(--safe-area-top,0px)_+_24px)] sm:pt-8 lg:pt-6"}`}>
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
            // `!title`: when a title is set the canonical row below owns the
            // chevron, so this standalone one would render a SECOND back
            // arrow stacked above it — the exact duplicated-chrome defect the
            // row exists to remove.
            !hideBack && !title && align !== "center" && (
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

          {/* THE canonical [back] [title] row. Chevron in a shrink-0 wrapper
              as the FIRST child, heading to its RIGHT on the SAME row in a
              flex-1 min-w-0 column, so the arrow reads as a lead-in to the
              words rather than floating above an untitled card
              (CLAUDE.md / PageHeader.tsx). Rendered ABOVE the card: the row is
              page-level chrome, not a control belonging to the glass.

              `hideBack` yields the title alone — AccountBanned / AccountDenied
              / AccountPending / PaymentSuccess / CompleteProfile deliberately
              offer no way back, and a chevron there would be a dead end. */}
          {title && (
            <div className="flex items-center gap-2 mb-4">
              {!hideBack && <div className="shrink-0">{backLink}</div>}
              <h1
                className="flex-1 min-w-0 font-display italic font-bold text-ds-24 leading-tight truncate"
                style={{ color: "hsl(var(--ink-deep))", letterSpacing: "-0.02em" }}
              >
                {title}
              </h1>
            </div>
          )}

          {showFullHeader && (
            <div className="text-center mb-7">
              <Link to="/" className="inline-flex items-baseline gap-1">
                <span
                  className="font-display italic font-bold leading-none text-ds-32"
                  style={{
                    color: "hsl(var(--olivewood))",
                    letterSpacing: "-0.02em",
                  }}
                >
                  Helpr
                </span>
                <span
                  className="font-display italic font-bold leading-none text-ds-22"
                  style={{
                    // --accent-ink, matching HelprMark's own "· LA" — see the
                    // comment there. Byte-identical in light, lifted in dark,
                    // where raw --burnt-sienna measures 3.84:1 at this size.
                    color: "hsl(var(--accent-ink))",
                    letterSpacing: "0.22em",
                    marginLeft: "0.12em",
                  }}
                >
                  · LA
                </span>
              </Link>
              {/* --accent-ink at 0.9, not --burnt-sienna at 0.7. This 11px
                  line is the eyebrow every auth screen puts above its
                  heading, and on /payment-success it carries "Payment not
                  confirmed" — the one sentence telling a paying customer
                  something went wrong, and it measured the WORST contrast on
                  that screen: 3.33:1 light, 3.01:1 dark, against the 4.5:1
                  small text needs. --accent-ink is byte-identical to
                  --burnt-sienna in light mode and lifted in dark; 0.9 is the
                  same alpha the "or" divider below uses, for the same reason.
                  Now 4.97:1 light / 6.16:1 dark. */}
              <p
                className="mt-2 text-ds-11 tracking-[0.18em] uppercase font-serif italic"
                style={{ color: "hsl(var(--accent-ink) / 0.9)" }}
              >
                {eyebrow}
              </p>
            </div>
          )}

          {children}
        </div>
      </div>
    </div>,
  );
};

export default AuthShell;
