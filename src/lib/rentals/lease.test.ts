/**
 * The lease reads before db-deploy has created their RPCs (lead review of the lease round 2 #3 #4): PostgREST
 * answers PGRST202, with or without a "Perhaps you meant..." hint (PostgREST 11+). Both read as "not
 * deployed": the card shows nothing (never a guessed side) and Past leases is empty. Any other error throws.
 *
 * @mutate src/lib/rentals/lease.ts |   if (res.error && isMissingRpc(res.error)) return null; |   if (res.error && isMissingRpc(res.error) && !(res.error as { hint?: unknown }).hint) return null;
 * @mutate src/lib/rentals/lease.ts |   if (res.error && isMissingRpc(res.error)) return []; |   if (false) return [];
 * @mutate src/lib/rentals/lease.ts |   if (storedHash !== shownHash) throw new RentalsCopyError(LEASE_DID_NOT_SAVE, null); |   if (false) throw new RentalsCopyError(LEASE_DID_NOT_SAVE, null);
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

const rpc = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a) } }));

import { fetchLease, fetchMyLeases, sendSavedLease } from "./lease";
import { initialLeaseFields } from "./leaseTemplate";

const PGRST202_HINT = { code: "PGRST202", message: "Could not find the function public.rentals_lease(p_tenancy_id) in the schema cache", hint: "Perhaps you meant to call the function public.rentals_deposit", details: null };
const PGRST202_BARE = { code: "PGRST202", message: "Could not find the function public.rentals_lease(p_tenancy_id) in the schema cache", hint: null, details: null };

describe("lease reads before the RPCs are deployed", () => {
  beforeEach(() => rpc.mockReset());

  it("PGRST202 with a hint is still 'not deployed': nothing, no guessed side", async () => {
    rpc.mockResolvedValue({ data: null, error: PGRST202_HINT, status: 404 });
    expect(await fetchLease("t1")).toBeNull();
    expect(await fetchMyLeases()).toEqual([]);
  });

  it("PGRST202 without a hint too", async () => {
    rpc.mockResolvedValue({ data: null, error: PGRST202_BARE, status: 404 });
    expect(await fetchLease("t1")).toBeNull();
  });

  it("any other error throws (the card's load-error line)", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "P0002", message: "tenancy_not_found", hint: null, details: null }, status: 400 });
    await expect(fetchLease("t1")).rejects.toBeTruthy();
  });
});

describe("round 3 M1a: the landlord sends only what was saved", () => {
  beforeEach(() => rpc.mockReset());
  const fields = { ...initialLeaseFields(), landlord_name: "Dana", rent_amount: "1200" };
  const answer = (stored: Record<string, unknown>) => (name: string) => {
    if (name === "rentals_lease_save") return { data: "L1", error: null, status: 200 };
    if (name === "rentals_lease") {
      return { data: { side: "landlord", tenancy_status: "active", can_edit: true, signed: [],
        open: { id: "L1", status: "draft", template_version: "la-2026-10-14", fields: stored, change_request: null, body_sha256: null,
          landlord_signed_name: null, landlord_signed_at: null, sent_at: null, updated_at: "2026-10-19T00:00:00Z" } }, error: null, status: 200 };
    }
    return { data: null, error: null, status: 200 };
  };

  it("the stored blanks differ from the screen's: nothing is sent", async () => {
    rpc.mockImplementation(async (name: string) => answer({ ...fields, rent_amount: "999" })(name));
    await expect(sendSavedLease("t1", fields, "Dana", true, [])).rejects.toBeTruthy();
    expect(rpc.mock.calls.some((c) => c[0] === "rentals_lease_send")).toBe(false);
  });

  it("they match: sent with the stored blanks and their hash", async () => {
    let lastSaved: Record<string, unknown> = {};
    rpc.mockImplementation(async (name: string, args: Record<string, unknown>) => {
      if (name === "rentals_lease_save") lastSaved = args.p_fields as Record<string, unknown>;
      return answer(lastSaved)(name);
    });
    await sendSavedLease("t1", fields, "Dana", true, []);
    const send = rpc.mock.calls.find((c) => c[0] === "rentals_lease_send");
    expect(send?.[1]).toMatchObject({ p_lease_id: "L1", p_template_version: "la-2026-10-14", p_signed_name: "Dana", p_consent: true });
    expect(String((send?.[1] as { p_body_sha256: string }).p_body_sha256)).toMatch(/^[0-9a-f]{64}$/);
  });
});
