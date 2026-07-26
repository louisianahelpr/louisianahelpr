import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { PayoutCelebration, type CelebratablePayout } from "./PayoutCelebration";

// safeStorage reads/writes go through localStorage synchronously.
// Capacitor Preferences mirroring is fire-and-forget so we can let
// it run; nothing else here observes it.

vi.mock("@capacitor/preferences", () => ({
  Preferences: {
    set: vi.fn().mockResolvedValue(undefined),
    get: vi.fn().mockResolvedValue({ value: null }),
    remove: vi.fn().mockResolvedValue(undefined),
    keys: vi.fn().mockResolvedValue({ keys: [] }),
  },
}));

// framer-motion fires real animations that can interfere with jsdom
// timers. Strip motion.* down to plain elements for these tests so the
// component renders synchronously and `AnimatePresence` doesn't gate
// mount.
vi.mock("framer-motion", async () => {
  const React = await import("react");
  type Props = React.HTMLAttributes<HTMLElement> & { children?: React.ReactNode };
  const factory = (tag: keyof React.JSX.IntrinsicElements) =>
    React.forwardRef<HTMLElement, Props>(({ children, ...rest }, ref) =>
      React.createElement(tag, { ...rest, ref }, children),
    );
  const motion = new Proxy(
    {},
    { get: (_t, tag: string) => factory(tag as keyof React.JSX.IntrinsicElements) },
  );
  return {
    motion,
    AnimatePresence: ({ children }: { children: React.ReactNode }) => children,
  };
});

const STORAGE_KEY = "helpr_last_seen_payout_at";

function makePayout(overrides: Partial<CelebratablePayout> = {}): CelebratablePayout {
  return {
    id: "p1",
    amount_cents: 5000,
    status: "paid",
    paid_at: "2026-05-19T12:00:00.000Z",
    created_at: "2026-05-19T12:00:00.000Z",
    jobs: { title: "Mow the lawn" },
    ...overrides,
  };
}

describe("PayoutCelebration", () => {
  beforeEach(() => {
    localStorage.clear();
    // Default: reduced motion off. Reset matchMedia between tests so
    // the reduced-motion test can override it.
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: (query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      }),
    });
  });

  it("renders nothing when there are no paid payouts", () => {
    render(<PayoutCelebration payouts={[]} />);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("ignores non-paid payouts (pending/failed/reversed)", () => {
    render(
      <PayoutCelebration
        payouts={[
          makePayout({ id: "a", status: "pending" }),
          makePayout({ id: "b", status: "failed" }),
        ]}
      />,
    );
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("celebrates a new paid payout and advances the last-seen marker", () => {
    render(<PayoutCelebration payouts={[makePayout({ amount_cents: 7500 })]} />);

    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.getByText(/You earned \$75/)).toBeInTheDocument();
    expect(screen.getByText(/From Mow the lawn/)).toBeInTheDocument();

    // Marker advanced to the paid_at timestamp.
    const stored = parseInt(localStorage.getItem(STORAGE_KEY) ?? "0", 10);
    expect(stored).toBe(new Date("2026-05-19T12:00:00.000Z").getTime());
  });

  it("does NOT re-celebrate a payout already seen (suppression)", () => {
    // Mark as seen at-or-after the payout's paid_at.
    localStorage.setItem(
      STORAGE_KEY,
      String(new Date("2026-05-20T00:00:00.000Z").getTime()),
    );
    render(
      <PayoutCelebration
        payouts={[makePayout({ paid_at: "2026-05-19T12:00:00.000Z" })]}
      />,
    );
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("sums multiple new payouts into a single celebration with the total", () => {
    render(
      <PayoutCelebration
        payouts={[
          makePayout({ id: "a", amount_cents: 4000, paid_at: "2026-05-19T10:00:00.000Z", jobs: { title: "Trim hedges" } }),
          makePayout({ id: "b", amount_cents: 6000, paid_at: "2026-05-19T14:00:00.000Z", jobs: { title: "Fix fence" } }),
          makePayout({ id: "c", amount_cents: 2500, paid_at: "2026-05-19T08:00:00.000Z", jobs: { title: "Weed bed" } }),
        ]}
      />,
    );

    // 40 + 60 + 25 = $125, single card (one status node).
    const cards = screen.getAllByRole("status");
    expect(cards).toHaveLength(1);
    expect(screen.getByText(/You earned \$125/)).toBeInTheDocument();
    // Headline mentions the most recent job (Fix fence) and the count.
    expect(screen.getByText(/Across 3 jobs · latest: Fix fence/)).toBeInTheDocument();

    // Marker advanced to the LATEST paid_at across the batch.
    const stored = parseInt(localStorage.getItem(STORAGE_KEY) ?? "0", 10);
    expect(stored).toBe(new Date("2026-05-19T14:00:00.000Z").getTime());
  });

  it("renders without particles when reduced motion is preferred", () => {
    // Force matchMedia to report reduce.
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: (query: string) => ({
        matches: query.includes("prefers-reduced-motion: reduce"),
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      }),
    });

    render(<PayoutCelebration payouts={[makePayout()]} />);

    // The status card still renders — confetti is the only thing
    // suppressed in reduced-motion mode.
    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.queryByTestId("payout-celebration-particles")).not.toBeInTheDocument();
  });

  it("auto-dismisses after 4s", () => {
    vi.useFakeTimers();
    try {
      render(<PayoutCelebration payouts={[makePayout()]} />);
      expect(screen.getByRole("status")).toBeInTheDocument();
      act(() => {
        vi.advanceTimersByTime(4100);
      });
      expect(screen.queryByRole("status")).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
});
