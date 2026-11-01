import {
  Home,
  Briefcase,
  MessageSquare,
  UserRound,
  ClipboardList,
  Sofa,
  Store,
  KeyRound,
  Compass,
} from "lucide-react";
import { safeStorage } from "@/lib/safeStorage";

/**
 * Durable cache key for the Messages badge count. We mirror the last-known
 * count to localStorage (+ Capacitor Preferences via safeStorage's `helpr_`
 * prefix) so the badge doesn't flicker to 0 on a cold start with no network.
 * The number is re-validated as soon as the live query lands, but the
 * cached value is what paints on the FIRST frame.
 *
 * ONE PER ACCOUNT: the key is "<base>:<userId>". A global key painted one
 * account's unread count on the next account to sign in on the device until
 * a live read succeeded (owner report 2026-10-01; guarded by
 * src/test/countCachesArePerUser.test.tsx).
 */
const UNREAD_CACHE_KEY = "helpr_nav_unread_count";

/** Read this user's cached unread count; 0 with no user or a missing/malformed
 *  value. Also drops the pre-2026-10-01 global key (best-effort). */
export function readCachedUnread(userId?: string | null): number {
  try {
    if (safeStorage.getItem(UNREAD_CACHE_KEY) !== null) safeStorage.removeItem(UNREAD_CACHE_KEY);
  } catch {
    /* best-effort */
  }
  if (!userId) return 0;
  try {
    const raw = safeStorage.getItem(`${UNREAD_CACHE_KEY}:${userId}`);
    if (!raw) return 0;
    const n = Number.parseInt(raw, 10);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  } catch {
    return 0;
  }
}

export function writeCachedUnread(userId: string, n: number) {
  try {
    safeStorage.setItem(`${UNREAD_CACHE_KEY}:${userId}`, String(Math.max(0, n)));
  } catch {
    /* best-effort */
  }
}

/** A guest's dock tab: Home opens /browse (the read-only home), Profile opens /login; the rest keep their path. */
export function guestTabPath(path: string): string {
  return path === "/home" ? "/browse" : path === "/profile" ? "/login" : path;
}

export const leftItems = [
  { path: "/home", icon: Home, label: "Home" },
  { path: "/posts", icon: ClipboardList, label: "Posts" },
];

export const rightItems = [
  { path: "/jobs", icon: Briefcase, label: "Jobs" },
  { path: "/messages", icon: MessageSquare, label: "Messages", badgeKey: "messages" as const },
  { path: "/profile", icon: UserRound, label: "Profile" },
];

/**
 * The section tabs (owner, 2026-10-18, option 1A): Declutter, Shops and Homes
 * (the 'rentals' switch; the nav says Homes) sit in the dock beside Home and
 * one Jobs & Posts tab. Each shows only while its feature switch is on for the
 * viewer. The rail uses the same three, in the same order and icons.
 */
export const sectionItems = [
  { path: "/declutter", icon: Sofa, label: "Declutter", feature: "declutter" as const },
  { path: "/shops", icon: Store, label: "Shops", feature: "shops" as const },
  { path: "/rentals", icon: KeyRound, label: "Homes", feature: "rentals" as const },
];

/**
 * THE PHONE BOTTOM BAR (owner-approved mock-up, 2026-10-20): Home, Explore,
 * the center "+", Messages, You. Explore holds the four sections (its badge is
 * the To-do count: every job or order that needs you, one each, the same list
 * as Home's Next up; owner 2026-10-20); You is Profile, with the member's photo. Guard: src/test/centerCreateNav.test.tsx.
 */
export const exploreItem = { path: "/explore", icon: Compass, label: "Explore", badgeKey: "todo" as const };
export const youItem = { path: "/profile", icon: UserRound, label: "You" };

/** The nav's own icon for a page: an empty page wears it (owner, 2026-10-08, Q1558). */
export function navIconFor(path: "/home" | "/posts" | "/jobs" | "/messages") {
  return [...leftItems, ...rightItems].find((i) => i.path === path)!.icon;
}

