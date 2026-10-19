/**
 * Homes before landlord ID's migration is deployed (web can ship before db-deploy):
 * rentals_my_identity missing (PGRST202, no hint) reads as "not verified, nothing
 * sent", never the screen's load error. A PGRST202 WITH a hint (the function exists
 * with other arguments) and any other error still throw.
 *
 * @mutate src/lib/rentals/api.ts |   return e.code === "PGRST202" && !e.hint; |   return false;
 * @mutate src/lib/rentals/api.ts |   return e.code === "PGRST202" && !e.hint; |   return e.code === "PGRST202";
 */
import { describe, expect, it, vi } from "vitest";

const state = { rpc: { data: null as unknown, error: null as null | { code: string; message: string; hint?: string } } };
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: async () => state.rpc },
}));

import { fetchMyIdentity } from "./api";

describe("fetchMyIdentity before deploy", () => {
  it("a missing function reads as not verified, nothing sent", async () => {
    state.rpc = { data: null, error: { code: "PGRST202", message: "Could not find the function public.rentals_my_identity without parameters" } };
    expect(await fetchMyIdentity()).toEqual({ verified: false, idStatus: null, reviewNote: null, submittedAt: null, reviewedAt: null });
  });
  it("PGRST202 with a hint (wrong arguments) still throws", async () => {
    state.rpc = { data: null, error: { code: "PGRST202", message: "Could not find the function", hint: "Perhaps you meant to call public.rentals_my_identity(p_x)" } };
    await expect(fetchMyIdentity()).rejects.toBeTruthy();
  });
  it("any other error still throws", async () => {
    state.rpc = { data: null, error: { code: "42501", message: "feature_disabled" } };
    await expect(fetchMyIdentity()).rejects.toBeTruthy();
  });
  it("a deployed answer is read as before", async () => {
    state.rpc = { data: [{ verified: true, id_status: "approved", review_note: null, submitted_at: "2026-10-19T00:00:00Z", reviewed_at: "2026-10-19T01:00:00Z" }], error: null };
    expect(await fetchMyIdentity()).toMatchObject({ verified: true, idStatus: "approved" });
  });
});
