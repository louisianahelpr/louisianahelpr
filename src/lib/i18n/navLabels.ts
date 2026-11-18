import type { MsgKey } from "./en";

/**
 * The dictionary key for each main-nav destination, by path. The rail and the
 * phone dock keep their English `label` in config (tests, analytics and the
 * coming-soon toasts read it); what a member SEES goes through t(navKey(...)).
 */
const NAV_KEYS: Record<string, MsgKey> = {
  "/home": "nav.home",
  "/posts": "nav.posts",
  "/jobs": "nav.jobs",
  "/messages": "nav.messages",
  "/explore": "nav.explore",
  "/declutter": "nav.declutter",
  "/shops": "nav.shops",
  "/rentals": "nav.homes",
};

/** "/profile" reads "You" in the dock and rail ("Profile" elsewhere); "/home" reads "Home" in the phone dock (F146)
 *  and on the rail too (design audit area 02 #15, 11-18: the rail said "Dashboard" / "Panel" beside the dock's "Home" /
 *  "Inicio"; nav.home now reads Home / Inicio). */
export function navKey(path: string, label: string): MsgKey | null {
  if (path === "/home" && label === "Home") return "nav.dockHome";
  if (path === "/profile") return label === "You" ? "nav.you" : "nav.profile";
  // The desktop rail's row for /messages reads "Inbox" (owner 11-15); the phone dock's stays "Messages".
  if (path === "/messages" && label === "Inbox") return "inbox.title";
  return NAV_KEYS[path] ?? null;
}
