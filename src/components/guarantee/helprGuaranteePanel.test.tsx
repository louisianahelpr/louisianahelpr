/**
 * Helpr Guarantee panel (owner 2026-10-27): the poster's explainer and "Not done right", the hired Helpr's
 * Accept fix / Can't fix / Mark fixed, the poster's It's fixed / Still not right. The data layer is mocked here;
 * the rules are the server's (src/test/pglite/helprGuarantee.pglite.mjs, src/test/helprGuarantee.test.ts).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { GuaranteeClaim, GuaranteeJob } from "@/lib/guarantee";

const s = vi.hoisted(() => ({
  claim: null as unknown,
  calls: [] as unknown[][],
}));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }));
vi.mock("@/hooks/useProofPhotoUrls", () => ({ useProofPhotoUrls: (v: string[]) => v.map(() => null) }));
vi.mock("@/lib/guarantee", async (orig) => ({
  ...(await orig<typeof import("@/lib/guarantee")>()),
  fetchGuaranteeClaim: async () => s.claim,
  uploadGuaranteePhotos: async (...a: unknown[]) => (s.calls.push(["upload", ...a]), []),
  openGuaranteeClaim: async (...a: unknown[]) => (s.calls.push(["open", ...a]), "c1"),
  helprAnswerGuarantee: async (...a: unknown[]) => (s.calls.push(["answer", ...a]), "fix_scheduled"),
  markGuaranteeFixed: async (...a: unknown[]) => (s.calls.push(["fixed", ...a]), "fixed"),
  posterAnswerGuarantee: async (...a: unknown[]) => (s.calls.push(["poster", ...a]), "closed"),
}));

import { HelprGuaranteePanel } from "./HelprGuaranteePanel";

const doneAgo = (h: number) => new Date(Date.now() - h * 3600e3).toISOString();
const job = (over: Partial<GuaranteeJob> = {}): GuaranteeJob => ({
  id: "j1", customer_id: "me", helper_id: "h1", status: "completed", payment_status: "payout_pending", is_group_job: false,
  helper_completed_at: doneAgo(3), poster_completed_at: doneAgo(2), ...over,
});
const claim = (over: Partial<GuaranteeClaim> = {}): GuaranteeClaim => ({
  id: "c1", job_id: "j1", poster_id: "me", helper_id: "h1", note: "Two shelves are crooked and a bracket is loose.",
  photo_paths: [], status: "awaiting_helpr", helpr_answer_by: doneAgo(-40), fix_date: null, fixed_at: null,
  poster_answer_by: null, closed_at: null, close_reason: null, poster_reject_note: null, created_at: doneAgo(1), ...over,
});
function renderPanel(j: GuaranteeJob, userId: string, side: "poster" | "helpr" | null) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <HelprGuaranteePanel job={j} userId={userId} side={side} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  s.claim = null;
  s.calls.length = 0;
});

describe("the poster", () => {
  it("an open job: the explainer only", () => {
    renderPanel(job({ status: "open" }), "me", "poster");
    expect(screen.getByText(/Not done right\? Tell us within 48 hours/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Not done right" })).toBeNull();
  });

  it("within 48 h of done: Not done right, a sentence required, then the claim is sent", async () => {
    renderPanel(job(), "me", "poster");
    fireEvent.click(await screen.findByRole("button", { name: "Not done right" }));
    const send = screen.getByRole("button", { name: "Ask for a fix" });
    expect((send as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("What wasn't done right?"), { target: { value: "Two of the shelves are crooked." } });
    expect((send as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(send);
    await waitFor(() => expect(s.calls.map((c) => c[0])).toEqual(["upload", "open"]));
    expect(s.calls[1]).toEqual(["open", "j1", "Two of the shelves are crooked.", []]);
  });

  it("past 48 h, or already paid: no button", async () => {
    renderPanel(job({ helper_completed_at: doneAgo(50), poster_completed_at: doneAgo(49) }), "me", "poster");
    await screen.findByText(/Tell us within 48 hours/);
    expect(screen.queryByRole("button", { name: "Not done right" })).toBeNull();
  });

  it("after the fix: It's fixed closes it; Still not right needs a sentence", async () => {
    s.claim = claim({ status: "fixed", fix_date: "2026-10-28", poster_answer_by: doneAgo(-40) });
    renderPanel(job(), "me", "poster");
    fireEvent.click(await screen.findByRole("button", { name: "It's fixed" }));
    await waitFor(() => expect(s.calls[0]).toEqual(["poster", "c1", true, null]));
  });
});

describe("the hired Helpr", () => {
  it("sees nothing without a claim", async () => {
    const { container } = renderPanel(job(), "h1", "helpr");
    await new Promise((r) => setTimeout(r, 0));
    expect(container.querySelector("[data-guarantee-panel]")).toBeNull();
  });

  it("sees the note, picks a day and accepts; or says Can't fix after a confirm", async () => {
    s.claim = claim();
    renderPanel(job(), "h1", "helpr");
    expect(await screen.findByText("Two shelves are crooked and a bracket is loose.")).toBeTruthy();
    const days = screen.getAllByRole("radio");
    expect(days.length).toBe(4);
    fireEvent.click(days[2]);
    fireEvent.click(screen.getByRole("button", { name: "Accept fix" }));
    await waitFor(() => expect(s.calls[0]?.[0]).toBe("answer"));
    expect(s.calls[0][2]).toBe(true);
    expect(s.calls[0][3]).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    fireEvent.click(screen.getByRole("button", { name: "Can't fix" }));
    fireEvent.click(screen.getByRole("button", { name: "Yes, I can't fix it" }));
    await waitFor(() => expect(s.calls[1]).toEqual(["answer", "c1", false, null]));
  });

  it("a scheduled fix: Mark fixed", async () => {
    s.claim = claim({ status: "fix_scheduled", fix_date: "2026-10-29" });
    renderPanel(job(), "h1", "helpr");
    fireEvent.click(await screen.findByRole("button", { name: "Mark fixed" }));
    await waitFor(() => expect(s.calls[0]).toEqual(["fixed", "c1"]));
  });
});
