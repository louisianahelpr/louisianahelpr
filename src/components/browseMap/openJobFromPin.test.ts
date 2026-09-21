// VN-10 — the map pin's card must open the job, whether or not the list that
// happens to be on screen holds it. Both maps (the feed's toggle map and the
// desktop split map) call this; the defect was that each had its own narrower
// copy, and the desktop one still did nothing when the pin's job wasn't loaded.
import { describe, it, expect, vi } from "vitest";
import { openJobFromPin } from "./openJobFromPin";

const job = (id: string) => ({ id, title: `Job ${id}` }) as never;
const flush = () => new Promise((r) => setTimeout(r, 0));

describe("openJobFromPin", () => {
  it("opens from the first list that holds the job", () => {
    const open = vi.fn(), onError = vi.fn(), fetchJob = vi.fn();
    openJobFromPin({ jobId: "a", lists: [[job("a")], [job("b")]], open, onError, fetchJob });
    expect(open).toHaveBeenCalledWith(expect.objectContaining({ id: "a" }));
    expect(fetchJob).not.toHaveBeenCalled();
  });

  it("falls through to the later list when the first misses", () => {
    const open = vi.fn(), onError = vi.fn(), fetchJob = vi.fn();
    openJobFromPin({ jobId: "b", lists: [[job("a")], [job("b")]], open, onError, fetchJob });
    expect(open).toHaveBeenCalledWith(expect.objectContaining({ id: "b" }));
    expect(fetchJob).not.toHaveBeenCalled();
  });

  it("fetches the job when NO list holds it — the dead tap this closes", async () => {
    const open = vi.fn(), onError = vi.fn();
    const fetchJob = vi.fn().mockResolvedValue(job("z"));
    openJobFromPin({ jobId: "z", lists: [[job("a")], [job("b")]], open, onError, fetchJob });
    expect(open).not.toHaveBeenCalled();
    await flush();
    expect(fetchJob).toHaveBeenCalledWith("z");
    expect(open).toHaveBeenCalledWith(expect.objectContaining({ id: "z" }));
    expect(onError).not.toHaveBeenCalled();
  });

  it("says the job is gone rather than doing nothing", async () => {
    const open = vi.fn(), onError = vi.fn();
    openJobFromPin({ jobId: "z", lists: [[]], open, onError, fetchJob: vi.fn().mockResolvedValue(null) });
    await flush();
    expect(open).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith("That job is no longer available.");
  });

  it("reports a failed fetch instead of swallowing it", async () => {
    const open = vi.fn(), onError = vi.fn();
    openJobFromPin({ jobId: "z", lists: [undefined], open, onError, fetchJob: vi.fn().mockRejectedValue(new Error("boom")) });
    await flush();
    expect(onError).toHaveBeenCalledWith("Couldn't open that job. Try again.");
  });

  it("tolerates a list that hasn't loaded yet", () => {
    const open = vi.fn();
    openJobFromPin({ jobId: "a", lists: [undefined, [job("a")]], open, onError: vi.fn(), fetchJob: vi.fn() });
    expect(open).toHaveBeenCalledWith(expect.objectContaining({ id: "a" }));
  });
});

// The dead tap this exists to close: the pin's job is not in any loaded list
// and nothing happens. Second mutation: the fetch fails and is swallowed, so
// the tap is dead again for a different reason.
// @mutate src/components/browseMap/openJobFromPin.ts | void fetchJob(jobId) | if (jobId) return;\n  void fetchJob(jobId)
// @mutate src/components/browseMap/openJobFromPin.ts | .catch(() => onError("Couldn't open that job. Try again.")); | .catch(() => {});
