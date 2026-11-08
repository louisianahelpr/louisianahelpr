/**
 * PRIVACY (lead 11-07, Builder 5): "last active" is a coarse band, never a sign-in time.
 *
 * get_user_last_active (20260609090000) returned the EXACT newest sign-in for ANY list of ids to any signed-in
 * member, with no block or test-account filter, no cap and no pg_temp. 20261108001932 restates it to answer
 * 'today' / 'this_week' (or no row), skipping blocked, suspended, removed and hidden test users, at most 200 ids,
 * search_path public, pg_temp; and gives declutter_seller_sold_count / declutter_seller_on_time_handovers the same
 * block and suspended checks. Backend proof: src/test/pglite/lastActiveBand.pglite.mjs (3x; 23 FAIL on the old
 * function; RED on 12 planted defects).
 *
 * This guard reads the EFFECTIVE definitions (any dollar tag, newest wins) and the client: no source reads a
 * timestamp from the read any more, and every caller words it from the band.
 */
// @mutate supabase/migrations/20261108001932_last_active_band_and_seller_badge_blocks.sql | RETURNS TABLE(user_id uuid, active_band text)\nLANGUAGE plpgsql | RETURNS TABLE(user_id uuid, active_band text, last_active_at timestamptz)\nLANGUAGE plpgsql
// @mutate supabase/migrations/20261108001932_last_active_band_and_seller_badge_blocks.sql | IF cardinality(user_ids) > 200 THEN | IF cardinality(user_ids) > 100000 THEN
// @mutate supabase/migrations/20261108001932_last_active_band_and_seller_badge_blocks.sql |                          OR (b.blocker_id = p.user_id AND b.blocked_id = v_uid)) |                          OR false)
// @mutate src/lib/activeBand.ts |   for (let i = 0; i < ids.length; i += ACTIVE_BAND_MAX_IDS) pages.push(ids.slice(i, i + ACTIVE_BAND_MAX_IDS)); |   pages.push(ids);
// @mutate src/pages/user/userProfileHelpers.ts |   return text ? { text, isLive: band === "today" } : null; |   return text ? { text, isLive: true } : null;
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";
import { trackedFiles } from "./helpers/trackedFiles";

const rpcCalls = vi.hoisted(() => [] as string[][]);
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: async (_name: string, args: { user_ids: string[] }) => {
      rpcCalls.push(args.user_ids);
      return { data: args.user_ids.slice(0, 2).map((id, i) => ({ user_id: id, active_band: i === 0 ? "today" : "last_active_at" })), error: null };
    },
  },
}));

import { ACTIVE_BAND_MAX_IDS, activeBandLabel, fetchActiveBands } from "@/lib/activeBand";
import { computeLastActiveLabel } from "@/pages/user/userProfileHelpers";

const ROOT = resolve(__dirname, "../..");
const DEFS = effectiveDefs(resolve(ROOT, "supabase/migrations"));
const flat = (name: string) => blankSqlComments(DEFS.get(name)?.stmt ?? "").replace(/\s+/g, " ");

describe("get_user_last_active answers a band, never a time", () => {
  const fn = flat("get_user_last_active");
  it("reads the definition (floor)", () => {
    expect(fn.length).toBeGreaterThan(800);
  });
  it("returns user_id + active_band only, no timestamp column", () => {
    expect(fn).toMatch(/RETURNS TABLE\(user_id uuid, active_band text\)/);
    expect(fn).not.toMatch(/last_active_at|timestamptz\)/);
    expect(fn).toContain("THEN 'today' ELSE 'this_week' END");
    expect(fn).toContain("AND lh.created_at > now() - interval '7 days'");
  });
  it("skips blocked (both ways), suspended, removed and hidden test users; caps the list; pins pg_temp", () => {
    expect(fn).toContain("SET search_path TO 'public', 'pg_temp'");
    expect(fn).toContain("(b.blocker_id = v_uid AND b.blocked_id = p.user_id) OR (b.blocker_id = p.user_id AND b.blocked_id = v_uid)");
    expect(fn).toContain("FROM public.profiles p JOIN public.login_history lh ON lh.user_id = p.user_id");
    expect(fn).toMatch(/COALESCE\(p\.ban_status, 'active'\) IN \('banned', 'permanently_banned'\)/);
    expect(fn).toContain("AND p.under_13_blocked_at IS NULL");
    expect(fn).toContain("AND NOT (COALESCE(p.is_seed, false) AND v_seed_hidden)");
    expect(fn).toContain(`IF cardinality(user_ids) > ${ACTIVE_BAND_MAX_IDS} THEN RAISE EXCEPTION 'too_many_ids'`);
  });
  it("the seller badges skip a blocked or suspended seller", () => {
    for (const name of ["declutter_seller_sold_count", "declutter_seller_on_time_handovers"]) {
      const f = flat(name);
      expect(f, name).toContain("(b.blocker_id = v_uid AND b.blocked_id = p_seller_id) OR (b.blocker_id = p_seller_id AND b.blocked_id = v_uid)");
      expect(f, name).toContain("AND p.under_13_blocked_at IS NULL");
      expect(f, name).toMatch(/COALESCE\(p\.ban_status, 'active'\) = 'temp_banned'/);
    }
  });
});

describe("the client words the band, and nothing reads a sign-in time", () => {
  it("no app source reads last_active_at (comments blanked; generated types excluded)", () => {
    const files = trackedFiles("src").filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\.tsx?$/.test(f) && !f.includes("/test/") && !f.endsWith("integrations/supabase/types.ts"));
    expect(files.length).toBeGreaterThan(1000);
    const bad = files.filter((f) => blankComments(readFileSync(resolve(ROOT, f), "utf8")).includes("last_active_at"));
    expect(bad).toEqual([]);
  });
  it("every caller of get_user_last_active is one of the band readers (inventory floor)", () => {
    const files = trackedFiles("src").filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\.tsx?$/.test(f) && !f.includes("/test/") && !f.endsWith("integrations/supabase/types.ts"));
    const callers = files.filter((f) => /rpc\(\s*"get_user_last_active"/.test(blankComments(readFileSync(resolve(ROOT, f), "utf8")))).sort();
    expect(callers.length).toBeGreaterThan(2);
    for (const f of callers) {
      const src = blankComments(readFileSync(resolve(ROOT, f), "utf8"));
      expect(src, f).toMatch(/bandMap\(/);
    }
  });
  it("labels: today, this week, nothing else", () => {
    expect(activeBandLabel("today")).toBe("Active today");
    expect(activeBandLabel("this_week")).toBe("Active this week");
    expect(activeBandLabel(null)).toBeNull();
    expect(computeLastActiveLabel("today")).toEqual({ text: "Active today", isLive: true });
    expect(computeLastActiveLabel("this_week")).toEqual({ text: "Active this week", isLive: false });
    expect(computeLastActiveLabel(null)).toBeNull();
  });
  it("asks in pages of 200 and drops a band it does not know", async () => {
    rpcCalls.length = 0;
    const ids = Array.from({ length: 450 }, (_, i) => `u${i}`);
    const { bands, error } = await fetchActiveBands([...ids, "u0"]);
    expect(error).toBeNull();
    expect(rpcCalls.map((c) => c.length)).toEqual([200, 200, 50]);
    expect(bands.get("u0")).toBe("today");
    expect(bands.has("u1")).toBe(false);
  });
});
