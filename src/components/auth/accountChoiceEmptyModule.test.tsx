/**
 * An empty lazy module never leaves a screen silently stuck (B68, review of 5d490e886e).
 *
 * When main.tsx prevents a preload error for a recovery reload, Vite resolves the import with undefined
 * (loadModule then gives null). If no reload follows, untilReload() rejects, and each site's existing failure
 * path runs instead of a bare `return`:
 *   - the account-choice dialog (sign-up with no matching account): its catch reports, tells the person and
 *     clears the choice, and the "the page reloaded" retry marker is cleared;
 *   - Help: a small "try again" message, and the next tap tries again.
 *
 * @mutate src/components/auth/SocialAuthButtons.tsx |       .then((m) => m ?? untilReload())\n      .then((m) => {\n        clearAccountChoiceRetry(); |       .then((m) => {\n        if (!m) return;\n        clearAccountChoiceRetry();
 * @mutate src/components/auth/SocialAuthButtons.tsx |         if (err instanceof ModuleUnavailableError) clearAccountChoiceRetry(); |         void ModuleUnavailableError;
 * @mutate src/components/help/HelpEntry.tsx |       .then((mod) => mod ?? untilReload()) |       .then((mod) => mod ?? new Promise<never>(() => {}))
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const h = vi.hoisted(() => ({ empty: 0, reports: [] as unknown[], toasts: [] as string[] }));
vi.mock("@/lib/loadModule", async (orig) => {
  const real = await orig<typeof import("@/lib/loadModule")>();
  return { ...real, loadModule: async <T,>(load: () => Promise<T>) => (h.empty > 0 ? (h.empty--, null) : real.loadModule(load)) };
});
vi.mock("@/lib/errorLogger", () => ({ report: (e: unknown) => h.reports.push(e) }));
vi.mock("sonner", () => ({ toast: Object.assign((m: string) => h.toasts.push(m), { error: (m: string) => h.toasts.push(`error:${m}`) }) }));
vi.mock("@/hooks/useCurrentUser", () => ({ useCurrentUser: () => ({ user: { id: "u1" }, profile: {}, isLoading: false }) }));

import { useAccountChoiceDialog } from "./SocialAuthButtons";
import { HelpEntry } from "@/components/help/HelpEntry";

beforeEach(() => {
  h.empty = 0;
  h.reports.length = 0;
  h.toasts.length = 0;
});

describe("account-choice dialog, empty module, no reload", () => {
  it("reports, runs the failure path (tell + clear the choice) and clears the retry marker", async () => {
    h.empty = 1;
    const onLoadFailed = vi.fn();
    const { result } = renderHook(() => useAccountChoiceDialog(true, onLoadFailed));
    await waitFor(() => expect(onLoadFailed).toHaveBeenCalledTimes(1));
    expect(h.reports).toHaveLength(1);
    expect(result.current).toBeNull();
    // Storage itself (peekAccountChoiceRetry memoises this document's first read).
    expect(sessionStorage.getItem("helpr_signin_retry_note")).toBeNull();
  });

  it("loads normally otherwise", async () => {
    const onLoadFailed = vi.fn();
    const { result } = renderHook(() => useAccountChoiceDialog(true, onLoadFailed));
    await waitFor(() => expect(result.current).not.toBeNull());
    expect(onLoadFailed).not.toHaveBeenCalled();
  });
});

describe("Help, empty module, no reload", () => {
  it("says to try again instead of ignoring the tap", async () => {
    h.empty = 1;
    render(<MemoryRouter initialEntries={["/home"]}><HelpEntry /></MemoryRouter>);
    fireEvent.click(screen.getByRole("button", { name: "Help" }));
    await waitFor(() => expect(h.toasts).toContain("error:Help didn't open. Tap Help to try again."));
  });
});
