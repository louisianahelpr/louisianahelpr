/**
 * a11y-prod /explore (helper, phone light, 11-06): axe label-content-name-mismatch (serious, WCAG 2.5.3
 * "Label in Name") on every signed-in job card. The card root (role=button) carried
 * aria-label "View <title> — $<price>", which left out the words the card shows (category, badges,
 * place, date, poster), so a voice user who said what they saw ("click Cleaning") hit nothing. axe's
 * rule applies only to a control that HAS an aria-label or aria-labelledby; with neither, the card's
 * own words are its name. An sr-only "View " goes first so a screen reader still hears what a tap does.
 * The spoken price is the chip's own text now, so it is the figure the chip shows, with the first-payout
 * setup fee taken off (Q753), never a second computation beside it.
 *
 * @mutate src/components/dashboard/jobCardInteractiveProps.ts |         tabIndex: 0,\n |         tabIndex: 0,\n        "aria-label": `View ${job.title}`,\n
 * @mutate src/components/dashboard/JobCard.tsx |       {!isGuest && <span className="sr-only">View </span>} | {null}
 * @mutate src/components/dashboard/JobPrice.tsx |   const { netEarnings } = computeNet(budget, effectiveFee, urgentFee, helpersNeeded, firstPayoutFee, feeStamp); |   const { netEarnings } = computeNet(budget, effectiveFee, urgentFee, helpersNeeded, 0, feeStamp);
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import JobCard from "@/components/dashboard/JobCard";
import type { EnrichedJob } from "@/components/dashboard/types";

const fee = vi.hoisted(() => ({ dollars: 0 }));
vi.mock("@/hooks/useFirstPayoutFee", () => ({ useFirstPayoutFeeDollars: () => fee.dollars, useFirstPayoutFeeCents: () => fee.dollars * 100 }));
vi.mock("@/hooks/useMapKitJs", () => ({ useMapKitJs: () => "idle" }));
vi.mock("@/lib/haptics", () => ({ hapticLight: vi.fn() }));

afterEach(() => { cleanup(); fee.dollars = 0; });

const job = (o: Record<string, unknown> = {}) =>
  ({
    id: "j1", title: "Deep clean the kitchen", description: "x", category: "cleaning", budget: 100,
    location: "Lafayette, LA", status: "open", expires_at: null, boost_expires_at: null, boosted_at: null,
    created_at: "2026-10-01T12:00:00Z", updated_at: "2026-10-01T12:00:00Z", date_needed: null, is_urgent: false,
    urgent_fee: 0, is_group_job: false, helpers_needed: 1, customer_id: "22222222-2222-2222-2222-222222222222",
    photos: [], posterName: "Bea Thibodeaux", posterAvatarUrl: null, posterAvgRating: 4.8, posterReviewCount: 6,
    ...o,
  }) as unknown as EnrichedJob;

const draw = (variant?: "guest") =>
  render(
    <MemoryRouter>
      <JobCard job={job()} effectiveFee={15} currentUserId="someone-else" onApply={() => {}} onReport={() => {}} onSelect={() => {}} index={1} variant={variant} />
    </MemoryRouter>,
  ).container;

/** The accessible name testing-library's role query computes for `el`. */
function computeAccessibleName(el: Element): string {
  let out: string | null = null;
  within(el.parentElement as HTMLElement).getAllByRole("button", {
    name: (n, e) => {
      if (e === el) out = n;
      return e === el;
    },
  });
  if (out === null) throw new Error("no button name computed for the card");
  return out;
}

/** Text a sighted reader sees: the subtree minus aria-hidden and sr-only parts. */
function visibleText(el: Element): string {
  const clone = el.cloneNode(true) as Element;
  clone.querySelectorAll('[aria-hidden="true"], [aria-hidden=""], .sr-only').forEach((n) => n.remove());
  return (clone.textContent ?? "").replace(/\s+/g, " ").trim();
}

describe("a signed-in job card's accessible name is its own words (WCAG 2.5.3)", () => {
  it("the card root has no aria-label or aria-labelledby, so axe's label-in-name rule has nothing to mismatch", () => {
    const cards = draw().querySelectorAll('[data-feed-card][role="button"]');
    expect(cards.length).toBeGreaterThan(0);
    for (const card of cards) {
      expect(card.hasAttribute("aria-label")).toBe(false);
      expect(card.hasAttribute("aria-labelledby")).toBe(false);
    }
  });

  it("its name starts with 'View ' and holds the title, the place and the chip's price", () => {
    const card = draw().querySelector('[data-feed-card][role="button"]')!;
    const name = computeAccessibleName(card);
    expect(name.startsWith("View ")).toBe(true);
    expect(name).toContain("Deep clean the kitchen");
    expect(name).toContain("Lafayette");
    const chip = card.querySelector(".money-chip")!;
    expect(visibleText(chip)).toMatch(/^\$\d+$/);
    expect(name.replace(/\s+/g, "")).toContain(visibleText(chip));
  });

  it("with the first-payout fee owed, the spoken price is the chip's figure with the fee off (Q753)", () => {
    const before = visibleText(draw().querySelector(".money-chip")!);
    cleanup();
    fee.dollars = 3;
    const card = draw().querySelector('[data-feed-card][role="button"]')!;
    const after = visibleText(card.querySelector(".money-chip")!);
    expect(Number(after.slice(1))).toBe(Number(before.slice(1)) - 3);
    const name = computeAccessibleName(card).replace(/\s+/g, "");
    expect(name).toContain(after);
    expect(name).toContain("setupfee");
  });

  it("a guest card (no role) gets no 'View ' text", () => {
    const card = draw("guest").querySelector("[data-feed-card]")!;
    expect(card.getAttribute("role")).toBeNull();
    expect(card.querySelector(".sr-only")?.textContent ?? "").not.toBe("View ");
  });
});
