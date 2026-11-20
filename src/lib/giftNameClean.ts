/**
 * A name a visitor types for something we show on our own pages (the gift guides' wish list name, owner 2026-11-20),
 * made safe to keep: control, zero-width and direction-changing characters dropped (security review 2026-11-20 #4; the
 * server's gift_wish_list_save strips the same set), then at most `max` characters counted by code point, so an emoji
 * is never cut in half (a lone surrogate makes a save fail, #6). Shared so every gift-guide feature cleans names alike.
 */
export function cleanGiftName(name: string, max: number): string {
  // eslint-disable-next-line no-control-regex -- control characters are exactly what this removes
  const visible = name.replace(/[\u0000-\u001f\u007f-\u009f\u00ad\u061c\u180e\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]/g, "");
  return Array.from(visible).slice(0, max).join("");
}

/**
 * Why a name cannot be shown on our page, or null: a link ("link": http:, www., or any word.tld such as evil.com) or a
 * phone number ("phone": 7+ digits, ignoring spaces, dots, dashes, brackets and +). The same rule as the server's
 * invalid_name in gift_wish_list_save (20261120062130), so a name the page accepts is never refused later.
 */
export function giftNameProblem(name: string): "link" | "phone" | null {
  if (/(https?:|www\.|\.[a-z]{2,}\/|\b[a-z0-9-]+\.[a-z]{2,}\b)/i.test(name)) return "link";
  if (/[0-9]{7,}/.test(name.replace(/[\s().+-]/g, ""))) return "phone";
  return null;
}
