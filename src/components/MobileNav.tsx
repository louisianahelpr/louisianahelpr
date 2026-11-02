import { useEffect, useState, useRef, forwardRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useReducedMotion } from "@/lib/accessibility";
import {
  Plus,
  type LucideIcon,
} from "lucide-react";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useNeedsYouCounts } from "@/lib/needsYouStore";
import { prefetchRoute } from "@/lib/routePrefetch";
import { hapticLight, hapticMedium } from "@/lib/haptics";
import { TabButton } from "@/components/mobileNav/TabButton";
import { Button } from "@/components/ui/button";
import { announceTabReselect } from "@/components/mobileNav/tabReselect";
import { useNavUnreadCount } from "@/components/mobileNav/useNavUnreadCount";
import { useLongPress } from "@/hooks/useLongPress";
import { NavQuickMenuItem } from "@/components/mobileNav/NavQuickMenuItem";
import { useDockMotionLoader } from "@/components/mobileNav/useDockMotion";
import { useDockSheetsLoader } from "@/components/mobileNav/useDockSheets";
import { useRecentConversationsPreview } from "@/components/mobileNav/useRecentConversationsPreview";
import { useWarmPostedJobs } from "@/components/mobileNav/useWarmPostedJobs";
import { useWarmAvatar, useWarmTabChunks } from "@/components/mobileNav/useDockWarmups";
import { POSTED_STATUS_FILTERS } from "@/components/job-card/activityFilters";
import { useStoredSessionHint } from "@/hooks/useStoredSessionHint";
import {
  authPages,
  noNavPages,
  inTabStack,
  guestTabPath,
} from "@/components/mobileNav/mobileNavHelpers";
import { phoneDockItems, type DockItem } from "@/components/mobileNav/dockItems";
import { DockPill } from "@/components/mobileNav/DockPill";
import { conversationLink } from "@/lib/teamThread";
import { DockCurtain } from "@/components/mobileNav/DockCurtain";
import { dockRevealsAtEnd } from "@/components/mobileNav/dockAtEnd";
import { useLanguage } from "@/lib/i18n/language";
import { navKey } from "@/lib/i18n/navLabels";

