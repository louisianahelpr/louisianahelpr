/**
 * F424 second half (audit 11-10): the order chat labelled every line "Mon 12:32 PM" / "Tue 1:45 PM" while the job
 * chat reads as a dated transcript with "Today" / "Yesterday" dividers. The order chat now puts the job chat's own
 * day dividers (dateDividerLabel) between days, and each line carries only its clock time.
 *
 * @mutate src/components/declutter/DeclutterOrderTalk.tsx | (i === 0 \|\| dayKey(t.messages[i - 1].created_at) !== dayKey(m.created_at)) && ( | false && (
 * @mutate src/components/declutter/DeclutterOrderTalk.tsx | (m.mine ? "You" : `The ${other}`)} · {clock(m.created_at)}</p> | (m.mine ? "You" : `The ${other}`)} · {when(m.created_at)}</p>
 * @mutate src/components/declutter/DeclutterOrderTalk.tsx | (i === 0 \|\| dayKey(t.messages[i - 1].created_at) !== dayKey(m.created_at)) && ( | (i === 0) && (
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { OrderTalkFromLink } from "@/components/declutter/DeclutterOrderTalk";

const ORDER = "00000000-0000-4000-8000-0000000000c1";
const startOfToday = new Date();
startOfToday.setHours(0, 0, 0, 0);
const at = (ms: number) => new Date(startOfToday.getTime() + ms).toISOString();
const MSGS = [
  { id: "m1", mine: true, body: "Is Saturday ok?", created_at: at(-12 * 3600_000) },
  { id: "m2", mine: false, body: "Yes, after 9.", created_at: at(-11 * 3600_000) },
  { id: "m3", mine: true, body: "See you then.", created_at: at(60_000) },
];

vi.mock("sonner", async () => (await import("@/test/helpers/sonnerMock")).sonnerMock());
vi.mock("@/hooks/useIsWebDesktop", () => ({ useIsWebDesktop: () => false }));
vi.mock("@/components/declutter/OrderTalkStep", () => ({ default: () => null }));
vi.mock("@/lib/declutter/talkRead", () => ({ markTalkRead: async () => undefined }));
vi.mock("@/lib/declutter/managerMode", () => ({ useManagerLabels: () => ({ data: new Map() }) }));
vi.mock("@/lib/declutter/orderTalk", () => ({
  MY_ORDER_TALKS_KEY: ["declutter", "my-order-talks"],
  fetchOrderTalk: async (id: string) => ({ order_id: id, side: "buyer", open: true, open_until: null, messages: MSGS }),
  fetchMyOrderTalks: async () => [],
  sendOrderMessage: async () => "m9",
}));

describe("F424: the order chat has the job chat's Today / Yesterday dividers", () => {
  it("one Yesterday divider over the two older lines, one Today over the new one; lines show the clock only", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[`/declutter?order_talk=${ORDER}`]}>
          <OrderTalkFromLink />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(await screen.findByText("See you then.")).toBeTruthy();
    const dividers = screen.getAllByRole("separator").filter((el) => el.hasAttribute("data-order-talk-day"));
    expect(dividers.map((d) => d.textContent?.trim())).toEqual(["Yesterday", "Today"]);
    const clock = new Date(MSGS[2].created_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    expect(screen.getAllByText(`You · ${clock}`).length).toBe(1);
    const weekday = new Date(MSGS[2].created_at).toLocaleString([], { weekday: "short" });
    expect(document.body.textContent).not.toContain(`You · ${weekday} `);
  });
});
