// useDraftJob persists the post-job form across navigations + tab kills.
// Bugs here silently lose user-typed content (a top-of-funnel UX
// regression that won't surface in any error log). Test the storage
// contract, the 7-day expiration, the debounce, and the unmount flush.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useDraftJob } from "./useDraftJob";

const getItemMock = vi.fn();
const setItemMock = vi.fn();
const removeItemMock = vi.fn();

vi.mock("@/lib/safeStorage", () => ({
  safeStorage: {
    getItem: (...args: unknown[]) => getItemMock(...args),
    setItem: (...args: unknown[]) => setItemMock(...args),
    removeItem: (...args: unknown[]) => removeItemMock(...args),
  },
}));

const DRAFT_KEY = "helpr_draft_job";

describe("useDraftJob — initial load", () => {
  beforeEach(() => {
    getItemMock.mockReset();
    setItemMock.mockReset();
    removeItemMock.mockReset();
  });

  it("hasDraft=false and empty fields when no draft exists", () => {
    getItemMock.mockReturnValue(null);
    const { result } = renderHook(() => useDraftJob());
    expect(result.current.hasDraft).toBe(false);
    expect(result.current.draft.title).toBe("");
    expect(result.current.draft.category).toBe("other");
  });

  it("restores a draft saved less than 7 days ago", () => {
    const recent = {
      title: "Yard work",
      description: "Mow the lawn",
      category: "yard_work",
      location: "New Orleans",
      dateNeeded: "",
      startTime: "",
      estimatedHours: "",
      budget: "50",
      specialRequirements: "",
      isRecurring: false,
      recurrenceInterval: "weekly",
      recurrenceEndDate: "",
      jobDuration: "none",
      savedAt: Date.now() - 60_000, // 1 minute ago
    };
    getItemMock.mockReturnValue(JSON.stringify(recent));

    const { result } = renderHook(() => useDraftJob());
    expect(result.current.hasDraft).toBe(true);
    expect(result.current.draft.title).toBe("Yard work");
    expect(result.current.draft.budget).toBe("50");
  });

  it("discards a draft older than 7 days and removes it from storage", () => {
    const stale = {
      title: "Old",
      description: "",
      category: "other",
      location: "",
      dateNeeded: "",
      startTime: "",
      estimatedHours: "",
      budget: "",
      specialRequirements: "",
      isRecurring: false,
      recurrenceInterval: "weekly",
      recurrenceEndDate: "",
      jobDuration: "none",
      savedAt: Date.now() - 8 * 24 * 60 * 60 * 1000, // 8 days ago
    };
    getItemMock.mockReturnValue(JSON.stringify(stale));

    const { result } = renderHook(() => useDraftJob());
    expect(result.current.hasDraft).toBe(false);
    expect(result.current.draft.title).toBe("");
    expect(removeItemMock).toHaveBeenCalledWith(DRAFT_KEY);
  });

  it("ignores malformed JSON without crashing", () => {
    getItemMock.mockReturnValue("{not-valid-json");
    const { result } = renderHook(() => useDraftJob());
    expect(result.current.hasDraft).toBe(false);
    expect(result.current.draft.title).toBe("");
  });
});

