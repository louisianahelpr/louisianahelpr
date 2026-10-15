/**
 * docs/OPEN.md Q1816 (vacuity member): prod-seed --apply must still repair its
 * EXISTING seed jobs when the shared poster holds 5 open paid jobs.
 *
 * enforce_open_job_limit is BEFORE INSERT, and PostgREST's upsert is an INSERT
 * ... ON CONFLICT DO UPDATE, so the cap refused even the repair of rows that
 * already existed. vacuity run 38684819715 (2026-10-15) lost both prod legs to
 * it: `prod-seed --apply failed: POST jobs → 400 ... maximum of 5 open jobs`,
 * while poster-e2e held three funded e2e-journeys leftovers.
 *
 * The fix (scripts/audit/openJobCapFallback.mjs): on exactly that refusal,
 * existing rows are written by PATCH (an UPDATE the cap does not judge), each
 * proven by its returned row; a row that does not exist yet is thrown with the
 * cause named. prod-seed's upsert routes every `jobs` chunk through it.
 *
 * @mutate scripts/audit/openJobCapFallback.mjs |     if (!OPEN_JOB_CAP_REFUSAL.test(message)) throw e; |     throw e;
 * @mutate scripts/audit/openJobCapFallback.mjs |     if (missing.length) { |     if (false) {
 * @mutate scripts/audit/openJobCapFallback.mjs |       if (!Array.isArray(got) \|\| got.length !== 1) { |       if (!Array.isArray(got)) {
 * @mutate scripts/audit/prod-seed.mjs |     out.push(...(table === "jobs" && onConflict === "id" ? await upsertJobsPastOpenJobCap(chunk, { |     out.push(...(false ? await upsertJobsPastOpenJobCap(chunk, {
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { upsertJobsPastOpenJobCap } from "../../scripts/audit/openJobCapFallback.mjs";
import { blankComments } from "./helpers/blankNonCode";

const CAP = new Error('POST jobs → 400 {"code":"P0001","details":null,"hint":null,"message":"You can have a maximum of 5 open jobs at a time. Please wait for existing jobs to be accepted or close them first."}');
const rows = [
  { id: "a", customer_id: "poster", status: "open", payment_status: "unpaid" },
  { id: "b", customer_id: "poster", status: "open", payment_status: "unpaid" },
];

function io({ post, existing = ["a", "b"], patchRows = 1 }: { post: () => Promise<object[]>; existing?: string[]; patchRows?: number }) {
  const patched: Array<{ id: string; values: Record<string, unknown> }> = [];
  return {
    patched,
    io: {
      post,
      existingIds: async (ids: string[]) => ids.filter((id) => existing.includes(id)),
      patch: async (id: string, values: Record<string, unknown>) => {
        patched.push({ id, values });
        return Array.from({ length: patchRows }, () => ({ id }));
      },
    },
  };
}

describe("prod-seed repairs existing seed jobs past the 5-open-job cap (Q1816 vacuity)", () => {
  it("a normal upsert is one POST and nothing else", async () => {
    const t = io({ post: async () => rows });
    expect(await upsertJobsPastOpenJobCap(rows, t.io)).toEqual(rows);
    expect(t.patched).toEqual([]);
  });

  it("the cap refusing existing rows: each is written by PATCH, without its id in the body", async () => {
    const t = io({ post: async () => { throw CAP; } });
    expect(await upsertJobsPastOpenJobCap(rows, t.io)).toEqual([{ id: "a" }, { id: "b" }]);
    expect(t.patched.map((p) => p.id)).toEqual(["a", "b"]);
    expect(t.patched[0].values).toEqual({ customer_id: "poster", status: "open", payment_status: "unpaid" });
  });

  it("the cap refusing a row that does not exist yet: thrown with the cause named, nothing patched", async () => {
    const t = io({ post: async () => { throw CAP; }, existing: ["a"] });
    await expect(upsertJobsPastOpenJobCap(rows, t.io)).rejects.toThrow(/1 seed job\(s\) do not exist yet \(b\).*enforce_open_job_limit/);
    expect(t.patched).toEqual([]);
  });

  it("any other refusal is rethrown as it was", async () => {
    const other = new Error('POST jobs → 409 {"code":"23505"}');
    const t = io({ post: async () => { throw other; } });
    await expect(upsertJobsPastOpenJobCap(rows, t.io)).rejects.toBe(other);
    expect(t.patched).toEqual([]);
  });

  it("a PATCH that wrote no row is an error, not a repair", async () => {
    const t = io({ post: async () => { throw CAP; }, patchRows: 0 });
    await expect(upsertJobsPastOpenJobCap(rows, t.io)).rejects.toThrow(/wrote 0 row\(s\), expected 1/);
  });

  it("prod-seed's upsert sends every jobs chunk through it", () => {
    const src = blankComments(readFileSync(join(__dirname, "..", "..", "scripts/audit/prod-seed.mjs"), "utf8"));
    expect(src).toMatch(/import \{ upsertJobsPastOpenJobCap \} from "\.\/openJobCapFallback\.mjs";/);
    expect(src).toMatch(/table === "jobs" && onConflict === "id" \? await upsertJobsPastOpenJobCap\(chunk,/);
    // Every jobs write in the script is an upsert("jobs", ...) call, so it is covered. Floor: the two known callers.
    const callers = src.match(/\bupsert\("jobs",/g) ?? [];
    expect(callers.length).toBeGreaterThan(1);
  });
});
