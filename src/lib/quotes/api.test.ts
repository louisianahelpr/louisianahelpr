/**
 * Quotes' client calls (src/lib/quotes/api.ts), the only door to the quote RPCs.
 *
 * What is pinned: each call sends the RPC its name says with whole-dollar prices
 * turned into cents (optional fields omitted, never sent as null); a refusal
 * throws an Error whose message is the server's code with that RPC's words on
 * `userMessage`; a refusal for a missing ID check opens the one ID sheet; an id
 * the server did not answer is a throw, never an empty string; past-work photos
 * live under the quoter's own `quotes` folder.
 *
 * The Supabase client is a recording fake (calls logged, results queued).
 *
 * @mutate src/lib/quotes/api.ts |   if (!LISTING_PHOTO_UPLOAD_TYPES.includes(cleaned.type)) throw new Error("invalid_photo"); |
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  const queue: { data?: unknown; error?: unknown }[] = [];
  const reads: { table: string; ops: [string, unknown[]][] }[] = [];
  const rpcs: unknown[][] = [];
  const storage: unknown[][] = [];
  const idSheet: unknown[] = [];
  const next = () => queue.shift() ?? { data: null, error: null };
  const from = (table: string) => {
    const q = { table, ops: [] as [string, unknown[]][] };
    reads.push(q);
    const b: Record<string, (...a: unknown[]) => unknown> = {};
    for (const m of ["select", "eq"]) b[m] = (...a: unknown[]) => (q.ops.push([m, a]), b);
    b.maybeSingle = () => Promise.resolve(next());
    return b;
  };
  return {
    queue,
    reads,
    rpcs,
    storage,
    idSheet,
    clean: { type: "image/jpeg" },
    supabase: {
      from,
      rpc: (...a: unknown[]) => (rpcs.push(a), Promise.resolve(next())),
      storage: {
        from: (bucket: string) => ({
          upload: (...a: unknown[]) => (storage.push(["upload", bucket, ...a]), Promise.resolve(next())),
          remove: (...a: unknown[]) => (storage.push(["remove", bucket, ...a]), Promise.resolve(next())),
          getPublicUrl: (path: string) => ({ data: { publicUrl: `https://cdn.example/${bucket}/${path}` } }),
        }),
      },
    },
  };
});

vi.mock("@/integrations/supabase/client", () => ({ supabase: h.supabase }));
vi.mock("@/lib/identityCheck", async (orig) => ({
  ...(await orig<typeof import("@/lib/identityCheck")>()),
  openIdentityCheck: (reason: unknown) => (h.idSheet.push(reason), true),
}));
vi.mock("@/lib/declutter/photos", async (orig) => ({
  ...(await orig<typeof import("@/lib/declutter/photos")>()),
  cleanListingPhoto: async (f: File) => new File([f], "clean.jpg", { type: h.clean.type }),
}));

import {
  bookAcceptedQuote,
  cancelQuoteRequest,
  createQuoteRequest,
  dollars,
  fetchBookedJobPayment,
  fetchMyJobQuotes,
  fetchMyQuoteRequests,
  fetchOpenQuoteRequests,
  fetchQuotesForRequest,
  isMyQuoteRequest,
  offersOf,
  quotePhotoUrl,
  removeQuotePhotos,
  respondToQuote,
  submitJobQuote,
  switchToSetPrice,
  uploadQuotePhoto,
  withdrawJobQuote,
  type NewQuoteRequest,
} from "./api";
import { RPC_ERROR_COPY } from "@/lib/lifecycleErrors";

type Thrown = Error & { userMessage?: string };

beforeEach(() => {
  h.queue.length = 0;
  h.reads.length = 0;
  h.rpcs.length = 0;
  h.storage.length = 0;
  h.idSheet.length = 0;
  h.clean.type = "image/jpeg";
});

async function thrown(p: Promise<unknown>): Promise<Thrown> {
  try {
    await p;
  } catch (e) {
    return e as Thrown;
  }
  throw new Error("expected a throw");
}

describe("reads", () => {
  it("the four list RPCs, null data read as an empty list", async () => {
    h.queue.push({ data: [{ id: "r1" }] }, { data: null }, { data: [{ id: "q1" }] }, { data: null });
    await expect(fetchMyQuoteRequests()).resolves.toEqual([{ id: "r1" }]);
    await expect(fetchOpenQuoteRequests()).resolves.toEqual([]);
    await expect(fetchQuotesForRequest("r1")).resolves.toEqual([{ id: "q1" }]);
    await expect(fetchMyJobQuotes()).resolves.toEqual([]);
    expect(h.rpcs).toEqual([
      ["get_my_quote_requests"],
      ["list_open_quote_requests"],
      ["get_quotes_for_request", { p_request_id: "r1" }],
      ["get_my_job_quotes"],
    ]);
  });

  it("isMyQuoteRequest reads one row by id and poster; a non-uuid is nobody's and reads nothing", async () => {
    const id = "123e4567-e89b-42d3-a456-426614174000";
    h.queue.push({ data: { id } }, { data: null });
    await expect(isMyQuoteRequest(id, "u1")).resolves.toBe(true);
    await expect(isMyQuoteRequest(id, "u2")).resolves.toBe(false);
    await expect(isMyQuoteRequest("not-a-uuid", "u1")).resolves.toBe(false);
    expect(h.reads).toHaveLength(2);
    expect(h.reads[0].ops).toContainEqual(["eq", ["id", id]]);
    expect(h.reads[0].ops).toContainEqual(["eq", ["poster_id", "u1"]]);
  });

  it("a read refusal throws with its RPC's words", async () => {
    const code = Object.keys(RPC_ERROR_COPY.get_quotes_for_request)[0];
    h.queue.push({ error: { message: code } });
    const e = await thrown(fetchQuotesForRequest("r1"));
    expect(e.message).toBe(code);
    expect(e.userMessage).toBe((RPC_ERROR_COPY.get_quotes_for_request as Record<string, string>)[code]);
  });

  it("offersOf: an array is the offers, anything else is none", () => {
    expect(offersOf([{ by: "quoter", price_cents: 5000, note: null, at: "t" }])).toHaveLength(1);
    expect(offersOf(null)).toEqual([]);
    expect(offersOf({ by: "quoter" })).toEqual([]);
  });
});

describe("asking for quotes", () => {
  const req: NewQuoteRequest = {
    title: "Fence fix",
    description: "Two loose panels",
    category: "handyman",
    dateNeeded: "2026-11-03",
    startTime: null,
    estimatedHours: null,
    location: null,
    latitude: null,
    longitude: null,
    parish: null,
    windowHours: 48,
  };

  it("sends the request, leaving unknown fields out, and answers the new id", async () => {
    h.queue.push({ data: "req-1" });
    await expect(createQuoteRequest(req)).resolves.toBe("req-1");
    const [name, args] = h.rpcs[0] as [string, Record<string, unknown>];
    expect(name).toBe("create_quote_request");
    expect(args).toMatchObject({ p_title: "Fence fix", p_category: "handyman", p_date_needed: "2026-11-03", p_window_hours: 48 });
    for (const k of ["p_start_time", "p_estimated_hours", "p_location", "p_latitude", "p_longitude", "p_parish"]) expect(args[k]).toBeUndefined();
  });

  it("no id back is a throw, never an empty id", async () => {
    h.queue.push({ data: null });
    expect((await thrown(createQuoteRequest(req))).message).toBe("no_request_id");
  });

  it("a missing ID check opens the one ID sheet for posting, and still throws", async () => {
    h.queue.push({ error: { message: "identity_required_to_post" } });
    await thrown(createQuoteRequest(req));
    expect(h.idSheet).toEqual(["post"]);
  });

  it("any other refusal does not open the ID sheet", async () => {
    h.queue.push({ error: { message: "invalid_window" } });
    const e = await thrown(createQuoteRequest(req));
    expect(e.userMessage).toBe((RPC_ERROR_COPY.create_quote_request as Record<string, string>).invalid_window);
    expect(h.idSheet).toEqual([]);
  });
});

describe("quoting and answering", () => {
  it("submitJobQuote sends whole dollars as cents and answers the quote id", async () => {
    h.queue.push({ data: "q-1" }, { data: null });
    const input = { requestId: "r1", priceDollars: 149.6, note: "n", when: "Sat AM", photoPaths: ["u/quotes/a.jpg"] };
    await expect(submitJobQuote(input)).resolves.toBe("q-1");
    expect(h.rpcs[0]).toEqual(["submit_job_quote", {
      p_request_id: "r1", p_price_cents: 15000, p_note: "n", p_available_note: "Sat AM", p_photo_paths: ["u/quotes/a.jpg"],
    }]);
    expect((await thrown(submitJobQuote(input))).message).toBe("no_quote_id");
  });

  it("respondToQuote: a counter carries a price and trimmed note; an accept carries neither", async () => {
    h.queue.push({ data: "countered" }, { data: "accepted" }, { data: null });
    await expect(respondToQuote({ quoteId: "q1", action: "counter", priceDollars: 120, note: "  Can you do 120?  " })).resolves.toBe("countered");
    await expect(respondToQuote({ quoteId: "q1", action: "accept", note: "   " })).resolves.toBe("accepted");
    expect(h.rpcs[0]).toEqual(["respond_to_job_quote", { p_quote_id: "q1", p_action: "counter", p_price_cents: 12000, p_note: "Can you do 120?" }]);
    expect(h.rpcs[1]).toEqual(["respond_to_job_quote", { p_quote_id: "q1", p_action: "accept", p_price_cents: undefined, p_note: undefined }]);
    expect((await thrown(respondToQuote({ quoteId: "q1", action: "decline" }))).message).toBe("no_answer");
  });

  it("booking and switching to a set price answer the job id, and throw without one", async () => {
    h.queue.push({ data: "job-1" }, { data: "job-2" }, { data: null }, { data: null });
    await expect(bookAcceptedQuote("r1")).resolves.toBe("job-1");
    await expect(switchToSetPrice("r1", 80)).resolves.toBe("job-2");
    expect((await thrown(bookAcceptedQuote("r1"))).message).toBe("no_job_id");
    expect((await thrown(switchToSetPrice("r1", 80))).message).toBe("no_job_id");
    expect(h.rpcs[1]).toEqual(["switch_quote_request_to_set_price", { p_request_id: "r1", p_budget: 80 }]);
  });

  it("cancel and withdraw send their ids; a refusal throws", async () => {
    h.queue.push({}, {}, { error: { message: "quotes_closed" } });
    await cancelQuoteRequest("r1");
    await withdrawJobQuote("q1");
    await thrown(withdrawJobQuote("q1"));
    expect(h.rpcs.slice(0, 2)).toEqual([["cancel_quote_request", { p_request_id: "r1" }], ["withdraw_job_quote", { p_quote_id: "q1" }]]);
  });
});

describe("every RPC call words its refusal from its own table", () => {
  it("each call's refusal carries that RPC's words (floor)", async () => {
    const calls: [keyof typeof RPC_ERROR_COPY, () => Promise<unknown>][] = [
      ["get_my_quote_requests", () => fetchMyQuoteRequests()],
      ["list_open_quote_requests", () => fetchOpenQuoteRequests()],
      ["get_my_job_quotes", () => fetchMyJobQuotes()],
      ["submit_job_quote", () => submitJobQuote({ requestId: "r1", priceDollars: 50, note: "", when: "", photoPaths: [] })],
      ["respond_to_job_quote", () => respondToQuote({ quoteId: "q1", action: "accept" })],
      ["book_accepted_quote", () => bookAcceptedQuote("r1")],
      ["switch_quote_request_to_set_price", () => switchToSetPrice("r1", 80)],
      ["cancel_quote_request", () => cancelQuoteRequest("r1")],
      ["withdraw_job_quote", () => withdrawJobQuote("q1")],
    ];
    expect(calls.length).toBeGreaterThan(8);
    for (const [rpc, call] of calls) {
      const [code, words] = Object.entries(RPC_ERROR_COPY[rpc] as Record<string, string>).slice(-1)[0]!;
      h.queue.push({ error: { message: code } });
      const e = await thrown(call());
      expect((h.rpcs.slice(-1)[0] as unknown[])[0], rpc).toBe(rpc);
      expect(e.message).toBe(code);
      expect(e.userMessage, `${rpc}.${code}`).toBe(words);
    }
  });
});

describe("past-work photos", () => {
  it("uploads the cleaned JPEG under the quoter's own quotes folder, never overwriting", async () => {
    const path = await uploadQuotePhoto("u1", new File(["x"], "a.png", { type: "image/png" }));
    expect(path).toMatch(/^u1\/quotes\/[^/]+\.jpg$/);
    const [op, bucket, sentPath, file, opts] = h.storage[0] as [string, string, string, File, Record<string, unknown>];
    expect([op, bucket, sentPath]).toEqual(["upload", "job-photos", path]);
    expect(file.type).toBe("image/jpeg");
    expect(opts).toMatchObject({ contentType: "image/jpeg", upsert: false });
  });

  it("a photo that did not clean to JPEG, or a failed upload, is invalid_photo", async () => {
    h.clean.type = "image/png";
    expect((await thrown(uploadQuotePhoto("u1", new File(["x"], "a.png", { type: "image/png" })))).message).toBe("invalid_photo");
    expect(h.storage).toHaveLength(0);
    h.clean.type = "image/jpeg";
    h.queue.push({ error: { message: "The resource already exists" } });
    expect((await thrown(uploadQuotePhoto("u1", new File(["x"], "a.jpg", { type: "image/jpeg" })))).message).toBe("invalid_photo");
  });

  it("removes unsent photos (nothing to remove calls nothing; a failure only warns)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await removeQuotePhotos([]);
    expect(h.storage).toHaveLength(0);
    h.queue.push({ error: { message: "denied" } });
    await removeQuotePhotos(["u1/quotes/a.jpg"]);
    expect(h.storage[0]).toEqual(["remove", "job-photos", ["u1/quotes/a.jpg"]]);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it("a photo's public URL is in the job-photos bucket", () => {
    expect(quotePhotoUrl("u1/quotes/a.jpg")).toBe("https://cdn.example/job-photos/u1/quotes/a.jpg");
  });
});

describe("fetchBookedJobPayment", () => {
  const read = async (payment_status: string | null, status: string | null = "open") => {
    h.queue.push({ data: payment_status === undefined ? null : { payment_status, status } });
    return fetchBookedJobPayment("j1");
  };

  it("only money held or paid out reads as paid; every other state is named", async () => {
    expect(await read("escrow")).toBe("paid");
    expect(await read("payout_pending")).toBe("paid");
    expect(await read("released")).toBe("paid");
    expect(await read("unpaid")).toBe("not_paid");
    expect(await read(null)).toBe("not_paid");
    expect(await read("unpaid", "cancelled")).toBe("cancelled");
    expect(await read("refunded")).toBe("refunded");
    expect(await read("cancelled")).toBe("cancelled");
    expect(await read("cancelling")).toBe("cancelling");
    expect(await read("chargeback")).toBe("disputed");
    expect(await read("something_new")).toBe("unknown");
    expect(h.reads[0].ops).toContainEqual(["eq", ["id", "j1"]]);
  });
});

describe("dollars", () => {
  it("whole dollars with thousands separators", () => {
    expect(dollars(15000)).toBe("$150");
    expect(dollars(123456)).toBe("$1,235");
  });
});
