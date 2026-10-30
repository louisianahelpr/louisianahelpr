import { act, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import NeedsYouMount, { PAGE_READS_CAP_MS, PAGE_READS_QUIET_MS } from "./NeedsYouMount";

// @mutate src/components/NeedsYouMount.tsx | return usePageReadsSettled() ? <>{children}</> : null; | return <>{children}</>;
// @mutate src/components/NeedsYouMount.tsx | const cap = setTimeout(() => setSettled(true), PAGE_READS_CAP_MS); | const cap = setTimeout(() => {}, PAGE_READS_CAP_MS);
// @mutate src/components/NeedsYouMount.tsx | useState(() => window.location.pathname === "/home") | useState(() => false)

vi.mock("@/hooks/useCurrentUser", () => ({ useCurrentUser: () => ({ user: { id: "u1" } }) }));
vi.mock("./NeedsYouBridge", () => ({ default: () => <div>badge reads running</div> }));

const client = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });
const mount = (qc: QueryClient) =>
  render(
    <QueryClientProvider client={qc}>
      <NeedsYouMount />
    </QueryClientProvider>,
  );
/** Lets the lazy chunk's promise resolve under fake timers. */
const flush = async (ms = 0) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};

beforeEach(() => {
  vi.useFakeTimers();
  window.history.pushState({}, "", "/declutter");
});
afterEach(() => {
  vi.useRealTimers();
  window.history.pushState({}, "", "/");
});

describe("the badge's reads wait for the page's own", () => {
  it("start only after the page's reads finish and stay quiet", async () => {
    const qc = client();
    let finish: (v: string) => void = () => {};
    void qc.fetchQuery({ queryKey: ["page"], queryFn: () => new Promise<string>((r) => { finish = r; }) });
    mount(qc);
    await flush(1000);
    expect(screen.queryByText("badge reads running")).toBeNull();
    finish("done");
    await flush(); // the query cache tells its listeners on the next tick
    await flush();
    await flush(PAGE_READS_QUIET_MS - 50);
    expect(screen.queryByText("badge reads running")).toBeNull();
    await flush(100);
    await flush(10);
    expect(screen.getByText("badge reads running")).toBeTruthy();
  });

  it("a page still reading at the cap does not hold the badge back", async () => {
    const qc = client();
    void qc.fetchQuery({ queryKey: ["slow"], queryFn: () => new Promise<string>(() => {}) });
    mount(qc);
    await flush(PAGE_READS_CAP_MS + 10);
    await flush();
    expect(screen.getByText("badge reads running")).toBeTruthy();
  });

  it("a page with no reads at all still gets its badge, at the cap", async () => {
    mount(client());
    await flush(PAGE_READS_CAP_MS + 10);
    await flush();
    expect(screen.getByText("badge reads running")).toBeTruthy();
  });

  it("Home does not wait: it reads the same rows for its own list", async () => {
    window.history.pushState({}, "", "/home");
    mount(client());
    await flush();
    expect(screen.getByText("badge reads running")).toBeTruthy();
  });
});
