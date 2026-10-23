/**
 * Owner request 2026-10-23 (via the lead): Admin Support had only Resolve /
 * Dismiss, so the owner had no way to answer a member. Each ticket now has a
 * Reply action and shows the replies already sent (who, when, what reached the
 * member). The server half is src/test/edge/admin-support-reply.test.ts; the
 * table and its admin-only reader are proven in
 * src/test/pglite/adminSupportReplies.pglite.mjs.
 *
 * @mutate src/components/admin/AdminSupport.tsx |                   canResolve={ticket.status === "pending"} |                   canResolve={false}
 * @mutate src/components/admin/AdminSupport.tsx |                   <SupportThread replies={repliesFor(ticket.id)} /> |                   null
 * @mutate src/components/admin/SupportReply.tsx |         body: { reportId: ticketId, message: trimmed, resolve: canResolve && resolve }, |         body: { reportId: ticketId, message: trimmed, resolve: false },
 * @mutate src/components/admin/SupportReply.tsx |       if (!result.success) throw new Error(result.error \|\| "The reply was not sent."); |
 * @mutate src/components/admin/AdminSupport.tsx |   const repliesPending = (id: string) => replies.isLoading \|\| (replies.isPlaceholderData && !fetchedIds.has(id)); |   const repliesPending = (id: string) => replies.isLoading;
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  rpc: {} as Record<string, unknown[]>,
  rpcErrors: {} as Record<string, { message: string; code?: string }>,
  invokes: [] as Array<{ name: string; body: unknown }>,
  invokeResult: { data: {} as unknown, error: null as unknown },
  /** When set, admin_support_replies waits for it (a slow thread fetch). */
  repliesHold: null as Promise<void> | null,
}));
const toasts = vi.hoisted(() => ({ success: vi.fn(), warning: vi.fn(), error: vi.fn() }));

