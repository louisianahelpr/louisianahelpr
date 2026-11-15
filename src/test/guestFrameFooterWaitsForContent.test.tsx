/**
 * Q2784 follow-up (www after the 11-15 deploy): on a guest's /declutter at 1280 the public footer painted high under the
 * loading page and jumped down when the grid arrived: CLS 0.307 in 2 of 3 loads, 0.29 of it one FOOTER shift
 * (~/.lh-shots/lander-1115g/postdeploy1.json). GuestPublicFrame now holds PublicLayout's footer until the content fills
 * the window or the page's reads have gone idle (useFooterAfterContent), the Q1312 rule /browse already follows.
 *
 * The class: every guest public-frame page (GUEST_PUBLIC_FRAME_ROUTES) is drawn by AppPage or SectionScreen through the
 * ONE GuestPublicFrame (guestPagesWearPublicFrame.test.tsx), so the frame's footer rule covers all of them; the source
 * walk below fails if a GuestPublicFrame PublicLayout ever drops the footer hold. /jobs/<id> (JobDetail) draws PublicLayout
 * itself for a guest and shifted the same way (footer 0.1098 at 1280, 3 of 3 loads), so it holds its footer the same way.
 * /hire/<service>/<town> is PublicHeaderPage (its own Q1312 `footer` prop; 0 CLS at 1280).
 *
 * @mutate src/components/marketing/GuestPublicFrame.tsx | <PublicLayout footer={footerReady}> | <PublicLayout>
 * @mutate src/pages/jobs/JobDetail.tsx | <PublicLayout noNavSpacer footer={footerReady}> | <PublicLayout noNavSpacer>
 * @mutate src/hooks/useFooterAfterContent.ts |       if (fills()) return setReady(true); |       if (fills()) return;
 * @mutate src/hooks/useFooterAfterContent.ts |       if ((client?.isFetching() ?? 0) === 0) idleTimer | if (true) idleTimer
 * @mutate src/hooks/useFooterAfterContent.ts |     const unsubscribe = client?.getQueryCache().subscribe(settle); |     const unsubscribe = undefined as (() => void) \| undefined;
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ReactNode } from "react";
import { blankComments } from "./helpers/blankNonCode";

vi.mock("@/components/marketing/PublicLayout", () => ({
  default: ({ children, footer }: { children: ReactNode; footer?: boolean }) => (
    <div data-frame="public" data-footer={String(footer)}>{children}</div>
  ),
}));

const { GuestPublicFrame } = await import("@/components/marketing/GuestPublicFrame");
const { FOOTER_IDLE_MS } = await import("@/hooks/useFooterAfterContent");

const footerOf = (c: HTMLElement) => c.querySelector("[data-frame]")?.getAttribute("data-footer");
let contentBottom = 300;
const realRect = HTMLElement.prototype.getBoundingClientRect;

beforeEach(() => {
  vi.useFakeTimers();
  contentBottom = 300;
  window.innerHeight = 800;
  HTMLElement.prototype.getBoundingClientRect = function () {
    return { bottom: this.hasAttribute("data-guest-public-frame") ? contentBottom : 0 } as DOMRect;
  };
});
afterEach(() => {
  vi.useRealTimers();
  HTMLElement.prototype.getBoundingClientRect = realRect;
});

function withPendingRead() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  let resolveRead: (v: number) => void = () => {};
  void client.fetchQuery({ queryKey: ["grid"], queryFn: () => new Promise<number>((r) => { resolveRead = r; }) });
  return { client, finish: () => resolveRead(1) };
}

describe("the guest public frame's footer waits for the content (no high footer that jumps)", () => {
  it("holds the footer while the page's read is in flight on a short (loading) page, then shows it once idle", async () => {
    const { client, finish } = withPendingRead();
    const { container } = render(
      <QueryClientProvider client={client}><GuestPublicFrame><div>loading</div></GuestPublicFrame></QueryClientProvider>,
    );
    expect(footerOf(container)).toBe("false");
    await act(async () => { vi.advanceTimersByTime(FOOTER_IDLE_MS * 4); });
    expect(footerOf(container)).toBe("false");
    await act(async () => { finish(); await Promise.resolve(); });
    await act(async () => { vi.advanceTimersByTime(FOOTER_IDLE_MS + 10); });
    expect(footerOf(container)).toBe("true");
  });

  it("shows the footer at once when the content already reaches the bottom of the window (it paints out of view)", async () => {
    contentBottom = 900;
    const { client } = withPendingRead();
    const { container } = render(
      <QueryClientProvider client={client}><GuestPublicFrame><div>grid</div></GuestPublicFrame></QueryClientProvider>,
    );
    await act(async () => { await Promise.resolve(); });
    expect(footerOf(container)).toBe("true");
  });

  it("source: every PublicLayout a guest frame page draws itself (GuestPublicFrame, JobDetail) passes the footer hold", () => {
    let n = 0;
    for (const file of ["../components/marketing/GuestPublicFrame.tsx", "../pages/jobs/JobDetail.tsx"]) {
      const src = blankComments(readFileSync(resolve(__dirname, file), "utf8"));
      const layouts = src.match(/<PublicLayout\b[^>]*>/g) ?? [];
      expect(layouts.length, file).toBeGreaterThan(0);
      for (const tag of layouts) expect(tag, file).toContain("footer={footerReady}");
      expect(src, file).toContain("useFooterAfterContent(contentRef)");
      n += layouts.length;
    }
    expect(n).toBeGreaterThan(1);
  });
});
