/**
 * Q1947: Declutter's "Sell it for me" opens a business's chat with ?ask=quote, and the message box starts with the
 * quote line for the member to finish and send; a plain ?talk= link starts empty, and nothing is sent for them.
 *
 * @mutate src/components/shops/ShopTalk.tsx | initialDraft={params.get("ask") === "quote" ? QUOTE_DRAFT : ""} | initialDraft=""
 * @mutate src/components/shops/ShopTalk.tsx |   const [draft, setDraft] = useState(initialDraft); |   const [draft, setDraft] = useState("");
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const TALK = "11111111-1111-4111-8111-111111111111";
const send = vi.hoisted(() => vi.fn());
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("@/lib/shops/talk", () => ({
  MY_SHOP_TALKS_KEY: ["shops", "my-talks"],
  fetchMyShopTalks: vi.fn(async () => []),
  openShopTalk: vi.fn(),
  openShopOrderTalk: vi.fn(),
  sendShopTalkMessage: send,
  fetchShopTalk: async () => ({ talk_id: TALK, shop_id: "s1", side: "buyer", other_label: "Bayou Consignment", open: true, messages: [] }),
  markShopTalkRead: async () => undefined,
}));

import { QUOTE_DRAFT, ShopTalkFromLink } from "./ShopTalk";

async function box(search: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[`/shops/s1${search}`]}>
        <ShopTalkFromLink />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  await screen.findByText("Message Bayou Consignment");
  return screen.getByLabelText("Message") as HTMLTextAreaElement;
}

describe("a shop chat opened for a quote", () => {
  it("starts the message box with the quote line (floor: the line is real words)", async () => {
    expect(QUOTE_DRAFT.length).toBeGreaterThan(20);
    const ta = await box(`?talk=${TALK}&ask=quote`);
    expect(ta.value).toBe("I'd like a quote to help sell my items: ");
    expect(send).not.toHaveBeenCalled();
  });

  it("a plain chat link starts empty", async () => {
    const ta = await box(`?talk=${TALK}`);
    expect(ta.value).toBe("");
  });
});
