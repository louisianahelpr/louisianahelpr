/**
 * Q2544: on 2026-10-31 23:30Z a signed-in member's /jobs showed the full-page
 * "Something went sideways" card because one optional chunk,
 * SmsPhonePrompt-<hash>.js, failed to load (error_logs 553a93b4, the
 * RouteErrorBoundary; the component stack ends at ActivityOfferDialogs' Lazy).
 * The phone prompt is a one-time ask that is usually not even due; a failed
 * fetch of it must not take down the page around it. It loads through
 * optionalLazy now: a failed load is reported (warning) and draws nothing.
 *
 * @mutate src/lib/optionalLazy.ts |       return { default: Nothing }; |       throw err;
 * @mutate src/components/job-card/ActivityOfferDialogs.tsx | const SmsPhonePrompt = optionalLazy( | const SmsPhonePrompt = lazy(
 */
import React from "react";
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { blankComments } from "@/test/helpers/blankNonCode";

const reported = vi.hoisted(() => [] as Array<{ err: unknown; opts: unknown }>);
vi.mock("@/lib/errorLogger", () => ({
  report: (err: unknown, opts: unknown) => reported.push({ err, opts }),
  logError: () => {},
}));
vi.mock("@/hooks/useIsWebDesktop", () => ({ useIsWebDesktop: () => false }));
vi.mock("sonner", async () => (await import("@/test/helpers/sonnerMock")).sonnerMock());
// The chunk itself fails, as the browser's import() did on prod.
vi.mock("@/components/notificationPreferences/SmsPhonePrompt", () => {
  throw new TypeError("Failed to fetch dynamically imported module: https://www.louisianahelpr.com/assets/SmsPhonePrompt-DdoLsp0o.js");
});

class Outer extends React.Component<{ children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? <p>route error card</p> : this.props.children;
  }
}

const code = (f: string) => blankComments(readFileSync(resolve(__dirname, "../..", f), "utf8"));

describe("Q2544: a failed phone-prompt chunk does not break the page", () => {
  it("Activity's offer dialogs stay up when SmsPhonePrompt's chunk fails", async () => {
    const { ActivityOfferDialogs } = await import("@/components/job-card/ActivityOfferDialogs");
    const actions = { awardBlockReason: null, paymentHeldSide: null, hiredPayout: null } as never;
    render(
      <MemoryRouter>
        <Outer>
          <p>jobs page</p>
          <ActivityOfferDialogs actions={actions} />
        </Outer>
      </MemoryRouter>,
    );
    // Settled: either the failure reached the page boundary or it was reported quietly.
    await waitFor(() => expect(reported.length + screen.queryAllByText("route error card").length).toBeGreaterThan(0));
    expect(screen.queryByText("route error card")).toBeNull();
    expect(screen.getByText("jobs page")).toBeTruthy();
    expect(reported[0].opts).toMatchObject({ severity: "warning" });
  });

  it("every SmsPhonePrompt mount loads through optionalLazy", () => {
    const sites = [
      "src/components/job-card/ActivityOfferDialogs.tsx",
      "src/pages/home/HomeDashboard.tsx",
      "src/pages/post-job/PaymentSuccess.tsx",
    ];
    for (const f of sites) {
      const src = code(f);
      expect(src, f).toMatch(/const SmsPhonePrompt = optionalLazy\(/);
      expect(src, f).not.toMatch(/\blazy\(\s*\(\)\s*=>\s*import\("@\/components\/notificationPreferences\/SmsPhonePrompt"\)/);
    }
    expect(code("src/components/notificationPreferences/SmsPhonePrompt.tsx")).toMatch(/const SmsPhonePromptDialog = optionalLazy\(/);
    expect(sites.length).toBeGreaterThan(2);
  });
});
