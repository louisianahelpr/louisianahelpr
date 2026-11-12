/**
 * F359d, the asker half (owner 11-11 ~5:00 PM pickup COUNT on the seller card; lead 11-12: the same under each asker).
 * The giver's list of people asking for a free item shows "3 pickups" under each asker who completed any: a count only,
 * none at 0, none when the server sends null (a block or ban, a test asker, or before the migration is on prod).
 * Server: migration 20261112053500 adds pickup_count to declutter_free_requests_for_item. Behaviour proof:
 * src/test/pglite/declutterFreeAskerPickupCount.pglite.mjs (3x; NEW_MIGRATION=skip red; mutants each FAIL).
 *
 * @mutate src/components/declutter/DeclutterFreeClaim.tsx | {(r.pickup_count ?? 0) > 0 && <span data-free-ask-pickups | {false && <span data-free-ask-pickups
 * @mutate src/components/declutter/DeclutterFreeClaim.tsx | {(r.pickup_count ?? 0) > 0 && <span data-free-ask-pickups | {(r.pickup_count ?? 0) >= 0 && <span data-free-ask-pickups
 * @mutate supabase/migrations/20261112053500_declutter_free_asker_pickup_count.sql |                        WHERE o.buyer_id = r.requester_id\n                         AND o.status = 'handed_over'\n |                        WHERE o.buyer_id = r.requester_id\n
 * @mutate supabase/migrations/20261112053500_declutter_free_asker_pickup_count.sql |            CASE WHEN public.declutter_names_hidden(v_uid, r.requester_id) OR public.is_test_member(r.requester_id)\n                     OR p.anonymized_at IS NOT NULL THEN NULL |            CASE WHEN false THEN NULL
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { resolve } from "node:path";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { blankSqlComments } from "./helpers/blankNonCode";

const later = new Date(Date.now() + 26 * 3600e3).toISOString();
const ROWS = [
  { request_id: "r1", requester_id: "u1", display_name: "Ann G.", avg_rating: null, review_count: 0, created_at: "2026-11-01T10:00:00Z", pickup_at: later, pickup_count: 3 },
  { request_id: "r2", requester_id: "u2", display_name: "Bo T.", avg_rating: null, review_count: 0, created_at: "2026-11-01T11:00:00Z", pickup_at: later, pickup_count: 1 },
  { request_id: "r3", requester_id: "u3", display_name: "Cy D.", avg_rating: null, review_count: 0, created_at: "2026-11-01T12:00:00Z", pickup_at: later, pickup_count: 0 },
  { request_id: "r4", requester_id: "u4", display_name: "A neighbor", avg_rating: null, review_count: 0, created_at: "2026-11-01T13:00:00Z", pickup_at: later, pickup_count: null },
];
vi.mock("@/lib/declutter/api", async (orig) => ({
  ...(await orig<typeof import("@/lib/declutter/api")>()),
  fetchFreeRequestsForItem: vi.fn(async () => ROWS),
  pickFreeRequest: vi.fn(),
}));
import { FreeRequestsForGiver } from "@/components/declutter/DeclutterFreeClaim";

describe("F359d: each asker's completed pickups on the giver's list", () => {
  it("shows the count under the asker; nothing at 0 or null", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={qc}><MemoryRouter><FreeRequestsForGiver item={{ id: "i1" } as never} /></MemoryRouter></QueryClientProvider>);
    await screen.findByText("Ann G.");
    const rows = [...document.querySelectorAll("[data-free-requests] li")];
    expect(rows.length).toBe(4);
    expect(rows.map((r) => r.querySelector("[data-free-ask-pickups]")?.textContent ?? null)).toEqual(["3 pickups", "1 pickup", null, null]);
  });

  it("the server counts handed-over pickups as the buyer, hidden across a block or ban and for a test asker", () => {
    const defs = effectiveDefs(resolve(__dirname, "../../supabase/migrations"));
    const def = defs.get("declutter_free_requests_for_item");
    expect(def?.file).toMatch(/20261112053500_declutter_free_asker_pickup_count\.sql$/);
    const fn = blankSqlComments(def?.stmt ?? "").replace(/\s+/g, " ");
    expect(fn).toContain("pickup_at timestamptz, pickup_count integer)");
    expect(fn).toContain(
      "CASE WHEN public.declutter_names_hidden(v_uid, r.requester_id) OR public.is_test_member(r.requester_id) OR p.anonymized_at IS NOT NULL THEN NULL ELSE (SELECT count(*)::integer FROM public.declutter_orders o WHERE o.buyer_id = r.requester_id AND o.status = 'handed_over' AND o.is_seed IS NOT TRUE AND NOT public.is_test_member(o.seller_id) AND NOT public.profile_review_same_person(o.buyer_id, o.seller_id)) END",
    );
    // The rest of the list is unchanged: the name rule and the block filter.
    expect(fn).toContain("CASE WHEN public.declutter_names_hidden(v_uid, r.requester_id) THEN 'A neighbor' ELSE public.member_display_name(p.full_name, 'A neighbor') END");
    expect(fn).toContain("AND NOT public.are_users_blocked(v_uid, r.requester_id)");
  });
});
