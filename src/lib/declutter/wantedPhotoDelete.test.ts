/**
 * B67 (B63 handoff leftover): a Wanted photo whose object delete failed on a bad connection was only console.warn'd,
 * so the photo stayed public by URL with nobody told. Now the delete is retried, a final failure is reported to ops
 * (error_logs) with the paths, and the paths are kept on the device and tried again on the next Wanted visit.
 *
 * @mutate src/lib/declutter/wanted.ts |   writePurgeQueue([...readPurgeQueue(), ...paths]); |   void readPurgeQueue;
 * @mutate src/lib/declutter/wanted.ts |   report(new Error(`Wanted photo objects not deleted: ${failure}`), { |   void (new Error(`Wanted photo objects not deleted: ${failure}`), {
 * @mutate src/lib/declutter/wanted.ts |   for (let attempt = 1; attempt <= WANTED_PURGE_TRIES; attempt++) { |   for (let attempt = 1; attempt <= 1; attempt++) {
 * @mutate src/lib/declutter/wanted.ts |   await deleteWantedObjects([path]); |   void path;
 * @mutate src/components/declutter/DeclutterWantedViews.tsx |   useEffect(() => { void retryWantedPhotoDeletes(userId); }, [userId]); |   void retryWantedPhotoDeletes;
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

const h = vi.hoisted(() => ({
  removes: [] as string[][],
  answers: [] as Array<"ok" | "error" | "throw">,
  rpc: vi.fn(),
  report: vi.fn(),
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: h.rpc,
    storage: {
      from: () => ({
        remove: async (paths: string[]) => {
          h.removes.push(paths);
          const a = h.answers.shift() ?? "ok";
          if (a === "throw") throw new TypeError("Failed to fetch");
          return a === "error" ? { data: null, error: { message: "Failed to fetch" } } : { data: paths.map((name) => ({ name })), error: null };
        },
      }),
    },
  },
}));
vi.mock("@/lib/errorLogger", () => ({ report: h.report }));

import { deleteWantedObjects, removeWantedPhoto, retryWantedPhotoDeletes, WANTED_PURGE_KEY, wantedPurgeTiming } from "./wanted";

const P = "u1/wanted/w1/a.jpg";
const kept = () => JSON.parse(localStorage.getItem(WANTED_PURGE_KEY) ?? "[]") as string[];

beforeEach(() => {
  h.removes.length = 0;
  h.answers.length = 0;
  h.rpc.mockReset();
  h.report.mockReset();
  localStorage.clear();
  wantedPurgeTiming.retryMs = 0;
});

describe("Wanted photo object deletes", () => {
  it("a delete that fails once is retried and succeeds, with nothing kept or reported", async () => {
    h.answers.push("throw", "ok");
    expect(await deleteWantedObjects([P])).toBe(true);
    expect(h.removes).toEqual([[P], [P]]);
    expect(kept()).toEqual([]);
    expect(h.report).not.toHaveBeenCalled();
  });

  it("a delete that keeps failing is reported to ops with the path and kept for the next visit", async () => {
    h.answers.push("error", "throw", "error");
    expect(await deleteWantedObjects([P])).toBe(false);
    expect(h.removes).toHaveLength(3);
    expect(kept()).toEqual([P]);
    expect(h.report).toHaveBeenCalledTimes(1);
    expect(h.report.mock.calls[0][1]).toMatchObject({ severity: "warning", context: { paths: P } });
  });

  it("removing a photo from a post goes through the retried delete, and the post's change stands", async () => {
    h.rpc.mockResolvedValue({ data: 2, error: null });
    h.answers.push("error", "error", "error");
    expect(await removeWantedPhoto("w1", P)).toBe(2);
    expect(kept()).toEqual([P]);
    expect(h.report).toHaveBeenCalledTimes(1);
  });

  it("the next visit retries only the signed-in poster's own kept paths and clears them once gone", async () => {
    const other = "u2/wanted/w9/b.jpg";
    localStorage.setItem(WANTED_PURGE_KEY, JSON.stringify([P, other]));
    await retryWantedPhotoDeletes("u1");
    expect(h.removes).toEqual([[P]]);
    expect(kept()).toEqual([other]);
    await retryWantedPhotoDeletes(null);
    expect(h.removes).toHaveLength(1);
  });

  it("a retry that fails again keeps the path", async () => {
    localStorage.setItem(WANTED_PURGE_KEY, JSON.stringify([P]));
    h.answers.push("error");
    await retryWantedPhotoDeletes("u1");
    expect(kept()).toEqual([P]);
  });

  it("the Wanted tab runs the retry for the signed-in poster", () => {
    const src = readFileSync("src/components/declutter/DeclutterWantedViews.tsx", "utf8");
    expect(src).toContain("useEffect(() => { void retryWantedPhotoDeletes(userId); }, [userId]);");
    expect(src.match(/retryWantedPhotoDeletes/g)?.length ?? 0).toBeGreaterThan(1);
  });
});
