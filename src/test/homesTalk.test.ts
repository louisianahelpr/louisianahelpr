/**
 * Homes A-H1 (audit 11-05; NOT-LAUNCHED Q2209, D8): a member messages the owner of a home to rent or buy, one thread
 * per listing and member, and the owner answers. Reads the EFFECTIVE (newest) definitions; behaviour on a real
 * database is src/test/pglite/homesTalk.pglite.mjs (3x, Supabase's default anon execute grant emulated).
 *
 * @mutate supabase/migrations/20261106182837_homes_talk.sql |   IF v_owner = v_uid THEN\n    RAISE EXCEPTION 'own_listing' |   IF false THEN\n    RAISE EXCEPTION 'own_listing'
 * @mutate supabase/migrations/20261106182837_homes_talk.sql |   IF public.are_users_blocked(t.member_id, l.owner_id) THEN\n    RAISE EXCEPTION 'talk_blocked' |   IF false THEN\n    RAISE EXCEPTION 'talk_blocked'
 * @mutate supabase/migrations/20261106182837_homes_talk.sql | REVOKE ALL ON FUNCTION public.rentals_send_talk_message(uuid, text) FROM PUBLIC, anon; | REVOKE ALL ON FUNCTION public.rentals_send_talk_message(uuid, text) FROM PUBLIC;
 * @mutate supabase/migrations/20261106182837_homes_talk.sql |   IF v_owner IS NULL OR NOT public.rentals_listing_visible(p_listing_id) THEN | IF v_owner IS NULL THEN
 * @mutate supabase/migrations/20261106182837_homes_talk.sql |   v_reason text := public.contact_leak_reason(NEW.body); |   v_reason text := NULL;
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { blankSqlComments } from "./helpers/blankNonCode";

const ROOT = resolve(__dirname, "../..");
const DEFS = effectiveDefs(resolve(ROOT, "supabase/migrations"));
const flat = (name: string) => blankSqlComments(DEFS.get(name)?.stmt ?? "").replace(/\s+/g, " ");
const RPCS = ["rentals_open_talk", "rentals_talk_view", "rentals_send_talk_message", "rentals_my_talks", "rentals_mark_talk_read"];

describe("a member can message a home's owner (Homes A-H1)", () => {
  it("reads the newest definitions (floor)", () => {
    for (const fn of [...RPCS, "home_talk_side", "home_talk_listing_ok", "reject_contact_leak_in_home_talk"]) {
      expect(DEFS.get(fn)?.file ?? "", fn).not.toBe("");
      expect(flat(fn).length, fn).toBeGreaterThan(150);
    }
  });

  it("every RPC is behind the rentals switch and refuses strangers; never anon", () => {
    for (const fn of RPCS) {
      expect(flat(fn), fn).toContain("PERFORM public.require_feature('rentals')");
      const file = blankSqlComments(readFileSync(resolve(ROOT, "supabase/migrations", DEFS.get(fn)?.file ?? ""), "utf8")).replace(/\s+/g, " ");
      expect(file, fn).toMatch(new RegExp(`REVOKE ALL ON FUNCTION public\\.${fn}\\([^)]*\\) FROM PUBLIC, anon;`));
    }
    for (const fn of ["rentals_talk_view", "rentals_send_talk_message", "rentals_mark_talk_read"]) {
      expect(flat(fn), fn).toContain("v_side := public.home_talk_side(p_talk_id, v_uid); IF v_side IS NULL THEN RAISE EXCEPTION 'talk_not_found'");
    }
  });

  it("only a listing the member can see, never your own, never across a block, the leak filter on every message, the notice never carries words", () => {
    expect(flat("rentals_open_talk")).toContain("IF v_owner IS NULL OR NOT public.rentals_listing_visible(p_listing_id) THEN RAISE EXCEPTION 'listing_not_found'");
    expect(flat("rentals_open_talk")).toContain("IF v_owner = v_uid THEN RAISE EXCEPTION 'own_listing'");
    expect(flat("rentals_open_talk")).toContain("IF public.are_users_blocked(v_uid, v_owner) THEN RAISE EXCEPTION 'talk_blocked'");
    expect(flat("rentals_send_talk_message")).toContain("IF NOT public.home_talk_listing_ok(l.id) THEN RAISE EXCEPTION 'talk_closed'");
    expect(flat("rentals_send_talk_message")).toContain("IF public.are_users_blocked(t.member_id, l.owner_id) THEN RAISE EXCEPTION 'talk_blocked'");
    expect(flat("reject_contact_leak_in_home_talk")).toContain("public.contact_leak_reason(NEW.body)");
    expect(flat("rentals_send_talk_message")).not.toMatch(/declutter_notify\([^;]*v_body/);
  });
});
