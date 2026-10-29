/**
 * Helpr Guarantee client calls (src/lib/guarantee/index.ts): the four RPC doors,
 * the claim read, the photo upload, and the words a failed action shows.
 *
 * The server rules are pinned elsewhere (src/test/helprGuarantee.test.ts and its
 * PGlite proof). This file pins the CLIENT's half: each call sends the RPC its
 * name says with the arguments it was given (optional ones omitted, never sent
 * as null), a refusal comes back as the code's own words, and anything the copy
 * table does not know is reported and shown as the generic line, never as the
 * platform's own text.
 *
 * The Supabase client is a recording fake (calls logged, results from a queue).
 *
 * @mutate src/lib/guarantee/index.ts |     ...(fixDate ? { _fix_date: fixDate } : {}), |     _fix_date: fixDate,
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  const queue: { data?: unknown; error?: unknown }[] = [];
  const rpcs: unknown[][] = [];
  const reads: { table: string; ops: [string, unknown[]][] }[] = [];
  const uploads: unknown[][] = [];
  const reported: unknown[][] = [];
  const next = () => queue.shift() ?? { data: null, error: null };
  const from = (table: string) => {
    const q = { table, ops: [] as [string, unknown[]][] };
    reads.push(q);
    const b: Record<string, (...a: unknown[]) => unknown> = {};
    for (const m of ["select", "eq"]) b[m] = (...a: unknown[]) => (q.ops.push([m, a]), b);
    b.maybeSingle = (...a: unknown[]) => (q.ops.push(["maybeSingle", a]), Promise.resolve(next()));
    return b;
  };
  return {
    queue,
    rpcs,
    reads,
    uploads,
    reported,
    supabase: {
      from,
      rpc: (...a: unknown[]) => (rpcs.push(a), Promise.resolve(next())),
      storage: {
        from: (bucket: string) => ({
          upload: (...a: unknown[]) => (uploads.push([bucket, ...a]), Promise.resolve(next())),
        }),
      },
    },
  };
});

vi.mock("@/integrations/supabase/client", () => ({ supabase: h.supabase }));
vi.mock("@/lib/errorLogger", () => ({ report: (...a: unknown[]) => h.reported.push(a) }));

import {
  canAskForFix,
  fetchGuaranteeClaim,
  fixDateChoices,
  fixDateLabel,
  guaranteeErrorText,
  helprAnswerGuarantee,
  markGuaranteeFixed,
  openGuaranteeClaim,
  posterAnswerGuarantee,
  uploadGuaranteePhotos,
  type GuaranteeClaim,
  type GuaranteeJob,
} from "./index";
import { GUARANTEE_RPC_ERROR_COPY as COPY } from "./errorCopy";

const GENERIC = "We couldn't save that. Check your connection and try again.";

beforeEach(() => {
  h.queue.length = 0;
  h.rpcs.length = 0;
  h.reads.length = 0;
  h.uploads.length = 0;
  h.reported.length = 0;
});

/** The thrown value of a rejected promise (fails the test when it resolves). */
async function thrown(p: Promise<unknown>): Promise<unknown> {
  try {
    await p;
  } catch (e) {
    return e;
  }
  throw new Error("expected a throw");
}

describe("guaranteeErrorText", () => {
  it("shows the generic line for anything this module did not word, never the platform's text", () => {
    expect(guaranteeErrorText(new Error("TypeError: Failed to fetch"))).toBe(GENERIC);
    expect(guaranteeErrorText("guarantee_window_closed")).toBe(GENERIC);
    expect(guaranteeErrorText(null)).toBe(GENERIC);
  });
});

describe("fetchGuaranteeClaim", () => {
  it("reads this job's claim by job id and hands the row back", async () => {
    const row = { id: "c1", job_id: "j1", status: "awaiting_helpr" };
    h.queue.push({ data: row, error: null });
    await expect(fetchGuaranteeClaim("j1")).resolves.toEqual(row);
    expect(h.reads[0].table).toBe("job_guarantee_claims");
    expect(h.reads[0].ops).toContainEqual(["eq", ["job_id", "j1"]]);
  });

  it("no row reads as null", async () => {
    h.queue.push({ data: null, error: null });
    await expect(fetchGuaranteeClaim("j1")).resolves.toBeNull();
  });

  it("a table the database has not deployed yet means no claim can exist (null, not a throw)", async () => {
    h.queue.push({ data: null, error: { code: "42P01", message: 'relation "job_guarantee_claims" does not exist' } });
    await expect(fetchGuaranteeClaim("j1")).resolves.toBeNull();
  });

  it("any other read error throws (never dropped)", async () => {
    h.queue.push({ data: null, error: { code: "42501", message: "permission denied" } });
    const e = await thrown(fetchGuaranteeClaim("j1"));
    expect((e as Error).message).toBe("permission denied");
  });
});

