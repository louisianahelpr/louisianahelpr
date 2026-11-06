/**
 * An open shop chat marks itself read once per newest message, not on every 15 s poll (lead 11-05, from the Lander's
 * #4154 read: ShopTalkSheet called shops_mark_talk_read in every poll, so an open thread wrote every 15 seconds).
 * Polls with the same newest message write nothing; a new message is marked once; a failed mark is tried again.
 *
 * @mutate src/components/shops/ShopTalk.tsx |     if (markedNewest.current !== newest) { |     if (true) {
 * @mutate src/components/shops/ShopTalk.tsx |         () => { markedNewest.current = undefined; }, |         () => undefined,
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const TALK = "11111111-1111-4111-8111-111111111111";
const talkMocks = vi.hoisted(() => ({
  fetchShopTalk: vi.fn(),
  markShopTalkRead: vi.fn(),
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("@/lib/shops/talk", () => ({
  MY_SHOP_TALKS_KEY: ["shops", "my-talks"],
  fetchMyShopTalks: vi.fn(async () => []),
  openShopTalk: vi.fn(),
  sendShopTalkMessage: vi.fn(),
  fetchShopTalk: talkMocks.fetchShopTalk,
  markShopTalkRead: talkMocks.markShopTalkRead,
}));

import { ShopTalkFromLink } from "./ShopTalk";

const view = (ids: string[]) => ({
  talk_id: TALK, shop_id: "s1", side: "shop", other_label: "Ruth", open: true,
  messages: ids.map((id) => ({ id, mine: false, body: `message ${id}`, created_at: "2026-11-05T23:00:00Z" })),
});

async function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[`/shops/s1?talk=${TALK}`]}>
        <ShopTalkFromLink />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  await screen.findByText("message m1");
  const poll = async () => { await act(async () => { await qc.refetchQueries({ queryKey: ["shops", "talk", TALK] }); }); };
  return { poll };
}

describe("an open shop chat marks itself read once per newest message", () => {
  beforeEach(() => {
    talkMocks.fetchShopTalk.mockReset();
    talkMocks.markShopTalkRead.mockReset();
    talkMocks.markShopTalkRead.mockResolvedValue(undefined);
  });

  it("polls with the same newest message write nothing; a new message is marked once", async () => {
    talkMocks.fetchShopTalk.mockResolvedValue(view(["m1"]));
    const { poll } = await mount();
    expect(talkMocks.markShopTalkRead).toHaveBeenCalledTimes(1);
    await poll();
    await poll();
    expect(talkMocks.fetchShopTalk.mock.calls.length).toBeGreaterThanOrEqual(3);
    expect(talkMocks.markShopTalkRead).toHaveBeenCalledTimes(1);
    talkMocks.fetchShopTalk.mockResolvedValue(view(["m1", "m2"]));
    await poll();
    expect(talkMocks.markShopTalkRead).toHaveBeenCalledTimes(2);
    await poll();
    expect(talkMocks.markShopTalkRead).toHaveBeenCalledTimes(2);
  });

  it("a failed mark is tried again on the next poll", async () => {
    talkMocks.fetchShopTalk.mockResolvedValue(view(["m1"]));
    talkMocks.markShopTalkRead.mockRejectedValueOnce(new Error("offline"));
    const { poll } = await mount();
    expect(talkMocks.markShopTalkRead).toHaveBeenCalledTimes(1);
    await poll();
    expect(talkMocks.markShopTalkRead).toHaveBeenCalledTimes(2);
    await poll();
    expect(talkMocks.markShopTalkRead).toHaveBeenCalledTimes(2);
  });
});
