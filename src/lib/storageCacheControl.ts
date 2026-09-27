/**
 * Cache-Control for Storage uploads (Q655).
 *
 * storage-js sends `max-age=<cacheControl>` and defaults to "3600", so every
 * photo was re-downloaded after an hour even though its URL never changes.
 *
 * - IMMUTABLE: the object key is unique per upload (timestamp / random / uuid)
 *   or its public URL carries a version (`?t=` on avatars). The bytes behind
 *   that URL never change, so the browser and CDN may keep it for a year.
 * - MUTABLE: a fixed key that is overwritten (`upsert: true`) and served at an
 *   unversioned URL. A year here would pin the old bytes, so it keeps an hour.
 *
 * src/test/storageUploadsSetCacheControl.test.ts makes every `.upload(` pick one.
 */
export const IMMUTABLE_OBJECT_CACHE_CONTROL = "31536000";
export const MUTABLE_OBJECT_CACHE_CONTROL = "3600";
