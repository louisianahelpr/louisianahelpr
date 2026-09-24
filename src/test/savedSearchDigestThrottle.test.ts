/**
 * ST-011: the saved-search hourly throttle must not bind digest matches, and
 * the throttle stamp is taken only when a notification is sent. Behaviour is
 * proven in PGlite (src/test/pglite/savedSearchDigestThrottle.pglite.mjs,
 * red on the live body); this pins the newest definition in migrations so a
 * later CREATE OR REPLACE cannot quietly restore the old shape.
 *
 * @mutate supabase/migrations/20260924071011_saved_search_digest_skips_throttle.sql |         OR (COALESCE(np.match_digest_mode, false) AND NOT v_is_urgent) -- ST-011 digest unthrottled |         OR false -- ST-011 digest unthrottled
 * @mutate supabase/migrations/20260924071011_saved_search_digest_skips_throttle.sql |       UPDATE public.saved_searches | UPDATE public.saved_searches SET last_notified_at = now() WHERE id = ANY(match_record.matched_search_ids); UPDATE public.saved_searches
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const DIR = resolve(__dirname, "../../supabase/migrations");

function newestBody(): { file: string; body: string } {
  let hit: { file: string; body: string } | null = null;
  for (const f of readdirSync(DIR).filter((x) => x.endsWith(".sql")).sort()) {
    const src = readFileSync(resolve(DIR, f), "utf8");
    const m = src.match(/CREATE OR REPLACE FUNCTION public\.notify_saved_searches_on_new_job\(\)[\s\S]*?\$function\$;/);
    if (m) hit = { file: f, body: m[0] };
  }
  if (!hit) throw new Error("no migration defines notify_saved_searches_on_new_job");
  return hit;
}

describe("saved-search throttle spares the digest (ST-011)", () => {
  const { file, body } = newestBody();
  const loop = body.slice(body.indexOf("  LOOP"));
  const elseAt = loop.indexOf("    ELSE");

  it("the match query lets a non-urgent digest match past the hourly throttle", () => {
    expect(body, file).toMatch(/OR \(COALESCE\(np\.match_digest_mode, false\) AND NOT v_is_urgent\)/);
  });

  it("last_notified_at is stamped only on the notify branch", () => {
    expect(elseAt, `${file}: no ELSE in the loop`).toBeGreaterThan(0);
    const stamps = [...loop.matchAll(/UPDATE public\.saved_searches/g)].map((m) => m.index!);
    expect(stamps.length, file).toBe(1);
    expect(stamps[0], `${file}: stamp before the digest branch`).toBeGreaterThan(elseAt);
  });
});
