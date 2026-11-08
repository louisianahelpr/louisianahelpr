/**
 * The guest's random device id (owner request 11-05, declutter_item_views; reused by the buy funnel, H3 audit 11-08):
 * made once and kept in localStorage; null where storage is blocked. Never an IP, an email or anything about the
 * person: a random uuid only.
 */
const DEVICE_KEY = "lh.declutter.viewer";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function viewerDeviceId(): string | null {
  try {
    const kept = window.localStorage.getItem(DEVICE_KEY);
    if (kept && UUID.test(kept)) return kept;
    const made = crypto.randomUUID();
    window.localStorage.setItem(DEVICE_KEY, made);
    return made;
  } catch {
    return null; // private mode or blocked storage: a guest view simply goes uncounted
  }
}
