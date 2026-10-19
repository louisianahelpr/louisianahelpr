/**
 * Shops M2 handover client (src/lib/shops/handover.ts): what each call sends,
 * the plain words a refusal carries, and the payout line a shop reads.
 *
 * Added for nightly-red #3395 (main: Vitest, "Coverage floor"): the M2 merge
 * (d65f58fd9) added handover.ts with no test, and src/lib/ line coverage fell
 * from 81.51% to 81.09% under its 81.17% floor. These assertions pin real
 * behaviour, not just lines run:
 *
 * @mutate src/lib/shops/handover.ts |   if (orderIds.length === 0) return new Map(); |   if (orderIds.length === -1) return new Map();
 * @mutate src/lib/shops/handover.ts |   return ((row as { handover_mode?: HandoverMode } \| null)?.handover_mode ?? "in_person"); |   return ((row as { handover_mode?: HandoverMode } \| null)?.handover_mode ?? "porch");
 * @mutate src/lib/shops/handover.ts |   const debt = p.debt_cents > 0 ? |   const debt = p.debt_cents > 1e9 ?
 * @mutate src/lib/shops/handover.ts |   if (!isStorageObjectPath(path)) return null; |   void isStorageObjectPath;
 * @mutate src/lib/shops/handover.ts |   const { error } = await supabase.rpc("shops_report_not_received", { p_order_id: orderId, p_note: note.trim() }); |   const { error } = await supabase.rpc("shops_report_not_received", { p_order_id: orderId, p_note: note });
 * @mutate src/lib/shops/handover.ts |     upsert: false, |     upsert: true,
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  rpc: vi.fn(),
  upload: vi.fn(),
  signed: vi.fn(),
  bucket: vi.fn(),
  table: vi.fn(),
  result: { data: null as unknown, error: null as { message: string } | null },
  calls: [] as Array<[string, unknown[]]>,
}));

vi.mock("@/integrations/supabase/client", () => {
  // A chainable PostgREST stand-in: records each builder call, resolves to h.result.
  const builder = (): Record<string, unknown> => {
    const b: Record<string, unknown> = {};
    for (const m of ["select", "eq", "in", "order", "limit", "maybeSingle"]) {
      b[m] = (...args: unknown[]) => { h.calls.push([m, args]); return b; };
    }
    b.then = (ok: (v: unknown) => unknown, bad: (e: unknown) => unknown) => Promise.resolve(h.result).then(ok, bad);
    return b;
  };
  return {
    supabase: {
      rpc: h.rpc,
      from: (t: string) => { h.table(t); return builder(); },
      storage: {
        from: (b: string) => { h.bucket(b); return { upload: h.upload, createSignedUrl: h.signed }; },
      },
    },
  };
});
vi.mock("@/lib/declutter/photos", () => ({
  cleanListingPhoto: async (f: File) => f,
  LISTING_PHOTO_UPLOAD_TYPES: ["image/jpeg"],
}));

import {
  confirmPickup,
  fetchHandoverMode,
  fetchHandovers,
  fetchMyShopPayouts,
  HANDOVER_MODES,
  HANDOVER_MODE_TEXT,
  markReady,
  payoutText,
  readyPhotoUrl,
  reportNotReceived,
  setHandoverMode,
  uploadReadyPhoto,
} from "./handover";
import { SHOPS_ERROR_COPY } from "./errors";

const jpeg = (type = "image/jpeg") => new File([new Uint8Array([1, 2, 3])], "a.jpg", { type });

beforeEach(() => {
  for (const f of [h.rpc, h.upload, h.signed, h.bucket, h.table]) f.mockReset();
  h.result = { data: null, error: null };
  h.calls = [];
});

describe("handover choices", () => {
  it("offers exactly the two modes, each with a label and a detail", () => {
    expect(HANDOVER_MODES.sort()).toEqual(["in_person", "porch"]);
    for (const m of HANDOVER_MODES) {
      expect(HANDOVER_MODE_TEXT[m].label.length).toBeGreaterThan(5);
      expect(HANDOVER_MODE_TEXT[m].detail).toMatch(/24 hours after the ready date/);
    }
  });

  it("reads the shop's mode, and a shop with none set is in person", async () => {
    h.result = { data: { handover_mode: "porch" }, error: null };
    expect(await fetchHandoverMode("shop-1")).toBe("porch");
    expect(h.table).toHaveBeenCalledWith("shops");
    expect(h.calls).toContainEqual(["eq", ["id", "shop-1"]]);
    h.result = { data: null, error: null };
    expect(await fetchHandoverMode("shop-2")).toBe("in_person");
  });

  it("a failed mode read throws instead of guessing", async () => {
    h.result = { data: null, error: { message: "boom" } };
    await expect(fetchHandoverMode("shop-1")).rejects.toThrow("boom");
  });

  it("setHandoverMode sends the mode and returns what the server saved", async () => {
    h.rpc.mockResolvedValue({ data: "porch", error: null });
    expect(await setHandoverMode("porch")).toBe("porch");
    expect(h.rpc).toHaveBeenCalledWith("shops_set_handover_mode", { p_mode: "porch" });
  });

  it("a refused mode change carries the shops words", async () => {
    h.rpc.mockResolvedValue({ data: null, error: { message: "invalid_handover_mode" } });
    await expect(setHandoverMode("porch")).rejects.toMatchObject({
      message: "invalid_handover_mode",
      userMessage: SHOPS_ERROR_COPY.invalid_handover_mode,
    });
  });
});

describe("handover rows and payouts", () => {
  it("asks for nothing when there are no orders", async () => {
    expect((await fetchHandovers([])).size).toBe(0);
    expect(h.table).not.toHaveBeenCalled();
  });

  it("maps handover rows by order id", async () => {
    h.result = {
      data: [
        { order_id: "o1", ready_at: "2026-10-19T10:00:00Z", ready_photo_path: null, confirmed_at: null, confirmed_how: null, problem_at: null },
        { order_id: "o2", ready_at: null, ready_photo_path: null, confirmed_at: "2026-10-19T11:00:00Z", confirmed_how: "buyer", problem_at: null },
      ],
      error: null,
    };
    const m = await fetchHandovers(["o1", "o2"]);
    expect(h.table).toHaveBeenCalledWith("shop_handovers");
    expect(h.calls).toContainEqual(["in", ["order_id", ["o1", "o2"]]]);
    expect(m.get("o1")?.ready_at).toBe("2026-10-19T10:00:00Z");
    expect(m.get("o2")?.confirmed_how).toBe("buyer");
  });

  it("reads the shop's payouts newest first, at most 100", async () => {
    h.result = { data: [{ id: "p1" }], error: null };
    expect(await fetchMyShopPayouts()).toEqual([{ id: "p1" }]);
    expect(h.table).toHaveBeenCalledWith("shop_payouts");
    expect(h.calls).toContainEqual(["order", ["created_at", { ascending: false }]]);
    expect(h.calls).toContainEqual(["limit", [100]]);
    h.result = { data: null, error: null };
    expect(await fetchMyShopPayouts()).toEqual([]);
  });
});

describe("ready photo", () => {
  it("uploads to <uid>/shops/handover/<order>/ in the private bucket, never overwriting", async () => {
    h.upload.mockResolvedValue({ error: null });
    const path = await uploadReadyPhoto("u1", "o1", jpeg());
    expect(path).toMatch(/^u1\/shops\/handover\/o1\/[^/]+\.jpg$/);
    expect(h.bucket).toHaveBeenCalledWith("shop-handover");
    expect(h.upload.mock.calls[0][0]).toBe(path);
    expect(h.upload.mock.calls[0][2]).toMatchObject({ contentType: "image/jpeg", upsert: false });
  });

  it("refuses a photo type the listing cleaner did not produce, before any upload", async () => {
    await expect(uploadReadyPhoto("u1", "o1", jpeg("image/gif"))).rejects.toThrow("photo_not_uploaded");
    expect(h.upload).not.toHaveBeenCalled();
  });

  it("a failed upload says so in plain words", async () => {
    h.upload.mockResolvedValue({ error: { message: "storage down" } });
    await expect(uploadReadyPhoto("u1", "o1", jpeg())).rejects.toMatchObject({
      message: "photo_not_uploaded",
      userMessage: "That photo didn't finish uploading. Try again.",
    });
  });

  it("signs only a storage path, and a failed signing is null, not a throw", async () => {
    expect(await readyPhotoUrl("https://evil.example/x.jpg")).toBeNull();
    expect(h.signed).not.toHaveBeenCalled();
    h.signed.mockResolvedValue({ data: { signedUrl: "https://signed/x" }, error: null });
    expect(await readyPhotoUrl("u1/shops/handover/o1/a.jpg")).toBe("https://signed/x");
    expect(h.signed).toHaveBeenCalledWith("u1/shops/handover/o1/a.jpg", 600);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    h.signed.mockResolvedValue({ data: null, error: { message: "nope" } });
    expect(await readyPhotoUrl("u1/shops/handover/o1/a.jpg")).toBeNull();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe("handover actions", () => {
  it("markReady sends the order and the photo", async () => {
    h.rpc.mockResolvedValue({ error: null });
    await markReady("o1", "u1/shops/handover/o1/a.jpg");
    expect(h.rpc).toHaveBeenCalledWith("shops_mark_ready", { p_order_id: "o1", p_photo_path: "u1/shops/handover/o1/a.jpg" });
  });

  it("markReady on a reported order carries the problem words", async () => {
    h.rpc.mockResolvedValue({ error: { message: "problem_open" } });
    await expect(markReady("o1", null)).rejects.toMatchObject({ userMessage: SHOPS_ERROR_COPY.problem_open });
  });

  it("confirmPickup sends the order; an uncharged order carries its words", async () => {
    h.rpc.mockResolvedValue({ error: null });
    await confirmPickup("o1");
    expect(h.rpc).toHaveBeenCalledWith("shops_confirm_pickup", { p_order_id: "o1" });
    h.rpc.mockResolvedValue({ error: { message: "order_not_charged_yet" } });
    await expect(confirmPickup("o1")).rejects.toMatchObject({ userMessage: SHOPS_ERROR_COPY.order_not_charged_yet });
  });

  it("reportNotReceived trims the note; an unknown refusal keeps its message and no userMessage", async () => {
    h.rpc.mockResolvedValue({ error: null });
    await reportNotReceived("o1", "  never left out  ");
    expect(h.rpc).toHaveBeenCalledWith("shops_report_not_received", { p_order_id: "o1", p_note: "never left out" });
    h.rpc.mockResolvedValue({ error: { message: "something_else" } });
    const err = await reportNotReceived("o1", "x").catch((e: unknown) => e as Error & { userMessage?: string });
    expect(err?.message).toBe("something_else");
    expect(err?.userMessage).toBeUndefined();
  });
});

describe("payoutText", () => {
  it("names the amount and the status in the shop's words", () => {
    expect(payoutText({ status: "succeeded", amount_cents: 1250, debt_cents: 0 })).toBe("$12.50 sent to your payout account.");
    expect(payoutText({ status: "nothing_due", amount_cents: 0, debt_cents: 300 })).toBe(
      "This order paid off $3.00 of card fees you owed, so nothing was sent.",
    );
    expect(payoutText({ status: "pending", amount_cents: 999, debt_cents: 0 })).toMatch(/^\$9\.99 is owed to you\. It's sent/);
    expect(payoutText({ status: "failed", amount_cents: 999, debt_cents: 0 })).toMatch(/^\$9\.99 is owed to you\. Sending it hasn't worked yet/);
  });

  it("says when a card-fee debt was taken out, and only then", () => {
    expect(payoutText({ status: "succeeded", amount_cents: 1000, debt_cents: 250 })).toBe(
      "$10.00 sent to your payout account ($2.50 card fee you owed was taken out).",
    );
    expect(payoutText({ status: "pending", amount_cents: 1000, debt_cents: 250 })).toContain("($2.50 card fee you owed was taken out)");
    expect(payoutText({ status: "pending", amount_cents: 1000, debt_cents: 0 })).not.toContain("card fee");
  });
});
