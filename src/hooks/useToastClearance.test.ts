/**
 * Lead review 2026-10-20 (board 14): the "Get notified?" toast is the one
 * prompt on screen, but it must not cover a card's button. While a toast is
 * live the list's bottom padding grows by its height (+12px); a removed toast
 * gives the room back.
 *
 * @mutate src/hooks/useToastClearance.ts | return tallest > 0 ? Math.ceil(tallest) + 12 : 0; | return 0;
 * @mutate src/components/job-card/JobListPage.tsx | var(--bottom-nav-h, 96px) + ${toastClearance}px) | var(--bottom-nav-h, 96px))
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, renderHook } from "@testing-library/react";
import { useToastClearance } from "./useToastClearance";

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

function toast(height: number, removed = false) {
  const li = document.createElement("li");
  li.setAttribute("data-sonner-toast", "");
  if (removed) li.setAttribute("data-removed", "true");
  li.getBoundingClientRect = () => ({ height, width: 300, top: 0, left: 0, right: 300, bottom: height, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
  return li;
}

describe("useToastClearance", () => {
  it("is 0 with no toast, the toast's height + 12 while one shows, and 0 again once it is removed", async () => {
    const { result } = renderHook(() => useToastClearance());
    expect(result.current).toBe(0);
    const t = toast(64);
    await act(async () => { document.body.appendChild(t); });
    expect(result.current).toBe(76);
    await act(async () => { t.setAttribute("data-removed", "true"); });
    expect(result.current).toBe(0);
  });

  it("the Jobs list wires it into its bottom padding", () => {
    const src = readFileSync(resolve(__dirname, "../components/job-card/JobListPage.tsx"), "utf8");
    expect(src).toMatch(/const toastClearance = useToastClearance\(\);/);
    expect(src).toContain("var(--bottom-nav-h, 96px) + ${toastClearance}px)");
  });
});
