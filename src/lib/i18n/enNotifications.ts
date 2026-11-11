/**
 * The notifications panel's own words in English (F260q, owner 11-11 "Spanish everything"): header, filter, empty
 * state, footer lines (NotificationPanelView.tsx). The notices themselves are written by the server in English (phase
 * 2: a profile language column). Importing this file registers the words with t() (enRegistry.ts). Spanish:
 * esNotifications.ts.
 */
import { addEnglish } from "./enRegistry";

export const enNotifications = {
  "notif.title": "Notifications",
  "notif.markAllRead": "Mark all read",
  "notif.filter": "Filter notifications",
  "notif.unread": "Unread",
  "notif.all": "All",
  "notif.unreadDot": "Unread",
  "notif.messagesUnread": "Messages, {n} unread",
  "notif.nothingUnread": "Nothing unread.",
  "notif.nothingNew": "Nothing new yet.",
  "notif.switchToAll": "Switch to All to see everything.",
  "notif.landHere": "Applications, messages and payouts land here.",
  "notif.showingNewest": "Showing your newest {count}. Mark all read clears all {unread} unread.",
  "notif.turnOnPush": "Turn on push notifications",
} as const;

addEnglish(enNotifications);
