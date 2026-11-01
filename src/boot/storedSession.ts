/**
 * The stored Supabase session's token and user, for the entry's speculative first-screen reads (declutterPrefetch.ts,
 * homePrefetch.ts). Only the entry's own small chunks may import this (see guestJobsPrefetch.ts for why).
 */
/** A session this close to expiry is left to supabase-js, which refreshes it. */
const MIN_TOKEN_LIFE_S = 60;

/** The stored session's token and whose it is, while it has life left; null otherwise (never throws). */
export function storedSession(nowS: number): { token: string; userId: string } | null {
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith("sb-") || !key.endsWith("-auth-token")) continue;
      const session = JSON.parse(localStorage.getItem(key) ?? "null") as
        | { access_token?: unknown; expires_at?: unknown; user?: { id?: unknown } }
        | null;
      const userId = session?.user?.id;
      if (typeof session?.access_token !== "string" || typeof session.expires_at !== "number" || typeof userId !== "string") return null;
      return session.expires_at - nowS > MIN_TOKEN_LIFE_S ? { token: session.access_token, userId } : null;
    }
  } catch {
    /* storage blocked or a malformed session: the page reads for itself */
  }
  return null;
}
