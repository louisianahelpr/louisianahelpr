/**
 * Manager mode phase 3 (owner 11-01): the seller's grant setup (member picker, parts, % or flat $, split preview),
 * the "Managed by" card (Change parts, End access), the manager's offer card (Accept / Decline), the Managing
 * switcher, and "Set up payouts to get your share".
 *
 * @mutate src/lib/declutter/managerMode.ts |   const manager = Math.min(raw, items); |   const manager = raw;
 * @mutate src/lib/declutter/managerMode.ts | Math.floor((items * Math.max(0, Math.min(100, share.value))) / 100) | Math.round((items * Math.max(0, Math.min(100, share.value))) / 100)
 * @mutate src/components/declutter/ManagerPanel.tsx |   const shareValue = type === "percent" ? Math.round(num) : Math.round(num * 100); |   const shareValue = Math.round(num);
 * @mutate src/components/declutter/ManagerPanel.tsx | disabled={!picked \|\| !anyPart \|\| !valueOk \|\| send.isPending} | disabled={!picked \|\| !valueOk \|\| send.isPending}
 * @mutate src/components/declutter/ManagerPanel.tsx | onClick={() => answer.mutate(true)}>Accept | onClick={() => answer.mutate(false)}>Accept
 * @mutate src/components/declutter/ManagerPanel.tsx |   if (payoutPrompt.kind !== "setup") return null;\n  if (paused) return <PayoutSetupPausedNotice />;\n  return (\n    <div className="mt-3 | if (paused) return <PayoutSetupPausedNotice />;\n  return (\n    <div className="mt-3
 * @mutate src/components/declutter/ManagerPanel.tsx |       {mineAsSeller ? <ManagedBy g={mineAsSeller} /> : <GrantSetup />} |       <GrantSetup />
 * @mutate src/components/declutter/DeclutterHomeView.tsx |       <ManagerPanelGate />\n |
 * @mutate src/lib/declutter/managerMode.ts |   if (s.paid_cents != null) return s.paid_cents;\n |
 * @mutate src/lib/declutter/managerMode.ts | (s.share_cents ?? 0) * Math.max(1, itemCount) | (s.share_cents ?? 0)
 * @mutate src/components/declutter/DeclutterHandoverViews.tsx | <ManagerSaleShareGate orderId={order.orderId} itemsCents={items} itemCount={order.lines.length} /> | null
 * @mutate src/components/declutter/ManagerPanel.tsx |         <MyShares g={g} />\n | <p />
 * @mutate src/components/declutter/ManagerPanelGate.tsx |   if (!on) return null;\n  return <Suspense | return <Suspense
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ManagerGrant } from "@/lib/declutter/managerMode";

const st = vi.hoisted(() => ({
  grants: [] as unknown[],
  hits: [] as { user_id: string; full_name: string; avatar_url: string | null }[],
  offered: [] as unknown[],
  answered: [] as unknown[],
  parts: [] as unknown[],
  ended: [] as unknown[],
  prompt: "none" as "none" | "setup",
  shares: [] as unknown[],
}));
vi.mock("sonner", async () => (await import("@/test/helpers/sonnerMock")).sonnerMock());
vi.mock("@/hooks/useStripeConnectStatus", () => ({ useStripeConnectStatus: () => ({ payoutPrompt: { kind: st.prompt }, refetchStatus: () => {} }) }));
vi.mock("@/hooks/usePayoutSetupPaused", () => ({ usePayoutSetupBlock: () => null }));
vi.mock("@/lib/declutter/managerMode", async (orig) => ({
  ...(await orig<typeof import("@/lib/declutter/managerMode")>()),
  useMyManagerGrants: () => ({ data: st.grants }),
  useOrderManagerShares: () => ({ data: st.shares }),
  searchMembers: async (q: string) => (q.trim().length >= 2 ? st.hits : []),
  offerToManage: async (...a: unknown[]) => { st.offered.push(a); return "g9"; },
  answerManageOffer: async (id: string, accept: boolean) => { st.answered.push([id, accept]); return accept ? "active" : "declined"; },
  setManagerParts: async (...a: unknown[]) => { st.parts.push(a); },
  endManaging: async (id: string) => { st.ended.push(id); return "ended"; },
  fetchManagedOverview: async () => ({
    grant_id: "g1", seller_first_name: "Kaci", parts: {},
    items: [{ id: "i1", title: "Oak dresser", status: "live", price_cents: 4000, updated_at: "", photo_path: null }],
    offers: [], questions: [{ id: "q1", item_id: "i1", question: "Still there?", answer: null, answered_at: null, created_at: "" }], orders: [],
  }),
}));
import ManagerPanel from "./ManagerPanel";
import ManagerSaleShare from "./ManagerSaleShare";
import { splitOf, splitWords } from "@/lib/declutter/managerMode";

function grant(over: Partial<ManagerGrant>): ManagerGrant {
  return {
    id: "g1", role: "seller", seller_id: "k1", manager_id: "d1", seller_first_name: "Kaci", manager_first_name: "Dana",
    status: "active", share_type: "percent", share_pct: 20, share_cents: null,
    can_list: true, can_prices: false, can_offers: false, can_messages: true, can_pickups: false,
    created_at: "", responded_at: null, ended_at: null, ...over,
  };
}

function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<MemoryRouter><QueryClientProvider client={qc}><ManagerPanel /></QueryClientProvider></MemoryRouter>);
}

beforeEach(() => {
  st.grants = [];
  st.hits = [{ user_id: "d1", full_name: "Dana Rivers", avatar_url: null }];
  st.offered = []; st.answered = []; st.parts = []; st.ended = [];
  st.prompt = "none";
  st.shares = [];
});

describe("the split preview matches the server's lock (20261101230509)", () => {
  it("percent rounds down; flat is capped at the item money", () => {
    expect(splitOf(4000, { type: "percent", value: 20 })).toEqual({ manager: 800, seller: 3200 });
    expect(splitOf(999, { type: "percent", value: 15 })).toEqual({ manager: 149, seller: 850 });
    expect(splitOf(300, { type: "flat", value: 500 })).toEqual({ manager: 300, seller: 0 });
    expect(splitWords(4000, 800, "Dana")).toBe("$40 sale · $8 to Dana · $32 to you");
  });
});

describe("the seller's grant setup", () => {
  it("search picks a member; parts, a flat $ share in cents, the preview; Send offer on the right", async () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Ask someone" }));
    expect(screen.getByText("Next: pick who helps you")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Member's name"), { target: { value: "Da" } });
    fireEvent.click(await screen.findByRole("button", { name: "Dana Rivers" }));
    expect(screen.getByText("$40 sale · $8 to Dana · $32 to you")).toBeTruthy();
    fireEvent.click(screen.getByRole("radio", { name: "$ per item" }));
    fireEvent.change(screen.getByLabelText("Dollars per item"), { target: { value: "5" } });
    expect(screen.getByText("$40 sale · $5 to Dana · $35 to you")).toBeTruthy();
    const buttons = screen.getAllByRole("button").map((b) => b.textContent);
    expect(buttons.indexOf("Send offer")).toBeGreaterThan(buttons.indexOf("Cancel"));
    fireEvent.click(screen.getByRole("button", { name: "Send offer" }));
    await waitFor(() => expect(st.offered).toEqual([["d1", "flat", 500, { list: true, prices: false, offers: false, messages: true, pickups: false }]]));
  });

  it("no part on: Send offer stays off", async () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Ask someone" }));
    fireEvent.change(screen.getByLabelText("Member's name"), { target: { value: "Da" } });
    fireEvent.click(await screen.findByRole("button", { name: "Dana Rivers" }));
    const boxes = screen.getAllByRole("checkbox") as HTMLInputElement[];
    expect(boxes.length).toBe(5);
    for (const b of boxes) if (b.checked) fireEvent.click(b);
    expect((screen.getByRole("button", { name: "Send offer" }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("the seller's Managed by card", () => {
  it("shows the share and parts; Change parts saves; End access ends", async () => {
    st.grants = [grant({})];
    mount();
    expect(screen.getByText("Managed by Dana")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Ask someone" })).toBeNull();
    expect(screen.getByText(/20% of each sale · Listing \(create, edit, post\), Messages/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Change parts" }));
    fireEvent.click(screen.getByLabelText("Offers"));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(st.parts).toEqual([["g1", { list: true, prices: false, offers: true, messages: true, pickups: false }]]));
    fireEvent.click(screen.getByRole("button", { name: "End access" }));
    await waitFor(() => expect(st.ended).toEqual(["g1"]));
  });

  it("an offer out: waiting on Dana, Take back", () => {
    st.grants = [grant({ status: "offered" })];
    mount();
    expect(screen.getByText("Waiting on Dana to accept")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Take back" })).toBeTruthy();
  });
});

describe("the manager's side", () => {
  it("the offer card: Accept accepts, Decline declines", async () => {
    st.grants = [grant({ role: "manager", status: "offered" })];
    mount();
    expect(screen.getByText("Kaci asked you to help sell")).toBeTruthy();
    expect(screen.getByText("Next: accept or decline")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Accept" }));
    await waitFor(() => expect(st.answered).toEqual([["g1", true]]));
    fireEvent.click(screen.getByRole("button", { name: "Decline" }));
    await waitFor(() => expect(st.answered).toEqual([["g1", true], ["g1", false]]));
  });

  it("Managing: switch to Kaci's to see her listings and the next step; payouts prompt only while not set up", async () => {
    st.grants = [grant({ role: "manager", status: "active" })];
    st.prompt = "setup";
    const { unmount } = mount();
    expect(screen.getByText("Next: set up payouts to get your share")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Set up payouts" }).getAttribute("href")).toBe("/profile?tab=payment");
    fireEvent.click(screen.getByRole("tab", { name: "Kaci's" }));
    expect(await screen.findByText("Oak dresser")).toBeTruthy();
    expect(screen.getByText("Next: answer 1 question for Kaci")).toBeTruthy();
    unmount();
    st.prompt = "none";
    mount();
    expect(screen.queryByText("Next: set up payouts to get your share")).toBeNull();
  });

  it("Selling mounts it lazily, only while the declutter_manager switch is on", () => {
    const gate = readFileSync(resolve(__dirname, "ManagerPanelGate.tsx"), "utf8");
    expect(gate).toContain('const ManagerPanel = lazy(() => import("./ManagerPanel"));');
    expect(gate).toContain('const on = useFeature("declutter_manager");\n  if (!on) return null;');
    const home = readFileSync(resolve(__dirname, "DeclutterHomeView.tsx"), "utf8");
    expect(home).toContain("<ManagerPanelGate />");
  });
});

describe("shares on the order and payout screens", () => {
  const share = (over: object) => ({ order_id: "o1", seller_id: "k1", manager_id: "d1", share_type: "percent", share_pct: 20, share_cents: null, paid_cents: null, payout_status: null, ...over });
  function mountShare(itemsCents: number, itemCount: number) {
    const qc = new QueryClient();
    return render(<QueryClientProvider client={qc}><ManagerSaleShare orderId="o1" itemsCents={itemsCents} itemCount={itemCount} /></QueryClientProvider>);
  }

  it("the seller's sold order: \"$40 sale · $8 to Dana · $32 to you\" from the locked terms", () => {
    st.grants = [grant({ status: "ended" })];
    st.shares = [share({})];
    mountShare(4000, 1);
    expect(screen.getByText("$40 sale · $8 to Dana · $32 to you")).toBeTruthy();
  });

  it("a flat share counts each item; the paid-out share wins once it exists", () => {
    st.grants = [grant({})];
    st.shares = [share({ share_type: "flat", share_pct: null, share_cents: 500 })];
    const { unmount } = mountShare(4000, 2);
    expect(screen.getByText("$40 sale · $10 to Dana · $30 to you")).toBeTruthy();
    unmount();
    st.shares = [share({ paid_cents: 600, payout_status: "succeeded" })];
    mountShare(4000, 1);
    expect(screen.getByText("$40 sale · $6 to Dana · $34 to you")).toBeTruthy();
  });

  it("no share on the sale: nothing shows", () => {
    const { container } = mountShare(4000, 1);
    expect(container.querySelector("[data-manager-sale-share]")).toBeNull();
  });

  it("the manager's shares: sent, or paid once the sale is final", () => {
    st.grants = [grant({ role: "manager", status: "active" })];
    st.shares = [share({ paid_cents: 800, payout_status: "succeeded" }), share({ order_id: "o2" }), share({ order_id: "o3", seller_id: "x9" })];
    mount();
    const rows = document.querySelectorAll("[data-manager-share]");
    expect(rows.length).toBe(2);
    expect(screen.getByText(/^\$8(\.00)? · sent$/)).toBeTruthy();
    expect(screen.getByText("Sold · your share is paid once the sale is final")).toBeTruthy();
  });

  it("the seller's order card mounts the split line lazily, only while the switch is on", () => {
    const gate = readFileSync(resolve(__dirname, "ManagerSaleShareGate.tsx"), "utf8");
    expect(gate).toContain('const ManagerSaleShare = lazy(() => import("./ManagerSaleShare"));');
    expect(gate).toContain('const on = useFeature("declutter_manager");\n  if (!on) return null;');
    const views = readFileSync(resolve(__dirname, "DeclutterHandoverViews.tsx"), "utf8");
    expect(views).toContain("<ManagerSaleShareGate orderId={order.orderId} itemsCents={items} itemCount={order.lines.length} />");
  });
});
