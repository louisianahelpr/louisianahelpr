/**
 * A3-57 (audit 7, 11-01, Medium GAP): a free ask whose pickup time passed stayed open, nobody was told, and a late pick
 * fell back to the 48-hour path. Migration *_free_asks_close_when_their_time_passes: the deadline sweep closes such an
 * ask with a notice to the asker and the giver, reminds the giver ~2 h before the earliest asked time, and the pick
 * refuses a passed ask (request_time_passed). Behaviour is proved in
 * src/test/pglite/freeAskClosesWhenItsTimePasses.pglite.mjs (27 PASS 3x; 13 FAIL with NEW_MIGRATION=skip; 12 mutants
 * red). Here: the giver's list marks a passed time and offers no Pick, the refusal has words, and the source anchors.
 *
 * @mutate src/components/declutter/DeclutterFreeClaim.tsx | const passed = !!r.pickup_at && new Date(r.pickup_at).getTime() <= Date.now(); | const passed = false;
 * @mutate src/components/declutter/DeclutterFreeClaim.tsx | {passed ? " · time passed" : ""} |
 * @mutate src/components/declutter/DeclutterFreeClaim.tsx |               {passed ? null : ( |               {false ? null : (
 * @mutate src/lib/lifecycleErrors.ts |     request_time_passed: DC.request_time_passed,\n |
 * @mutate supabase/migrations/20261102011547_free_asks_close_when_their_time_passes.sql |     v_free_asks := public.sweep_declutter_free_asks(p_now); |     v_free_asks := 0;
 * @mutate supabase/migrations/20261102011547_free_asks_close_when_their_time_passes.sql |   IF v_req.pickup_at IS NOT NULL AND v_req.pickup_at <= now() THEN | IF false THEN
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { blankSqlComments } from "./helpers/blankNonCode";

const ROWS = [
  { request_id: "r1", requester_id: "u1", display_name: "Ann G.", avg_rating: null, review_count: 0, created_at: "2026-11-01T10:00:00Z", pickup_at: new Date(Date.now() - 2 * 3600e3).toISOString() },
  { request_id: "r2", requester_id: "u2", display_name: "Bo T.", avg_rating: null, review_count: 0, created_at: "2026-11-01T11:00:00Z", pickup_at: new Date(Date.now() + 26 * 3600e3).toISOString() },
];
vi.mock("@/lib/declutter/api", async (orig) => ({
  ...(await orig<typeof import("@/lib/declutter/api")>()),
  fetchFreeRequestsForItem: vi.fn(async () => ROWS),
  pickFreeRequest: vi.fn(),
}));
import { FreeRequestsForGiver } from "@/components/declutter/DeclutterFreeClaim";
import { DECLUTTER_ERROR_COPY } from "@/lib/declutter/errors";
import { RPC_ERROR_COPY } from "@/lib/lifecycleErrors";

const ROOT = resolve(__dirname, "../..");
const MIG_DIR = resolve(ROOT, "supabase/migrations");
function newestFunctionBody(fn: string): string {
  const files = readdirSync(MIG_DIR).filter((f) => f.endsWith(".sql")).sort();
  let body = "";
  const re = new RegExp(`CREATE\\s+OR\\s+REPLACE\\s+FUNCTION\\s+public\\.${fn}\\s*\\([\\s\\S]*?AS\\s+(\\$[A-Za-z_]*\\$)([\\s\\S]*?)\\1`, "gi");
  for (const f of files) {
    const sql = blankSqlComments(readFileSync(resolve(MIG_DIR, f), "utf8"));
    for (const m of sql.matchAll(re)) body = m[2];
  }
  return body.replace(/\s+/g, " ");
}

describe("A3-57: the giver's Requests list", () => {
  it("marks a passed time and offers Pick only for asks still ahead", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={qc}><MemoryRouter><FreeRequestsForGiver item={{ id: "i1" } as never} /></MemoryRouter></QueryClientProvider>);
    const passed = await screen.findByText(/time passed/);
    expect(passed.textContent).toMatch(/^Pickup .+ · time passed$/);
    const rows = document.querySelectorAll("[data-free-requests] li");
    expect(rows.length).toBe(2);
    expect(rows[0].hasAttribute("data-free-ask-passed")).toBe(true);
    expect(rows[0].querySelector("button")).toBeNull();
    expect(rows[1].hasAttribute("data-free-ask-passed")).toBe(false);
    expect(rows[1].querySelector("button")?.textContent).toBe("Pick");
    expect(rows[1].textContent).not.toMatch(/time passed/);
  });
});

describe("A3-57: the refusal and the server anchors", () => {
  it("a late pick's refusal has words for the giver", () => {
    expect(DECLUTTER_ERROR_COPY.request_time_passed).toBe("Their pickup time has passed. Pick someone else.");
    expect((RPC_ERROR_COPY as Record<string, Record<string, string>>).declutter_pick_free_request.request_time_passed).toBe(DECLUTTER_ERROR_COPY.request_time_passed);
  });

  it("the newest pick refuses a passed ask before any hand-off", () => {
    const pick = newestFunctionBody("declutter_pick_free_request");
    expect(pick.length).toBeGreaterThan(1000);
    const refusal = pick.indexOf("IF v_req.pickup_at IS NOT NULL AND v_req.pickup_at <= now() THEN RAISE EXCEPTION 'request_time_passed'");
    expect(refusal).toBeGreaterThan(0);
    expect(refusal).toBeLessThan(pick.indexOf("UPDATE public.declutter_free_requests SET status = 'picked'"));
  });

  it("the newest deadline sweep runs the free-ask half, and that half closes, tells and reminds", () => {
    expect(newestFunctionBody("sweep_deadline_reminders")).toContain("v_free_asks := public.sweep_declutter_free_asks(p_now);");
    const sweep = newestFunctionBody("sweep_declutter_free_asks");
    expect(sweep).toContain("SET status = 'expired', closed_at = p_now WHERE q.status = 'open' AND q.pickup_at IS NOT NULL AND q.pickup_at <= p_now");
    expect(sweep).toContain("'Your pickup time passed'");
    expect(sweep).toContain("q.pickup_at <= p_now + interval '2 hours'");
    expect(sweep).toContain("IF public.needs_you_reminder_quiet(p_now) THEN");
  });
});
