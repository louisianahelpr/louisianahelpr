/**
 * Q1816 (e2e-journeys stale-deploy /home, runs 42221289461 and a local WebKit run 11-07): with the route's chunks
 * unreachable and the reload spent, /home showed the app-wide "Something went sideways" card with no nav and no
 * route card. The trace's last blocked chunk was NeedsYouBridge: NeedsYouMount renders beside the routes (App.tsx,
 * SignedInChrome), outside every route boundary, and on /home the page reads count as settled at once, so its
 * lazy() failed right beside the broken route and threw into the app-wide boundary. The bridge only feeds the nav
 * badges: it loads through optionalLazy now, so a failed chunk is reported (warning) and draws nothing.
 *
 * @mutate src/components/NeedsYouMount.tsx | const NeedsYouBridge = optionalLazy(() => import("./NeedsYouBridge"), "NeedsYouBridge"); | const NeedsYouBridge = lazy(() => import("./NeedsYouBridge"));
 */
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const reported = vi.hoisted(() => [] as Array<{ err: unknown; opts: unknown }>);
vi.mock("@/lib/errorLogger", () => ({
  report: (err: unknown, opts: unknown) => reported.push({ err, opts }),
  logError: () => {},
}));
vi.mock("@/hooks/useCurrentUser", () => ({ useCurrentUser: () => ({ user: { id: "u1" } }) }));
vi.mock("@/hooks/usePageReadsSettled", () => ({ usePageReadsSettled: () => true }));
vi.mock("@/lib/helprTasks/onlineHandoff", () => ({ expectOnlineFromBadge: () => {} }));
// The chunk itself fails, as the browser's import() did in the run.
vi.mock("@/components/NeedsYouBridge", () => {
  throw new TypeError("Importing a module script failed.");
});

class AppWide extends React.Component<{ children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? <p>Something went sideways.</p> : this.props.children;
  }
}

afterEach(() => { reported.length = 0; });

describe("a failed badge-bridge chunk does not take the app down", () => {
  it("the page beside it stays, and the failure is a warning", async () => {
    const { default: NeedsYouMount } = await import("@/components/NeedsYouMount");
    render(
      <QueryClientProvider client={new QueryClient()}>
        <AppWide>
          <p>the route</p>
          <NeedsYouMount />
        </AppWide>
      </QueryClientProvider>,
    );
    await waitFor(() => expect(reported.length + screen.queryAllByText("Something went sideways.").length).toBeGreaterThan(0));
    expect(screen.queryByText("Something went sideways.")).toBeNull();
    expect(screen.getByText("the route")).toBeTruthy();
    expect(reported[0].opts).toMatchObject({ severity: "warning", tags: { source: "NeedsYouBridge" } });
  });
});