describe("the four RPC doors", () => {
  it("openGuaranteeClaim sends the job, note and photo paths and returns the new id", async () => {
    h.queue.push({ data: "claim-1", error: null });
    await expect(openGuaranteeClaim("j1", "The fence is still loose", ["u/disputes/j1/a.jpg"])).resolves.toBe("claim-1");
    expect(h.rpcs[0]).toEqual(["rpc_guarantee_open", { _job_id: "j1", _note: "The fence is still loose", _photo_paths: ["u/disputes/j1/a.jpg"] }]);
  });

  it("a refusal the table words comes back as those words, and is not reported (a designed refusal)", async () => {
    h.queue.push({ data: null, error: { message: "guarantee_window_closed" } });
    const e = await thrown(openGuaranteeClaim("j1", "note long enough here", []));
    expect(guaranteeErrorText(e)).toBe(COPY.rpc_guarantee_open.guarantee_window_closed);
    expect(h.reported).toHaveLength(0);
  });

  it("an error the table does not know shows the generic line and IS reported with its source", async () => {
    const err = { message: "upstream connect error" };
    h.queue.push({ data: null, error: err });
    const e = await thrown(openGuaranteeClaim("j1", "note long enough here", []));
    expect(guaranteeErrorText(e)).toBe(GENERIC);
    expect(h.reported).toEqual([[err, { tags: { source: "guarantee.open" } }]]);
  });

  it("helprAnswerGuarantee sends a fix date only when there is one", async () => {
    h.queue.push({ data: "fix_scheduled", error: null }, { data: "disputed", error: null });
    await expect(helprAnswerGuarantee("c1", true, "2026-10-30")).resolves.toBe("fix_scheduled");
    await expect(helprAnswerGuarantee("c1", false, null)).resolves.toBe("disputed");
    expect(h.rpcs[0]).toEqual(["rpc_guarantee_helpr_answer", { _claim_id: "c1", _accept: true, _fix_date: "2026-10-30" }]);
    expect(h.rpcs[1]).toEqual(["rpc_guarantee_helpr_answer", { _claim_id: "c1", _accept: false }]);
  });

  it("helprAnswerGuarantee words its own refusal (bad fix date)", async () => {
    h.queue.push({ data: null, error: { message: "guarantee_bad_fix_date" } });
    const e = await thrown(helprAnswerGuarantee("c1", true, "2026-12-30"));
    expect(guaranteeErrorText(e)).toBe(COPY.rpc_guarantee_helpr_answer.guarantee_bad_fix_date);
  });

  it("markGuaranteeFixed sends the claim id; an unknown error is reported as guarantee.markFixed", async () => {
    h.queue.push({ data: "fixed", error: null });
    await expect(markGuaranteeFixed("c1")).resolves.toBe("fixed");
    expect(h.rpcs[0]).toEqual(["rpc_guarantee_mark_fixed", { _claim_id: "c1" }]);
    h.queue.push({ data: null, error: { message: "boom" } });
    const e = await thrown(markGuaranteeFixed("c1"));
    expect(guaranteeErrorText(e)).toBe(GENERIC);
    expect(h.reported[0][1]).toEqual({ tags: { source: "guarantee.markFixed" } });
  });

  it("posterAnswerGuarantee sends a note only when there is one", async () => {
    h.queue.push({ data: "closed", error: null }, { data: "escalating", error: null });
    await expect(posterAnswerGuarantee("c1", true, null)).resolves.toBe("closed");
    await expect(posterAnswerGuarantee("c1", false, "Still wobbles")).resolves.toBe("escalating");
    expect(h.rpcs[0]).toEqual(["rpc_guarantee_poster_answer", { _claim_id: "c1", _fixed: true }]);
    expect(h.rpcs[1]).toEqual(["rpc_guarantee_poster_answer", { _claim_id: "c1", _fixed: false, _note: "Still wobbles" }]);
  });

  it("posterAnswerGuarantee words its own refusal (needs a note), not the open RPC's", async () => {
    h.queue.push({ data: null, error: { message: "guarantee_needs_note" } });
    const e = await thrown(posterAnswerGuarantee("c1", false, null));
    expect(guaranteeErrorText(e)).toBe(COPY.rpc_guarantee_poster_answer.guarantee_needs_note);
    expect(guaranteeErrorText(e)).not.toBe(COPY.rpc_guarantee_open.guarantee_needs_note);
  });
});

