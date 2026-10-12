/**
 * Q1287: the admin health screen on a COLD load, before its reads answer.
 *
 * useInstantQuery hands back its fallback (a shell of zeros) until the first
 * fetch lands. AdminHealth painted that shell as readings: "0 sent",
 * "0 unresolved", Job Activity all 0, "No parish activity yet", "No devices
 * registered yet", and the red "No admin has registered a push token" banner.
 * Measured on prod 2026-10-12 with the reads held (Playwright, 375 and 1440):
 * all of those on screen while the loaded values were 8 sent, 87 suppressed,
 * 5 unresolved, 121 new jobs.
 *
 * This renders the REAL useHealthData / useFillRate / useInstantQuery over a
 * Supabase client whose every call never answers (the cold load held open),
 * then answers them (the control: the same screen does show readings, and the
 * banner, once a read says so).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";

const mode = vi.hoisted(() => ({ answer: false }));

// Every builder call returns the same chain; awaiting it either never settles
// (cold load held open) or answers with the ANSWER fixture below (no rows).
vi.mock("@/integrations/supabase/client", () => {
  const ANSWER = { data: [], count: 3, error: null, status: 200 };
  const chain: unknown = new Proxy(function () {}, {
    get: (_t, prop) => {
      if (prop === "then") {
        return (resolve: (v: unknown) => void) => { if (mode.answer) resolve(ANSWER); };
      }
      return chain;
    },
    apply: () => chain,
  });
  return {
    supabase: {
      from: () => chain,
      rpc: () => chain,
      functions: { invoke: () => (mode.answer ? Promise.resolve({ data: { status: "healthy" }, error: null }) : new Promise(() => {})) },
      channel: () => ({ on: () => ({ subscribe: () => ({}) }), subscribe: () => ({}) }),
      removeChannel: () => undefined,
      auth: { getSession: () => new Promise(() => {}), getUser: () => new Promise(() => {}) },
    },
  };
});
vi.mock("@/lib/errorLogger", () => ({ report: vi.fn() }));

import AdminHealth from "./AdminHealth";

function renderIt() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <AdminHealth />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** What the fallback's zeros used to say, each a claim no read has made. */
const ZERO_SHELL_CLAIMS = [
  "0 sent",
  "0 unresolved",
  "No admin has registered a push token",
  "No parish activity yet",
  "No devices registered yet",
  "No job data for this period yet",
];

describe("AdminHealth on a cold load (Q1287)", () => {
  beforeEach(() => { mode.answer = false; });

  // @mutate src/components/admin/AdminHealth.tsx | {!healthNeverLoaded && !healthLoading && adminPushTokenCount === 0 && ( | {!healthNeverLoaded && adminPushTokenCount === 0 && (
  // @mutate src/components/admin/AdminHealth.tsx |   pending ? <Skeleton data-pending-reading="" aria-hidden="true" className={bone} /> : <>{children}</>; |   <>{children}</>;
  // @mutate src/components/admin/adminHealth/useFillRate.ts | fillData, fillFetching, fillLoading, sortedParishes | fillData, fillFetching, fillLoading: false, sortedParishes
  it("before any read answers: placeholders, and none of the fallback's zeros or alarms", async () => {
    const { container } = renderIt();
    // Wait for the lazy-free first commit to settle the hooks' first render.
    await waitFor(() => expect(screen.getByText("Platform Status")).toBeTruthy());
    const text = container.textContent ?? "";
    for (const claim of ZERO_SHELL_CLAIMS) expect(text, claim).not.toContain(claim);
    // Job Activity's four counts and the push token counts are bones, not 0s.
    const bones = container.querySelectorAll("[data-pending-reading]").length;
    expect(bones).toBeGreaterThan(8);
  });

  it("control: once the reads answer, the readings and the banner render", async () => {
    mode.answer = true;
    const { container } = renderIt();
    await waitFor(() => expect(container.textContent).toContain("3 sent"));
    expect(container.textContent).toContain("3 unresolved");
    // user_roles answered with no admin rows: zero admin tokens is now a
    // reading, so the banner is right to show.
    expect(container.textContent).toContain("No admin has registered a push token");
    expect(container.querySelectorAll("[data-pending-reading]").length).toBe(0);
  });
});
