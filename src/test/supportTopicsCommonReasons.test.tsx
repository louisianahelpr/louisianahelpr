/**
 * F042 (owner UI audit 11-09; lead go-ahead 11-09): the support topics had no entry for the most common reasons to
 * write in. Five were added (Declutter order, A job, Payments or payouts, Can't log in, Report someone); "Other" stays.
 *  - The edge function (contact-support TOPIC_LABELS) files each under the app's own reportLabel, EXACTLY (both ways).
 *  - While an older contact-support is still deployed (functions deploy on merge), it refuses a new topic with
 *    "Choose what your message is about."; /support sends the same message once more under "message" with the topic's
 *    label in front of the subject, so nothing is lost. A topic the old function knows never takes that path.
 *
 * @mutate supabase/functions/contact-support/index.ts |   declutter_order: 'Declutter Order', |
 * @mutate src/pages/info/Support.tsx |       if (said === OLD_FUNCTION_TOPIC_REFUSAL) ({ data, error } = await supabase.functions.invoke("contact-support", { body: fallback })); |
 * @mutate src/lib/supportTopics.ts |   if (!topic \|\| !NEW_SUPPORT_TOPIC_KEYS.includes(topic.key)) return null; |   if (!topic) return null;
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { ReactNode } from "react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { blankComments } from "./helpers/blankNonCode";

const calls = vi.hoisted(() => [] as Array<Record<string, unknown>>);
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }));
vi.mock("@/hooks/useFeature", () => ({ useFeature: () => false }));
vi.mock("@/hooks/useAuthReady", () => ({ useAuthReady: () => ({ user: { id: "u1" }, isReady: true }) }));
vi.mock("@/hooks/useProfile", () => ({ useProfile: () => ({ data: { full_name: "Lucy M", email: "l@x.net" }, isLoading: false }) }));
vi.mock("@/hooks/usePageMeta", () => ({ usePageMeta: () => {} }));
vi.mock("@/components/marketing/PublicHeaderPage", () => ({ PublicHeaderPage: ({ children }: { children: ReactNode }) => <main>{children}</main> }));
vi.mock("@/components/support/BugReportAttachments", () => ({ BugReportAttachments: () => null, useBugReportContext: () => null }));
// An OLD contact-support: it knows only the four original topics (and help).
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: {
      invoke: async (_name: string, opts: { body: Record<string, unknown> }) => {
        calls.push(opts.body);
        const known = ["message", "suggestion", "report", "other", "help"].includes(String(opts.body.topic));
        return known ? { data: { success: true }, error: null } : { data: { error: "Choose what your message is about." }, error: null };
      },
    },
  },
}));

import Support from "@/pages/info/Support";
import { NEW_SUPPORT_TOPIC_KEYS, SUPPORT_TOPICS, supportFallbackPayload } from "@/lib/supportTopics";

describe("F042: the common reasons to write in each have a topic", () => {
  it("the five new topics exist, Other stays, and the edge function files each under the app's reportLabel (exact)", () => {
    const keys = SUPPORT_TOPICS.map((t) => t.key);
    for (const k of ["declutter_order", "job", "payments", "login", "report_someone", "other"]) expect(keys).toContain(k);
    expect(SUPPORT_TOPICS.length).toBeGreaterThan(8);
    const edge = blankComments(readFileSync(resolve(__dirname, "../../supabase/functions/contact-support/index.ts"), "utf8"));
    const block = edge.match(/const TOPIC_LABELS: Record<string, string> = \{([\s\S]*?)\n\}/)?.[1] ?? "";
    const labels = Object.fromEntries([...block.matchAll(/^\s*(\w+): '([^']+)'/gm)].map((m) => [m[1], m[2]]));
    for (const t of SUPPORT_TOPICS) expect(labels[t.key], t.key).toBe(t.reportLabel);
    // The edge's only extra key is the legacy "help" (merged into message long ago).
    expect(Object.keys(labels).filter((k) => !keys.includes(k as never))).toEqual(["help"]);
  });

  it("the fallback is only for the new topics, and keeps the topic as a subject prefix", () => {
    expect(NEW_SUPPORT_TOPIC_KEYS.length).toBe(5);
    expect(supportFallbackPayload({ topic: "payments", subject: "Charged twice" })).toEqual({ topic: "message", subject: "[Payments or payouts] Charged twice" });
    expect(supportFallbackPayload({ topic: "message", subject: "Hi" })).toBeNull();
    expect(supportFallbackPayload({ topic: "nonsense", subject: "Hi" })).toBeNull();
  });

  it("/support against an OLD function: a new topic is refused once, then sent under 'message' with its label", async () => {
    calls.length = 0;
    render(<MemoryRouter initialEntries={["/support?topic=payments&subject=Charged%20twice"]}><Support /></MemoryRouter>);
    fireEvent.change(screen.getByLabelText(/message/i), { target: { value: "My card was charged twice for one job." } });
    fireEvent.click(screen.getByRole("button", { name: /send/i }));
    await waitFor(() => expect(calls.length).toBe(2));
    expect(calls[0].topic).toBe("payments");
    expect(calls[1]).toMatchObject({ topic: "message", subject: "[Payments or payouts] Charged twice", message: "My card was charged twice for one job." });
    expect(await screen.findByText("Message sent")).toBeTruthy();
  });
});