describe("useDraftJob — saveDraft (debounced write)", () => {
  beforeEach(() => {
    getItemMock.mockReset().mockReturnValue(null);
    setItemMock.mockReset();
    removeItemMock.mockReset();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("updates state synchronously and flips hasDraft=true", () => {
    const { result } = renderHook(() => useDraftJob());
    act(() => {
      result.current.saveDraft({ title: "New job" });
    });
    expect(result.current.draft.title).toBe("New job");
    expect(result.current.hasDraft).toBe(true);
  });

  it("debounces writes — does NOT call setItem until 1000ms passes", () => {
    const { result } = renderHook(() => useDraftJob());
    act(() => {
      result.current.saveDraft({ title: "T" });
    });
    expect(setItemMock).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(999);
    });
    expect(setItemMock).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(setItemMock).toHaveBeenCalledOnce();
  });

  it("rapid successive saves merge — no field is dropped", () => {
    const { result } = renderHook(() => useDraftJob());
    act(() => {
      result.current.saveDraft({ title: "T" });
      result.current.saveDraft({ description: "D" });
      result.current.saveDraft({ budget: "100" });
    });
    expect(result.current.draft.title).toBe("T");
    expect(result.current.draft.description).toBe("D");
    expect(result.current.draft.budget).toBe("100");

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(setItemMock).toHaveBeenCalledOnce();
    const savedJson = setItemMock.mock.calls[0][1];
    const saved = JSON.parse(savedJson);
    expect(saved.title).toBe("T");
    expect(saved.description).toBe("D");
    expect(saved.budget).toBe("100");
  });

  it("each new saveDraft resets the debounce timer", () => {
    const { result } = renderHook(() => useDraftJob());
    act(() => {
      result.current.saveDraft({ title: "T1" });
    });
    act(() => {
      vi.advanceTimersByTime(800);
    });
    // 200ms remaining — but a new save resets the clock
    act(() => {
      result.current.saveDraft({ title: "T2" });
    });
    act(() => {
      vi.advanceTimersByTime(800);
    });
    expect(setItemMock).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(setItemMock).toHaveBeenCalledOnce();
    const saved = JSON.parse(setItemMock.mock.calls[0][1]);
    expect(saved.title).toBe("T2");
  });

  it("savedAt is updated on every save", () => {
    const { result } = renderHook(() => useDraftJob());
    const before = Date.now();
    act(() => {
      result.current.saveDraft({ title: "T" });
    });
    expect(result.current.draft.savedAt).toBeGreaterThanOrEqual(before);
  });
});

describe("useDraftJob — clearDraft", () => {
  beforeEach(() => {
    getItemMock.mockReset().mockReturnValue(null);
    setItemMock.mockReset();
    removeItemMock.mockReset();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("resets state to empty + flips hasDraft=false + removes from storage", () => {
    const { result } = renderHook(() => useDraftJob());
    act(() => {
      result.current.saveDraft({ title: "Will be cleared" });
    });
    expect(result.current.hasDraft).toBe(true);

    act(() => {
      result.current.clearDraft();
    });
    expect(result.current.hasDraft).toBe(false);
    expect(result.current.draft.title).toBe("");
    expect(removeItemMock).toHaveBeenCalledWith(DRAFT_KEY);
  });

  it("cancels any pending debounced write so storage stays clean", () => {
    const { result } = renderHook(() => useDraftJob());
    act(() => {
      result.current.saveDraft({ title: "About to clear" });
    });
    act(() => {
      result.current.clearDraft();
    });
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    // setItem should NOT have fired — the timer was cancelled
    expect(setItemMock).not.toHaveBeenCalled();
  });
});

describe("useDraftJob — unmount flush", () => {
  beforeEach(() => {
    getItemMock.mockReset().mockReturnValue(null);
    setItemMock.mockReset();
    removeItemMock.mockReset();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("flushes pending write on unmount so the last ~1s of typing is preserved", () => {
    const { result, unmount } = renderHook(() => useDraftJob());
    act(() => {
      result.current.saveDraft({ title: "Last second of typing" });
    });
    expect(setItemMock).not.toHaveBeenCalled(); // debounce hasn't fired yet

    unmount();
    // Flush should have fired synchronously during unmount
    expect(setItemMock).toHaveBeenCalledOnce();
    const saved = JSON.parse(setItemMock.mock.calls[0][1]);
    expect(saved.title).toBe("Last second of typing");
  });

  it("does NOT flush on unmount when there's no pending write", () => {
    const { unmount } = renderHook(() => useDraftJob());
    unmount();
    expect(setItemMock).not.toHaveBeenCalled();
  });
});
