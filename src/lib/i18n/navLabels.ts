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

/** "/profile" reads "You" in the dock and rail ("Profile" elsewhere). */
export function navKey(path: string, label: string): MsgKey | null {
  if (path === "/profile") return label === "You" ? "nav.you" : "nav.profile";
  return NAV_KEYS[path] ?? null;
}
