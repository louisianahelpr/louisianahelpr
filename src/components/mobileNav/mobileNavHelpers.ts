import {
  Home,
  Briefcase,
  MessageSquare,
  UserRound,
  ClipboardList,
} from "lucide-react";
import { safeStorage } from "@/lib/safeStorage";

/**
 * Durable cache key for the Messages badge count. We mirror the last-known
 * count to localStorage (+ Capacitor Preferences via safeStorage's `helpr_`
 * prefix) so the badge doesn't flicker to 0 on a cold start with no network.
 * The number is re-validated as soon as the live query lands, but the
 * cached value is what paints on the FIRST frame.
 */
export const UNREAD_CACHE_KEY = "helpr_nav_unread_count";

/** Read the cached unread count, defaulting to 0 if missing/malformed. */
export function readCachedUnread(): number {
  try {
    const raw = safeStorage.getItem(UNREAD_CACHE_KEY);
    if (!raw) return 0;
    const n = Number.parseInt(raw, 10);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  } catch {
    return 0;
  }
}

export function writeCachedUnread(n: number) {
  try {
    safeStorage.setItem(UNREAD_CACHE_KEY, String(Math.max(0, n)));
  } catch {
    /* best-effort */
  }
}

export const leftItems = [
  { path: "/dashboard", icon: Home, label: "Home" },
  { path: "/my-posts", icon: ClipboardList, label: "Posts", badgeKey: "posts" as const },
];

export const rightItems = [
  { path: "/my-jobs", icon: Briefcase, label: "Jobs", badgeKey: "jobs" as const },
  { path: "/messages", icon: MessageSquare, label: "Messages", badgeKey: "messages" as const },
  { path: "/profile", icon: UserRound, label: "Profile" },
];

export const authPages = ["/dashboard", "/activity", "/my-posts", "/my-jobs", "/post-job", "/profile", "/messages", "/support", "/schedule", "/availability", "/user", "/earnings", "/jobs", "/browse", "/account-pending", "/saved-helpers",
  // Standalone settings sub-pages keep the bottom tab bar so they share the
  // same chrome as the Profile-tab settings (Notifications, Earnings, etc.).
  "/pets", "/subscription", "/home-history", "/work-record", "/gift-card", "/benefits", "/family", "/wrapped", "/str-settings", "/help", "/data-rights"];

// /admin is a distinct console shell (its own full-height layout, header,
// back button, and logout) — the consumer Posts/Jobs/Messages/Profile bar
// doesn't belong there, so it's a no-nav page, not an auth tab route.
export const noNavPages = ["/login", "/signup", "/signup-pending", "/forgot-password", "/reset-password", "/account-denied", "/admin"];

// Map each tab root to sub-routes that belong to its stack.
// Tapping the tab while inside one of these returns the user to the tab root.
export const tabStacks: Record<string, string[]> = {
  "/dashboard": ["/jobs"],
  // NOTE: /post-job is deliberately NOT in this stack. Posting is reached from
  // the floating "+" FAB, not from the Posts tab, so lighting Posts up while
  // the user is mid-post claimed they were somewhere they hadn't navigated to —
  // and it competed with the FAB, which is the control they actually pressed.
  // The tab highlights for the Posts LIST and its /activity alias only.
  "/my-posts": ["/activity"],
  "/my-jobs": ["/earnings"],
  "/messages": [],
  "/profile": ["/support", "/user", "/admin", "/schedule", "/availability", "/saved-helpers"],
};
