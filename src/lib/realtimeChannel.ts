/**
 * A unique suffix for a Supabase realtime channel name.
 *
 * Two subscribers that open `.channel("same-name")` collide — Supabase
 * dedupes by name, so the second subscription silently never receives
 * events. Any component/hook that may mount more than once concurrently
 * (e.g. a panel rendered in both the header and the admin shell) must
 * append one of these per subscriber instance.
 */
export const channelNonce = (): string =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
