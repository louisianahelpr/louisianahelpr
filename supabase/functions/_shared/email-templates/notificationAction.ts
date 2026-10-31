/**
 * The notice email's one button names where it goes (audit 2026-10-31, AUD31-20: every notice said "View Details",
 * whatever it was about). Read from the notice's own same-origin link, so no producer has to send a label.
 * Guard: src/test/noticeEmailNamesItsAction.test.ts.
 */
export function notificationActionLabel(link: string | null | undefined): string {
  const path = (link ?? "").split(/[?#]/)[0];
  if (path.startsWith("/declutter/item/")) return "See the item";
  if (path.startsWith("/declutter")) {
    if (/[?&](tab|view)=buying\b/.test(link ?? "")) return "See your order";
    if (/[?&](tab|view)=selling\b/.test(link ?? "")) return "See your sale";
    if (/[?&]view=cart\b/.test(link ?? "")) return "See your cart";
    return "Open Declutter";
  }
  if (path.startsWith("/messages")) return "Read the message";
  if (path.startsWith("/jobs") || path.startsWith("/posts")) return "See the job";
  if (path.startsWith("/profile") && /[?&]tab=earnings\b/.test(link ?? "")) return "See your earnings";
  return "Open Louisiana Helpr";
}

/** The notice email's sign-off: the site's own name (AUD31-20: it read "The Helpr Team"). */
export const NOTICE_SIGNOFF = "Louisiana Helpr";

/**
 * "7-day", "24-hour", "2-week": the number and its unit never split at the hyphen (audit 2026-10-31, AUD31-21: the
 * notice email broke "7-" / "day pickup deadline" across lines at 1440). A non-breaking hyphen (U+2011) holds them.
 */
export function keepNumberUnitsTogether(text: string): string {
  return text.replace(/(\d)-(day|days|hour|hours|minute|minutes|week|weeks|month|months)\b/g, "$1\u2011$2");
}
