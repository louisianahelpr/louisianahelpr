/**
 * Payment success's "Posted" line says how soon nearby Helprs see the job, from the
 * early-access delay (the client mirror of public.early_access_delay_minutes()),
 * never a fixed "within 20 min" (audit 2026-10-28 F15: memberships are off, so
 * members see a new job at once while the page promised 20 minutes).
 *
 * @mutate src/components/postjob/PaymentLifecycleSteps.tsx |   const delayMinutes = earlyAccessDelayMs(null, useMembershipsOn()) / 60_000; |   const delayMinutes = 20;
 * @mutate src/components/postjob/PaymentLifecycleSteps.tsx | delayMinutes > 0 ? `Live now. Nearby Helprs see it within ${delayMinutes} min.` : "Live now. Nearby Helprs can see it." | `Live now. Nearby Helprs see it within ${delayMinutes} min.`
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const flags = { memberships: false };
vi.mock("@/hooks/useMembershipsOn", () => ({ useMembershipsOn: () => flags.memberships }));

import { PaymentLifecycleSteps } from "@/components/postjob/PaymentLifecycleSteps";

beforeEach(() => {
  flags.memberships = false;
});

describe("payment success: the Posted line follows the early-access delay (F15)", () => {
  it("memberships off (today, for every member): live now, no minutes", () => {
    render(<PaymentLifecycleSteps current={0} />);
    expect(screen.getByText("Live now. Nearby Helprs can see it.")).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/within \d+ min/);
  });

  it("memberships on: the free tier's wait, derived (20 min)", () => {
    flags.memberships = true;
    render(<PaymentLifecycleSteps current={0} />);
    expect(screen.getByText("Live now. Nearby Helprs see it within 20 min.")).toBeTruthy();
  });

  it("a later step shows its own line", () => {
    render(<PaymentLifecycleSteps current={1} />);
    expect(screen.getByText("You review applicants and pick one.")).toBeTruthy();
  });
});
