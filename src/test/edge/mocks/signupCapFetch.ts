import { vi } from "vitest";

/**
 * complete-signup reads `platform_settings.signup_rate_limit_per_hour` with a
 * raw `fetch` to `${SUPABASE_URL}/rest/v1/platform_settings` (not through the
 * supabase-js client the edge harness mocks), so without this every spec that
 * runs complete-signup sent a real request to its fake `x.supabase.co` project.
 * Unit tests never reach Supabase (Q55a, src/test/prodNetworkGuard.ts).
 *
 * Answers that one read with `rows` (default: no cap, the prod value) and
 * passes every other URL through to the guarded fetch, so an unexpected
 * request still fails loudly. Restore with the returned spy's mockRestore().
 */
export function stubSignupCapRead(rows: { signup_rate_limit_per_hour: number | null }[] = [
  { signup_rate_limit_per_hour: null },
]) {
  const passThrough = globalThis.fetch;
  return vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (/\/rest\/v1\/platform_settings\?select=signup_rate_limit_per_hour\b/.test(url)) {
      return Promise.resolve(new Response(JSON.stringify(rows), { status: 200, headers: { "Content-Type": "application/json" } }));
    }
    return passThrough(input, init);
  });
}
