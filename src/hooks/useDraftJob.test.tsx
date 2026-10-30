// useDraftJob persists the post-job form across navigations + tab kills.
// Bugs here silently lose user-typed content (a top-of-funnel UX
// regression that won't surface in any error log). Test the storage
// contract, the 7-day expiration, the debounce, and the unmount flush.
//
// @mutate src/hooks/useDraftJob.ts | if (!dirty.current \|\| pendingDraft.current.savedAt === 0) return; | if (pendingDraft.current.savedAt === 0) return;
// @mutate src/hooks/useDraftJob.ts | if (e.key !== DRAFT_KEY \|\| e.newValue !== null) return; | return;

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useDraftJob } from "./useDraftJob";

const account = vi.hoisted(() => ({
  read: vi.fn(async () => null as unknown),
  save: vi.fn(async () => {}),
  clear: vi.fn(async () => {}),
}));
vi.mock("@/lib/jobPostDraftAccount", () => ({
  readDraftFromAccount: account.read,
  saveDraftToAccount: account.save,
  clearDraftOnAccount: account.clear,
}));

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

  it("debounces writes — does NOT call setItem until 5000ms passes", () => {
    const { result } = renderHook(() => useDraftJob());
    act(() => {
      result.current.saveDraft({ title: "T" });
    });
    expect(setItemMock).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(4999);
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
      vi.advanceTimersByTime(5000);
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
      vi.advanceTimersByTime(4000);
    });
    // 1000ms remaining — but a new save resets the clock
    act(() => {
      result.current.saveDraft({ title: "T2" });
    });
    act(() => {
      vi.advanceTimersByTime(4000);
    });
    expect(setItemMock).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(1000);
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
      vi.advanceTimersByTime(10_000); // way past the debounce window
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

// Shown able to fail:
// Merge against the EMPTY draft rather than the pending one, so two saves inside the
// debounce window drop every field the second one did not name.
// @mutate src/hooks/useDraftJob.ts | { ...pendingDraft.current, ...data, savedAt: Date.now() } | { ...emptyDraft, ...data, savedAt: Date.now() }

describe("useDraftJob — a second tab never resurrects a posted draft (CC-002)", () => {
  beforeEach(() => {
    getItemMock.mockReset();
    setItemMock.mockReset();
    removeItemMock.mockReset();
  });

  const saved = () => JSON.stringify({ title: "Mow lawn", savedAt: Date.now() - 1000 });

  it("a restored draft this tab never edited is not re-written on hide", () => {
    getItemMock.mockReturnValue(saved());
    const { unmount } = renderHook(() => useDraftJob());
    unmount();
    expect(setItemMock).not.toHaveBeenCalled();
  });

  it("an edit here, then another tab clears the draft: nothing is written back", () => {
    getItemMock.mockReturnValue(saved());
    const { result, unmount } = renderHook(() => useDraftJob());
    act(() => result.current.saveDraft({ title: "Mow lawn and edge" }));
    act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key: DRAFT_KEY, newValue: null }));
    });
    unmount();
    expect(setItemMock).not.toHaveBeenCalled();
  });

  it("an unsaved edit here is still flushed on unmount", () => {
    getItemMock.mockReturnValue(null);
    const { result, unmount } = renderHook(() => useDraftJob());
    act(() => result.current.saveDraft({ title: "Paint fence" }));
    unmount();
    expect(setItemMock).toHaveBeenCalledWith(DRAFT_KEY, expect.stringContaining("Paint fence"));
  });
});

// OPS-3: the draft is kept on the account too, and another device can pick it up.
// @mutate src/hooks/useDraftJob.ts |       void saveDraftToAccount(pendingDraft.current);\n    }, SAVE_DEBOUNCE_MS); |     }, SAVE_DEBOUNCE_MS);
// @mutate src/hooks/useDraftJob.ts |     void saveDraftToAccount(pendingDraft.current);\n  }, []);\n\n  // Another tab |   }, []);\n\n  // Another tab
// @mutate src/hooks/useDraftJob.ts |   void clearDraftOnAccount();\n |
// @mutate src/hooks/useDraftJob.ts |       if (fromAccount && pendingDraft.current.savedAt === 0) { |       if (fromAccount) {
// @mutate src/hooks/useDraftJob.ts |     if (found) {\n      setDraftLoaded(true);\n      return;\n    } |     if (found) {\n      setDraftLoaded(true);\n    }
describe("useDraftJob: kept on the account (OPS-3)", () => {
  const FROM_ACCOUNT = { title: "Mow my lawn", description: "Front", savedAt: Date.now() - 1000 };
  beforeEach(() => {
    getItemMock.mockReset();
    setItemMock.mockReset();
    removeItemMock.mockReset();
    getItemMock.mockReturnValue(null);
    account.read.mockReset();
    account.read.mockResolvedValue(null);
    account.save.mockClear();
    account.clear.mockClear();
  });

  it("nothing on this device: the account's draft comes back, and loading waits for it", async () => {
    let answer: (d: unknown) => void = () => {};
    account.read.mockReturnValue(new Promise((r) => { answer = r; }));
    const { result } = renderHook(() => useDraftJob());
    expect(result.current.draftLoaded).toBe(false);
    await act(async () => { answer(FROM_ACCOUNT); });
    expect(result.current.draftLoaded).toBe(true);
    expect(result.current.hasDraft).toBe(true);
    expect(result.current.draft.title).toBe("Mow my lawn");
  });

  it("the account has none, or no answer: loading still finishes, with no draft", async () => {
    const { result } = renderHook(() => useDraftJob());
    await act(async () => {});
    expect(result.current.draftLoaded).toBe(true);
    expect(result.current.hasDraft).toBe(false);
  });

  it("a draft on this device wins, and the account isn't asked", () => {
    getItemMock.mockReturnValue(JSON.stringify({ title: "Here", savedAt: Date.now() }));
    const { result } = renderHook(() => useDraftJob());
    expect(result.current.draft.title).toBe("Here");
    expect(result.current.draftLoaded).toBe(true);
    expect(account.read).not.toHaveBeenCalled();
  });

  it("what was typed while the account answered is kept", async () => {
    let answer: (d: unknown) => void = () => {};
    account.read.mockReturnValue(new Promise((r) => { answer = r; }));
    const { result } = renderHook(() => useDraftJob());
    act(() => result.current.saveDraft({ title: "Typed now" }));
    await act(async () => { answer(FROM_ACCOUNT); });
    expect(result.current.draft.title).toBe("Typed now");
  });

  it("each save reaches the account after the pause, and on leaving", async () => {
    vi.useFakeTimers();
    try {
      const { result, unmount } = renderHook(() => useDraftJob());
      await act(async () => {});
      act(() => result.current.saveDraft({ title: "One" }));
      expect(account.save).not.toHaveBeenCalled();
      act(() => { vi.advanceTimersByTime(5000); });
      expect(account.save).toHaveBeenCalledTimes(1);
      act(() => result.current.saveDraft({ title: "Two" }));
      unmount();
      expect(account.save).toHaveBeenCalledTimes(2);
      expect(account.save.mock.calls[1][0 as never]).toEqual(expect.objectContaining({ title: "Two" }));
    } finally {
      vi.useRealTimers();
    }
  });

  it("thrown away or paid for: the account's copy goes too", async () => {
    const { result } = renderHook(() => useDraftJob());
    await act(async () => {});
    act(() => result.current.clearDraft());
    expect(account.clear).toHaveBeenCalledTimes(1);
  });
});
