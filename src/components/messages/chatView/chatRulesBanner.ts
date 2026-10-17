// The community-rules banner's per-user dismissal, read from localStorage.
// Moved out of ChatView.tsx unchanged (Q806, god-component ratchet).

/** localStorage key prefix for the per-user community-rules banner dismissal. */
export const CHAT_RULES_DISMISSED_KEY = "helpr.chatRulesBannerDismissed";

export function readBannerDismissed(key: string | null): boolean {
  if (typeof window === "undefined" || !key) return false;
  try {
    return window.localStorage.getItem(key) === "1";
  } catch {
    // Storage blocked (private window, quota, sandbox): read as "not dismissed",
    // so the reminder shows again. Nothing else depends on it, so no report.
    return false;
  }
}
