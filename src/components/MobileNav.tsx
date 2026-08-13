import { useEffect, useMemo, useState, forwardRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useReducedMotion } from "@/lib/accessibility";
import {
  Plus,
  type LucideIcon,
} from "lucide-react";
import { motion } from "framer-motion";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useActivityBadgeCounts } from "@/hooks/useActivityBadgeCounts";
import { prefetchRoute } from "@/lib/routePrefetch";
import { hapticLight, hapticMedium } from "@/lib/haptics";
import { TabButton } from "@/components/mobileNav/TabButton";
import { UserAvatar } from "@/components/UserAvatar";
import { GateSheet } from "@/components/mobileNav/GateSheet";
import { QuickActionSheet, type QuickActionTab } from "@/components/mobileNav/QuickActionSheet";
import { useNavUnreadCount } from "@/components/mobileNav/useNavUnreadCount";
import {
  leftItems,
  rightItems,
  authPages,
  noNavPages,
  tabStacks,
} from "@/components/mobileNav/mobileNavHelpers";

const MobileNav = forwardRef<HTMLElement>((_props, ref) => {
  const location = useLocation();
  const navigate = useNavigate();
  const reducedMotion = useReducedMotion();
  const { user, profile, isLoading } = useCurrentUser();
  const isGuest = !isLoading && !user;
  // A pending user can browse/apply, but /post-job stays gated until
  // review clears. Hide the Post FAB for them so they don't tap into a
  // redirect — see ProtectedRoute (the route has no `allowPending`).
  const isPendingApproval =
    !isGuest && profile?.approval_status === "pending";
  // Messages badge unread count (durable-cache seeded), its live query +
  // realtime channel + archive listener, the native app-icon badge mirror,
  // and the best-effort mark-all-read action — all owned by this hook.
  const { unreadCount, markAllRead } = useNavUnreadCount(user);
  // Lightweight "actionable activity" counts for the Posts / Jobs tab
  // badges (new applicants on your posts; pending direct offers to you).
  // Count-only queries — deliberately not the heavy useActivityData hook.
  const { postsCount, jobsCount } = useActivityBadgeCounts(user?.id);
  // Signed-out visitors get no bottom dock (below), so nothing should reserve
  // space for one. This class zeroes `--bottom-nav-h`, which feeds Tailwind's
  // `safe-nav` token — collapsing the ~112px strip on all 22 `pb-safe-nav`
  // pages at once. Toggled here because this component owns the decision to
  // render the dock at all; keeping the two in one place stops them drifting.
  // Mirrors EVERY early return below that suppresses the dock, not just the
  // guest one. This used to track `isGuest` alone, but the dock also returns
  // null on `noNavPages` and on any route outside `authPages` — which includes
  // all the marketing pages. So a SIGNED-IN visitor on "/" got no dock and
  // still paid its clearance: measured 112px of dead space under the landing
  // footer. Keep this expression in sync with the guards below; they are
  // adjacent on purpose.
  const dockHidden =
    isGuest ||
    noNavPages.some((p) => location.pathname.startsWith(p)) ||
    !authPages.some((p) => location.pathname.startsWith(p));

  useEffect(() => {
    document.documentElement.classList.toggle("no-bottom-nav", dockHidden);
    return () => document.documentElement.classList.remove("no-bottom-nav");
  }, [dockHidden]);

  const [gateOpen, setGateOpen] = useState(false);
  // Long-press quick-action sheet — one sheet, with content keyed by which
  // tab was long-pressed. Keeps the markup compact instead of one sheet per
  // tab. `null` = closed.
  const [quickActionTab, setQuickActionTab] = useState<QuickActionTab>(null);
  // Scroll-aware shadow lift — when content is actually scrolled under the
  // nav, deepen the drop shadow so the bar reads as floating above the
  // page rather than glued to the bottom edge.
  const [scrolled, setScrolled] = useState(false);
  // Hide-on-scroll: the whole bar (curtain + pill + Post FAB) slides off the
  // bottom when the user scrolls DOWN into content, and returns on scroll UP
  // or near the top — so the reading area is uncluttered but navigation is
  // one upward flick away. The Post FAB rides with the bar, so it's never
  // permanently gone; scrolling up reveals it again.
  const [navHidden, setNavHidden] = useState(false);

  useEffect(() => {
    // A fresh route always shows the bar and resets the scroll baseline.
    setNavHidden(false);
    // Reads the active scroll offset from whichever region actually scrolled.
    // Routes differ: AppShell pages scroll `.app-shell-scroll`, but several
    // pages (guest browse, Activity) roll their own `overflow-auto` flex
    // container, and document-scroll routes scroll the window. A capture-phase
    // listener (below) hands us the true scroll target, so prefer its
    // scrollTop; fall back to the AppShell container, then the window.
    const getY = (target: EventTarget | null) => {
      if (
        target instanceof HTMLElement &&
        target !== document.documentElement &&
        target !== document.body
      ) {
        return target.scrollTop;
      }
      const internal = document.querySelector<HTMLElement>(".app-shell-scroll");
      return internal && internal.scrollTop > 0 ? internal.scrollTop : window.scrollY;
    };
    let lastY = getY(null);
    const checkScroll = (e?: Event) => {
      const y = getY(e?.target ?? null);
      setScrolled(y > 8);
      const delta = y - lastY;
      // Ignore sub-threshold jitter and iOS rubber-band overscroll (y < 0),
      // which would otherwise flicker the bar during momentum scrolling.
      if (y < 0 || Math.abs(delta) < 6) {
        lastY = y;
        return;
      }
      if (y < 64) {
        setNavHidden(false); // near the top → always reveal
      } else if (delta > 0) {
        setNavHidden(true); // scrolling down → hide
      } else {
        setNavHidden(false); // scrolling up → reveal
      }
      lastY = y;
    };
    checkScroll();
    // Capture phase catches scroll from ANY nested container on the route
    // (scroll events don't bubble but do capture), so one listener covers
    // window-, AppShell-, and custom-container-scrolling pages uniformly.
    document.addEventListener("scroll", checkScroll, { capture: true, passive: true });
    return () => {
      document.removeEventListener("scroll", checkScroll, { capture: true });
    };
  }, [location.pathname]);

  // Long-press quick-action handlers. Each one closes the sheet and runs
  // the action; the action itself may navigate, fire a toast, or trigger a
  // backend mutation. Wrapped in `useMemo` so the inline lambdas (and the
  // SheetContent's onSelect handlers) don't churn identity on every parent
  // re-render — keeps the framer-motion sheet animation steady.
  //
  // Declared BEFORE the early returns below so `useMemo` is always called
  // in the same order across renders (rules-of-hooks).
  const quickActions = useMemo(() => {
    const close = () => setQuickActionTab(null);

    // Browse — open dashboard with a query param the page already parses
    // to open its filter sheet (?filters=open). If the page doesn't know
    // about that param it's a harmless no-op, so this is forward-safe.
    const browseFilters = () => {
      close();
      navigate("/dashboard?filters=open");
    };

    // Messages — best-effort mark-all-read. Closes the sheet, then defers to
    // the unread-count hook's mark-all-read (optimistic zero + rollback on
    // error). Doesn't touch individual thread state.
    const markAllReadAction = async () => {
      close();
      await markAllRead();
    };

    // Posts / Jobs — jump straight to the dedicated route for each Activity
    // tab. These must NOT go through `/activity?tab=…`: that route is a
    // `<Navigate to="/my-posts">` redirect, which drops the query string, and
    // Activity takes its tab from the `defaultTab` prop (App.tsx) rather than
    // from search params — so every `?tab=` link silently landed on My Posts.
    const goPosted = () => {
      close();
      navigate("/my-posts");
    };
    const goApplied = () => {
      close();
      navigate("/my-jobs");
    };

    return {
      browseFilters,
      markAllRead: markAllReadAction,
      goPosted,
      goApplied,
    };
  }, [navigate, markAllRead]);

  // NOTE: `dockHidden` above must stay in sync with these two guards + the
  // `isGuest` one below — it is what collapses `--bottom-nav-h` so pages
  // don't reserve clearance for a dock that never renders.
  if (noNavPages.some((p) => location.pathname.startsWith(p))) return null;
  if (!authPages.some((p) => location.pathname.startsWith(p))) return null;

  // Progressive activation: a pending user is NOT locked out of the bottom
  // nav tabs. Posts / Jobs / Messages / Profile are all `allowPending` /
  // `allowUnapproved` routes, so they navigate freely while review runs —
  // there is no `pendingLocked` branch any more. The Post FAB is the one
  // exception (`isPendingApproval` above hides it) since /post-job is still
  // gated. Verification still fires at the moments that genuinely need it
  // (accepting a job, payout) inside the page components.
  // The phone-sized website and the iOS/Android app are ALWAYS the same
  // surface: the guest "tease & convert" bottom nav renders on both. (Wide
  // desktop web hides the whole bar via CSS — `html.web-desktop
  // .mobile-nav-frame { display:none }` — so this only ever shows on a
  // phone/tablet browser or the native app, never the desktop rail.)

  // Signed-out visitors get NO bottom nav — every destination behind it needs
  // an account. This reverses the earlier "tease & convert" behaviour, where
  // guests saw the full dock with locked tabs that opened a signup sheet; the
  // dock is now a signed-in surface only. Guests are not stranded: the guest
  // browse dashboard carries its own sticky header with Log in / Get started,
  // and the marketing pages carry the Navbar.
  //
  // Everything below still branches on `isGuest` (tab remapping to
  // /browse and /login, the lock icons, GateSheet). That is unreachable now
  // rather than removed — reinstating the guest dock is a matter of deleting
  // this guard, and GateSheet is still used elsewhere.
  if (isGuest) return null;

  // Hide nav when in an active message conversation
  const params = new URLSearchParams(location.search);
  if (location.pathname === "/messages" && params.has("chat")) return null;

  const isInStack = (tabPath: string) => {
    if (location.pathname === tabPath) return true;
    const stack = tabStacks[tabPath] || [];
    return stack.some((p) => location.pathname.startsWith(p));
  };

  const triggerGate = () => {
    setGateOpen(true);
  };

  const renderItem = ({ path, icon: Icon, label, badgeKey }: { path: string; icon: LucideIcon; label: string; badgeKey?: "messages" | "posts" | "jobs" }) => {
    // Guest-mode tab remap: Home -> /browse (the read-only home dashboard
    // that mirrors the real /dashboard), Profile -> /login. Other tabs stay
    // visually present but show a lock + open the signup sheet.
    const guestLocked = isGuest && !["/dashboard", "/profile"].includes(path);
    const locked = guestLocked;
    const effectivePath = isGuest
      ? path === "/dashboard"
        ? "/browse"
        : path === "/profile"
          ? "/login"
          : path
      : path;

    const active =
      location.pathname === effectivePath ||
      (path === "/my-posts" && location.pathname === "/activity" && !new URLSearchParams(location.search).get("tab")) ||
      (path === "/my-jobs" && location.pathname === "/activity" && new URLSearchParams(location.search).get("tab") === "applied") ||
      (isGuest && path === "/dashboard" && (location.pathname === "/browse" || location.pathname === "/jobs"));

    const inStack = !isGuest && isInStack(path);
    // Guests never carry a badge (nothing to count). Each badged tab pulls
    // from its own count source: Messages → unread DMs, Posts → new
    // applicants on your jobs, Jobs → pending direct offers to you.
    const badgeCount = isGuest
      ? 0
      : badgeKey === "messages"
        ? unreadCount
        : badgeKey === "posts"
          ? postsCount
          : badgeKey === "jobs"
            ? jobsCount
            : 0;
    const showBadge = badgeCount > 0;

    const handleClick = () => {
      if (guestLocked) {
        triggerGate();
        return;
      }
      // Tab-switch haptic — only fires when the press actually moves the
      // user somewhere. Tapping the tab you're already on (a true no-op)
      // shouldn't buzz, otherwise it teaches users the haptic is decoupled
      // from navigation. `hapticLight` itself is web-safe (no-op + try/catch).
      // If we're inside this tab's stack but not on its root, pop back to root.
      if (!isGuest && inStack && location.pathname !== path) {
        hapticLight();
        navigate(path);
        return;
      }
      if (!isGuest && path === "/profile" && location.pathname === "/profile" && location.search) {
        hapticLight();
        navigate("/profile");
        return;
      }
      if (location.pathname !== effectivePath) {
        hapticLight();
        navigate(effectivePath);
        return;
      }
      if (location.search || location.hash) {
        hapticLight();
        navigate(effectivePath);
      }
    };

    // Long-press → quick-action sheet. Only the four feed/inbox tabs have an
    // action set; locked guest tabs fall through to the standard tap-handles-
    // it path. We dispatch into a single shared sheet (`quickActionTab` state)
    // and a `hapticMedium` lets the user know the long-press registered.
    const longPressableTabs: Array<typeof path> = [
      "/dashboard",
      "/my-posts",
      "/my-jobs",
      "/messages",
    ];
    const hasQuickActions = !locked && longPressableTabs.includes(path);
    const openQuickActions = () => {
      if (!hasQuickActions) return;
      hapticMedium();
      setQuickActionTab(path as typeof quickActionTab);
    };

    const isActive = active || inStack;
    return (
      <TabButton
        key={path}
        onTap={handleClick}
        onLongPress={openQuickActions}
        longPressEnabled={hasQuickActions}
        onPrefetch={() => !locked && prefetchRoute(effectivePath)}
        ariaLabel={locked ? `${label} — locked until your account is approved` : label}
        ariaCurrent={isActive ? "page" : undefined}
        className={`relative flex flex-col items-center justify-center gap-0.5 flex-1 min-h-[48px] h-full transition-[color,transform] duration-200 active:scale-[0.95] [-webkit-tap-highlight-color:transparent] select-none ${locked ? "opacity-50" : ""}`}
        style={{ color: isActive ? "hsl(var(--bark))" : "hsl(48 9% 47%)" }}
      >
        {/* Sliding active pill — single shared layoutId across all items
            so the pill animates between tabs when you switch. Sits BEHIND
            the icon + label content. Deliberately QUIET: a soft neutral-ink
            chip with no brand color and no drop shadow, so it never competes
            with the bark-green Post FAB. The Post FAB is the single loud
            focal point in the bar; the active tab is signalled by the bolder
            mid-bark icon/label + the burnt-sienna underline dot, with this
            chip just a subtle "you are here" backing. (Active was near-black
            olivewood, which read as a heavy dark blob; bark is a lighter
            recognizable brand green. Was also a bark-green glass lens with a
            layered drop shadow that rivalled the FAB — that broke hierarchy.) */}
        {isActive && (
          <motion.span
            layoutId="mobile-nav-pill"
            // Squircle, not a circle. `rounded-full` on a near-square box
            // reads as a bubble stuck behind the glyph; the app's own shape
            // language is the squircle (rounded-ds-md + .squircle), used for
            // avatars, cards and every other soft container. The selected tab
            // is the one place that was still round.
            className="absolute inset-x-2 inset-y-1 rounded-ds-md squircle pointer-events-none"
            style={{
              background: "hsl(var(--bark) / 0.07)",
              border: "0.5px solid hsl(var(--bark) / 0.08)",
              boxShadow: "inset 0 1px 1px 0 hsl(0 0% 100% / 0.45)",
            }}
            transition={reducedMotion ? { duration: 0 } : { type: "spring", stiffness: 380, damping: 32 }}
            aria-hidden
          />
        )}
        <div className="relative z-10">
          {/* Profile tab shows the signed-in user's avatar (like Instagram /
              Facebook) instead of a generic person glyph. UserAvatar falls
              back to a deterministic initials-gradient when there's no photo,
              so it's never a broken image. The active state is signalled by a
              bark-green ring (matching the active icon color) rather than the
              icon-fill treatment the other tabs use. Guests have no user, so
              they keep the plain person icon (their Profile tab routes to
              /login). */}
          {path === "/profile" && !isGuest ? (
            <UserAvatar
              userId={user?.id}
              src={profile?.avatar_url}
              name={profile?.full_name}
              pixelSize={48}
              alt=""
              className="w-[24px] h-[24px] transition-all duration-200"
              style={{
                boxShadow: isActive
                  ? "0 0 0 2px hsl(var(--bark)), 0 0 0 3.5px hsl(var(--bark) / 0.18)"
                  : "0 0 0 1.5px hsl(var(--olivewood) / 0.18)",
              }}
            />
          ) : (
            <Icon
              className="w-[22px] h-[22px] transition-all duration-200"
              strokeWidth={isActive ? 2 : 1.6}
              fill={isActive ? "currentColor" : "none"}
            />
          )}
          {/* No per-tab padlock for guests — three padlocks in a row read
              as a barrier wall on a first-time guest's home screen. The tab
              is gently dimmed (opacity-50) and a tap routes to sign-up, so
              "locked" is communicated without the cluttered lock glyphs. The
              header's prominent Get started button is the single unlock CTA. */}
          {showBadge && (
            <span
              className="absolute -top-1.5 -right-2 min-w-[16px] h-4 rounded-full text-ds-10 flex items-center justify-center font-bold px-1"
              style={{
                background: "hsl(var(--burnt-sienna))",
                color: "hsl(var(--parchment))",
              }}
            >
              {badgeCount > 9 ? "9+" : badgeCount}
            </span>
          )}
        </div>
        {/* Icon-only bar — the per-tab word label was removed deliberately:
            every destination already shows its title at the top of the page,
            so the bottom-nav word was redundant chrome. The tab's accessible
            name is preserved via TabButton's `ariaLabel`, so screen readers
            still announce "Home / Posts / Jobs / Messages / Profile". */}
        {/* Burnt-Sienna underline accent — 4px wide × 1.5px tall dot
            below the active label. Only renders for active so the
            non-active tabs stay clean. */}
        {isActive && (
          <motion.span
            layoutId="mobile-nav-underline"
            className="absolute bottom-0.5 w-6 h-[3px] rounded-full pointer-events-none"
            style={{
              background: "hsl(var(--burnt-sienna))",
              boxShadow: "0 0 6px hsl(var(--burnt-sienna) / 0.45)",
            }}
            transition={reducedMotion ? { duration: 0 } : { type: "spring", stiffness: 380, damping: 32 }}
            aria-hidden
          />
        )}
      </TabButton>
    );
  };

  const handlePostClick = () => {
    if (isGuest) {
      triggerGate();
      return;
    }
    navigate("/post-job");
  };

  return (
    <>
      <nav
        ref={ref}
        aria-label="Bottom navigation"
        aria-hidden={navHidden || undefined}
        className="mobile-nav-frame fixed bottom-0 left-0 right-0 z-50"
        style={{
          paddingBottom: "env(safe-area-inset-bottom, 0px)",
          // Slide the whole bar (incl. the upward-extending frosted curtain)
          // fully off-screen when hidden. Offset = safe-area + a margin large
          // enough to clear the curtain band (safe-area + 96 + 24px tall).
          transform: navHidden
            ? "translateY(calc(env(safe-area-inset-bottom, 0px) + 130px))"
            : "translateY(0)",
          transition: reducedMotion ? "none" : "transform 0.28s cubic-bezier(0.4, 0, 0.2, 1)",
          willChange: "transform",
        }}
      >
        {/* Frosted curtain — full-width backdrop-blur layer behind the
            nav so any content scrolling up the page softly blurs as it
            passes through this band, not just under the centered pill.
            The mask gradient fades the blur to zero at the top so the
            transition into clear content above is smooth.

            The band must be at least as tall as the page-content scroll
            clearance the fixed-shell pages reserve for the dock
            (calc(safe-area-inset-bottom + 96px) — see PageScaffold /
            Profile / Messages). If the curtain were shorter, the last
            ~28px of reserved space would sit *above* the frost, so the
            panel/cards would read as ending in a hard horizontal line
            over bare page background rather than fading continuously
            under the glass. We anchor the band's top to that same
            clearance value (measured from the bottom of the viewport,
            i.e. the bottom of this `bottom-0` nav minus its own
            safe-area padding) and stretch the mask fade across the full
            band so there is no perceptible cutoff edge. */}
        <div
          aria-hidden
          className="absolute inset-x-0 pointer-events-none"
          style={{
            // Anchor the band to the bottom of the viewport (this nav is
            // `fixed bottom-0`; its `paddingBottom` is the safe-area inset,
            // so `bottom: -safe-area` puts the curtain's lower edge at the
            // true screen bottom) and give it a fixed height that covers
            // the full dock clearance the pages reserve (safe-area + 96px)
            // plus a 24px overhang so the fade begins in clear content.
            bottom: "calc(-1 * env(safe-area-inset-bottom, 0px))",
            height: "calc(env(safe-area-inset-bottom, 0px) + 96px + 24px)",
            backdropFilter: "blur(32px) saturate(170%)",
            WebkitBackdropFilter: "blur(32px) saturate(170%)",
            // Longer fade (35% solid → transparent) so the blur ramps in
            // gradually across the band instead of snapping on partway up.
            maskImage: "linear-gradient(to top, black 35%, transparent 100%)",
            WebkitMaskImage: "linear-gradient(to top, black 35%, transparent 100%)",
            background: "linear-gradient(to top, var(--nav-curtain-top), var(--nav-curtain-fade))",
          }}
        />
        {/* mx-auto at ALL widths, not just md+. The pill is capped at max-w-lg
            (512px); on a phone that exceeds the viewport so it fills edge-to-edge
            (mx-auto is a no-op there), but between ~512px and md the old `mx-3` +
            `md:mx-auto` left the capped pill pinned LEFT with a big dead gap on
            the right (measured 140px at 664px). Centering always fixes that;
            px-3 keeps the phone edge padding that mx-3 used to provide. */}
        <div className="relative mx-auto mb-1.5 flex items-end gap-3.5 max-w-lg md:max-w-xl lg:max-w-3xl xl:max-w-4xl 2xl:max-w-5xl px-3 md:px-8 xl:px-12">
          {/* Main nav pill — liquid glass. Shadow stack switches to the
              deeper "lifted" variant when the page is scrolled, so the bar
              reads as floating above content rather than glued to the
              bottom. */}
          <div
            className="flex-1 rounded-full transition-shadow duration-300"
            style={{
              backgroundColor: "var(--nav-pill-bg)",
              backdropFilter: "blur(40px) saturate(180%)",
              WebkitBackdropFilter: "blur(40px) saturate(180%)",
              // Stronger high-contrast white edge along the top — mimics
              // the Apple Dock's "glass-catching-light" rim. Sides + bottom
              // stay softer. Rim opacities drop in dark mode via the tokens.
              borderTop: "1px solid var(--nav-rim-strong)",
              borderLeft: "1px solid var(--nav-rim-soft)",
              borderRight: "1px solid var(--nav-rim-soft)",
              borderBottom: "1px solid var(--nav-rim-bottom)",
              // Bumped to match the elevated treatment used on the Post
              // button + FAB — bright top rim, subtle inset bottom, and
              // a more pronounced multi-stop spreading drop shadow.
              // Top-of-dock soft glow lifts the bar off the page, plus
              // a big ambient drop. No hard line — all very soft, very
              // wide spreads.
              boxShadow: scrolled
                ? "inset 0 1px 1px 0 var(--nav-inset-hi), inset 0 -1px 1px 0 rgba(0, 0, 0, 0.08), 0 -10px 40px rgba(0,0,0,0.06), 0 2px 4px hsl(var(--olivewood) / 0.08), 0 22px 44px -10px hsl(var(--olivewood) / 0.20), 0 50px 90px -20px hsl(var(--olivewood) / 0.24)"
                : "inset 0 1px 1px 0 var(--nav-inset-hi), inset 0 -1px 1px 0 rgba(0, 0, 0, 0.08), 0 -10px 40px rgba(0,0,0,0.05), 0 1px 2px hsl(var(--olivewood) / 0.06), 0 18px 36px -8px hsl(var(--olivewood) / 0.16), 0 40px 72px -16px hsl(var(--olivewood) / 0.20)",
            }}
          >
            <div className="flex items-stretch h-14 px-2">
              {[...leftItems, ...rightItems].map((item) => (
                <div key={item.path} className="flex flex-1 items-stretch relative">
                  {renderItem(item)}
                </div>
              ))}
            </div>
          </div>

          {/* Post FAB — flat deep-olive (bark) puck with a soft static
              green halo plus a slow pulsing ring behind it to draw the
              eye to the primary action. Guest gating is handled by the
              gate sheet on tap, so no lock badge needed on the surface. */}
          {!isPendingApproval && (
            <div className="relative shrink-0 w-14 h-14">
              {/* Slow pulsing halo — sits behind the button so it draws the
                  eye without competing with the icon. motion-safe gates it
                  for users with reduced-motion preferences. */}
              <span
                aria-hidden
                className="absolute inset-0 rounded-full motion-safe:animate-pulse pointer-events-none"
                style={{
                  background:
                    "radial-gradient(circle, hsl(var(--bark) / 0.38) 0%, hsl(var(--bark) / 0) 72%)",
                  filter: "blur(8px)",
                  transform: "scale(1.28)",
                }}
              />
              <button
                onClick={handlePostClick}
                onMouseEnter={() => !isGuest && prefetchRoute("/post-job")}
                onFocus={() => !isGuest && prefetchRoute("/post-job")}
                aria-label={isGuest ? "Post a new job — sign up required" : "Post a new job"}
                className="group relative w-14 h-14 rounded-full flex items-center justify-center active:scale-[0.96] transition-transform duration-200"
                style={{
                  // Lit-from-top orb — a radial highlight in the upper-left
                  // fading to a deeper olive at the base gives the puck real
                  // sphere-like dimension instead of a flat disc.
                  background:
                    "radial-gradient(125% 125% at 32% 22%, hsl(var(--bark-light)) 0%, hsl(var(--bark)) 46%, hsl(var(--bark-border)) 100%)",
                  color: "hsl(var(--parchment))",
                  border: "1px solid hsl(var(--bark-border))",
                  boxShadow:
                    "inset 0 1.5px 1px 0 rgba(255, 255, 255, 0.28), " +
                    "inset 0 -2px 3px 0 hsl(66 28% 14% / 0.45), " +
                    "0 1px 2px hsl(70 20% 18% / 0.22), " +
                    "0 8px 18px -6px hsl(var(--bark) / 0.55), " +
                    "0 18px 36px -12px hsl(var(--bark) / 0.4), " +
                    "0 0 0 6px hsl(var(--bark) / 0.06), " +
                    "0 0 24px 4px hsl(var(--bark) / 0.22)",
                }}
              >
                <Plus
                  className="w-7 h-7 motion-safe:transition-transform motion-safe:duration-300 motion-safe:group-hover:rotate-90 motion-safe:group-active:rotate-180"
                  strokeWidth={2.75}
                  style={{ color: "hsl(var(--parchment))" }}
                />
              </button>
            </div>
          )}
        </div>
      </nav>

      <GateSheet open={gateOpen} onOpenChange={setGateOpen} />

      <QuickActionSheet
        quickActionTab={quickActionTab}
        onClose={() => setQuickActionTab(null)}
        quickActions={quickActions}
      />
    </>
  );
});
MobileNav.displayName = "MobileNav";

export default MobileNav;
