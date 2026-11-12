/**
 * S2-036 (Shops audit 2): the shop chat sheet is a chat. Only the messages scroll (the title, the reply box and Send
 * stay put), and it opens at the newest message.
 *
 * @mutate src/components/shops/ShopTalk.tsx |     if (el) el.scrollTop = el.scrollHeight; |     void el;
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const TALK = "11111111-1111-4111-8111-111111111111";
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("@/lib/shops/talk", () => ({
  MY_SHOP_TALKS_KEY: ["shops", "my-talks"],
  fetchMyShopTalks: vi.fn(async () => []),
  openShopTalk: vi.fn(),
  sendShopTalkMessage: vi.fn(),
  markShopTalkRead: vi.fn(async () => undefined),
  fetchShopTalk: vi.fn(async () => ({
    talk_id: TALK, shop_id: "s1", side: "buyer", other_label: "Mae's Bakery", open: true,
    messages: ["m1", "m2", "m3"].map((id) => ({ id, mine: id !== "m2", body: `message ${id}`, created_at: "2026-11-05T23:00:00Z" })),
  })),
}));

import { ShopTalkFromLink } from "./ShopTalk";

describe("S2-036: the shop chat pins its reply box and opens at the newest message", () => {
  it("scrolls only the message list, keeps the reply box outside it, and starts at the bottom", async () => {
    Object.defineProperty(HTMLElement.prototype, "scrollHeight", { configurable: true, get() { return 900; } });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[`/shops/s1?talk=${TALK}`]}>
          <ShopTalkFromLink />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    await screen.findByText("message m3");
    const sheet = document.querySelector("[data-shop-talk]") as HTMLElement;
    expect(sheet.className).toContain("overflow-hidden");
    expect(sheet.className).not.toContain("overflow-y-auto");
    const scroller = document.querySelector("[data-shop-talk-scroll]") as HTMLElement;
    expect(scroller.className).toContain("overflow-y-auto");
    expect(scroller.contains(screen.getByRole("list", { name: "Messages" }))).toBe(true);
    expect(scroller.contains(screen.getByLabelText("Message"))).toBe(false);
    expect(scroller.contains(screen.getByRole("button", { name: "Send" }))).toBe(false);
    await waitFor(() => expect(scroller.scrollTop).toBe(900));
  });
});
