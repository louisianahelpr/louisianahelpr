/**
 * F428 (whole-app audit 2026-11-10, W5 High): the block sheet's 4th bullet was a 90-word run-on ("10 active jobs
 * between you will be cancelled: "...", ... It starts within 24 hours, so about $545 is for your Helpr's time, most of
 * the rest of your payment comes back to you, and it counts as a strike.") next to the red Block button, and a person
 * who only wanted quiet had no way out but Cancel. Now: one short bullet per fact, the job titles as a nested list,
 * "the Helpr's time" (never "your Helpr's"), and "Mute instead" as the FIRST button wherever a thread can be muted.
 * @mutate src/components/BlockUserDialog.tsx |               {onMuteInstead && ( |               {false && (
 * @mutate src/components/BlockUserDialog.tsx |                   onClick={() => { onClose(); onMuteInstead(); }}> |                   onClick={() => { onMuteInstead(); }}>
 * @mutate src/components/BlockUserDialog.tsx | )}{" "}You get most of the rest back. | )}
 * @mutate src/components/BlockUserDialog.tsx | for the Helpr&rsquo;s time and it counts | for your Helpr&rsquo;s time and it counts
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { jobLocalDateISO } from "@/test/helpers/jobLocalDate";

const rows: Array<Record<string, unknown>> = [];
vi.mock("sonner", async () => (await import("@/test/helpers/sonnerMock")).sonnerMock());
vi.mock("@/lib/userBlocks", () => ({ blockUser: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: { getUser: vi.fn(() => Promise.resolve({ data: { user: { id: "poster-1" } } })) },
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        or: vi.fn(() => ({
          in: vi.fn(() => ({ is: vi.fn(() => Promise.resolve({ data: rows, error: null })) })),
        })),
      })),
    })),
  },
}));

import { BlockUserDialog } from "@/components/BlockUserDialog";

const NOW = new Date("2026-09-27T12:00:00Z");
// Committed yesterday-start job, $100 budget: the 50% tier, so the poster reads a $50 amount and a strike.
const job = (i: number) => ({
  id: `job-${i}`, title: `Job number ${i}`, budget: 100, date_needed: jobLocalDateISO(-1, NOW), start_time: null,
  customer_id: "poster-1", helper_id: "helper-1", helper_confirmed_at: "2026-09-20T12:00:00Z",
});

function open(props: { onMuteInstead?: () => void; onClose?: () => void } = {}) {
  render(<BlockUserDialog open onClose={props.onClose ?? vi.fn()} blockedUserId="helper-1" blockedUserName="Hallie" onMuteInstead={props.onMuteInstead} />);
  return screen.getByRole("dialog");
}
const words = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;

beforeEach(() => {
  rows.length = 0;
  vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
});
afterEach(() => vi.useRealTimers());

describe("F428: the block sheet is a short list, with Mute instead first", () => {
  it("ten jobs: every top-level bullet stays short; the titles are a nested list, not a run-on", async () => {
    for (let i = 1; i <= 10; i++) rows.push(job(i));
    const dialog = open();
    await screen.findByText(/also cancels/);
    const list = within(dialog).getByRole("list", { name: "Jobs that will be cancelled" });
    // F260i: three show; the rest wait behind the "Show all" button.
    expect(within(list).getAllByRole("listitem")).toHaveLength(3);
    const top = within(dialog).getAllByRole("listitem").filter((li) => !list.contains(li));
    // A bullet's own words: what sits outside its nested list.
    const texts = top.map((li) => Array.from(li.childNodes).filter((n) => (n as HTMLElement).tagName !== "UL").map((n) => n.textContent ?? "").join(""));
    expect(texts.length).toBeGreaterThanOrEqual(5);
    for (const t of texts) expect(words(t), t).toBeLessThanOrEqual(20);
    expect(texts).toContain("Jobs cancelled:Show all 10 jobs");
    expect(texts).toContain("That covers 10 jobs that start within 24 hours. You get most of the rest back.");
    // F260i: the amount and the strike are in the one summary line above the bullets.
    const summary = within(dialog).getByText(/^Blocking Hallie also cancels 10 jobs\./).textContent ?? "";
    expect(words(summary), summary).toBeLessThanOrEqual(25);
    expect(summary).toMatch(/You will pay about \$\d[\d.,]* for the Helpr’s time and it counts as a strike against you\.$/);
    fireEvent.click(within(dialog).getByRole("button", { name: "Show all 10 jobs" }));
    expect(within(list).getAllByRole("listitem")).toHaveLength(10);
    expect(dialog.textContent).not.toMatch(/your Helpr/);
    expect(dialog.textContent).not.toMatch(/active jobs? between you/);
  });

  it("with a thread to mute, Mute instead is the first button; it closes the sheet and opens the mute picker", async () => {
    rows.push(job(1));
    const onMuteInstead = vi.fn();
    const onClose = vi.fn();
    const dialog = open({ onMuteInstead, onClose });
    await screen.findByText(/also cancels/);
    const names = within(dialog).getAllByRole("button").map((b) => (b.getAttribute("aria-label") || b.textContent || "").trim()).filter((n) => n !== "Close");
    expect(names).toEqual(["Mute instead", "Cancel", "Block"]);
    fireEvent.click(within(dialog).getByRole("button", { name: "Mute instead" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onMuteInstead).toHaveBeenCalledTimes(1);
  });

  it("without a thread (a profile), there is no Mute instead", () => {
    const dialog = open();
    expect(within(dialog).queryByRole("button", { name: "Mute instead" })).toBeNull();
  });

  it("both chat entry points (header menu and bubble sheet) hand the sheet the mute picker", () => {
    const src = readFileSync(resolve(__dirname, "../components/messages/ChatView.tsx"), "utf8");
    const hits = src.match(/setBlockTarget\(\{ id: otherUserId, name: activeConvo\.otherUserName, muteInstead: \(\) => setMuteSheetOpen\(true\) \}\)/g) ?? [];
    expect(hits).toHaveLength(2);
    expect(src).not.toMatch(/setBlockTarget\(\{ id: otherUserId, name: activeConvo\.otherUserName \}\)/);
  });
});