const MobileNav = forwardRef<HTMLElement>((_props, ref) => {
  const { t: tr } = useLanguage(); // Spanish option (2026-10-29): the dock's words come from the dictionary.
  const location = useLocation();
  const navigate = useNavigate();
  const reducedMotion = useReducedMotion();
  const { user, profile, isLoading } = useCurrentUser();
  // While `useCurrentUser` is still resolving there is no `user` to read, and
  // this used to resolve to `!isLoading && !user` — i.e. "not a guest" for
  // EVERYONE during the auth window. That is wrong in both directions on a
  // cold start: a real guest got the full dock painted and then yanked away
  // when auth landed, and `dockHidden` below stayed false for that whole
  // window, so `no-bottom-nav` (which zeroes `--bottom-nav-h` for all 22
  // `pb-safe-nav` pages) landed 2–3s late and the ~112px strip collapsed under
  // whatever the visitor had already scrolled to.
  //
  // `hasPersistedAuthToken()` is the existing synchronous stand-in and it is
  // used here exactly as documented: `false` is trustworthy (no token → guest
  // → no dock, decided on the first frame), `true` is a maybe — and a maybe is
  // enough to paint the dock SHELL immediately instead of waiting on the
  // network, which is the whole point. `useCurrentUser` still owns the answer
  // the moment it has one; the only cost of a wrong `true` is the dock showing
  // for a beat on a stale token, which is what happened for every visitor
  // before.
  //
  // Read once, not per render (a synchronous storage hit), and once more when the
  // app's Keychain restore lands: before it, an evicted localStorage reads "no
  // token" for a signed-in person and the dock jumped in late (Q1463).
  const maybeSignedIn = useStoredSessionHint();
  const isGuest = isLoading ? !maybeSignedIn : !user;
  // Q1586(c): a saved birthday under 18 greys the Post button out; a tap says why.
  // Messages badge unread count (durable-cache seeded), its live query +
  // realtime channel + archive listener, the native app-icon badge mirror,
  // and the best-effort mark-all-read action — all owned by this hook.
  const { unreadCount } = useNavUnreadCount(user);
  // BADGE = TO-DO (owner, 2026-10-20): the Explore badge is the number of
  // to-dos on Home (one per job or order that needs you), published by the
  // lazily-mounted NeedsYouBridge. This file reads only the tiny store, never
  // the activity reads (MobileNav is a first-screen root).
  const todo = useNeedsYouCounts(user?.id);
  // THE PHONE BOTTOM BAR (owner-approved mock-up, 2026-10-20): Home,
  // Explore, the center "+", Messages, You. The four sections live in Explore
  // (their switches and Customize apply there); the "+" opens the create sheet.
  const dock = phoneDockItems();
  const [createOpen, setCreateOpen] = useState(false);
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
  //
  // An unconfirmed email gets no dock either (Q180): ProtectedRoute sends it
  // to the verify-email page from every tab, so each tab was a control that
  // bounced straight back (measured 2026-09-23 at 375: all five, /post-job
  // included, landed on the verify-email page; /signup-pending since Q193).
  const emailUnverified = !!user && !user.email_confirmed_at;
  const dockHidden =
    isGuest ||
    emailUnverified ||
    noNavPages.some((p) => location.pathname.startsWith(p)) ||
    !authPages.some((p) => location.pathname.startsWith(p));

  useEffect(() => {
    document.documentElement.classList.toggle("no-bottom-nav", dockHidden);
    return () => document.documentElement.classList.remove("no-bottom-nav");
  }, [dockHidden]);

  useWarmTabChunks(dockHidden, [...dock.left, ...dock.right].map((i) => i.path));

  useWarmPostedJobs(!dockHidden, user?.id);

  useWarmAvatar(profile?.avatar_url); // the top bar's photo, from memory on its first frame

  const [gateOpen, setGateOpen] = useState(false);

  // The tab just tapped, lit AT ONCE (AUD31-62). The router puts each
  // navigation in a React transition, so while the new tab's page chunk loads
  // `location` (and the page) stay on the old screen: the URL changed in
  // ~0.1 s but Home stayed lit for 0.8-2.6 s and nothing answered the tap.
  // This state is set in the click handler, outside the transition, so the
  // dock re-renders now; it applies only while `location.key` is still the one
  // tapped from, so the router's own answer wins the moment it commits.
  const [tapped, setTapped] = useState<{ path: string; fromKey: string } | null>(null);
  const litNow = tapped && tapped.fromKey === location.key ? tapped.path : null;
  const goTab = (path: string, to: string) => {
    setTapped({ path, fromKey: location.key });
    navigate(to);
  };

  // Long-press quick menus — Posts (status-bucket quick filters) and
  // Messages (last-3-conversations preview). At most one open at a time;
  // the string identifies which tab's menu is showing so renderItem can
  // decide whether to render its NavQuickMenu.
  const [quickMenuTab, setQuickMenuTab] = useState<"posts" | "messages" | null>(null);
  const closeQuickMenu = () => setQuickMenuTab(null);
  const dockMotion = useDockMotionLoader(dockHidden, quickMenuTab !== null);
  const dockSheets = useDockSheetsLoader(dockHidden, createOpen || gateOpen);
  // A completed long-press still ends in a `touchend`, which browsers follow
  // with a synthetic `click` a beat later — without this guard that trailing
  // click would ALSO fire the tab's normal `onTap` and navigate away right
  // as the menu opens. Set the instant a long-press fires, consumed (and
  // cleared) by the very next click on either tab — see `handleClick` below.
  const justLongPressedRef = useRef(false);
  const postsLongPress = useLongPress({
    onLongPress: () => {
      if (isGuest) return;
      justLongPressedRef.current = true;
      hapticMedium();
      setQuickMenuTab("posts");
    },
  });
  const messagesLongPress = useLongPress({
    onLongPress: () => {
      if (isGuest) return;
      justLongPressedRef.current = true;
      hapticMedium();
      setQuickMenuTab("messages");
    },
  });
  // Fetched lazily — only once the Messages quick menu is actually open —
  // see useRecentConversationsPreview for why this is safe to call
  // unconditionally every render.
  const { recent: recentConversations, isLoading: recentConversationsLoading } =
    useRecentConversationsPreview(user, quickMenuTab === "messages");
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
    //
    // The `.app-shell-scroll` lookup is resolved ONCE per route, not per event.
    // It used to run inside `getY`, i.e. on every scroll event — and on any
    // route rendering `<AppShell scrollable={false}>` (Profile, Activity,
    // Messages) that element does not exist, so every single scroll event paid
    // for a full-document querySelector that was always going to miss. Measured
    // at ~8x the cost of a hit. `null` is a valid cached answer here: we want
    // "already looked, not present", not "look again".
    let cachedShell: HTMLElement | null = null;
    let shellResolved = false;
    const shellScroller = () => {
      if (!shellResolved) {
        cachedShell = document.querySelector<HTMLElement>(".app-shell-scroll");
        shellResolved = true;
      }
      return cachedShell;
    };
    // The element whose scroll last drove the decision. Held so the observer
    // below can notice when THAT surface stops being able to scroll — see the
    // invariant note there.
    let activeScroller: HTMLElement | null = null;
    const getY = (target: EventTarget | null) => {
      if (
        target instanceof HTMLElement &&
        target !== document.documentElement &&
        target !== document.body
      ) {
        activeScroller = target;
        return target.scrollTop;
      }
      const internal = shellScroller();
      if (internal && internal.scrollTop > 0) {
        activeScroller = internal;
        return internal.scrollTop;
      }
      // Window/document scroll — no element to watch.
      activeScroller = null;
      return window.scrollY;
    };

    // INVARIANT: the dock may only stay hidden while some surface is actually
    // scrolled down. Everything else here is event-driven off `scroll`, which
    // means a surface that simply STOPS EXISTING never fires anything and the
    // dock is stranded off-screen with no gesture that can bring it back.
    //
    // Measured, not hypothesised: on Home, scroll the feed down (dock hides),
    // then tap Map view. BrowseTasksFeed sets `display:none` on the list's
    // PullToRefreshWrapper and renders the map in a sibling that never
    // scrolls — so there was no scroll surface left on the route at all, and
    // the whole bottom nav (tabs AND the Post FAB) stayed 130px below the
    // viewport until the user navigated away. The same shape applies to any
    // view swap that unmounts the scroller.
    //
    // ResizeObserver is the right tool: an observed element that becomes
    // `display:none` (or leaves the document) reports a 0x0 box, which is
    // exactly the "this surface can no longer justify a hidden dock" signal.
    // It is deliberately NOT a second copy of the hide/reveal logic — it only
    // ever REVEALS, and re-baselines `lastY` so the next real scroll event
    // measures a delta from where the surface is now rather than from a
    // position that belonged to a container that is gone. Coming BACK to a
    // scrollable view therefore leaves the dock visible instead of snapping it
    // shut on a toggle the user never scrolled.
    let observed: HTMLElement | null = null;
    const surfaceObserver =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(() => {
            const el = observed;
            if (!el) return;
            const scrollable =
              el.isConnected && el.clientHeight > 0 && el.scrollHeight - el.clientHeight > 8;
            lastY = scrollable ? el.scrollTop : 0;
            if (!scrollable) setNavHidden(false);
          });
    const syncObserver = () => {
      if (!surfaceObserver || activeScroller === observed) return;
      surfaceObserver.disconnect();
      observed = activeScroller;
      if (observed) surfaceObserver.observe(observed);
    };

    let lastY = getY(null);
    const checkScroll = (e?: Event) => {
      const y = getY(e?.target ?? null);
      syncObserver();
      setScrolled(y > 8);
      const delta = y - lastY;
      const surface = activeScroller ?? document.documentElement;
      const atEnd = dockRevealsAtEnd(surface.scrollHeight, surface.clientHeight, y); // DA-9: dockAtEnd.ts
      // Ignore sub-threshold jitter and iOS rubber-band overscroll (y < 0), which would otherwise flicker the bar
      // during momentum scrolling; never at the end, whose last step is often under 6px.
      if (!atEnd && (y < 0 || Math.abs(delta) < 6)) {
        lastY = y;
        return;
      }
      // Near the top or at the end: reveal. Otherwise scrolling down hides and scrolling up reveals.
      setNavHidden(!atEnd && y >= 64 && delta > 0);
      lastY = y;
    };
    checkScroll();
    // Capture phase catches scroll from ANY nested container on the route
    // (scroll events don't bubble but do capture), so one listener covers
    // window-, AppShell-, and custom-container-scrolling pages uniformly.
    document.addEventListener("scroll", checkScroll, { capture: true, passive: true });
    return () => {
      document.removeEventListener("scroll", checkScroll, { capture: true });
      surfaceObserver?.disconnect();
    };
  }, [location.pathname]);

  // NOTE: `dockHidden` above must stay in sync with these two guards + the
  // `isGuest` one below — it is what collapses `--bottom-nav-h` so pages
  // don't reserve clearance for a dock that never renders.
  if (noNavPages.some((p) => location.pathname.startsWith(p))) return null;
  if (!authPages.some((p) => location.pathname.startsWith(p))) return null;

  // No approval states (Q193): every tab and the Post FAB show to every
  // signed-in, email-confirmed account. Verification still fires at the
  // moments that genuinely need it (accepting a job, payout) inside the page
  // components.
  // The phone-sized website and the iOS/Android app are ALWAYS the same
  // surface: the guest "tease & convert" bottom nav renders on both. (Wide
  // desktop web hides the whole bar via CSS — `html.web-desktop
  // .mobile-nav-frame { display:none }` — so this only ever shows on a
  // phone/tablet browser or the native app, never the desktop rail.)

  // Signed-out visitors get NO bottom nav — every destination behind it needs
  // an account. This reverses the earlier "tease & convert" behaviour, where
  // guests saw the full dock with locked tabs that opened a signup sheet; the
  // dock is now a signed-in surface only. Guests are not stranded: the guest
  // browse dashboard carries its own sticky header with Log in / Join free,
  // and the marketing pages carry the Navbar.
  //
  // Everything below still branches on `isGuest` (tab remapping to
  // /browse and /login, the lock icons, GateSheet). That is unreachable now
  // rather than removed — reinstating the guest dock is a matter of deleting
  // this guard, and GateSheet is still used elsewhere.
  if (isGuest) return null;
  // Same condition as `dockHidden` above: nowhere to go until the email is
  // confirmed, and /signup-pending carries Resend + Start over itself.
  if (emailUnverified) return null;

  // Hide nav when in an active message conversation — an open thread replaces
  // the app chrome with its own header, iOS-style, and the way out is that
  // header's back button.
  //
  // This is a HARD dependency on `?chat=` meaning "a thread is really open".
  // The flag lives in the URL while the thread lives in Messages' component
  // state, and when the two desynced (a remount, a native resume restoring
  // `/messages?chat=1` from RouteMemory) this hid the dock over the INBOX —
  // no nav, no back button, no way out of Messages at all. The invariant is
  // enforced in src/pages/messages/Messages.tsx; see the contract on chatOpenPath in
  // src/pages/messages/constants.ts before changing either side of it.
  const params = new URLSearchParams(location.search);
  if (location.pathname === "/messages" && params.has("chat")) return null;

  const isInStack = (tabPath: string) => inTabStack(tabPath, location.pathname, user?.id);

  const triggerGate = () => {
    setGateOpen(true);
  };

  const renderItem = ({ path, icon: Icon, label, badgeKey }: { path: string; icon: LucideIcon; label: string; badgeKey?: DockItem["badgeKey"] }) => {
    // Guest-mode tab remap: Home -> /browse (the read-only home dashboard
    // that mirrors the real /home), Profile -> /login. Other tabs stay
    // visually present but show a lock + open the signup sheet.
    const shownKey = navKey(path, label);
    const shown = shownKey ? tr(shownKey) : label;
    const guestLocked = isGuest && !["/home", "/profile"].includes(path);
    const locked = guestLocked;
    const effectivePath = isGuest ? guestTabPath(path) : path;

    // /browse is Home for everyone (signed-in users redirect to /home; guest-only lit it late: media 2→4).
    const active =
      location.pathname === effectivePath || (path === "/home" && location.pathname === "/browse");

    const inStack = !isGuest && isInStack(path);
    // Guests never carry a badge (nothing to count). Messages → unread
    // chats; Explore → the To-do count (the same list Home shows).
    const badgeCount = isGuest
      ? 0
      : badgeKey === "messages"
        ? unreadCount
        : badgeKey === "todo"
          ? todo.total
          : badgeKey === "todoJobs"
            ? todo.jobs
            : badgeKey === "todoShops"
              ? todo.shops
              : badgeKey === "todoDeclutter"
                ? todo.declutter
                : 0;
    const showBadge = badgeCount > 0;

    const handleClick = () => {
      // Swallow the trailing click a completed long-press's touchend
      // produces — see the comment on `justLongPressedRef` above.
      if ((path === "/posts" || path === "/messages") && justLongPressedRef.current) {
        justLongPressedRef.current = false;
        return;
      }
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
        goTab(path, path);
        return;
      }
      if (!isGuest && path === "/profile" && location.pathname === "/profile" && location.search) {
        hapticLight();
        navigate("/profile");
        return;
      }
      if (location.pathname !== effectivePath) {
        hapticLight();
        goTab(path, effectivePath);
        return;
      }
      announceTabReselect(path); // a re-tap of this tab: screens that reset on it listen (Home folds To do up)
      if (location.search || location.hash) {
        hapticLight();
        navigate(effectivePath);
      }
    };

    // A section tab is lit anywhere inside its section; the one Jobs & Posts
    // tab is lit on both lists.
    // A tab tapped a moment ago is the lit one until the router catches up.
    const isActive = litNow ? litNow === path : active || inStack;
    // Long-press quick menus only wire up for Posts and Messages, and only
    // for a real signed-in account — guests never navigate has-status
    // filters or conversations. handleClick above already double-checks
    // `isGuest`, so this is belt-and-braces, not the only guard.
    const longPress =
      !locked && path === "/posts"
        ? postsLongPress
        : !locked && path === "/messages"
          ? messagesLongPress
          : undefined;
    return (
      <>
      <TabButton
        key={path}
        onTap={handleClick}
        onPrefetch={() => !locked && prefetchRoute(effectivePath)}
        ariaLabel={locked ? `${shown} — locked until your account is approved` : shown}
        ariaCurrent={isActive ? "page" : undefined}
        className={`relative flex flex-col items-center justify-center gap-0.5 flex-1 min-h-[48px] h-full transition-[color,transform] duration-200 active:scale-[0.95] [-webkit-tap-highlight-color:transparent] select-none ${locked ? "opacity-50" : ""}`}
        style={{ color: isActive ? "hsl(var(--bark))" : "hsl(var(--muted-foreground))" }}
        longPress={longPress}
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
          <DockPill
            layoutId="mobile-nav-pill"
            // ROUND, deliberately — reversing the squircle note that used to
            // live here. That note argued `rounded-full` on a near-square box
            // "reads as a bubble stuck behind the glyph" and that the app's
            // shape language is the squircle. On device the owner read the
            // result the other way round: "the selected button on home needs a
            // more circular fill so it fills the space to the left" — the
            // squircle's flat sides left a visible band of dead dock either
            // side of the chip, most obvious on Home because it is the FIRST
            // tab and that band sits against the dock's own rounded end.
            //
            // So the geometry goes the other way: `rounded-full` on a slot that
            // is ~54×56 renders as a circle, and the insets shrink from 4px/2px
            // to 2px/2px so the circle actually occupies its slot. Paired with
            // the container's px-2 → px-1.5 below, the gap between the dock's
            // inner edge and the Home chip goes 12px → 8px.
            //
            // Only the GEOMETRY changed. The fill stays at bark/0.07 on
            // purpose: the Post FAB is the single loud focal point in this bar,
            // and making this chip louder to make it bigger would trade one
            // problem for the hierarchy problem a previous pass already fixed.
            className="absolute inset-x-0.5 inset-y-0.5 rounded-full pointer-events-none"
            style={{
              background: "hsl(var(--bark) / 0.07)",
              border: "0.5px solid hsl(var(--bark) / 0.08)",
              boxShadow: "inset 0 1px 1px 0 hsl(0 0% 100% / 0.45)",
            }}
            transition={reducedMotion ? { duration: 0 } : { type: "spring", stiffness: 380, damping: 32 }}
          />
        )}
        <div className="relative z-10">
          {/* "You" is a PERSON ICON, filled when active, like every other tab
              (lead review 2026-10-20, boards 7/18/19): the top bar already shows
              the member's photo, so a second avatar here was a duplicate. */}
          <Icon
            className="w-[22px] h-[22px] transition-all duration-200"
            strokeWidth={isActive ? (path === "/explore" ? 2.4 : 2) : 1.6}
            // A filled Compass is a solid disc with no needle (looked, 2026-10-20): Explore goes bold, not filled.
            fill={isActive && path !== "/explore" ? "currentColor" : "none"}
          />
          {/* No per-tab padlock for guests — three padlocks in a row read
              as a barrier wall on a first-time guest's home screen. The tab
              is gently dimmed (opacity-50) and a tap routes to sign-up, so
              "locked" is communicated without the cluttered lock glyphs. The
              header's prominent Join free button is the single unlock CTA. */}
          {showBadge && (
            <span
              data-dock-badge={path}
              className="absolute -top-1.5 -right-2 min-w-[16px] h-4 rounded-full text-ds-10 flex items-center justify-center font-bold px-1"
              style={{
                // Count badges are --alert, never rust (rust is money only; spec v2 §1.1).
                background: "hsl(var(--alert))",
                color: "#fff",
              }}
            >
              {badgeCount > 9 ? "9+" : badgeCount}
            </span>
          )}
        </div>
        {/* One-word label under each icon (owner, 2026-10-19): ONE line, never cut, 10px at 320, 11px from 360; no clip,
            so a wide word spills into the slot gap. Guards: dockLabelsOneLine + nav-hide-on-scroll.spec.ts "dock labels". */}
        <span data-dock-label className={`relative z-10 block whitespace-nowrap text-ds-10 min-[360px]:text-ds-11 leading-[13px] tracking-[-0.01em] ${isActive ? "font-bold" : "font-medium"}`}>
          {shown}
        </span>
        {/* No underline: the active tab is its filled icon + bold olive label (spec v2 §3;
            the rust underline broke "rust is money only", lead review 2026-10-20). */}
      </TabButton>
      {path === "/posts" && dockMotion && (
        <dockMotion.NavQuickMenu open={quickMenuTab === "posts"} onClose={closeQuickMenu} title="Quick filter">
          {POSTED_STATUS_FILTERS.map((f) => (
            <NavQuickMenuItem
              key={f.key}
              label={f.label}
              onSelect={() => {
                closeQuickMenu();
                hapticLight();
                navigate(`/posts?filter=${f.key}`);
              }}
            />
          ))}
        </dockMotion.NavQuickMenu>
      )}
      {path === "/messages" && dockMotion && (
        <dockMotion.NavQuickMenu open={quickMenuTab === "messages"} onClose={closeQuickMenu} title="Recent chats">
          {recentConversationsLoading && recentConversations.length === 0 ? (
            <p className="px-3.5 py-2 text-ds-12" style={{ color: "hsl(var(--muted-foreground))" }}>
              Loading…
            </p>
          ) : recentConversations.length === 0 ? (
            <p className="px-3.5 py-2 text-ds-12" style={{ color: "hsl(var(--muted-foreground))" }}>
              No conversations yet
            </p>
          ) : (
            recentConversations.map((c) => (
              <NavQuickMenuItem
                key={`${c.jobId}_${c.otherUserId}`}
                label={c.otherUserName}
                sub={c.lastMessage || c.jobTitle}
                onSelect={() => {
                  closeQuickMenu();
                  hapticLight();
                  // Q262 and team threads: see conversationLink.
                  navigate(conversationLink(c));
                }}
              />
            ))
          )}
        </dockMotion.NavQuickMenu>
      )}
      </>
    );
  };


  return (
    <>
      <nav
        ref={ref}
        aria-label={tr("nav.bottom")}
        aria-hidden={navHidden || undefined}
        // `aria-hidden` alone on a bar full of buttons is an
        // aria-hidden-focus failure, not an accommodation: the dock is
        // translated 130px BELOW the viewport but its five tabs and the Post
        // FAB stay in the tab order, so a keyboard or switch user tabs into
        // controls that are announced to nobody and painted nowhere. `inert`
        // takes them out of the tab order (and out of hit-testing) for exactly
        // as long as the bar is off-screen.
        //
        // Spread rather than written as a prop: React 18's JSX types have no
        // `inert` (it landed as a first-class boolean prop in React 19), and
        // passing `inert={true}` on 18 logs a non-boolean-attribute warning.
        // The empty string is the attribute's own "present" form.
        {...(navHidden ? { inert: "" } : {})}
        className="mobile-nav-frame fixed bottom-0 left-0 right-0 z-50"
        style={{
          paddingBottom: "var(--safe-area-bottom, 0px)",
          // Slide the whole bar (incl. the upward-extending frosted curtain)
          // fully off-screen when hidden. Offset = safe-area + a margin large
          // enough to clear the curtain band (safe-area + 96 + 24px tall).
          transform: navHidden
            ? "translateY(calc(var(--safe-area-bottom, 0px) + 130px))"
            : "translateY(0)",
          transition: reducedMotion ? "none" : "transform 0.28s cubic-bezier(0.4, 0, 0.2, 1)",
          willChange: "transform",
        }}
      >
        <DockCurtain />
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
            {/* px-1.5, not px-2 — the last 2px of "fills the space to the left".
                The active chip is inset 2px inside its own tab, so with 8px of
                container padding the Home chip sat 10px in from the dock's inner
                edge; at 6px it sits 8px in. Height is untouched (h-14). */}
            <div className="flex items-stretch h-14 px-1.5">
              {dock.left.map((item) => (
                <div key={item.path} className="flex flex-1 items-stretch relative">
                  {renderItem(item)}
                </div>
              ))}
              {/* The center "+" (owner-approved mock-up, 2026-10-20): one raised
                  olive disc that opens "What are we doing?". The only loud
                  thing in the bar; it turns into an X while the sheet is open. */}
              <div className="flex flex-1 items-start justify-center relative">
                <Button
                  type="button" variant="primary" size="iconLarge"
                  data-testid="dock-create"
                  aria-label={tr("nav.create")}
                  aria-haspopup="dialog" aria-expanded={createOpen}
                  onClick={() => {
                    hapticMedium();
                    setCreateOpen((o) => !o);
                  }}
                  // HELPR-DESIGN-SPEC §3: a 60px disc raised half above the bar, in a 4px ring of the page's own ground.
                  className="btn-press absolute -top-[30px] [-webkit-tap-highlight-color:transparent]"
                  style={{
                    color: "hsl(var(--primary-foreground))",
                    boxShadow: "0 0 0 4px hsl(var(--background)), 0 4px 18px rgba(32, 30, 26, 0.12)",
                  }}
                >
                  <Plus
                    className="transition-transform duration-200"
                    strokeWidth={2.25}
                    aria-hidden
                    style={{ transform: createOpen ? "rotate(45deg)" : undefined }}
                  />
                </Button>
              </div>
              {dock.right.map((item) => (
                <div key={item.path} className="flex flex-1 items-stretch relative">
                  {renderItem(item)}
                </div>
              ))}
            </div>
          </div>

        </div>
      </nav>

      {dockSheets && <><dockSheets.GateSheet open={gateOpen} onOpenChange={setGateOpen} /><dockSheets.CreateSheet open={createOpen} onOpenChange={setCreateOpen} /></>}
    </>
  );
});
MobileNav.displayName = "MobileNav";

export default MobileNav;
