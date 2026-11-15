/**
 * THE INBOX'S TWO TABS (owner 11-15: "Merge messages and notifications into one, like Vinted does").
 *
 * /messages is the Inbox. `?tab=notifications` opens its Notifications tab; no `?tab` (or anything else) is Messages,
 * the default, so every existing /messages and /messages/:id link keeps landing on the conversations. The top-bar
 * Inbox icon opens the LAST tab the member chose (remembered on this device), so links can target a tab and the icon
 * still comes back to where the member was. Guard: src/test/inboxOneIconTwoTabs.test.tsx.
 */
export type InboxTab = "messages" | "notifications";

export const INBOX_PATH = "/messages";
const LAST_TAB_KEY = "lh.inbox.lastTab";

/** The tab a URL's search string names: Notifications only when it says so. */
export function inboxTabFrom(search: string | URLSearchParams): InboxTab {
  const params = typeof search === "string" ? new URLSearchParams(search) : search;
  return params.get("tab") === "notifications" ? "notifications" : "messages";
}

/** The Inbox URL for a tab: Messages is the bare path, so it stays the default every old link already uses. */
export function inboxPath(tab: InboxTab): string {
  return tab === "notifications" ? `${INBOX_PATH}?tab=notifications` : INBOX_PATH;
}

export function rememberInboxTab(tab: InboxTab): void {
  try {
    localStorage.setItem(LAST_TAB_KEY, tab);
  } catch {
    // Storage blocked (private window): the icon then opens Messages, the default. Nothing to report.
  }
}

export function lastInboxTab(): InboxTab {
  try {
    return localStorage.getItem(LAST_TAB_KEY) === "notifications" ? "notifications" : "messages";
  } catch {
    // Storage blocked: Messages, the default.
    return "messages";
  }
}
