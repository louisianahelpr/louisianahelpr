import { useSyncExternalStore } from "react";

/**
 * AM-011: the admin queue counts live in Admin.tsx's state, but on desktop web
 * the only nav is the global DesktopSidebarNav (AdminSidebar, the old badge
 * renderer, mounts only below the desktop breakpoint). Admin publishes its
 * per-section counts here and DesktopSidebarNav reads them, so both navs show
 * the same numbers from the same getBadge.
 */
type Badges = Readonly<Record<string, number>>;

let badges: Badges = {};
const listeners = new Set<() => void>();

export function publishAdminBadges(next: Record<string, number>): void {
  const keys = Object.keys(next);
  if (keys.length === Object.keys(badges).length && keys.every((k) => badges[k] === next[k])) return;
  badges = { ...next };
  listeners.forEach((l) => l());
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useAdminBadges(): Badges {
  return useSyncExternalStore(subscribe, () => badges, () => badges);
}
