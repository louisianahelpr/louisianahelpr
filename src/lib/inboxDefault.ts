/**
 * Which Messages tab the inbox opens on, expressed once so the app and its
 * tests cannot drift apart.
 *
 * UPDATED: the default tab is now always "All" (owner request, 2026-08-30),
 * and the tab order changed to All / Unread / Active — All first, since it's
 * the one slice guaranteed to show every thread the user has. The previous
 * rule ("Unread, when there is unread") had good intentions — Unread is the
 * tab worth landing on because it's the one with something to do — but it
 * meant the inbox's default view moved around depending on read state, which
 * the owner didn't want. All is now the stable, predictable default; Unread
 * and Active stay one tap away.
 *
 * This lives in its own module rather than inline in ConversationList because
 * an E2E spec once asserted the old behaviour as a literal and broke the
 * moment the rule changed — the test was encoding a product decision by
 * restating it. Anything that needs to know the default imports it from here
 * instead.
 */
export type InboxTab = "unread" | "all" | "active";

export function defaultInboxTab(_unreadCount: number): InboxTab {
  return "all";
}
