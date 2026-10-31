/**
 * Board 29 (poster hires): "Hire Andre", the job and the Helpr, and what was paid. The card is charged
 * when the job is posted (owner 2026-10-21, friction 2), so hiring charges nothing new and the sheet
 * says so; the amount is the job price in rust, shown only when it is the whole charge for this Helpr.
 * @mutate src/components/ResponseDeadlineDialog.tsx | </strong>, was paid when you posted it, so nothing new is charged now. | </strong>, is charged now.
 * @mutate src/components/ResponseDeadlineDialog.tsx |   const series = !!job?.recurrence_days?.length; |   const series = false;
 * @mutate src/components/ResponseDeadlineDialog.tsx |             {job?.is_group_job\n |             {false\n
 * @mutate src/components/ResponseDeadlineDialog.tsx |   const price = job && !job.is_group_job && | const price = job &&
 * @mutate src/components/ResponseDeadlineDialog.tsx | <DialogHero title={`Hire ${them}`} /> | <DialogHero title="Set a response deadline" />
 */
import { describe, it, expect, vi, beforeAll } from "vitest";
import { render, screen } from "@testing-library/react";
import { ResponseDeadlineDialog } from "@/components/ResponseDeadlineDialog";

vi.mock("@/components/UserAvatar", () => ({ UserAvatar: () => <span /> }));

beforeAll(() => {
  Element.prototype.hasPointerCapture = Element.prototype.hasPointerCapture ?? (() => false);
  Element.prototype.scrollIntoView = Element.prototype.scrollIntoView ?? (() => {});
});

const job = { title: "Pressure wash driveway", date_needed: "2031-10-31", start_time: "09:00", budget: 90, is_group_job: false, urgent_fee: null };
const helper = { userId: "h1", idVerified: true, avgRating: 4.9, reviewCount: 18 };

describe("board 29: hire sheet", () => {
  it("names the hire, the job, the Helpr, and says nothing new is charged, with the paid price in rust", () => {
    render(<ResponseDeadlineDialog open helperName="Andre Landry" job={job} helper={helper} onConfirm={() => {}} onClose={() => {}} />);
    expect(screen.getByRole("heading", { name: "Hire Andre" })).toBeInTheDocument();
    expect(screen.getByText("Pressure wash driveway")).toBeInTheDocument();
    expect(screen.getByText("ID verified")).toBeInTheDocument();
    expect(screen.getByText(/4\.9 · 18 reviews/)).toBeInTheDocument();
    const note = document.querySelector("[data-hire-no-new-charge]")!;
    expect(note.textContent).toMatch(/The job price, \$90, was paid when you posted it, so nothing new is charged now\. Louisiana Helpr holds the money and releases it to Andre after the job is done\. If Andre says no or doesn't answer, the job reopens and your payment stays on it\./);
    expect(note.querySelector("strong")!.className).toContain("sienna-ink");
    expect(screen.getByRole("button", { name: "Send offer" })).toBeInTheDocument();
  });

  it("a crew job or an urgent bonus shows no amount (the budget isn't this Helpr's whole charge)", () => {
    const { unmount } = render(<ResponseDeadlineDialog open helperName="Andre" job={{ ...job, is_group_job: true }} onConfirm={() => {}} onClose={() => {}} />);
    expect(document.querySelector("[data-hire-no-new-charge]")!.textContent).toMatch(/^The job was paid for when you posted it, so nothing new is charged now\. Louisiana Helpr holds the money and pays each Helpr on the crew their share after the job is done\.$/);
    unmount();
    render(<ResponseDeadlineDialog open helperName="Andre" job={{ ...job, urgent_fee: 10 }} onConfirm={() => {}} onClose={() => {}} />);
    expect(document.querySelector("[data-hire-no-new-charge]")!.textContent).not.toMatch(/\$/);
  });

  it("a series says only the first visit was paid, and later visits are charged before they come (money review #1)", () => {
    render(<ResponseDeadlineDialog open helperName="Andre" job={{ ...job, recurrence_days: [1, 3] }} onConfirm={() => {}} onClose={() => {}} />);
    expect(document.querySelector("[data-hire-no-new-charge]")!.textContent).toMatch(/^The first visit, \$90, was paid when you posted it, so nothing new is charged now\. Each later visit is charged before it comes\./);
  });

  it("claims payment only on a funded job (money review #4)", () => {
    render(<ResponseDeadlineDialog open helperName="Andre" job={{ ...job, payment_status: "unpaid" }} onConfirm={() => {}} onClose={() => {}} />);
    expect(document.querySelector("[data-hire-no-new-charge]")).toBeNull();
  });
});
