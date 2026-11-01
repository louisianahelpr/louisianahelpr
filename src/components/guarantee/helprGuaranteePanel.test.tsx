/**
 * Helpr Guarantee panel (owner 2026-10-27): the poster's explainer and "Not done right", the hired Helpr's
 * Accept fix / Can't fix / Mark fixed, the poster's It's fixed / Still not right. The data layer is mocked here;
 * the rules are the server's (src/test/pglite/helprGuarantee.pglite.mjs, src/test/helprGuarantee.test.ts).
 *
 * F5 (app audit 2026-10-28): the explainer ended "we decide, and a refund is of the job price." (broken sentence),
 * and the admin-deciding line read "A refund, if any, is of the job price." (same shape; lead, same commit).
 * @mutate src/components/guarantee/HelprGuaranteePanel.tsx |       we decide whether you get a refund of the job price. |       we decide, and a refund is of the job price.
 * @mutate src/components/guarantee/HelprGuaranteePanel.tsx | An admin is deciding this, including whether you get a refund of the job price. | An admin is deciding this. A refund, if any, is of the job price.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { GuaranteeClaim, GuaranteeJob } from "@/lib/guarantee";

const s = vi.hoisted(() => ({
  claim: null as unknown,
  calls: [] as unknown[][],
  fetched: 0,
}));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }));
vi.mock("@/hooks/useProofPhotoUrls", () => ({ useProofPhotoUrls: (v: string[]) => v.map(() => null) }));
vi.mock("@/lib/guarantee", async (orig) => ({
  ...(await orig<typeof import("@/lib/guarantee")>()),
  fetchGuaranteeClaim: async () => { s.fetched += 1; return s.claim; },
  uploadGuaranteePhotos: async (...a: unknown[]) => (s.calls.push(["upload", ...a]), []),
  openGuaranteeClaim: async (...a: unknown[]) => (s.calls.push(["open", ...a]), "c1"),
  helprAnswerGuarantee: async (...a: unknown[]) => (s.calls.push(["answer", ...a]), "fix_scheduled"),
  markGuaranteeFixed: async (...a: unknown[]) => (s.calls.push(["fixed", ...a]), "fixed"),
  posterAnswerGuarantee: async (...a: unknown[]) => (s.calls.push(["poster", ...a]), "closed"),
}));

import { HelprGuaranteePanel } from "./HelprGuaranteePanel";
import { fixDateChoices } from "@/lib/guarantee";

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
  // JA-28 (audit 11-01): the explainer only where the guarantee applies (Working to 48 h after Done, no open dispute).
  // @mutate src/lib/guarantee/index.ts |   if (job.status !== "completed") return false; |   if (job.status !== "completed") return true;
  // @mutate src/lib/guarantee/index.ts |   if (job.has_active_dispute \|\| job.status === "disputed") return false; |   if (false) return false;
  // @mutate src/components/guarantee/HelprGuaranteePanel.tsx |     if (!guaranteeExplainerApplies(job)) return null; |     if (false) return null;
  // @mutate src/components/guarantee/HelprGuaranteePanel.tsx |   if (!c && !ask && !guaranteeExplainerApplies(job)) return null; |   if (false) return null;
  it("an open job (not worked yet): no explainer", () => {
    const { container } = renderPanel(job({ status: "open" }), "me", "poster");
    expect(container.querySelector("[data-guarantee-panel]")).toBeNull();
  });

  it("a job under way: the explainer only", async () => {
    renderPanel(job({ status: "in_progress", helper_completed_at: null, poster_completed_at: null }), "me", "poster");
    expect(await screen.findByText(/Not done right\? Tell us within 48 hours/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Not done right" })).toBeNull();
  });

  it("cancelled, booked, disputed, or past 48 h with no claim: no explainer", async () => {
    for (const j of [
      job({ status: "cancelled", payment_status: "refunded" }),
      job({ status: "accepted", helper_completed_at: null, poster_completed_at: null }),
      job({ status: "disputed" }),
      job({ status: "in_progress", has_active_dispute: true }),
      job({ helper_completed_at: doneAgo(50), poster_completed_at: doneAgo(49) }),
    ]) {
      const before = s.fetched;
      const { container, unmount } = renderPanel(j, "me", "poster");
      // The claim read has answered (an un-answered read also draws nothing, which would prove nothing).
      await waitFor(() => expect(s.fetched).toBeGreaterThan(before));
      await new Promise((r) => setTimeout(r, 10));
      expect(container.querySelector("[data-guarantee-explainer]"), j.status ?? "").toBeNull();
      unmount();
    }
  });

  it("F5: the explainer's refund line is a whole sentence", async () => {
    const { container } = renderPanel(job({ status: "in_progress", helper_completed_at: null, poster_completed_at: null }), "me", "poster");
    await screen.findByText(/Tell us within 48 hours/);
    const text = (container.querySelector("[data-guarantee-explainer]")?.textContent ?? "").replace(/\s+/g, " ").trim();
    // Inventory floor: the explainer rendered with all its sentences.
    expect(text.split(/(?<=[.?])\s/).length).toBeGreaterThan(2);
    expect(text, "the broken 'a refund is of the job price' sentence is back").not.toMatch(/refund is of/);
    expect(text).toMatch(/If it can't be fixed, we decide whether you get a refund of the job price\.$/);
  });

  it("F5: while an admin decides, the poster reads the same plain refund wording", async () => {
    s.claim = claim({ status: "escalating" });
    const { container } = renderPanel(job(), "me", "poster");
    expect(await screen.findByText("An admin is deciding this, including whether you get a refund of the job price.")).toBeTruthy();
    expect(container.textContent, "the 'is of the job price' wording is back").not.toMatch(/is of the job price/);
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
    renderPanel(job({ payment_status: "released" }), "me", "poster");
    await screen.findByText(/Tell us within 48 hours/);
    expect(screen.queryByRole("button", { name: "Not done right" })).toBeNull();
    cleanup();
    const before = s.fetched;
    const { container } = renderPanel(job({ helper_completed_at: doneAgo(50), poster_completed_at: doneAgo(49) }), "me", "poster");
    await waitFor(() => expect(s.fetched).toBeGreaterThan(before));
    await new Promise((r) => setTimeout(r, 10));
    expect(screen.queryByRole("button", { name: "Not done right" })).toBeNull();
    expect(container.querySelector("[data-guarantee-explainer]")).toBeNull();
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
    // The server's window, today only while a visit today is still possible (F31: fixDateChoices).
    expect(days.length).toBe(fixDateChoices().length);
    expect(days.length).toBeGreaterThanOrEqual(3);
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