export const authPages = ["/home", "/explore", "/posts", "/jobs", "/post-job", "/profile", "/messages", "/support", "/user", "/jobs/", "/browse",
  // Declutter (hidden switch): the dock stays on its screens.
  "/declutter",
  // Quotes on jobs (hidden switch 'quotes'): the same.
  "/quotes",
  "/tips",
  // Shops (hidden switch): the same.
  "/shops",
  // One search across the sections (board 89).
  "/search",
  // Rentals (hidden switch 'rentals'): it had the desktop rail but no dock at
  // 375 (measured 2026-10-15, local build); guard: src/test/dualSurfaceRoutesGetAppChrome.test.ts
  // (every App.tsx route with the rail has the dock).
  "/rentals",
  // Standalone settings sub-pages keep the bottom tab bar so they share the
  // same chrome as the Profile-tab settings (Notifications, Earnings, etc.).
  // "/benefits" left this list 2026-08-31 with the page itself — the route is
  // gone, so listing it would only give the 404 screen a bottom dock.
  // "/pets" left this list 2026-09-02 with its route — it is now the Profile
  // `?tab=pets` tab, and /profile is already covered above. A stale entry here
  // would only give the 404 screen a bottom dock, exactly as the note about
  // "/benefits" above says.
  "/help",
  "/sms-opt-in", // same PublicLayout page as /help (Twilio A2P review, 2026-10-23)
  // /auto-tip ("After a Job") was the ONE settings sub-page on that list of
  // siblings that never reached this one — measured 2026-08-31 at 320/375/768:
  // no bottom dock rendered at all, on a screen whose only other way out is the
  // back chevron. It is already in `AUTH_PREFIXES` (desktopNavRoutes.ts), so
  // the same screen HAD the desktop rail at 1440 and no nav on a phone — the
  // exact asymmetry that list's own comment was added to close for /wrapped.
  // /legal joins /help here (owner, 2026-08-30: "there should be a public and
  // signed in version of help and legal"). Both are reachable from the
  // marketing footer AND from inside the app (Profile → Legal & Policies), and
  // PublicLayout now picks its chrome by AUTH rather than by platform — so a
  // signed-in visitor gets the app shell on both. Without /legal in this list
  // it got the shell but none of the app's own navigation, stranding the user
  // on a page with no way back into the app except the browser's Back button.
  "/legal",
  // The town + service pages (OPS-4, /hire/<service>/<town>): PublicHeaderPage, so signed in they need the dock.
  "/hire/",
  // /terms, /privacy and /rules are the same Legal page on its other three
  // routes (Q179): signed in they had no dock at all. Guard:
  // src/test/dualSurfaceRoutesGetAppChrome.test.ts.
  "/terms", "/privacy", "/rules"  // The six standalone settings sub-pages that used to be listed here left
  // with their routes on 2026-09-02 — they are Profile tabs now
  // (?tab=work_record, home_history, str_settings, auto_tip, wrapped,
  // analytics), and "/profile" above already covers every one of them.
  // These entries are PREFIX matches against a pathname, so a
  // "/profile?tab=x" entry would never match anything and an entry for a
  // deleted path would only dress the 404 screen in signed-in chrome —
  // the "/benefits" lesson recorded above.
];

// /admin is a distinct console shell (its own full-height layout, header,
// back button, and logout) — the consumer Posts/Jobs/Messages/Profile bar
// doesn't belong there, so it's a no-nav page, not an auth tab route.
// "/post-job": a flow, start to pay, so no dock and no "+" over it (owner 2026-10-21); the page's own
// back arrow is the way out. The desktop rail is a separate surface (desktopNavRoutes.ts) and stays.
export const noNavPages = ["/login", "/signup", "/signup-pending", "/forgot-password", "/reset-password", "/admin", "/post-job", "/declutter/sell"];

// Map each tab root to sub-routes that belong to its stack.
// Tapping the tab while inside one of these returns the user to the tab root.
const tabStacks: Record<string, string[]> = {
  // /jobs/<id> and /jobs/settings belong to Jobs since the feed moved to Jobs > Browse (2026-10-19); they lit Home.
  "/home": [],
  // NOTE: /post-job is deliberately NOT in this stack. Posting is reached from
  // the floating "+" FAB, not from the Posts tab, so lighting Posts up while
  // the user is mid-post claimed they were somewhere they hadn't navigated to —
  // and it competed with the FAB, which is the control they actually pressed.
  // The tab highlights for the Posts LIST only.
  "/posts": [],
  "/jobs": ["/jobs/"],
  "/messages": [],
  // Every section lives under Explore (2026-10-20), so Explore is lit inside any of them.
  "/explore": ["/jobs", "/posts", "/declutter", "/shops", "/rentals", "/quotes"],
  "/profile": ["/support", "/user", "/admin"],
};

/** Is `pathname` inside the tab `tabPath`'s stack? Someone ELSE's /user/<id> is
 *  not "You" (audit #58, 2026-10-21): it lights You only as your own preview. */
export function inTabStack(tabPath: string, pathname: string, userId: string | null | undefined): boolean {
  if (pathname === tabPath) return true;
  if (tabPath === "/profile" && pathname.startsWith("/user/")) return !!userId && pathname.startsWith(`/user/${userId}`);
  return (tabStacks[tabPath] || []).some((p) => pathname.startsWith(p));
}