vi.mock("sonner", () => ({ toast: toasts }));
vi.mock("@/lib/errorLogger", () => ({ report: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => {
  const CHAIN = ["select", "eq", "neq", "in", "is", "not", "or", "order", "gte", "lte", "limit", "range"];
  const builder = () => {
    const b: Record<string, unknown> = {};
    for (const m of CHAIN) b[m] = () => b;
    b.maybeSingle = async () => ({ data: null, error: null });
    b.then = (res: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(res);
    return b;
  };
  return {
    supabase: {
      from: () => builder(),
      rpc: async (name: string) => {
        if (name === "admin_support_replies" && db.repliesHold) await db.repliesHold;
        return db.rpcErrors[name] ? { data: null, error: db.rpcErrors[name] } : { data: db.rpc[name] ?? [], error: null };
      },
      functions: {
        invoke: async (name: string, opts: { body: unknown }) => {
          db.invokes.push({ name, body: opts.body });
          return db.invokeResult;
        },
      },
      auth: { getUser: async () => ({ data: { user: { id: "admin-1" } }, error: null }) },
    },
  };
});

import AdminSupport from "@/components/admin/AdminSupport";
import { replyOutcomeMessage, SUPPORT_REPLY_MAX_CHARS } from "@/components/admin/SupportReply";

const PAST = "2026-10-20T15:00:00Z";
const ticket = (over: Record<string, unknown> = {}) => ({
  id: "r-1", reporter_id: "u-1", reason: "[Issue Report] App freezes", description: "It froze",
  status: "pending", created_at: PAST, priority_at: PAST, priority_support: false,
  reporter_name: "Lucy Malveaux", reporter_email: "lucy@example.com", support_tier: "free", ...over,
});

function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter><AdminSupport /></MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("Admin Support: reply to a member", () => {
  beforeEach(() => {
    db.rpc = { admin_support_queue: [ticket()], admin_support_replies: [] };
    db.rpcErrors = {};
    db.repliesHold = null;
    db.invokes = [];
    db.invokeResult = { data: { success: true, notified: true, email_queued: true, has_email: true, resolved: true, resolve: "resolved", outcome_recorded: true }, error: null };
    toasts.success.mockReset(); toasts.warning.mockReset(); toasts.error.mockReset();
  });

  it("shows the replies already sent: who, the text, and what reached the member", async () => {
    db.rpc.admin_support_replies = [{
      id: "rep-1", report_id: "r-1", body: "Thanks Lucy.\nFixed now.", created_at: "2026-10-21T10:00:00Z",
      admin_name: "Ada Owner", notified: true, email_status: "sent", resolved_on_send: true, outcome_recorded: true,
    }];
    mount();
    const thread = await screen.findByRole("list", { name: "Replies sent" });
    expect(thread).toHaveTextContent("Ada O. replied");
    expect(thread).toHaveTextContent("Thanks Lucy.");
    expect(thread).toHaveTextContent("In-app notice delivered · Emailed · Resolved on send");
    expect(thread).not.toHaveTextContent("not fully recorded");
  });

  it("a reply whose delivery was never recorded says check first, never 'not delivered' (lh-silent-failure r1 #1)", async () => {
    db.rpc.admin_support_replies = [{
      id: "rep-2", report_id: "r-1", body: "Hi", created_at: "2026-10-21T10:00:00Z",
      admin_name: "Ada Owner", notified: null, email_status: "unknown", resolved_on_send: false, outcome_recorded: false,
    }];
    mount();
    const thread = await screen.findByRole("list", { name: "Replies sent" });
    expect(thread).toHaveTextContent("Delivery not fully recorded: check before resending");
    expect(thread).toHaveTextContent("In-app notice not recorded");
    expect(thread).not.toHaveTextContent("not delivered");
  });

  it("every email state reads as what it means (r1 #2: failed is still retrying; dlq and not_queued are final)", async () => {
    const { emailStatusLabel } = await import("@/components/admin/SupportReply");
    expect(emailStatusLabel("failed")).toBe("Email retrying");
    expect(emailStatusLabel("dlq")).toBe("Email failed");
    expect(emailStatusLabel("not_queued")).toBe("Email not queued");
    expect(emailStatusLabel("unconfirmed")).toBe("Not emailed (address not confirmed)");
    expect(emailStatusLabel("no_address")).toBe("Not emailed (no address on file)");
  });

  it("Reply opens a composer; Send reply posts the ticket, the text and resolve, then says what reached them", async () => {
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Reply" }));
    const send = screen.getByRole("button", { name: "Send reply" });
    expect(send).toBeDisabled();
    expect(screen.getByRole("checkbox", { name: "Mark resolved when sent" })).toBeChecked();
    fireEvent.change(screen.getByLabelText("Reply to Lucy M."), { target: { value: "  We fixed it.  " } });
    fireEvent.click(send);
    await waitFor(() => expect(toasts.success).toHaveBeenCalled());
    expect(db.invokes).toEqual([{ name: "admin-support-reply", body: { reportId: "r-1", message: "We fixed it.", resolve: true } }]);
    expect(toasts.success).toHaveBeenCalledWith("Reply sent to Lucy M. in the app and by email. Ticket marked resolved.");
  });

  it("unticking resolve sends resolve: false", async () => {
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Reply" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Mark resolved when sent" }));
    fireEvent.change(screen.getByLabelText("Reply to Lucy M."), { target: { value: "Hi" } });
    fireEvent.click(screen.getByRole("button", { name: "Send reply" }));
    await waitFor(() => expect(db.invokes).toHaveLength(1));
    expect(db.invokes[0].body).toMatchObject({ resolve: false });
  });

  it("a refused reply is an error toast, and the composer keeps the text", async () => {
    db.invokeResult = { data: { error: "Forbidden" }, error: null };
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Reply" }));
    fireEvent.change(screen.getByLabelText("Reply to Lucy M."), { target: { value: "Hi" } });
    fireEvent.click(screen.getByRole("button", { name: "Send reply" }));
    await waitFor(() => expect(toasts.error).toHaveBeenCalled());
    expect(toasts.success).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Reply to Lucy M.")).toHaveValue("Hi");
  });

  it("a lost answer never claims nothing was sent: it says to check the replies first (lh-authz-rls r1 #3)", async () => {
    db.invokeResult = { data: null, error: new Error("Failed to fetch") };
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Reply" }));
    fireEvent.change(screen.getByLabelText("Reply to Lucy M."), { target: { value: "Hi" } });
    fireEvent.click(screen.getByRole("button", { name: "Send reply" }));
    await waitFor(() => expect(toasts.error).toHaveBeenCalled());
    const said = String(toasts.error.mock.calls[0][0]);
    expect(said).not.toMatch(/Nothing was sent/i);
  });

  it("a reply that missed a channel is a warning naming it, never a plain success", async () => {
    db.invokeResult = { data: { success: true, notified: false, email_queued: true, has_email: true, resolved: false }, error: null };
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Reply" }));
    fireEvent.change(screen.getByLabelText("Reply to Lucy M."), { target: { value: "Hi" } });
    fireEvent.click(screen.getByRole("button", { name: "Send reply" }));
    await waitFor(() => expect(toasts.warning).toHaveBeenCalledWith("Reply sent to Lucy M. by email, but not in the app."));
    expect(toasts.success).not.toHaveBeenCalled();
  });

  it("over the limit, Send stays off and the count says why", async () => {
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Reply" }));
    fireEvent.change(screen.getByLabelText("Reply to Lucy M."), { target: { value: "x".repeat(SUPPORT_REPLY_MAX_CHARS + 1) } });
    expect(screen.getByRole("button", { name: "Send reply" })).toBeDisabled();
    expect(screen.getByText(/too long to send/)).toBeInTheDocument();
  });

  it("a ticket whose member deleted their account has no Reply button and says why", async () => {
    db.rpc.admin_support_queue = [ticket({ reporter_id: null, reporter_name: null })];
    mount();
    expect(await screen.findByText("This member deleted their account, so there is no one to reply to.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reply" })).toBeNull();
  });

  it("switching filters: a ticket the last fetch never covered says 'Loading replies…', never looks reply-less (lh-silent-failure r2 #2)", async () => {
    mount();
    await screen.findByRole("button", { name: "Reply" });
    let release!: () => void;
    db.repliesHold = new Promise<void>((r) => { release = r; });
    db.rpc.admin_support_queue = [ticket({ id: "r-2", status: "resolved", reason: "[Other] Old billing question" })];
    db.rpc.admin_support_replies = [{
      id: "rep-9", report_id: "r-2", body: "Answered last week.", created_at: "2026-10-15T10:00:00Z",
      admin_name: "Ada Owner", notified: true, email_status: "sent", resolved_on_send: true, outcome_recorded: true,
    }];
    fireEvent.click(screen.getByRole("button", { name: "Resolved" }));
    expect(await screen.findByText("Loading replies…")).toBeInTheDocument();
    release();
    expect(await screen.findByText("Answered last week.")).toBeInTheDocument();
    expect(screen.queryByText("Loading replies…")).toBeNull();
  });

  it("an unreadable thread says so instead of looking like no replies were sent", async () => {
    db.rpcErrors.admin_support_replies = { message: "boom", code: "XX000" };
    mount();
    expect(await screen.findByText(/Couldn't load the replies on this ticket/)).toBeInTheDocument();
  });

  it("the outcome sentence covers every channel combination", () => {
    expect(replyOutcomeMessage("Lucy", { notified: true, email_queued: true, has_email: true })).toEqual({ ok: true, text: "Reply sent to Lucy in the app and by email." });
    expect(replyOutcomeMessage("Lucy", { notified: true, has_email: false })).toEqual({ ok: false, text: "Reply sent to Lucy in the app, but not by email (no address on file)." });
    expect(replyOutcomeMessage("Lucy", { notified: false, email_queued: false, has_email: true })).toEqual({ ok: false, text: "Reply saved, but it did not reach Lucy in the app or by email." });
    expect(replyOutcomeMessage("Lucy", { notified: true, has_email: true, email_unconfirmed: true })).toEqual({ ok: false, text: "Reply sent to Lucy in the app, but not by email (their address isn't confirmed)." });
    // r1 #3 / #1a: a resolve that did not happen, or a record that did not save, is said and is never a plain success.
    expect(replyOutcomeMessage("Lucy", { notified: true, email_queued: true, has_email: true, resolve: "error" })).toEqual({ ok: false, text: "Reply sent to Lucy in the app and by email. The ticket is still open: marking it resolved failed." });
    expect(replyOutcomeMessage("Lucy", { notified: true, email_queued: true, has_email: true, resolve: "already_closed" })).toEqual({ ok: true, text: "Reply sent to Lucy in the app and by email. The ticket was already closed." });
    expect(replyOutcomeMessage("Lucy", { notified: true, email_queued: true, has_email: true, outcome_recorded: false }).ok).toBe(false);
  });

  it("the client, the edge function and the table agree on the length limit", () => {
    const root = process.cwd();
    const edge = readFileSync(join(root, "supabase/functions/admin-support-reply/index.ts"), "utf8");
    const sql = readFileSync(join(root, "supabase/migrations/20261023200521_admin_support_replies.sql"), "utf8");
    expect(edge).toContain(`const MAX_REPLY_CHARS = ${SUPPORT_REPLY_MAX_CHARS}`);
    expect(sql).toContain(`CHECK (char_length(btrim(body)) BETWEEN 1 AND ${SUPPORT_REPLY_MAX_CHARS})`);
  });
});
