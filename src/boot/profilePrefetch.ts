/**
 * Start the You landing's gated reads from the ENTRY, beside the app's own download (same idea as homePrefetch.ts and
 * declutterPrefetch.ts; lead 11-14, after F260a).
 *
 * Measured 2026-11-14 (cwv-lab, local build against prod, poster account, 375x812, Slow 4G + 4x CPU;
 * ~/.lh-shots/b2-perf-1114/after2-375x812.json): the landing holds its skeleton until four answers are in (Profile.tsx's
 * arrival gate: the section switches, "does my page open?" and, with a preview section, which sections are open to
 * everyone). They started only once the app and Profile.js had run (2.99 s and 4.56 s) and ran in a chain: profile row
 * (to 4.2 s), then the page and the switches (to 5.3 s), then open-to-everyone (to 5.9 s). The landing painted at 6.0 s.
 *
 * So a cold /profile (the landing: no ?tab=) asks all of them here at once with plain fetch: the switches, the
 * open-to-everyone list, and the handle, then that handle's page. The app's queries take each answer ONCE instead of
 * asking again (src/lib/profileBootPrefetch.ts). Uses the session the app would use, sent only to the app's own
 * Supabase, as supabase-js sends it. No usable session, any failure, or an answer not in the expected shape: nothing is
 * handed over and that query reads as it always did.
 *
 * NOTHING outside the entry may import this file (see guestJobsPrefetch.ts). Guard: src/boot/profilePrefetch.test.ts.
 */
import { storedSession } from "./storedSession";
import { FIRST_SCREEN_SWITCH_KEYS } from "./declutterPrefetch";

/** Same string as the take module's KEY (the test pins it). */
export const PROFILE_PREFETCH_KEY = "__lhProfilePrefetch";

/** One read's parsed JSON body, or null on any failure (never a rejection). */
const json = (p: Promise<Response>): Promise<unknown> =>
  p.then((r) => (r.ok ? (r.json() as Promise<unknown>) : null)).catch(() => null);

/** Called by the entry. No-op unless this is a cold load of the You landing with a live session. */
export function startProfilePrefetch(pathname: string, search: string): void {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  if (path !== "/profile" || new URLSearchParams(search).get("tab") || typeof fetch !== "function") return;
  const base = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;
  const session = storedSession(Date.now() / 1000);
  if (!base || !key || !session) return;
  const rest = `${base.replace(/\/$/, "")}/rest/v1/`;
  const headers = { apikey: key, Authorization: `Bearer ${session.token}`, "Content-Type": "application/json", Accept: "application/json" };
  const rpc = (name: string, body: unknown) => json(fetch(`${rest}rpc/${name}`, { method: "POST", headers, body: JSON.stringify(body) }));
  const switches = rpc("feature_switches_for_me", { p_keys: FIRST_SCREEN_SWITCH_KEYS });
  const open = rpc("features_open_to_everyone", {});
  const page = json(fetch(`${rest}profiles?select=handle&user_id=eq.${encodeURIComponent(session.userId)}`, { headers }))
    .then(async (rows) => {
      const handle = Array.isArray(rows) && rows.length === 1 ? (rows[0] as { handle?: unknown }).handle : null;
      if (typeof handle !== "string" || !handle) return null;
      const r = await fetch(`${rest}rpc/public_profile_by_handle`, { method: "POST", headers, body: JSON.stringify({ p_handle: handle }) });
      // A refused or failed read hands nothing over (the card's own read decides); a 200 "null" is a real "no page".
      if (!r.ok) return null;
      return { handle, data: (await r.json()) as unknown };
    })
    // A failed prefetch is not an error: the card reads for itself.
    .catch(() => null);
  (window as unknown as Record<string, unknown>)[PROFILE_PREFETCH_KEY] = {
    at: Date.now(),
    userId: session.userId,
    keys: FIRST_SCREEN_SWITCH_KEYS.join(","),
    switches,
    open,
    page,
  };
}
