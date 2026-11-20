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
