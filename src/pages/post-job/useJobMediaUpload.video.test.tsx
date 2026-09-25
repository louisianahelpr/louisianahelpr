import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

const toastError = vi.fn();
vi.mock("sonner", () => ({ toast: { error: (...a: unknown[]) => toastError(...a), success: vi.fn() } }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
// jsdom never loads video metadata; the length check itself is covered in src/lib/scopeVideo.test.ts.
const duration = vi.fn(async (): Promise<number | null> => null);
vi.mock("@/lib/scopeVideo", async (orig) => ({
  ...(await orig<typeof import("@/lib/scopeVideo")>()),
  readVideoDuration: () => duration(),
}));

import { useJobMediaUpload } from "./useJobMediaUpload";

function pick(file: File) {
  const input = document.createElement("input");
  Object.defineProperty(input, "files", { value: [file] });
  return { target: input } as unknown as React.ChangeEvent<HTMLInputElement>;
}

function sized(name: string, type: string, bytes: number): File {
  const f = new File(["x"], name, { type });
  Object.defineProperty(f, "size", { value: bytes });
  return f;
}

// @mutate src/pages/post-job/useJobMediaUpload.ts | if (problem) { | if (false) {
describe("post-a-job scope video selection refuses what the bucket would refuse (archive L2889)", () => {
  beforeEach(() => {
    toastError.mockReset();
    duration.mockReset();
    duration.mockResolvedValue(null);
    Object.defineProperty(URL, "createObjectURL", { value: () => "blob:x", configurable: true, writable: true });
  });

  it("an oversized clip is refused with the reason and never becomes the scope video", async () => {
    const { result } = renderHook(() => useJobMediaUpload());
    await act(async () => {
      await result.current.handleVideoSelect(pick(sized("big.mp4", "video/mp4", 51 * 1024 * 1024)));
    });
    expect(toastError).toHaveBeenCalledWith(expect.stringMatching(/too large/));
    expect(result.current.scopeVideoFile).toBeNull();
  });

  it("an unsupported format is refused with the reason", async () => {
    const { result } = renderHook(() => useJobMediaUpload());
    await act(async () => {
      await result.current.handleVideoSelect(pick(sized("clip.avi", "video/x-msvideo", 1024)));
    });
    expect(toastError).toHaveBeenCalledWith(expect.stringMatching(/format isn't supported/));
    expect(result.current.scopeVideoFile).toBeNull();
  });

  it("a clip longer than 30 s is refused with the reason", async () => {
    duration.mockResolvedValue(42);
    const { result } = renderHook(() => useJobMediaUpload());
    await act(async () => {
      await result.current.handleVideoSelect(pick(sized("long.mp4", "video/mp4", 4 * 1024 * 1024)));
    });
    expect(toastError).toHaveBeenCalledWith(expect.stringMatching(/42s long/));
    expect(result.current.scopeVideoFile).toBeNull();
  });

  it("a clip within the limits is kept", async () => {
    const { result } = renderHook(() => useJobMediaUpload());
    const ok = sized("clip.mp4", "video/mp4", 4 * 1024 * 1024);
    await act(async () => {
      await result.current.handleVideoSelect(pick(ok));
    });
    expect(toastError).not.toHaveBeenCalled();
    expect(result.current.scopeVideoFile).toBe(ok);
  });
});
