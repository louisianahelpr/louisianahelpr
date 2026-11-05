/**
 * The branded /u link card's words, photo URL and version tag (M1 slice 2, share-profile audit 2026-11-05, Q2759).
 *
 * Pure and dependency-free, so api/share.ts (which writes the og:image URL) and api/og-profile.ts (which draws the
 * 1200x630 PNG) agree without share.ts loading the image renderer. Nothing in src/ imports it, so no page ships it.
 */

export const OG_PROFILE_WIDTH = 1200;
export const OG_PROFILE_HEIGHT = 630;
/** The function's path on the site (api/og-profile.ts). */
export const OG_PROFILE_PATH = "/api/og-profile";

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const AVATAR_TYPES = { jpg: "image/jpeg", png: "image/png" };

function clean(value, max) {
  if (typeof value !== "string") return "";
  const flat = value.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
}

/** The lines the card prints, worked out from the public_profile_by_handle answer alone. */
export function ogProfileLines(card) {
  const name = clean(card?.name, 40) || "A neighbor";
  const town = clean(card?.town, 60);
  const reviews = Number(card?.stats?.review_count ?? 0);
  const avg = card?.stats?.avg_rating == null ? NaN : Number(card.stats.avg_rating);
  const rating = reviews > 0 && Number.isFinite(avg) ? `★ ${avg.toFixed(1)} · ${reviews} review${reviews === 1 ? "" : "s"}` : "";
  const facts = [];
  const done = Number(card?.helpr?.jobs_done ?? 0);
  if (done > 0) facts.push(`${done} job${done === 1 ? "" : "s"} done`);
  // The TRUE count (M1 slice 1): the listings array is capped, listing_count is not.
  const countRaw = card?.listing_count == null ? NaN : Number(card.listing_count);
  const selling = Number.isFinite(countRaw) && countRaw >= 0 ? countRaw : Array.isArray(card?.listings) ? card.listings.length : 0;
  if (selling > 0) facts.push(`${selling} item${selling === 1 ? "" : "s"} for sale`);
  const skills = [...new Set(clean(card?.skills, 200).split(/[,\n]/).map((x) => x.trim()).filter(Boolean))].slice(0, 3).join(" · ");
  return { name, town, rating, facts: facts.join(" · "), skills };
}

/**
 * The avatar's small square render URL, or null when it is not one of this project's stored avatars
 * (avatars/<uuid>/avatar.jpg|png, the same shape api/share.ts accepts). Nothing else is ever fetched (no SSRF).
 */
export function ogProfilePhotoUrl(avatarUrl, supabaseUrl) {
  if (typeof avatarUrl !== "string" || !supabaseUrl) return null;
  const prefix = `${supabaseUrl}/storage/v1/object/public/avatars/`;
  if (avatarUrl.slice(0, prefix.length) !== prefix) return null;
  const [userId, file, ...rest] = avatarUrl.slice(prefix.length).split(/[?#]/)[0].split("/");
  if (rest.length || !UUID_RE.test(userId ?? "")) return null;
  const ext = /^avatar\.([a-z]+)$/.exec(file ?? "")?.[1];
  if (!ext || !AVATAR_TYPES[ext]) return null;
  return `${supabaseUrl}/storage/v1/render/image/public/avatars/${userId}/${file}?width=360&height=360&resize=cover&quality=80&format=origin`;
}

/**
 * A short, stable tag of everything the card draws. api/share.ts puts it on the og:image URL (?v=) so a crawler that
 * caches images by URL (Facebook does) fetches a new card when the name, town, rating, counts, skills or photo change.
 */
export function ogProfileVersion(card) {
  const l = ogProfileLines(card);
  const s = [l.name, l.town, l.rating, l.facts, l.skills, typeof card?.photo_url === "string" ? card.photo_url : ""].join("\u0001");
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

/** The og:image URL api/share.ts gives a found /u card. */
export function ogProfileImageUrl(siteOrigin, handle, card) {
  return `${siteOrigin}${OG_PROFILE_PATH}?h=${encodeURIComponent(handle)}&v=${ogProfileVersion(card)}`;
}
