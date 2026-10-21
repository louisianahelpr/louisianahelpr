/**
 * SH12 FAQ screens: the card shows nothing without FAQs and a retry on a
 * failed read; the owner's editor adds, removes (at most 10) and saves.
 *
 * @mutate src/components/shops/ShopFaqs.tsx |   if (list.length === 0) return null; |   if (false) return null;
 * @mutate src/components/shops/ShopFaqsEditor.tsx |           {rows.length < FAQ_MAX && ( |           {true && (
 * @mutate src/components/shops/ShopFaqs.tsx |   if (faqs.isError && !faqs.data) { |   if (false) {
 * @mutate src/components/shops/ShopPolicies.tsx |   if (!policies.data) return null; |   if (!policies.data) return <p>Shop policies</p>;
 * @mutate src/components/shops/ShopPayoutRow.tsx | onSetUp={() => navigate("/profile?tab=payment")} | onSetUp={() => navigate("/shops")}
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));
const api = vi.hoisted(() => ({ fetchShopFaqs: vi.fn(), saveMyShopFaqs: vi.fn(), fetchShopPolicies: vi.fn() }));
const connect = vi.hoisted(() => ({ prompt: { kind: "none" } as { kind: string }, refetch: vi.fn() }));
vi.mock("@/hooks/useStripeConnectStatus", () => ({ useStripeConnectStatus: () => ({ payoutPrompt: connect.prompt, refetchStatus: connect.refetch }) }));
const nav = vi.hoisted(() => vi.fn());
vi.mock("react-router-dom", async (orig) => ({ ...(await orig<typeof import("react-router-dom")>()), useNavigate: () => nav }));
vi.mock("@/lib/shops/faqs", async (orig) => ({ ...(await orig<typeof import("@/lib/shops/faqs")>()), ...api }));

import ShopFaqs from "./ShopFaqs";
import ShopFaqsEditor from "./ShopFaqsEditor";
import ShopPolicies from "./ShopPolicies";
import ShopPayoutRow from "./ShopPayoutRow";

function renderWith(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  for (const f of Object.values(api)) f.mockReset();
  toast.success.mockReset();
  toast.error.mockReset();
});

describe("ShopFaqs (the shop page card)", () => {
  it("shows each question and its answer", async () => {
    api.fetchShopFaqs.mockResolvedValue([{ question: "Do you deliver?", answer: "Pickup only." }]);
    renderWith(<ShopFaqs shopId="s1" />);
    expect(await screen.findByText("Do you deliver?")).toBeTruthy();
    expect(screen.getByText("Pickup only.")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Questions" })).toBeTruthy();
  });

  it("no FAQs, no card", async () => {
    api.fetchShopFaqs.mockResolvedValue([]);
    const { container } = renderWith(<ShopFaqs shopId="s1" />);
    await waitFor(() => expect(api.fetchShopFaqs).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 10));
    expect(container.textContent).toBe("");
  });

  it("a failed read says so, with a retry", async () => {
    api.fetchShopFaqs.mockRejectedValueOnce(new Error("boom")).mockResolvedValue([{ question: "Q one?", answer: "A" }]);
    renderWith(<ShopFaqs shopId="s1" />);
    fireEvent.click(await screen.findByRole("button", { name: /try again|retry/i }));
    expect(await screen.findByText("Q one?")).toBeTruthy();
  });
});

describe("ShopFaqsEditor (/shops/mine)", () => {
  it("adds a question and saves the list", async () => {
    api.fetchShopFaqs.mockResolvedValue([]);
    api.saveMyShopFaqs.mockResolvedValue(1);
    renderWith(<ShopFaqsEditor shopId="s1" />);
    fireEvent.click(await screen.findByRole("button", { name: "Add a question" }));
    fireEvent.change(screen.getByLabelText("Question 1"), { target: { value: "Do you deliver?" } });
    fireEvent.change(screen.getByLabelText("Answer"), { target: { value: "Pickup only." } });
    fireEvent.click(screen.getByRole("button", { name: "Save questions" }));
    await waitFor(() => expect(api.saveMyShopFaqs).toHaveBeenCalledWith([{ question: "Do you deliver?", answer: "Pickup only." }]));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Questions saved."));
  });

  it("stops offering Add at 10, and Remove takes one out", async () => {
    api.fetchShopFaqs.mockResolvedValue(Array.from({ length: 10 }, (_, i) => ({ question: `Question ${i}?`, answer: "A" })));
    renderWith(<ShopFaqsEditor shopId="s1" />);
    await screen.findByDisplayValue("Question 0?");
    expect(screen.queryByRole("button", { name: "Add a question" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Remove question 1" }));
    expect(screen.queryByDisplayValue("Question 0?")).toBeNull();
    expect(screen.getByRole("button", { name: "Add a question" })).toBeTruthy();
  });

  it("a refused save shows the server's words", async () => {
    api.fetchShopFaqs.mockResolvedValue([{ question: "Call me?", answer: "337-555-1234" }]);
    api.saveMyShopFaqs.mockRejectedValue(Object.assign(new Error("x"), { userMessage: "Keep phone numbers off your shop." }));
    renderWith(<ShopFaqsEditor shopId="s1" />);
    fireEvent.click(await screen.findByRole("button", { name: "Save questions" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
  });
});

describe("ShopPolicies (the shop page card)", () => {
  it("one line per rule, in the order sheet's words", async () => {
    api.fetchShopPolicies.mockResolvedValue({ cancel_policy: "until_accept", ready_tap_cancel: "from_day_before" });
    renderWith(<ShopPolicies shopId="s1" />);
    expect(await screen.findByRole("heading", { name: "Shop policies" })).toBeTruthy();
    expect(screen.getByTestId("shop-policy-cancel").textContent).toContain("Free to cancel until the shop accepts");
    expect(screen.getByTestId("shop-policy-payment").textContent).toContain("Your card is held, not charged.");
  });

  it("no answer (not visible / not deployed), no card", async () => {
    api.fetchShopPolicies.mockResolvedValue(null);
    const { container } = renderWith(<ShopPolicies shopId="s1" />);
    await waitFor(() => expect(api.fetchShopPolicies).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 10));
    expect(container.textContent).toBe("");
  });
});

describe("ShopPayoutRow (shop dashboard)", () => {
  it("nothing once payouts work; Set up goes to the one payout screen", () => {
    connect.prompt = { kind: "none" };
    const a = renderWith(<ShopPayoutRow />);
    expect(a.container.textContent).toBe("");
    a.unmount();
    connect.prompt = { kind: "setup" };
    renderWith(<ShopPayoutRow />);
    fireEvent.click(screen.getByRole("button", { name: /Set up/ }));
    expect(nav).toHaveBeenCalledWith("/profile?tab=payment");
  });
});
