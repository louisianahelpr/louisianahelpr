/**
 * Profile leftovers 11-05: an item's "See the whole sale" goes to /user/<seller>, which forwards a member to
 * /u/<handle>, and /u had no moving-sale banner, so the link landed on a page without the sale. Class: every page a
 * "See the whole sale" link can land on draws the seller's MovingSaleBanner (/user and /u), for the seller's own id.
 *
 * @mutate src/pages/u/PublicProfilePage.tsx | <PublicProfileMovingSale handle={p.handle} currentUserId={viewerId} isMe={isMe} /> | {null}
 * @mutate src/components/profile/publicProfile/PublicProfileMovingSale.tsx | const sellerId = isMe ? currentUserId : q.data?.id ?? null; | const sellerId = q.data?.id ?? null;
 * @mutate src/components/profile/publicProfile/PublicProfileMovingSale.tsx | enabled: !!currentUserId && !isMe, | enabled: !!currentUserId,
 * @mutate src/components/profile/publicProfile/PublicProfileMovingSale.tsx | <MovingSaleBanner sellerId={sellerId} /> | {null}
 */
import { readFileSync } from "node:fs";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { blankComments } from "@/test/helpers/blankNonCode";

const hire = vi.fn(async (_h: string): Promise<{ id?: string; error?: string }> => ({ id: "seller-2" }));
vi.mock("@/lib/hireMe", () => ({ hireTargetByHandle: (h: string) => hire(h) }));
vi.mock("@/components/declutter/MovingSaleBanner", () => ({
  MovingSaleBanner: ({ sellerId }: { sellerId: string }) => <p data-testid="banner">{sellerId}</p>,
}));

const { PublicProfileMovingSale } = await import("@/components/profile/publicProfile/PublicProfileMovingSale");

const show = (currentUserId: string | null, isMe: boolean) =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <PublicProfileMovingSale handle="eli-b" currentUserId={currentUserId} isMe={isMe} />
    </QueryClientProvider>,
  );

describe("the /u page draws the seller's moving sale (profile leftovers 11-05)", () => {
  beforeEach(() => hire.mockClear());

  it("someone else's page: the banner for the seller's id, read through the page's member-id key", async () => {
    show("me-1", false);
    expect(await screen.findByTestId("banner")).toHaveTextContent("seller-2");
    expect(hire).toHaveBeenCalledWith("eli-b");
  });

  it("your own page: your own id, no lookup", () => {
    show("me-1", true);
    expect(screen.getByTestId("banner")).toHaveTextContent("me-1");
    expect(hire).not.toHaveBeenCalled();
  });

  it("a guest, or a refused lookup (a block): nothing", async () => {
    const guest = show(null, false);
    expect(guest.queryByTestId("banner")).toBeNull();
    guest.unmount();
    hire.mockResolvedValueOnce({ error: "nope" });
    show("me-1", false);
    await waitFor(() => expect(hire).toHaveBeenCalled());
    expect(screen.queryByTestId("banner")).toBeNull();
  });

  it("every landing page for 'See the whole sale' mounts the banner (inventory of 2)", () => {
    const pages = ["src/pages/user/UserProfile.tsx", "src/pages/u/PublicProfilePage.tsx"];
    // F359i: /user/:userId mounts the banner through its one Declutter group (ProfileDeclutterSections).
    expect(blankComments(readFileSync("src/pages/user/ProfileDeclutterSections.tsx", "utf8"))).toMatch(/<MovingSaleBanner\b/);
    const mounting = pages.filter((f) => /<(MovingSaleBanner|PublicProfileMovingSale|ProfileDeclutterSections)\b/.test(blankComments(readFileSync(f, "utf8"))));
    expect(mounting.length).toBeGreaterThan(1);
    expect(mounting).toEqual(pages);
  });
});
