import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { usePageTitle } from "./usePageTitle";

beforeEach(() => {
  document.title = "Helpr";
});

afterEach(() => {
  document.title = "Helpr";
});

describe("usePageTitle", () => {
  it("sets document.title to the provided title", () => {
    renderHook(() => usePageTitle("Browse Jobs — Helpr"));
    expect(document.title).toBe("Browse Jobs — Helpr");
  });

  it("resets to 'Helpr' on unmount", () => {
    const { unmount } = renderHook(() => usePageTitle("Custom Title"));
    expect(document.title).toBe("Custom Title");
    unmount();
    expect(document.title).toBe("Helpr");
  });

  it("updates when the title prop changes (route change scenario)", () => {
    const { rerender } = renderHook(({ t }) => usePageTitle(t), {
      initialProps: { t: "First Page" },
    });
    expect(document.title).toBe("First Page");
    rerender({ t: "Second Page" });
    expect(document.title).toBe("Second Page");
  });
});

// The dependency array is the whole route-change contract: with `[]` the
// effect runs once and every subsequent page keeps the first page's title in
// the tab, in the history entry and in what a screen reader announces.
// @mutate src/hooks/usePageTitle.ts | }, [title]); | }, []);
