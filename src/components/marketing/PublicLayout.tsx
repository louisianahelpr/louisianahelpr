import type { ReactNode } from "react";
import { useLocation } from "react-router-dom";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import AppShell from "@/components/AppShell";
import { authPages } from "@/components/mobileNav/mobileNavHelpers";
import { isNativePlatform } from "@/lib/nativeInit";

/**
 * PublicLayout — shared chrome for the public marketing / SEO surface
 * (landing, /jobs, /help).
 *
 * Gives every marketing page ONE consistent nav (the shared <Navbar>) and
 * ONE footer (<Footer>). The page's own content renders as {children}
 * between the nav spacer and the footer — these pages stay document-scroll
 * (`min-h-screen` / `bg-premium-page`), never AppShell.
 *
 * A shared "ready to start?" CTA band used to live above the footer, gated on
 * a `showCtaBand` prop that defaulted to false. It read as repetitive stacked
 * over the footer, so every one of the call sites either passed
 * `showCtaBand={false}` or omitted it — the band, its four copy props
 * (ctaHeadline / ctaSubcopy / ctaLabel / ctaTo) and the `/#how-it-works` link
 * inside it never rendered once. Removed 2026-08-25 rather than left as a
 * dormant second conversion surface.
 */
interface PublicLayoutProps {
  children: ReactNode;
  /**
   * Drop the spacer that clears the fixed Navbar. The landing hero is
   * designed to flow UNDER the transparent nav, so it opts out; every
   * other page keeps the spacer so content starts below the nav.
   */
  noNavSpacer?: boolean;
}

const PublicLayout = ({
  children,
  noNavSpacer = false,
}: PublicLayoutProps) => {
  const location = useLocation();

  // NATIVE (iOS/Android WebView): the marketing Navbar + Footer are web-only
  // chrome — an "App Store download" footer inside the app is nonsensical and
  // reads as a different product. On native, render the page content in the
  // canonical in-app shell (AppShell + a status-bar cap for the notch inset),
  // dropping the marketing nav, footer, CTA band, and web nav spacer. The
  // global MobileNav supplies bottom navigation on authed routes, so reserve
  // that space only when the current route carries the bottom bar. Centralised
  // here so no PublicLayout page can regress the footer onto the app surface.
  if (isNativePlatform) {
    const reserveBottomNav = authPages.some((p) => location.pathname.startsWith(p));
    const statusBarCap = (
      <div
        aria-hidden
        style={{
          paddingTop: "var(--safe-area-top, 0px)",
          background: "hsl(var(--surface-band))",
        }}
      />
    );
    return (
      <AppShell
        header={statusBarCap}
        reserveBottomNav={reserveBottomNav}
        className="bg-premium-page"
        contentClassName="bg-premium-page"
      >
        {children}
      </AppShell>
    );
  }

  return (
    // overflow-x-clip: structural guarantee for CLAUDE.md's "every page must FIT
    // THE SCREEN — no horizontal overflow" rule. Decorative ambient halos
    // (WarmHalo's `-inset-16 sm:-inset-24 lg:-inset-32`) intentionally bleed past
    // their parent, which was widening the scroll area at 375px (a marketing page
    // overflowed 42px, /subscription 4px) and dragging every `w-full` fixed
    // element out with it. `clip` not `hidden`: it does NOT create a scroll
    // container, so sticky children still stick, and the fixed Navbar/mesh keep
    // the viewport as their containing block and are not clipped.
    /* Bottom padding is dock clearance + safe area, but WITHOUT the extra
       `1rem` that Tailwind's `safe-nav` token adds. `<Footer>` is the last
       child and carries its own internal padding, so that rem was a visible
       dead band under the footer on every marketing page — 16px once
       `--bottom-nav-h` collapsed to 0 (which it does here, since the dock
       never renders on marketing routes).

       Still expressed in terms of `--bottom-nav-h` rather than hardcoded to
       zero: if a PublicLayout route ever does show the dock, the footer must
       not slide underneath it. */
    <div className="min-h-screen page-warmth pb-[calc(var(--safe-area-bottom,0px)_+_var(--bottom-nav-h,96px))] relative flex flex-col overflow-x-clip">
      {/* Global mesh behind every section — matches the landing surface. */}
      <div aria-hidden className="mesh-gradient-global" />

      {/* Interior pages (with a nav spacer) keep the Heritage Gold hairline
          from the top so the nav has a visible bottom edge against the page
          surface. The landing hero (noNavSpacer) stays transparent until
          scroll so it can float over the photo. */}
      {/* Nav renders in the SAME glass-transparent + backdrop-blur state
          on every public page (landing, membership, help,
          legal). Previously interior pages used `solid=true` which added
          a bordered olive surface — that made every non-landing page's
          top nav look different from the landing. Uniform now. */}
      <Navbar solid={false} />
      {/* Spacer clears the fixed Navbar (h-12 = 3rem + safe-area top inset)
          AND adds a comfortable breathing gap below it so a page's title/header
          doesn't crowd the nav. The min breathing room is 1.5rem (was 0.25rem,
          which read as touching); a notched device's larger safe-area inset
          wins via max(). The landing hero opts out (noNavSpacer) so it flows
          under the nav. */}
      {!noNavSpacer && (
        <div
          aria-hidden
          style={{ height: "calc(max(var(--safe-area-top, 0px), 1.5rem) + 3rem)" }}
        />
      )}

      {/* A "Back to home" link used to live here, gated on
          `!noNavSpacer && !hideHomeLink && pathname !== "/"`. It was dead:
          every one of the 8 PublicLayout call sites passes `noNavSpacer` or
          `hideHomeLink`, so the condition could never be true and the link
          has never rendered. Removed 2026-08-14 rather than left to imply a
          back affordance that does not exist. The now-unused
          `hideHomeLink` prop was removed with it. */}

      <div className="flex-1">{children}</div>

      <Footer />
    </div>
  );
};

export default PublicLayout;
