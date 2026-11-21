/**
 * A Declutter item's link-preview image (owner 11-20, site polish E): the first photo, drawn so it is safe at both
 * 1:1 and 1.91:1. api/og-item.ts draws a 1200x630 PNG with the WHOLE photo fitted inside the centre 630x630 square
 * (a square crop, as iMessage and some Facebook placements make, keeps all of it), on a soft, faded fill of the same
 * photo across the full width (the 1.91:1 card never shows bars). Before, shop-photo's cover crop to 1200x630 cut a
 * portrait photo to a thin middle band, and a square crop of that cut it again.
 *
 * Pure and dependency-free, so api/share.ts (which writes the og:image URL) and api/og-item.ts (which draws it) agree
 * without share.ts loading the renderer. Nothing in src/ imports it, so no page ships it.
 */

export const OG_ITEM_WIDTH = 1200;
export const OG_ITEM_HEIGHT = 630;
/** The function's path on the site (api/og-item.ts). */
export const OG_ITEM_PATH = "/api/og-item";
/** Bump with any change to how api/og-item.ts draws the card, so crawlers that cache by URL fetch the new one. */
export const OG_ITEM_STYLE = "safe-1120";

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/** True for a uuid (item and photo ids are uuids; nothing else is ever put in the URL or fetched). */
export function isUuid(value) {
  return typeof value === "string" && UUID_RE.test(value);
}

/** The canonical card URL: exactly `?id=<item>&p=<cover photo>&v=<style>`, lowercase ids, or null for a bad id. */
export function ogItemImageUrl(siteOrigin, itemId, photoId) {
  if (!isUuid(itemId) || !isUuid(photoId)) return null;
  return `${siteOrigin}${OG_ITEM_PATH}?id=${itemId.toLowerCase()}&p=${photoId.toLowerCase()}&v=${OG_ITEM_STYLE}`;
}

/**
 * The cover photo, whole (shop-photo's contain resize, 640 wide, JPEG), by photo id through shop-photo kind=declutter,
 * which re-checks the item is link-visible on every fetch. Never a storage path (it names the seller).
 */
export function ogItemPhotoUrl(supabaseUrl, photoId) {
  if (!supabaseUrl || !isUuid(photoId)) return null;
  return `${supabaseUrl}/functions/v1/shop-photo?id=${photoId.toLowerCase()}&kind=declutter&w=640`;
}
