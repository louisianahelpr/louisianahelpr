/**
 * Which Messages tab the inbox opens on, expressed once so the app and its
 * tests cannot drift apart.
 *
 * The rule is "Unread, when there is unread". Unread is the tab worth landing
 * on because it is the one with something to do in it — but only while it has
 * rows. A caught-up user who lands on an empty Unread tab is shown "You're all
 * caught up" over a hidden inbox: every conversation they have is one tap away
 * under All, and nothing tells them the tab moved. That reads as an app that
 * lost their messages, which is a worse first impression than the tidier
 * default it was meant to be.
 *
 * This lives in its own module rather than inline in ConversationList because
 * an E2E spec asserted the old behaviour as a literal and broke the moment the
 * rule changed — the test was encoding a product decision by restating it.
 * Anything that needs to know the default imports it from here instead.
 */
export type InboxTab = "unread" | "all" | "active";

export function defaultInboxTab(unreadCount: number): InboxTab {
  return unreadCount > 0 ? "unread" : "all";
}
