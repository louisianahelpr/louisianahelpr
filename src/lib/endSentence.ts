/**
 * Close a sentence we did not write (a server message) before our own copy
 * follows it. Trailing periods and whitespace are trimmed, then a period is
 * added unless the message already ends a sentence with "?" or "!".
 *
 * Q34: "Couldn't start payment: Card declined?. Please try again." — the old
 * code trimmed only periods and always appended ". ".
 */
export function endSentence(message: string): string {
  const trimmed = message.replace(/[.\s]+$/, "");
  if (!trimmed) return "";
  return /[?!]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}
