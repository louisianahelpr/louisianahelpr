/**
 * Q2426: the seller's own live listing shares in one tap. "Share this item" hands the item's own link to the
 * share ladder (the phone's sheet, where Facebook and the groups are); "Post to Facebook" opens Facebook's
 * share page for that link in a new tab. The link is /declutter/item/<id>, whose card api/share.ts builds.
 *
 * @mutate src/components/declutter/DeclutterShareCard.tsx | itemPriceLabel(it.current_price_cents)} on Louisiana Helpr | itemPriceLabel(it.current_price_cents)}
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

const shareNative = vi.fn(async (_c: unknown) => "shared" as const);
vi.mock("@/lib/nativeShare", () => ({ shareNative: (c: unknown) => shareNative(c), copyToClipboard: vi.fn(async () => true) }));
vi.mock("@/lib/nativeInit", () => ({ isNativePlatform: false }));

const ITEM = { id: "3f2a1b0c-1111-4222-8333-444455556666", title: "Oak rocking chair", current_price_cents: 0 };

afterEach(() => {
  shareNative.mockClear();
  vi.restoreAllMocks();
});

describe("ShareListingRow", () => {
  it("Share this item passes the item's own link and says Free for a $0 item", async () => {
    const { ShareListingRow } = await import("./DeclutterShareCard");
    render(<ShareListingRow item={ITEM} />);
    fireEvent.click(screen.getByRole("button", { name: "Share this item" }));
    expect(shareNative).toHaveBeenCalledTimes(1);
    const arg = shareNative.mock.calls[0][0] as unknown as { url: string; text: string };
    expect(arg.url).toMatch(new RegExp(`/declutter/item/${ITEM.id}$`));
    expect(arg.text).toBe("Oak rocking chair · Free on Louisiana Helpr");
  });

  it("Post to Facebook opens Facebook's share page for the item link in a new tab", async () => {
    const open = vi.spyOn(window, "open").mockReturnValue({} as Window);
    const { ShareListingRow } = await import("./DeclutterShareCard");
    render(<ShareListingRow item={ITEM} />);
    fireEvent.click(screen.getByRole("button", { name: "Post to Facebook" }));
    expect(open).toHaveBeenCalledTimes(1);
    const [url, target] = open.mock.calls[0];
    expect(String(url)).toMatch(/^https:\/\/www\.facebook\.com\/sharer\/sharer\.php\?u=/);
    expect(decodeURIComponent(String(url).split("?u=")[1])).toMatch(new RegExp(`/declutter/item/${ITEM.id}$`));
    expect(target).toBe("_blank");
    expect(shareNative).not.toHaveBeenCalled();
  });

  it("a blocked pop-up still does something: the share ladder gets the link", async () => {
    vi.spyOn(window, "open").mockReturnValue(null);
    const { ShareListingRow } = await import("./DeclutterShareCard");
    render(<ShareListingRow item={ITEM} />);
    fireEvent.click(screen.getByRole("button", { name: "Post to Facebook" }));
    expect(shareNative).toHaveBeenCalledTimes(1);
  });
});

describe("the seller's own listing carries the share row (Q2426)", () => {
  const listing = (status: string) => ({
    id: ITEM.id, seller_id: "me", status, title: "Mid-century lamp", description: "", category: "home_decor",
    condition_stars: 4, delivery_size: "small", price_cents: 4000, current_price_cents: 3800, area_label: "Delcambre",
    area_lat: 29.9, area_lng: -91.9, created_at: "2026-10-18T00:00:00Z", porch_ok: true,
  });
  const panel = async (status: string) => {
    const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
    const { SellerListingPanel } = await import("./DeclutterManageListing");
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
      <QueryClientProvider client={qc}>
        <SellerListingPanel item={listing(status) as never} coverUrl={null} />
      </QueryClientProvider>,
    );
  };

  it("a live listing shows Share this item and Post to Facebook", async () => {
    await panel("live");
    expect(screen.getByRole("button", { name: "Share this item" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Post to Facebook" })).toBeTruthy();
  });

  it("a paused listing (buyers can't open it) shows no share row", async () => {
    await panel("paused");
    expect(screen.getByRole("button", { name: "Relist" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Share this item" })).toBeNull();
  });
});
