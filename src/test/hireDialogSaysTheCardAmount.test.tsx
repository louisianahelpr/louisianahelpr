/**
 * JOBS3-46: the hire dialog on a held card said "Your card is charged when Hallie accepts" and never how much.
 *
 * @mutate src/components/ResponseDeadlineDialog.tsx |   const holdJobId = open && postedJob |   const holdJobId = false && postedJob
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ResponseDeadlineDialog } from "@/components/ResponseDeadlineDialog";

const read = vi.hoisted(() => vi.fn());
vi.mock("@/lib/cardHoldRead", () => ({ readCardHoldLine: read }));

const job = { id: "j1", date_needed: "2099-01-01", start_time: "09:00", title: "Yard", budget: 100, payment_status: "held" };
const draw = (over: object = {}) =>
  render(
    <MemoryRouter>
      <ResponseDeadlineDialog open helperName="Hallie H" onConfirm={vi.fn()} onClose={vi.fn()} job={{ ...job, ...over }} />
    </MemoryRouter>,
  );
const line = () => document.querySelector("[data-hire-card-held]")?.textContent ?? "";

describe("the hire dialog names what a held card is charged", () => {
  beforeEach(() => read.mockReset());

  it("states the hold's own amount", async () => {
    read.mockResolvedValue({ scheduled: false, amountCents: 10570 });
    draw();
    await waitFor(() => expect(line()).toBe("Your card is charged $105.70 when Hallie accepts."));
    expect(read).toHaveBeenCalledWith("j1");
    expect(screen.queryByText(/nothing new is charged/)).not.toBeInTheDocument();
  });

  it("an unread hold names no amount", async () => {
    read.mockResolvedValue({ scheduled: false, amountCents: null });
    draw();
    await waitFor(() => expect(read).toHaveBeenCalled());
    expect(line()).toBe("Your card is charged when Hallie accepts.");
  });

  it("a crew's total is not this one Helpr's, and a paid job has no hold to read", () => {
    draw({ is_group_job: true });
    expect(line()).toBe("Your card is charged when Hallie accepts.");
    draw({ payment_status: "escrow" });
    expect(read).not.toHaveBeenCalled();
  });
});