describe("uploadGuaranteePhotos", () => {
  const jpeg = (name: string) => new File(["x"], name, { type: "image/jpeg" });

  it("uploads each photo under the poster's disputes folder for the job and returns the paths", async () => {
    const paths = await uploadGuaranteePhotos("u1", "j1", [jpeg("a.jpg"), jpeg("b.jpg")]);
    expect(paths).toHaveLength(2);
    for (const p of paths) expect(p).toMatch(/^u1\/disputes\/j1\/\d+-[a-z0-9]+\.jpg$/);
    expect(h.uploads.map((u) => u[0])).toEqual(["proof-photos", "proof-photos"]);
    expect(h.uploads.map((u) => u[1])).toEqual(paths);
  });

  it("a type the bucket refuses is refused before anything uploads, with the bad-photo words", async () => {
    const gif = new File(["x"], "a.gif", { type: "image/gif" });
    const e = await thrown(uploadGuaranteePhotos("u1", "j1", [jpeg("a.jpg"), gif]));
    expect(guaranteeErrorText(e)).toBe(COPY.rpc_guarantee_open.guarantee_bad_photo);
    expect(h.uploads).toHaveLength(0);
  });

  it("every photo or none: a failed upload stops and throws the bad-photo words", async () => {
    h.queue.push({ error: null }, { error: { message: "Payload too large" } });
    const e = await thrown(uploadGuaranteePhotos("u1", "j1", [jpeg("a.jpg"), jpeg("b.jpg"), jpeg("c.jpg")]));
    expect(guaranteeErrorText(e)).toBe(COPY.rpc_guarantee_open.guarantee_bad_photo);
    expect(h.uploads).toHaveLength(2);
  });

  it("no photos uploads nothing", async () => {
    await expect(uploadGuaranteePhotos("u1", "j1", [])).resolves.toEqual([]);
    expect(h.uploads).toHaveLength(0);
  });
});

describe("canAskForFix", () => {
  const now = new Date("2026-10-29T18:00:00Z");
  const job: GuaranteeJob = {
    id: "j1",
    customer_id: "poster",
    helper_id: "helpr",
    status: "completed",
    payment_status: "payout_pending",
    is_group_job: false,
    completed_at: "2026-10-28T18:00:00Z",
  };

  it("falls back to the later done stamp when completed_at is missing", () => {
    const j = { ...job, completed_at: null, helper_completed_at: "2026-10-26T00:00:00Z", poster_completed_at: "2026-10-28T12:00:00Z" };
    expect(canAskForFix(j, "poster", null, now)).toBe(true);
    // Both stamps more than 48 h old: the window has passed.
    const old = { ...j, poster_completed_at: "2026-10-26T12:00:00Z" };
    expect(canAskForFix(old, "poster", null, now)).toBe(false);
  });

  it("no done stamp at all offers nothing", () => {
    expect(canAskForFix({ ...job, completed_at: null }, "poster", null, now)).toBe(false);
  });

  it("an existing claim, an unpaid-out-not-pending job, or another viewer offers nothing", () => {
    expect(canAskForFix(job, "poster", { id: "c" } as GuaranteeClaim, now)).toBe(false);
    expect(canAskForFix({ ...job, payment_status: "paid_out" }, "poster", null, now)).toBe(false);
    expect(canAskForFix(job, "helpr", null, now)).toBe(false);
    expect(canAskForFix(job, "poster", null, now)).toBe(true);
  });
});

describe("fixDateLabel / fixDateChoices", () => {
  it("labels a day without sliding it across time zones", () => {
    expect(fixDateLabel("2026-10-29")).toBe("Thu, Oct 29");
    expect(fixDateLabel("2027-01-01")).toBe("Fri, Jan 1");
  });

  it("offers consecutive Louisiana days, today first while a visit today is still possible", () => {
    // 9:00 AM in Louisiana (CDT, UTC-5): a same-day visit is still possible.
    const morning = fixDateChoices(new Date("2026-10-29T14:00:00Z"));
    expect(morning).toEqual(["2026-10-29", "2026-10-30", "2026-10-31", "2026-11-01"]);
    // 11:20 PM in Louisiana: today is gone, the next three days remain (audit F31).
    const late = fixDateChoices(new Date("2026-10-30T04:20:00Z"));
    expect(late).toEqual(["2026-10-30", "2026-10-31", "2026-11-01"]);
  });
});
