/**
 * AI help on /support (owner 2026-11-03, 3:30 PM; B70): before a ticket is sent, Claude suggests an answer from the
 * Help Center (support-ai-answer, mode "ask"). The member picks "This answered my question" (nothing is sent) or
 * "Still send to the team" (contact-support, as before). The ticket goes to the team unless they say it was
 * answered, and any AI failure, or the switch being off, sends it exactly as before.
 *
 * @mutate src/pages/info/Support.tsx |     if (aiOn && askedKey !== key) { |     if (false) {
 * @mutate src/pages/info/Support.tsx |       if (answer) {\n        setSuggestion(answer);\n        return;\n      } |
 * @mutate src/pages/info/Support.tsx | onClick={() => setAnsweredByAi(true)} | onClick={sendTicket}
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  aiOn: true,
  invokes: [] as Array<{ name: string; body: Record<string, unknown> }>,
  aiResult: { data: { answered: true, answer: "Payouts start after the poster approves the work." }, error: null } as {
    data: unknown; error: unknown;
  },
}));

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("@/hooks/useFeature", () => ({ useFeature: (key: string) => key === "ai_support_answers" && state.aiOn }));
vi.mock("@/hooks/useAuthReady", () => ({ useAuthReady: () => ({ user: { id: "u-1" }, isReady: true }) }));
vi.mock("@/hooks/useProfile", () => ({
  useProfile: () => ({ data: { full_name: "Lucy Malveaux", email: "lucy@bayoumail.net" }, isLoading: false }),
}));
vi.mock("@/hooks/usePageMeta", () => ({ usePageMeta: () => {} }));
vi.mock("@/components/marketing/PublicHeaderPage", () => ({
  PublicHeaderPage: ({ children }: { children: ReactNode }) => <main>{children}</main>,
}));
vi.mock("@/components/support/BugReportAttachments", () => ({
  BugReportAttachments: () => null,
  useBugReportContext: () => null,
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: {
      invoke: async (name: string, opts: { body: Record<string, unknown> }) => {
        state.invokes.push({ name, body: opts.body });
        if (name === "support-ai-answer") return state.aiResult;
        return { data: { success: true }, error: null };
      },
    },
  },
}));

import Support from "@/pages/info/Support";

function mountAndFill() {
  render(
    <MemoryRouter initialEntries={["/support?topic=other&subject=Payout%20timing"]}>
      <Support />
    </MemoryRouter>,
  );
  fireEvent.change(screen.getByLabelText(/message/i), { target: { value: "When do I get paid for a job I finished?" } });
  fireEvent.click(screen.getByRole("button", { name: /send/i }));
}

const names = () => state.invokes.map((i) => i.name);

describe("/support: Claude's answer before the ticket is sent", () => {
  beforeEach(() => {
    state.aiOn = true;
    state.invokes = [];
    state.aiResult = { data: { answered: true, answer: "Payouts start after the poster approves the work." }, error: null };
  });

  it("shows the Help Center answer first, and sends nothing yet", async () => {
    mountAndFill();
    expect(await screen.findByText("Payouts start after the poster approves the work.")).toBeInTheDocument();
    expect(names()).toEqual(["support-ai-answer"]);
    expect(state.invokes[0].body).toEqual({ mode: "ask", subject: "Payout timing", message: "When do I get paid for a job I finished?" });
    expect(screen.getByText(/can't see your account or change anything/)).toBeInTheDocument();
  });

  it('"This answered my question" sends nothing to the team', async () => {
    mountAndFill();
    fireEvent.click(await screen.findByRole("button", { name: "This answered my question" }));
    expect(await screen.findByText("Glad that helped")).toBeInTheDocument();
    expect(names()).not.toContain("contact-support");
  });

  it('"Still send to the team" sends the ticket as before', async () => {
    mountAndFill();
    fireEvent.click(await screen.findByRole("button", { name: "Still send to the team" }));
    await waitFor(() => expect(names()).toContain("contact-support"));
    expect(state.invokes.find((i) => i.name === "contact-support")?.body)
      .toMatchObject({ subject: "Payout timing", message: "When do I get paid for a job I finished?" });
    expect(await screen.findByText("Message sent")).toBeInTheDocument();
  });

  it("no answer, or any AI failure, sends the ticket straight away", async () => {
    for (const aiResult of [
      { data: { answered: false, answer: "" }, error: null },
      { data: null, error: new Error("feature_disabled") },
    ]) {
      state.invokes = [];
      state.aiResult = aiResult;
      const { unmount } = render(
        <MemoryRouter initialEntries={["/support?topic=other&subject=Payout%20timing"]}><Support /></MemoryRouter>,
      );
      fireEvent.change(screen.getByLabelText(/message/i), { target: { value: "When do I get paid for a job I finished?" } });
      fireEvent.click(screen.getByRole("button", { name: /send/i }));
      await waitFor(() => expect(names()).toEqual(["support-ai-answer", "contact-support"]));
      unmount();
    }
  });

  it("with the switch off, the AI is never asked", async () => {
    state.aiOn = false;
    mountAndFill();
    await waitFor(() => expect(names()).toEqual(["contact-support"]));
  });
});
