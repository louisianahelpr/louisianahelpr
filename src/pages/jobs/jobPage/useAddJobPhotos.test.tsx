/**
 * Audit 11-21 (High): "Add a photo" on an open job with no applicants opened EditJobDialog, which has no photo field.
 * useAddJobPhotos adds them in place. This proves the write: each picked photo is cleaned (compressImage), uploaded
 * under the job's own folder in job-photos, and APPENDED to jobs.photos (the existing ones kept), capped at 5, with
 * a zero-row write reported (unwrapMutation), never a silent success.
 *
 * @mutate src/pages/jobs/jobPage/useAddJobPhotos.ts | .update({ photos: [...have, ...urls] }) | .update({ photos: urls })
 * @mutate src/pages/jobs/jobPage/useAddJobPhotos.ts | const room = MAX_JOB_PHOTOS - have.length; | const room = MAX_JOB_PHOTOS;
 * @mutate src/pages/jobs/jobPage/useAddJobPhotos.ts |         { action: "add these photos to your job" }, |         { action: "add these photos to your job", min: 0 },
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const calls = vi.hoisted(() => ({ uploads: [] as string[], updates: [] as Array<{ patch: unknown; id: unknown }>, rows: [{ id: "job-1" }] as unknown[] }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    storage: {
      from: (bucket: string) => ({
        upload: async (path: string) => { calls.uploads.push(`${bucket}:${path}`); return { error: null }; },
        getPublicUrl: (path: string) => ({ data: { publicUrl: `https://cdn/${path}` } }),
      }),
    },
    from: () => ({
      update: (patch: unknown) => ({
        eq: (_c: string, id: unknown) => ({
          select: async () => { calls.updates.push({ patch, id }); return { data: calls.rows, error: null }; },
        }),
      }),
    }),
  },
}));
vi.mock("@/lib/imageCompression", () => ({ compressImage: async (f: File) => new File([f], f.name.replace(/\.\w+$/, ".jpg"), { type: "image/jpeg" }) }));
vi.mock("@/lib/errorLogger", () => ({ report: vi.fn() }));
const toasts = vi.hoisted(() => ({ ok: [] as string[], err: [] as string[] }));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: (m: string) => toasts.ok.push(m), error: (m: string) => toasts.err.push(m) }) }));

import { useAddJobPhotos } from "./useAddJobPhotos";

const MAX_JOB_PHOTOS = 5; // Post a job's cap (useJobMediaUpload), the same here

const wrap = ({ children }: { children: ReactNode }) => <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>;
const img = (n: string) => new File(["x"], n, { type: "image/png" });

beforeEach(() => {
  calls.uploads.length = 0;
  calls.updates.length = 0;
  calls.rows = [{ id: "job-1" }];
  toasts.ok.length = 0;
  toasts.err.length = 0;
});

describe("useAddJobPhotos: Add a photo on an open job really adds it", () => {
  it("uploads under the job's folder and appends to the photos already there", async () => {
    const { result } = renderHook(() => useAddJobPhotos("job-1", ["https://cdn/old.jpg"]), { wrapper: wrap });
    let ok = false;
    await act(async () => { ok = await result.current.add([img("a.png"), img("b.png")]); });
    expect(ok).toBe(true);
    // Inventory floor: two picked, two uploaded.
    expect(calls.uploads.length).toBeGreaterThan(1);
    expect(calls.uploads.every((u) => /^job-photos:job-1\/\d+-\w+\.jpg$/.test(u))).toBe(true);
    expect(calls.updates).toHaveLength(1);
    const photos = (calls.updates[0].patch as { photos: string[] }).photos;
    expect(photos[0], "the photo already on the job was dropped").toBe("https://cdn/old.jpg");
    expect(photos).toHaveLength(3);
    expect(calls.updates[0].id).toBe("job-1");
    expect(toasts.ok).toEqual([]);
    expect(toasts.err).toEqual([]);
  });

  it("keeps to the 5-photo cap and refuses a type the bucket would not take", async () => {
    const have = ["1", "2", "3", "4"].map((n) => `https://cdn/${n}.jpg`);
    const { result } = renderHook(() => useAddJobPhotos("job-1", have), { wrapper: wrap });
    await act(async () => { await result.current.add([img("a.png"), img("b.png"), new File(["x"], "c.heic", { type: "image/heic" })]); });
    expect(calls.uploads).toHaveLength(1);
    expect((calls.updates[0].patch as { photos: string[] }).photos).toHaveLength(MAX_JOB_PHOTOS);
    expect(toasts.err.length).toBe(2);
  });

  it("a write that changed no row is an error the poster sees, never 'Photo added'", async () => {
    calls.rows = [];
    const { result } = renderHook(() => useAddJobPhotos("job-1", []), { wrapper: wrap });
    let ok = true;
    await act(async () => { ok = await result.current.add([img("a.png")]); });
    expect(ok).toBe(false);
    expect(toasts.ok).toEqual([]);
    expect(toasts.err.length).toBe(1);
  });
});
