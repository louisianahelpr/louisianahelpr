import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, within } from "@testing-library/react";

import {
  EscrowProgressBar,
  ESCROW_STEPS,
  deriveEscrowStep,
  deriveEscrowStepFromJob,
} from "./EscrowProgressBar";

/**
 * jsdom does not implement `matchMedia` by default. The shared
 * `src/test/setup.ts` registers a stub that always returns
 * `matches: false`, so the reduced-motion code path defaults to OFF.
 * We override per-test below for the reduced-motion case.
 */

afterEach(() => {
  vi.restoreAllMocks();
});

describe("EscrowProgressBar", () => {
  it("renders all four step labels", () => {
    render(<EscrowProgressBar currentStep={1} />);
    for (const step of ESCROW_STEPS) {
      // Each label is rendered both as the visible label and inside
      // the trigger's aria-label, so we expect >= 1 match.
      expect(screen.getAllByText(step.label).length).toBeGreaterThan(0);
    }
  });

  it("exposes role=progressbar with aria-valuenow matching currentStep", () => {
    const { rerender } = render(<EscrowProgressBar currentStep={1} />);
    const bar = screen.getByRole("progressbar", {
      name: /payment progress/i,
    });
    expect(bar).toHaveAttribute("aria-valuenow", "1");
    expect(bar).toHaveAttribute("aria-valuemax", "4");
    expect(bar).toHaveAttribute("aria-valuemin", "1");

    rerender(<EscrowProgressBar currentStep={3} />);
    expect(
      screen.getByRole("progressbar", { name: /payment progress/i }),
    ).toHaveAttribute("aria-valuenow", "3");
  });

  it("marks the current step with aria-current=step", () => {
    render(<EscrowProgressBar currentStep={2} />);
    const current = screen.getByRole("button", {
      name: /Working — step 2 of 4 \(current\)/i,
    });
    expect(current).toHaveAttribute("aria-current", "step");
  });

  it("marks earlier steps as complete in their accessible name", () => {
    render(<EscrowProgressBar currentStep={3} />);
    expect(
      screen.getByRole("button", { name: /Paid — step 1 of 4 \(complete\)/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: /Working — step 2 of 4 \(complete\)/i,
      }),
    ).toBeInTheDocument();
  });

  it("does not throw and still renders all steps when reduced motion is on", () => {
    // Override matchMedia to claim the user prefers reduced motion.
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: (query: string) => ({
        matches: query.includes("prefers-reduced-motion"),
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => {},
      }),
    });

    render(<EscrowProgressBar currentStep={2} />);
    const bar = screen.getByRole("progressbar", { name: /payment progress/i });
    expect(bar).toHaveAttribute("aria-valuenow", "2");
    // All 4 node buttons must still be in the tree even with no animation.
    const buttons = within(bar).getAllByRole("button");
    expect(buttons).toHaveLength(4);
  });
});

describe("deriveEscrowStep", () => {
  it("returns null for open jobs with no payment intent (hide the bar)", () => {
    expect(
      deriveEscrowStep({ status: "open", hasPaymentIntent: false }),
    ).toBeNull();
  });

  it("returns 1 (Paid) for open jobs that have a payment intent", () => {
    expect(
      deriveEscrowStep({ status: "open", hasPaymentIntent: true }),
    ).toBe(1);
  });

  it("returns 2 (Working) for accepted and in_progress jobs", () => {
    expect(
      deriveEscrowStep({ status: "accepted", hasPaymentIntent: true }),
    ).toBe(2);
    expect(
      deriveEscrowStep({ status: "in_progress", hasPaymentIntent: true }),
    ).toBe(2);
    expect(
      deriveEscrowStep({
        status: "revision_requested",
        hasPaymentIntent: true,
      }),
    ).toBe(2);
  });

  it("returns 3 (Verified) for completed jobs with no payout yet", () => {
    expect(
      deriveEscrowStep({
        status: "completed",
        hasPaymentIntent: true,
        payoutPaid: false,
      }),
    ).toBe(3);
  });

  it("returns 4 (Released) for completed jobs whose payout has paid_at set", () => {
    expect(
      deriveEscrowStep({
        status: "completed",
        hasPaymentIntent: true,
        payoutPaid: true,
      }),
    ).toBe(4);
  });

  it("returns null for cancelled jobs (escrow does not apply)", () => {
    expect(
      deriveEscrowStep({
        status: "cancelled",
        hasPaymentIntent: true,
      }),
    ).toBeNull();
  });
});

describe("deriveEscrowStepFromJob", () => {
  it("maps a paid-but-open job to step 1", () => {
    expect(
      deriveEscrowStepFromJob({
        status: "open",
        stripe_payment_intent_id: "pi_123",
        payment_status: "escrow",
      }),
    ).toBe(1);
  });

  it("hides the bar when no payment intent has been captured", () => {
    expect(
      deriveEscrowStepFromJob({
        status: "open",
        stripe_payment_intent_id: null,
        payment_status: null,
      }),
    ).toBeNull();
  });

  it("maps a completed job whose payment_status is 'released' to step 4", () => {
    expect(
      deriveEscrowStepFromJob({
        status: "completed",
        stripe_payment_intent_id: "pi_123",
        payment_status: "released",
      }),
    ).toBe(4);
  });

  it("maps a completed but not-yet-released job to step 3", () => {
    expect(
      deriveEscrowStepFromJob({
        status: "completed",
        stripe_payment_intent_id: "pi_123",
        payment_status: "payout_pending",
      }),
    ).toBe(3);
  });
});
