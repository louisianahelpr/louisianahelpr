/**
 * Landlord ID photos are deleted LANDLORD_ID_RETENTION_DAYS (30, owner
 * 2026-10-19) after the admin's decision: the sweep cleanup-abandoned-accounts
 * runs daily (supabase/functions/_shared/landlordIdRetention.ts). Driven with a
 * fake client: which objects go, which stay, and that a failure never claims
 * the row is clean. The SQL half (due only after the window, the stamp touches
 * only the decision it read, service_role only) is
 * src/test/pglite/landlordIdReview.pglite.mjs.
 *
 * @mutate supabase/functions/_shared/landlordIdRetention.ts | export const LANDLORD_ID_RETENTION_DAYS = 30; | export const LANDLORD_ID_RETENTION_DAYS = 90;
 * @mutate supabase/functions/_shared/landlordIdRetention.ts |         if (!Number.isFinite(created) \|\| created <= decidedAt) doomed.push(`${prefix}/${o.name}`); |         doomed.push(`${prefix}/${o.name}`);
 * @mutate supabase/functions/_shared/landlordIdRetention.ts |       if (rmErr) {\n        out.failures.push(`${row.user_id}: remove ${rmErr.message}`);\n        continue;\n      } |       if (rmErr) {\n        out.failures.push(`${row.user_id}: remove ${rmErr.message}`);\n      }
 * @mutate supabase/functions/_shared/landlordIdRetention.ts |       if (removed !== doomed.length) { |       if (false) {
 * @mutate supabase/functions/_shared/landlordIdRetention.ts |   const paths = data.map((r) => r.name).filter((n) => typeof n === "string" && n.split("/")[1] === LANDLORD_ID_FOLDER); |   const paths = data.map((r) => r.name);
 * @mutate supabase/functions/_shared/landlordIdRetention.ts |     if (removed !== batch.length) out.failures.push | if (false) out.failures.push
 * @mutate supabase/functions/cleanup-abandoned-accounts/index.ts |     const landlordIdOrphans = await sweepOrphanLandlordIdImages(supabase as unknown as LandlordIdOrphanClient, { dryRun }); |     const landlordIdOrphans = { found: 0, removed: 0, failures: [] as string[] };
 * @mutate supabase/functions/cleanup-abandoned-accounts/index.ts |     const landlordId = await sweepLandlordIdImages(supabase as unknown as LandlordIdSweepClient, { dryRun }); |     const landlordId = { due: 0, removed: 0, stamped: 0, failures: [] as string[] };
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  LANDLORD_ID_ORPHAN_MIN_AGE_HOURS,
  LANDLORD_ID_RETENTION_DAYS,
  sweepLandlordIdImages,
  sweepOrphanLandlordIdImages,
  type LandlordIdOrphanClient,
  type LandlordIdSweepClient,
} from "../../../supabase/functions/_shared/landlordIdRetention";
import { blankComments } from "../helpers/blankNonCode";

const DECIDED = "2026-09-01T12:00:00.000Z";
const BEFORE = "2026-08-31T09:00:00.000Z";
const AFTER = "2026-09-02T09:00:00.000Z";

function fake(opts: { listErr?: string; removeErr?: string; stamped?: boolean; dueErr?: string; removesOnly?: number } = {}) {
  const calls = { due: [] as unknown[], removed: [] as string[][], stamps: [] as unknown[], listed: [] as string[] };
  const objects = [
    { name: "1-front-id.jpg", id: "o1", created_at: BEFORE },
    { name: "1-back-id.jpg", id: "o2", created_at: BEFORE },
    { name: "2-front-new.jpg", id: "o3", created_at: AFTER },
  ];
  const client = {
    rpc: (fn: string, args: Record<string, unknown>) => {
      if (fn === "landlord_id_images_due") {
        calls.due.push(args);
        return Promise.resolve(opts.dueErr ? { data: null, error: { message: opts.dueErr } } : { data: [{ user_id: "u1", reviewed_at: DECIDED }], error: null });
      }
      calls.stamps.push(args);
      return Promise.resolve({ data: opts.stamped ?? true, error: null });
    },
    storage: {
      from: (bucket: string) => ({
        list: (prefix: string) => {
          calls.listed.push(`${bucket}:${prefix}`);
          return Promise.resolve(opts.listErr ? { data: null, error: { message: opts.listErr } } : { data: objects, error: null });
        },
        remove: (paths: string[]) => {
          calls.removed.push(paths);
          if (opts.removeErr) return Promise.resolve({ data: null, error: { message: opts.removeErr } });
          return Promise.resolve({ data: paths.slice(0, opts.removesOnly ?? paths.length).map((name) => ({ name })), error: null });
        },
      }),
    },
  } as unknown as LandlordIdSweepClient;
  return { client, calls };
}

describe("landlord ID retention sweep", () => {
  it("THE number is 30 days (owner 2026-10-19) and it is what the sweep asks the database for", async () => {
    expect(LANDLORD_ID_RETENTION_DAYS).toBe(30);
    const { client, calls } = fake();
    await sweepLandlordIdImages(client);
    expect(calls.due).toEqual([{ p_retention_days: 30, p_limit: 100 }]);
  });

  it("deletes the photos uploaded before the decision from the private bucket, keeps a newer one, then stamps that decision", async () => {
    const { client, calls } = fake();
    const r = await sweepLandlordIdImages(client);
    expect(calls.listed).toEqual(["user-documents:u1/landlord-id"]);
    expect(calls.removed).toEqual([["u1/landlord-id/1-front-id.jpg", "u1/landlord-id/1-back-id.jpg"]]);
    expect(calls.stamps).toEqual([{ p_user_id: "u1", p_reviewed_at: DECIDED }]);
    expect(r).toEqual({ due: 1, removed: 2, stamped: 1, failures: [] });
  });

  it("a failed removal is a failure and the row is NOT stamped (retried next run)", async () => {
    const { client, calls } = fake({ removeErr: "storage down" });
    const r = await sweepLandlordIdImages(client);
    expect(calls.stamps).toEqual([]);
    expect(r.failures).toEqual(["u1: remove storage down"]);
    expect(r.stamped).toBe(0);
  });

  it("Storage answering no error but removing fewer photos than asked is a failure, and the row is NOT stamped", async () => {
    const { client, calls } = fake({ removesOnly: 1 });
    const r = await sweepLandlordIdImages(client);
    expect(calls.stamps).toEqual([]);
    expect(r.failures).toEqual(["u1: removed 1 of 2 photos"]);
    expect(r.removed).toBe(1);
  });

  it("a failed listing is a failure, nothing removed or stamped", async () => {
    const { client, calls } = fake({ listErr: "nope" });
    const r = await sweepLandlordIdImages(client);
    expect(calls.removed).toEqual([]);
    expect(calls.stamps).toEqual([]);
    expect(r.failures).toEqual(["u1: list nope"]);
  });

  it("an unreadable due list is a failure, never a clean run", async () => {
    const { client } = fake({ dueErr: "rpc missing" });
    expect((await sweepLandlordIdImages(client)).failures).toEqual(["due read: rpc missing"]);
  });

  it("dry run removes and stamps nothing", async () => {
    const { client, calls } = fake();
    const r = await sweepLandlordIdImages(client, { dryRun: true });
    expect(calls.removed).toEqual([]);
    expect(calls.stamps).toEqual([]);
    expect(r.removed).toBe(2);
  });

  it("the daily cron runs it and reports its failures as defects", () => {
    const src = blankComments(readFileSync(join(process.cwd(), "supabase/functions/cleanup-abandoned-accounts/index.ts"), "utf8"));
    // Inventory floor (vacuity): the cron source this reads is real code, not an empty file.
    expect(src.length).toBeGreaterThan(1000);
    expect(src).toContain("const landlordId = await sweepLandlordIdImages(supabase as unknown as LandlordIdSweepClient, { dryRun });");
    expect(src).toContain("for (const f of landlordId.failures) defects.record(`landlord ID retention: ${f}`);");
    expect(src).toContain("const landlordIdOrphans = await sweepOrphanLandlordIdImages(supabase as unknown as LandlordIdOrphanClient, { dryRun });");
    expect(src).toContain("for (const f of landlordIdOrphans.failures) defects.record(`landlord ID orphan photos: ${f}`);");
  });
});

// Q2202: a photo uploaded but never submitted (the app died between the upload and the submit RPC) is named by no
// review row; the SQL half that finds it is landlord_id_orphan_photos (src/test/pglite/landlordIdOrphanPhotos.pglite.mjs).
function orphanFake(opts: { readErr?: string; removeErr?: string; removesOnly?: number; names?: string[] } = {}) {
  const calls = { read: [] as unknown[], removed: [] as string[][] };
  const names = opts.names ?? ["u1/landlord-id/9-front-crash.jpg", "u2/landlord-id/3-back-crash.jpg"];
  const client = {
    rpc: (_fn: string, args: Record<string, unknown>) => {
      calls.read.push(args);
      return Promise.resolve(opts.readErr ? { data: null, error: { message: opts.readErr } } : { data: names.map((name) => ({ name })), error: null });
    },
    storage: {
      from: (bucket: string) => ({
        remove: (paths: string[]) => {
          calls.removed.push(paths.map((p) => `${bucket}:${p}`));
          if (opts.removeErr) return Promise.resolve({ data: null, error: { message: opts.removeErr } });
          return Promise.resolve({ data: paths.slice(0, opts.removesOnly ?? paths.length).map((name) => ({ name })), error: null });
        },
      }),
    },
  } as unknown as LandlordIdOrphanClient;
  return { client, calls };
}

describe("Q2202: landlord ID photos no review names are deleted after a day", () => {
  it("asks for uploads at least a day old and removes each from the private bucket", async () => {
    expect(LANDLORD_ID_ORPHAN_MIN_AGE_HOURS).toBe(24);
    const { client, calls } = orphanFake();
    const r = await sweepOrphanLandlordIdImages(client);
    expect(calls.read).toEqual([{ p_min_age_hours: 24, p_limit: 500 }]);
    expect(calls.removed).toEqual([["user-documents:u1/landlord-id/9-front-crash.jpg", "user-documents:u2/landlord-id/3-back-crash.jpg"]]);
    expect(r).toEqual({ found: 2, removed: 2, failures: [] });
  });

  it("never removes a path outside a landlord-id folder, whatever the read returns", async () => {
    const { client, calls } = orphanFake({ names: ["u1/ownership/deed.pdf", "u1/landlord-id/1.jpg"] });
    await sweepOrphanLandlordIdImages(client);
    expect(calls.removed).toEqual([["user-documents:u1/landlord-id/1.jpg"]]);
  });

  it("a failed read, a failed removal, or a short removal is a failure, never a clean run", async () => {
    expect((await sweepOrphanLandlordIdImages(orphanFake({ readErr: "rpc missing" }).client)).failures).toEqual(["orphan read: rpc missing"]);
    expect((await sweepOrphanLandlordIdImages(orphanFake({ removeErr: "storage down" }).client)).failures).toEqual(["orphan remove: storage down"]);
    expect((await sweepOrphanLandlordIdImages(orphanFake({ removesOnly: 1 }).client)).failures).toEqual(["orphan remove: removed 1 of 2 photos"]);
  });

  it("dry run removes nothing", async () => {
    const { client, calls } = orphanFake();
    const r = await sweepOrphanLandlordIdImages(client, { dryRun: true });
    expect(calls.removed).toEqual([]);
    expect(r.found).toBe(2);
  });
});
