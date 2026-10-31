/**
 * A PROOF PHOTO THAT REACHED STORAGE IS ON THE JOB (owner report 2026-10-23: "ben also did not receive any before or
 * after pictures", Mow two lawns 7c6deb77).
 *
 * Measured on prod (read-only SQL): storage proof-photos holds a before photo from 14:40:57Z that is NOT in
 * jobs.proof_before_urls; error_logs has two PhotoProof.upload "Load failed" reports at 14:41:01Z from the same
 * Helpr (iPhone Safari). So the upload LANDED and the client counted it failed: nothing was attached, and the
 * 17:16Z retry attached only the new photo. Two fixes, both shown here on the real dialog:
 *  1. a failed upload is retried on the SAME path once; a duplicate answer means it had landed, so it is attached;
 *  2. the save appends to the column AS IT IS ON THE ROW NOW, never to the list the screen loaded, so a stale screen
 *     can never write a shorter list over a photo saved meanwhile.
 *
 * @mutate src/components/PhotoProof.tsx |         error = again.error && !isAlreadyStored(again.error) ? again.error : null; |         error = again.error;
 * @mutate src/components/PhotoProof.tsx |   const merged = [...onRow, ...urls.filter((u) => !onRow.includes(u))]; |   const merged = urls;
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";

const calls = vi.hoisted(() => ({ uploads: [] as string[], updates: [] as unknown[], uploadAnswers: [] as Array<{ error: unknown }>, row: [] as string[] }));
vi.mock("@/integrations/supabase/client", () => {
  const jobs = {
    select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { proof_before_urls: calls.row }, error: null }) }) }),
    update: (payload: unknown) => {
      calls.updates.push(payload);
      return { eq: () => ({ select: async () => ({ data: [{ id: "job-x" }], error: null }) }) };
    },
  };
  return {
    supabase: {
      from: () => jobs,
      storage: { from: () => ({ upload: async (path: string) => { calls.uploads.push(path); return calls.uploadAnswers.shift() ?? { error: null }; } }) },
      rpc: async () => ({ data: null, error: null }),
    },
  };
});
vi.mock("@/hooks/useProofPhotoUrls", () => ({ useProofPhotoUrls: () => [], PENDING_PHOTO_SRC: "" }));
vi.mock("@/lib/errorLogger", () => ({ report: vi.fn() }));
// Cleaning needs a real canvas; its own proof is src/test/heicProofPhotos.test.tsx.
vi.mock("@/lib/cleanProofPhoto", () => ({ cleanProofPhoto: async (f: File) => f }));
vi.mock("sonner", async () => (await import("@/test/helpers/sonnerMock")).sonnerMock());

import { PhotoProofCaptureChip } from "@/components/PhotoProof";

beforeEach(() => {
  calls.uploads = []; calls.updates = []; calls.uploadAnswers = []; calls.row = [];
  (URL as unknown as { createObjectURL: () => string }).createObjectURL = () => "blob:x";
});
afterEach(cleanup);

async function uploadOne(existing: string[]) {
  render(<PhotoProofCaptureChip jobId="job-x" type="before" existingUrls={existing} label="Before photo" />);
  fireEvent.click(screen.getByRole("button", { name: /Before/ }));
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  fireEvent.change(input, { target: { files: [new File(["x"], "a.jpg", { type: "image/jpeg" })] } });
  const go = screen.getByRole("button", { name: "Upload" }) as HTMLButtonElement;
  await waitFor(() => expect(go.disabled).toBe(false));
  fireEvent.click(go);
  await waitFor(() => expect(calls.updates.length).toBeGreaterThan(0));
  return (calls.updates[0] as { proof_before_urls: string[] }).proof_before_urls;
}

describe("a proof photo that reached storage is on the job (7c6deb77)", () => {
  it("1. 'Load failed' after storage saved it: the same path is retried, the duplicate answer attaches it", async () => {
    calls.uploadAnswers = [{ error: { message: "Load failed" } }, { error: { statusCode: "409", error: "Duplicate", message: "The resource already exists" } }];
    const written = await uploadOne([]);
    expect(calls.uploads).toHaveLength(2);
    expect(calls.uploads[0]).toBe(calls.uploads[1]);
    expect(written).toEqual([calls.uploads[0]]);
  });

  it("2. the save appends to the row as it is now, never to the screen's stale list", async () => {
    calls.row = ["job-x/before-earlier.jpg"];
    const written = await uploadOne([]); // this screen never saw the earlier photo
    expect(written[0]).toBe("job-x/before-earlier.jpg");
    expect(written).toHaveLength(2);
  });
});
