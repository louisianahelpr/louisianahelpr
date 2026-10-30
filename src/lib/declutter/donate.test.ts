/**
 * Donate what doesn't sell (donate.ts, donateErrors.ts): what the seller's and the admin's calls send, and what the
 * Haul it away card and the admin list get back. The app never states what an item is worth, and nothing here moves
 * money; the rules are the server's.
 *
 * @mutate src/lib/declutter/donate.ts |     if (msg && Object.isExtensible(e)) e.userMessage = msg; |     if (false) e.userMessage = msg;
 * @mutate src/lib/declutter/donate.ts |     if (msg && Object.isExtensible(e)) e.userMessage = msg; |     if (msg) e.userMessage = msg;
 * @mutate src/lib/declutter/donate.ts | { p_item_ids: itemIds, p_partner_id: partnerId as string } | { p_item_ids: itemIds, p_partner_id: "" }
 * @mutate src/lib/declutter/donate.ts |   return Number(n ?? 0); |   return Number(n ?? 1);
 * @mutate src/lib/declutter/donate.ts | itemIds ? { p_item_ids: itemIds } : {} | { p_item_ids: itemIds as string[] }
 * @mutate src/lib/declutter/donate.ts |   return `${haulAwayPath}&donate=1`; |   return `${haulAwayPath}?donate=1`;
 * @mutate src/lib/declutter/donate.ts |   if (isNotDeployedYet(result.error)) return []; |   if (false) return [];
 * @mutate src/lib/declutter/donate.ts | .map((r) => ({ ...r, lat: Number(r.lat), lng: Number(r.lng) })) | .map((r) => r)
 * @mutate src/lib/declutter/donate.ts |     p_takes: p.takes ?? "", |     p_takes: p.takes as string,
 * @mutate src/lib/declutter/donate.ts | admin?.rpcErrorMessage("admin_declutter_save_donation_partner", e) ?? null | null
 * @mutate src/lib/declutter/donateErrors.ts | new RegExp(`(^\|[^a-z0-9_])${code}($\|[^a-z0-9_])`).test(raw) | raw.includes(code)
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  rpc: vi.fn(),
  calls: [] as unknown[][],
  result: { data: null as unknown, error: null as unknown },
}));
vi.mock("@/integrations/supabase/client", () => {
  const query = (): Record<string, unknown> => {
    const q: Record<string, unknown> = {
      then: (resolve: (r: unknown) => void) => resolve(h.result),
    };
    for (const m of ["select", "order"]) {
      q[m] = (...args: unknown[]) => { h.calls.push([m, ...args]); return q; };
    }
    return q;
  };
  return { supabase: { rpc: h.rpc, from: (t: string) => { h.calls.push(["from", t]); return query(); } } };
});

import { DECLUTTER_ERROR_COPY as DC } from "./errors";
import {
  adminSaveDonationPartner, chooseDonation, donatePostJobPath, fetchAllDonationPartners, fetchDonationPartnersNear, fetchMyDonations,
  oneDonationPartner, type MyDonation,
} from "./donate";
import { DONATE_ERROR_COPY, rpcErrorMessage } from "./donateErrors";
import { HAUL_AWAY_ERROR_COPY } from "./haulAwayErrors";

beforeEach(() => {
  h.rpc.mockReset();
  h.calls.length = 0;
  h.result = { data: null, error: null };
});

describe("fetchDonationPartnersNear", () => {
  it("asks about these items; no rows is an empty list", async () => {
    h.rpc.mockResolvedValue({ data: null, error: null });
    await expect(fetchDonationPartnersNear(["i1", "i2"])).resolves.toEqual([]);
    expect(h.rpc).toHaveBeenCalledWith("declutter_donation_partners_near", { p_item_ids: ["i1", "i2"] });
  });

  it("a refusal carries its plain words", async () => {
    h.rpc.mockResolvedValue({ data: null, error: { message: "haul_away_too_many" } });
    await expect(fetchDonationPartnersNear(["i1"])).rejects.toMatchObject({
      message: "haul_away_too_many",
      userMessage: HAUL_AWAY_ERROR_COPY.haul_away_too_many,
    });
  });

  it("a code with no words throws as it came", async () => {
    h.rpc.mockResolvedValue({ data: null, error: { message: "boom" } });
    const err = await fetchDonationPartnersNear(["i1"]).catch((e: unknown) => e) as Error & { userMessage?: string };
    expect(err.message).toBe("boom");
    expect(err.userMessage).toBeUndefined();
  });

  it("a frozen error is thrown as it is, not replaced by a TypeError from writing the words on it", async () => {
    const frozen = Object.freeze(new Error("item_not_found"));
    h.rpc.mockResolvedValue({ data: null, error: frozen });
    await expect(fetchDonationPartnersNear(["i1"])).rejects.toBe(frozen);
  });
});

describe("chooseDonation", () => {
  it("answers how many items it set, and sends the partner", async () => {
    h.rpc.mockResolvedValue({ data: 3, error: null });
    await expect(chooseDonation(["i1"], "p1")).resolves.toBe(3);
    expect(h.rpc).toHaveBeenCalledWith("declutter_choose_donation", { p_item_ids: ["i1"], p_partner_id: "p1" });
  });

  it("clearing the charity sends a real null, and no answer counts as none set", async () => {
    h.rpc.mockResolvedValue({ data: null, error: null });
    await expect(chooseDonation(["i1"], null)).resolves.toBe(0);
    expect(h.rpc).toHaveBeenCalledWith("declutter_choose_donation", { p_item_ids: ["i1"], p_partner_id: null });
  });

  it("an item already on a posted job says so in words", async () => {
    h.rpc.mockResolvedValue({ data: null, error: { message: "donation_locked" } });
    await expect(chooseDonation(["i1"], "p1")).rejects.toMatchObject({ userMessage: DONATE_ERROR_COPY.donation_locked });
  });
});

describe("fetchMyDonations", () => {
  it("all of the seller's rows sends no item filter at all; these items sends them", async () => {
    h.rpc.mockResolvedValue({ data: null, error: null });
    await expect(fetchMyDonations()).resolves.toEqual([]);
    expect(h.rpc.mock.calls[0]).toStrictEqual(["declutter_my_donations", {}]);
    await fetchMyDonations(["i1"]);
    expect(h.rpc.mock.calls[1]).toStrictEqual(["declutter_my_donations", { p_item_ids: ["i1"] }]);
  });

  it("a signed-out read says so in words", async () => {
    h.rpc.mockResolvedValue({ data: null, error: { message: "not_authenticated" } });
    await expect(fetchMyDonations()).rejects.toMatchObject({ userMessage: DC.not_authenticated });
  });
});

describe("oneDonationPartner", () => {
  const row = (item_id: string, partner_name: string, receipt = false): MyDonation => ({
    item_id, item_title: item_id, partner_name, partner_address: "1 Main St", chosen_at: "2026-10-30T00:00:00Z", donated_at: null, receipt,
  });

  it("names the charity only when every item goes to the same one", () => {
    expect(oneDonationPartner([row("a", "Bea's"), row("b", "Bea's")], ["a", "b"])).toEqual({ name: "Bea's", address: "1 Main St" });
    expect(oneDonationPartner([row("a", "Bea's"), row("b", "Other")], ["a", "b"])).toBeNull();
    expect(oneDonationPartner([row("a", "Bea's")], ["a", "b"])).toBeNull();
    expect(oneDonationPartner([], [])).toBeNull();
  });

  it("a receipt is a donation already done, not one still going", () => {
    expect(oneDonationPartner([row("a", "Bea's", true)], ["a"])).toBeNull();
  });
});

describe("donatePostJobPath", () => {
  it("adds to the haul-away link's own query", () => {
    expect(donatePostJobPath("/post-job?haulAway=a,b")).toBe("/post-job?haulAway=a,b&donate=1");
  });
});

describe("fetchAllDonationPartners", () => {
  it("lists parish then name, with numeric map points", async () => {
    h.result = { data: [{ id: "p1", lat: "30.5", lng: "-91.25" }], error: null };
    const rows = await fetchAllDonationPartners();
    expect(rows[0]).toMatchObject({ lat: 30.5, lng: -91.25 });
    expect(h.calls).toContainEqual(["from", "declutter_donation_partners"]);
    expect(h.calls.filter((c) => c[0] === "order")).toEqual([["order", "parish"], ["order", "name"]]);
  });

  it("not deployed yet is an empty list; any other failure throws", async () => {
    h.result = { data: null, error: { code: "42P01", message: "relation does not exist" } };
    await expect(fetchAllDonationPartners()).resolves.toEqual([]);
    h.result = { data: null, error: { code: "42501", message: "permission denied" } };
    await expect(fetchAllDonationPartners()).rejects.toThrow("permission denied");
  });
});

describe("adminSaveDonationPartner", () => {
  const partner = { id: null, parish: "Lafayette", name: "Bea's", address: "1 Main St", lat: 30.2, lng: -92, takes: null, active: true };

  it("a new partner goes with no id, and an empty takes as blank", async () => {
    h.rpc.mockResolvedValue({ data: "new-id", error: null });
    await expect(adminSaveDonationPartner(partner)).resolves.toBe("new-id");
    expect(h.rpc).toHaveBeenCalledWith("admin_declutter_save_donation_partner", {
      p_id: null, p_parish: "Lafayette", p_name: "Bea's", p_address: "1 Main St", p_lat: 30.2, p_lng: -92, p_takes: "", p_active: true,
    });
  });

  it("a refusal reads the admin's own words", async () => {
    h.rpc.mockResolvedValue({ data: null, error: { message: "donation_partner_invalid" } });
    await expect(adminSaveDonationPartner(partner)).rejects.toMatchObject({
      userMessage: DONATE_ERROR_COPY.donation_partner_invalid,
    });
  });
});

describe("donate words", () => {
  it("a code matches as a whole word, inside a longer message too", () => {
    expect(rpcErrorMessage("declutter_choose_donation", "donation_locked")).toBe(DONATE_ERROR_COPY.donation_locked);
    expect(rpcErrorMessage("declutter_choose_donation", { message: "ERROR: donation_locked (P0001)" })).toBe(DONATE_ERROR_COPY.donation_locked);
    expect(rpcErrorMessage("declutter_choose_donation", "was_donation_locked_before")).toBeNull();
  });

  it("a code another RPC raises has no words here, and nothing to read is null", () => {
    expect(rpcErrorMessage("declutter_my_donations", "donation_locked")).toBeNull();
    expect(rpcErrorMessage("declutter_my_donations", null)).toBeNull();
    expect(rpcErrorMessage("declutter_my_donations", { message: 42 })).toBeNull();
  });
});
