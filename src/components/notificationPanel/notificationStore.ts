import type { Notification } from "./types";

/**
 * ONE unread truth, shared by every bell on screen.
 *
 * WHY THIS EXISTS. `<NotificationPanel />` is mounted in FOUR places —
 * DesktopTopNav, AdminTopBar, DashboardTitleBar and DashboardHeader — and each
 * held its own `useState` list and its own `unreadTotal`. Nothing synchronised
 * them. Mark a notification read under one bell and the others never heard;
 * navigate between two surfaces that mount different bells and each refetched
 * at its own moment. The numbers then disagreed on screen, which is exactly
 * what the owner kept reporting (bell 10 beside a panel reading 11) and what
 * two earlier "fixes" of mine did not touch — the first restyled the count,
 * the second stopped ONE component's badge drifting from ITS OWN list. Neither
 * could help, because the two numbers came from two different components.
 *
 * Deliberately a module store rather than React Query: the panel drives this
 * data imperatively — a deferred initial load, a realtime `postgres_changes`
 * subscription, pull-to-refresh, and optimistic read-flips that roll back on
 * failure. Threading all of that through a query cache is a rewrite of an
 * 807-line component. This changes WHERE the state lives and nothing else, so
 * every one of those paths keeps working and simply writes somewhere shared.
 *
 * Read through `useSyncExternalStore`, so `getSnapshot` MUST return a stable
 * reference while nothing has changed — hence one frozen object replaced
 * wholesale on write, never mutated in place.
 */

export type NotificationState = {
  notifications: Notification[];
  /** The TRUE database total. `null` means "not counted yet" — callers fall
   *  back to the page-derived count, which is capped at the fetch limit. */
  unreadTotal: number | null;
  /** Whose notifications these are. A different id means a different person,
   *  and their unread count must not be inherited. */
  userId: string | null;
};

const EMPTY: NotificationState = { notifications: [], unreadTotal: null, userId: null };

let state: NotificationState = EMPTY;
const listeners = new Set<() => void>();

const emit = (next: NotificationState) => {
  if (next === state) return;
  state = next;
  // Copied before iterating: a listener may unsubscribe during the loop (React
  // does exactly that when a bell unmounts mid-update), and mutating the Set
  // while iterating it skips whoever came next.
  for (const l of [...listeners]) l();
};

export const subscribeNotifications = (l: () => void) => {
  listeners.add(l);
  return () => { listeners.delete(l); };
};

export const getNotificationSnapshot = (): NotificationState => state;

/** Server render / non-browser: no subscriber ever writes, so the constant is
 *  the correct stable snapshot. */
export const getNotificationServerSnapshot = (): NotificationState => EMPTY;

/**
 * Bind the store to a user. Clears everything when the id changes — including
 * to null on sign-out — so one account can never briefly show another's
 * unread count after a switch.
 */
export const setNotificationUser = (userId: string | null) => {
  if (state.userId === userId) return;
  emit({ ...EMPTY, userId });
};

export const setNotifications = (
  update: Notification[] | ((prev: Notification[]) => Notification[]),
) => {
  const next = typeof update === "function" ? update(state.notifications) : update;
  if (next === state.notifications) return;
  emit({ ...state, notifications: next });
};

export const setUnreadTotal = (
  update: number | null | ((prev: number | null) => number | null),
) => {
  const next = typeof update === "function" ? update(state.unreadTotal) : update;
  if (next === state.unreadTotal) return;
  emit({ ...state, unreadTotal: next });
};

/** Test-only reset. Module state outlives a test file otherwise. */
export const __resetNotificationStore = () => { state = EMPTY; };
