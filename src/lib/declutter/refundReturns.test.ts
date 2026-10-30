/**
 * Declutter returns (refundReturns.ts): the buyer's and the seller's calls for getting a full-refund item back. Money
 * moves only on the seller's "I got it back" (refundRequests.ts), so what these must get right is the way, the day,
 * the place and the live photo. A stale photo is refused before anything is uploaded.
 *
 * @mutate src/lib/declutter/refundReturns.ts |     if (msg && Object.isExtensible(e)) e.userMessage = msg; |     if (false) e.userMessage = msg;
 * @mutate src/lib/declutter/refundReturns.ts |     if (msg && Object.isExtensible(e)) e.userMessage = msg; |     if (msg) e.userMessage = msg;
 * @mutate src/lib/declutter/refundReturns.ts |       p_day: day as string, |       p_day: atIso as string,
 * @mutate src/lib/declutter/refundReturns.ts |       p_at: atIso as string, |       p_at: day as string,
 * @mutate src/lib/declutter/refundReturns.ts |       p_photo_path: photoPath, |       p_photo_path: requestId,
 * @mutate src/lib/declutter/refundReturns.ts |       p_address: address, |       p_address: requestId,
 * @mutate src/lib/declutter/refundReturns.ts |   assertLivePhoto(file); |   void assertLivePhoto;
 * @mutate src/lib/declutter/refundReturns.ts |   if (!LISTING_PHOTO_UPLOAD_TYPES.includes(cleaned.type)) throw new Error("photo_not_uploaded"); |   if (false) throw new Error("photo_not_uploaded");
 * @mutate src/lib/declutter/refundReturns.ts |   const path = `${userId}/declutter/return/${orderId}/${nonce}.jpg`; |   const path = `${orderId}/declutter/return/${userId}/${nonce}.jpg`;
 * @mutate src/lib/declutter/refundReturns.ts | supabase.storage.from("declutter-handover") | supabase.storage.from("declutter-photos")
 * @mutate src/lib/declutter/refundReturns.ts |     upsert: false, |     upsert: true,
 * @mutate src/lib/declutter/refundReturns.ts |   if (error) throw new Error("photo_not_uploaded"); |   if (false) throw new Error("photo_not_uploaded");
 * @mutate src/lib/declutter/refundReturns.ts | timeZone: "America/Chicago" | timeZone: "UTC"
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  rpc: vi.fn(),
  clean: vi.fn(),
  upload: vi.fn(),
  buckets: [] as string[],
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: h.rpc,
    storage: { from: (bucket: string) => { h.buckets.push(bucket); return { upload: h.upload }; } },
  },
}));
vi.mock("@/lib/declutter/photos", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/declutter/photos")>()),
  cleanListingPhoto: h.clean,
}));

import { DECLUTTER_ERROR_COPY as DC } from "./errors";
import { acceptRefundWithReturn, returnDayChoices, returnDayWords, returnDroppedOff, setReturnAddress, uploadReturnPhoto } from "./refundReturns";

const WHERE = { lat: 30.2, lng: -92 };

function photo(lastModified: number = Date.now()): File {
  return new File(["x"], "camera.jpg", { type: "image/jpeg", lastModified });
}

beforeEach(() => {
  h.rpc.mockReset();
  h.clean.mockReset();
  h.upload.mockReset();
  h.buckets.length = 0;
  h.clean.mockImplementation(async (f: File) => f);
  h.upload.mockResolvedValue({ data: {}, error: null });
});

describe("acceptRefundWithReturn", () => {
  it("a drop-off sends its day and no time; a collect its time and no day", async () => {
    h.rpc.mockResolvedValue({ data: { result: "returning" }, error: null });
    await acceptRefundWithReturn("r1", "drop_off", "2026-10-31", null);
    expect(h.rpc).toHaveBeenLastCalledWith("declutter_accept_refund_with_return", {
      p_request_id: "r1", p_way: "drop_off", p_day: "2026-10-31", p_at: null,
    });
    await acceptRefundWithReturn("r1", "collect", null, "2026-10-31T15:00:00Z");
    expect(h.rpc).toHaveBeenLastCalledWith("declutter_accept_refund_with_return", {
      p_request_id: "r1", p_way: "collect", p_day: null, p_at: "2026-10-31T15:00:00Z",
    });
  });

  it("a refusal carries its plain words, the original kept", async () => {
    h.rpc.mockResolvedValue({ data: null, error: { message: "invalid_return_way" } });
    await expect(acceptRefundWithReturn("r1", "collect", null, null)).rejects.toMatchObject({
      message: "invalid_return_way",
      userMessage: DC.invalid_return_way,
    });
  });

  it("a code with no words throws as it came", async () => {
    h.rpc.mockResolvedValue({ data: null, error: { message: "boom" } });
    const err = await acceptRefundWithReturn("r1", "collect", null, null).catch((e: unknown) => e) as Error & { userMessage?: string };
    expect(err.message).toBe("boom");
    expect(err.userMessage).toBeUndefined();
  });

  it("a frozen error is thrown as it is, not replaced by a TypeError from writing the words on it", async () => {
    const frozen = Object.freeze(new Error("item_not_found"));
    h.rpc.mockResolvedValue({ data: null, error: frozen });
    await expect(acceptRefundWithReturn("r1", "collect", null, null)).rejects.toBe(frozen);
  });
});

describe("returnDroppedOff", () => {
  it("sends the photo and where it was taken", async () => {
    h.rpc.mockResolvedValue({ data: { result: "dropped_off" }, error: null });
    await expect(returnDroppedOff("r1", "u1/declutter/return/o1/a.jpg", WHERE)).resolves.toEqual({ result: "dropped_off" });
    expect(h.rpc).toHaveBeenCalledWith("declutter_return_dropped_off", {
      p_request_id: "r1", p_photo_path: "u1/declutter/return/o1/a.jpg", p_lat: 30.2, p_lng: -92,
    });
  });

  it("too far from the address says so in words", async () => {
    h.rpc.mockResolvedValue({ data: null, error: { message: "not_at_pickup" } });
    await expect(returnDroppedOff("r1", "p", WHERE)).rejects.toMatchObject({ userMessage: DC.not_at_pickup });
  });
});

describe("setReturnAddress", () => {
  it("sends the address the buyer typed and its point", async () => {
    h.rpc.mockResolvedValue({ data: { result: "address_set" }, error: null });
    await expect(setReturnAddress("r1", "1 Main St", WHERE)).resolves.toEqual({ result: "address_set" });
    expect(h.rpc).toHaveBeenCalledWith("declutter_set_return_address", {
      p_request_id: "r1", p_address: "1 Main St", p_lat: 30.2, p_lng: -92,
    });
  });

  it("a request that isn't a collect says so in words", async () => {
    h.rpc.mockResolvedValue({ data: null, error: { message: "not_a_collect" } });
    await expect(setReturnAddress("r1", "1 Main St", WHERE)).rejects.toMatchObject({ userMessage: DC.not_a_collect });
  });
});

describe("uploadReturnPhoto", () => {
  it("uploads the cleaned photo to this user's folder for this order, in the private bucket, never over another", async () => {
    const cleaned = new File(["y"], "clean.jpg", { type: "image/jpeg" });
    h.clean.mockResolvedValue(cleaned);
    const path = await uploadReturnPhoto("u1", "o1", photo());
    expect(path).toMatch(/^u1\/declutter\/return\/o1\/[^/]+\.jpg$/);
    expect(h.buckets).toEqual(["declutter-handover"]);
    const [sentPath, sentFile, options] = h.upload.mock.calls[0];
    expect(sentPath).toBe(path);
    expect(sentFile).toBe(cleaned);
    expect(options).toMatchObject({ contentType: "image/jpeg", upsert: false });
  });

  it("a photo taken more than 10 minutes ago is refused before it is cleaned or uploaded", async () => {
    await expect(uploadReturnPhoto("u1", "o1", photo(Date.now() - 11 * 60_000))).rejects.toThrow("photo_too_old");
    expect(h.clean).not.toHaveBeenCalled();
    expect(h.upload).not.toHaveBeenCalled();
  });

  it("a cleaned photo in a type the bucket refuses is not sent", async () => {
    h.clean.mockResolvedValue(new File(["y"], "clean.gif", { type: "image/gif" }));
    await expect(uploadReturnPhoto("u1", "o1", photo())).rejects.toThrow("photo_not_uploaded");
    expect(h.upload).not.toHaveBeenCalled();
  });

  it("a failed upload throws, so no path that holds nothing reaches the server", async () => {
    h.upload.mockResolvedValue({ data: null, error: { message: "storage down" } });
    await expect(uploadReturnPhoto("u1", "o1", photo())).rejects.toThrow("photo_not_uploaded");
  });
});

describe("the days a seller may pick", () => {
  it("today and the next 7, by Louisiana's calendar: 9 pm in Lafayette is still that day", () => {
    const days = returnDayChoices(new Date(Date.UTC(2026, 9, 31, 2)));
    expect(days[0]).toBe("2026-10-30");
    expect(days).toHaveLength(8);
    expect(days[7]).toBe("2026-11-06");
  });

  it("the clocks changing never lists a day twice", () => {
    const days = returnDayChoices(new Date(Date.UTC(2026, 10, 1, 5)));
    expect(new Set(days).size).toBe(days.length);
    expect(days.length).toBeGreaterThan(6);
  });

  it("reads a calendar date as that date whatever the device's zone", () => {
    expect(returnDayWords("2026-10-30")).toMatch(/Fri.*Oct 30/);
  });
});
