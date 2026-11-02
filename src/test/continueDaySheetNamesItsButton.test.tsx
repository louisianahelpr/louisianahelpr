/**
 * Jobs stages audit 1102e, two continue-day Lows:
 *  - Q2678 (row 14): after the Helpr marked it done, "Not finished? Set a day" still sat under their buttons, and one
 *    tap cleared their own Done (the sheet says "Your 'done' is cleared"). The Helpr's link is gone once they marked it
 *    done (they can Message); the poster's stays (the owner's Yusef case, lead 11-01).
 *  - Q2679 (row 16): the Helpr's "Ask for a different day" opened a sheet titled "Set a day to finish". The sheet now
 *    carries the name of the button that opened it, on both sides.
 * @mutate src/pages/jobs/jobPage/useContinueDayActions.tsx |     if (offerSetDay && !job.helper_completed_at) setDay = |     if (offerSetDay) setDay =
 * @mutate src/pages/jobs/jobPage/useContinueDayActions.tsx |     : side === "helpr"\n      ? "Ask for a different day" |     : side === "helpr"\n      ? undefined
 * @mutate src/pages/jobs/jobPage/useContinueDayActions.tsx |       : row.status === "set" ? "Change day" : "Set a different day"; |       : undefined;
 * @mutate src/components/jobs/ContinueDaySheet.tsx | <SheetHero title={title ?? "Set a day to finish"} /> | <SheetHero title={"Set a day to finish"} />
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, renderHook, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type { ContinueDay } from "@/lib/continueDayWords";

const state: { row: ContinueDay | null } = { row: null };
vi.mock("@/lib/continueDay", async (orig) => ({
  ...(await orig<typeof import("@/lib/continueDay")>()),
  fetchContinueDay: async () => state.row,
}));
vi.mock("sonner", async () => (await import("@/test/helpers/sonnerMock")).sonnerMock());
import { useContinueDayActions } from "@/pages/jobs/jobPage/useContinueDayActions";

Element.prototype.scrollTo ??= () => {};

const job = (over: Record<string, unknown> = {}) => ({
  id: "j1", status: "in_progress", is_group_job: false, has_active_dispute: false,
  helper_arrived_at: "2026-11-02T12:00:00Z", helper_completed_at: null as string | null, ...over,
});
const day = (over: Partial<ContinueDay> = {}): ContinueDay => ({
  id: "c1", job_id: "j1", proposed_by: "p", new_date: "2099-11-05", new_start_time: "09:00:00", note: null,
  status: "set", helper_confirmed_at: null, ...over,
});

function run(side: "poster" | "helpr", j: ReturnType<typeof job>) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  return renderHook(() => useContinueDayActions({ job: j, side, otherFirst: "Lexi", trackingStatus: "working", onChanged: () => {} }), { wrapper });
}

/** Opens the hook's sheet and returns its title. */
async function sheetTitle(result: ReturnType<typeof run>["result"]): Promise<string> {
  await waitFor(() => expect(result.current.setDay ?? result.current.posterExtras.find((a) => a.key === "continue-change")).toBeTruthy());
  const opener = result.current.setDay ?? result.current.posterExtras.find((a) => a.key === "continue-change")!;
  opener.go();
  await waitFor(() => expect(result.current.sheet).toBeTruthy());
  const { unmount } = render(<>{result.current.sheet}</>);
  const title = (await screen.findByRole("dialog")).querySelector("h2")?.textContent ?? "";
  unmount();
  return title;
}

beforeEach(() => { state.row = null; });

describe("Q2678 the Helpr's own Done is never one tap from cleared", () => {
  it("before Done the Helpr has the link; after Done they do not; the poster keeps theirs", async () => {
    const before = run("helpr", job());
    await waitFor(() => expect(before.result.current.setDay?.label).toBe("Not finished? Set a day"));
    const after = run("helpr", job({ helper_completed_at: "2026-11-02T13:00:00Z" }));
    await waitFor(() => expect(after.result.current.row).toBeNull());
    expect(after.result.current.setDay).toBeNull();
    const poster = run("poster", job({ helper_completed_at: "2026-11-02T13:00:00Z" }));
    await waitFor(() => expect(poster.result.current.setDay?.label).toBe("Not finished? Set a day"));
  });
});

describe("Q2679 the sheet is titled by the button that opened it", () => {
  it("the Helpr with a day set: 'Ask for a different day' opens 'Ask for a different day'", async () => {
    state.row = day();
    const h = run("helpr", job());
    await waitFor(() => expect(h.result.current.setDay?.label).toBe("Ask for a different day"));
    expect(await sheetTitle(h.result)).toBe("Ask for a different day");
  });

  it("the poster's 'Change day' opens 'Change day'; with no day yet the sheet is 'Set a day to finish'", async () => {
    state.row = day();
    const p = run("poster", job());
    expect(await sheetTitle(p.result)).toBe("Change day");
    state.row = null;
    const none = run("helpr", job());
    expect(await sheetTitle(none.result)).toBe("Set a day to finish");
  });
});
