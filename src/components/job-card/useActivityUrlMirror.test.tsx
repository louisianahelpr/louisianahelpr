// Posted / Working keep their filter + search in the URL (useActivityUrlMirror, moved out of JobListPage.tsx,
// Q806). A link that carries ?filter= / ?q= opens on that view, and a view at its default writes no param.
// @mutate src/components/job-card/useActivityUrlMirror.ts | if (nextFilter !== statusFilter) setStatusFilter(nextFilter); | void nextFilter;
// @mutate src/components/job-card/useActivityUrlMirror.ts | filter: statusFilter === defaultFilter ? "" : statusFilter, | filter: statusFilter,
import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { useState, type ReactNode } from "react";
import { useActivityUrlMirror } from "./useActivityUrlMirror";

vi.mock("@/lib/errorLogger", () => ({ report: vi.fn() }));

function mirror(entry: string, initialFilter = "all") {
  const wrapper = ({ children }: { children: ReactNode }) => <MemoryRouter initialEntries={[entry]}>{children}</MemoryRouter>;
  return renderHook(
    () => {
      const [statusFilter, setStatusFilter] = useState(initialFilter);
      const [searchQuery, setSearchQuery] = useState("");
      useActivityUrlMirror(statusFilter, setStatusFilter, searchQuery, setSearchQuery, "all");
      return { statusFilter, setStatusFilter, searchQuery, search: useLocation().search };
    },
    { wrapper },
  );
}

describe("Posted / Working mirror their filter and search into the URL", () => {
  it("a link with ?filter= and ?q= opens on that bucket and search", () => {
    const { result } = mirror("/posts?filter=done&q=lawn");
    expect(result.current.statusFilter).toBe("done");
    expect(result.current.searchQuery).toBe("lawn");
  });

  it("a chosen bucket is written to the URL, and going back to the default drops the param", () => {
    const { result } = mirror("/posts");
    act(() => result.current.setStatusFilter("waiting"));
    expect(result.current.search).toBe("?filter=waiting");
    act(() => result.current.setStatusFilter("all"));
    expect(result.current.search).toBe("");
  });
});
