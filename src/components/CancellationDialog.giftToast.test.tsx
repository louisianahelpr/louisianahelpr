// Q?gift-cancel-copy (lh-money-escrow review of 7166349cd, #7; Q1806 design
// review, 2026-10-17): a job a gift card paid toward gets its gift back on the
// GIFT balance (void-cancelled-payments -> restore_gift_card_for_job). The
// confirmation used to tell that poster their money "returns to your card,
// less the card-processing fee". The dialog reads the job's gift_cards row
// right after the cancel and the toast names the gift; a failed read is
// neutral copy, never the card copy.
//
// @mutate src/components/CancellationDialog.tsx |         gift = giftOnJobFromRead(giftRows, giftErr); |         gift = "none";
// @mutate src/components/CancellationDialog.tsx |           .in("status", ["redeemed", "reserved"]) |           .in("status", ["reserved"])
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const toastSuccess = vi.fn();
let giftRead: { data: Array<{ status: string }> | null; error: unknown } = { data: [], error: null };
const giftQueries: Array<{ jobId?: unknown; statuses?: unknown }> = [];

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: (...a: unknown[]) => toastSuccess(...a), warning: vi.fn() } }));
vi.mock("@/lib/haptics", () => ({ hapticError: vi.fn(), hapticSuccess: vi.fn(), hapticLight: vi.fn(), hapticMedium: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: vi.fn((table: string) => {
      if (table === "gift_cards") {
        const q: { jobId?: unknown; statuses?: unknown } = {};
        giftQueries.push(q);
        const chain = {
          select: () => chain,
          eq: (_col: string, v: unknown) => { q.jobId = v; return chain; },
          in: (_col: string, v: unknown) => { q.statuses = v; return chain; },
          limit: () => Promise.resolve(giftRead),
        };
        return chain;
      }
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            maybeSingle: vi.fn(() => Promise.resolve({ data: null, error: null })),
            single: vi.fn(() => Promise.resolve({ data: null, error: null })),
          })),
        })),
      };
    }),
    rpc: () => Promise.resolve({ data: { action: "none", cancellation_fee: 0 }, error: null }),
  },
}));
vi.mock("@/lib/notifications", () => ({ createNotification: vi.fn(), notifyJobParty: vi.fn() }));
vi.mock("@/lib/errorLogger", () => ({ report: vi.fn() }));

import { CancellationDialog } from "./CancellationDialog";

const props = {
  jobId: "job-gift", jobTitle: "Fix the fence", jobDate: new Date(Date.now() + 72 * 3600e3).toISOString().slice(0, 10),
  jobStartTime: null, jobBudget: 100, hasHelper: true, wasFunded: true, helperName: "Marie",
  feeStamp: { helper_fee_flat_cents: 70, helper_fee_percent: 5 },
  open: true, onClose: vi.fn(), onCancelled: vi.fn(),
};

async function cancelAndReadToast(): Promise<string> {
  render(<CancellationDialog {...props} />);
  fireEvent.click(await screen.findByRole("button", { name: /^cancel job$/i }));
  await waitFor(() => expect(toastSuccess).toHaveBeenCalled());
  return String(toastSuccess.mock.calls[0][0]);
}

describe("CancellationDialog — a gift paid toward the job", () => {
  beforeEach(() => {
    toastSuccess.mockClear();
    giftQueries.length = 0;
  });

  it("names the gift balance, and reads this job's redeemed or reserved gift", async () => {
    giftRead = { data: [{ status: "redeemed" }], error: null };
    const t = await cancelAndReadToast();
    expect(t).toMatch(/^Job cancelled — your gift goes back to your gift balance within the hour, and any card payment returns to your card/);
    expect(giftQueries).toEqual([{ jobId: "job-gift", statuses: ["redeemed", "reserved"] }]);
  });

  it("a failed gift read is neutral, never the card copy", async () => {
    giftRead = { data: null, error: { code: "57014", message: "canceling statement due to statement timeout" } };
    const t = await cancelAndReadToast();
    expect(t).toBe("Job cancelled. We'll send you a note with exactly what comes back to you within the hour.");
  });

  it("control: no gift keeps the card copy", async () => {
    giftRead = { data: [], error: null };
    const t = await cancelAndReadToast();
    expect(t).toMatch(/returns to your card/);
    expect(t).not.toMatch(/gift/);
  });
});
