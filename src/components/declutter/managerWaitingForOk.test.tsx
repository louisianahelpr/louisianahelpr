/**
 * Manager mode (owner 11-01, 5:05 PM): a draft the manager sends waits on the seller's Selling page for her OK.
 * Approve needs her own tax statements and posts it as hers; Send back takes a note. Nothing shows when nothing waits.
 *
 * @mutate src/components/declutter/ManagerWaitingForOk.tsx | disabled={busy \|\| !ticked} onClick={() => approve.mutate(r.item_id)} | disabled={busy} onClick={() => approve.mutate(r.item_id)}
 * @mutate src/components/declutter/ManagerWaitingForOk.tsx | sendBack.mutate({ id: r.item_id, note: note.trim() }) | sendBack.mutate({ id: r.item_id, note: "" })
 * @mutate src/components/declutter/ManagerWaitingForOk.tsx |   if (rows.length === 0) return null; |
 * @mutate src/components/declutter/ManagerWaitingForOk.tsx | approve to put {rows.length === 1 ? "it" : "each"} on sale | approve to put it on sale
 * @mutate src/components/declutter/ManagerWaitingForOk.tsx | flex flex-wrap items-center justify-end gap-x-3 | flex flex-wrap items-center gap-x-3
 * @mutate src/components/declutter/DeclutterHomeView.tsx |       <ManagerWaitingForOkGate userId={userId} />\n |
 * @mutate src/components/declutter/ManagerWaitingForOkGate.tsx |   if (!on) return null;\n  return <Suspense | return <Suspense
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const st = vi.hoisted(() => ({
  rows: [] as { item_id: string; title: string; price_cents: number; submitted_at: string }[],
  approved: [] as unknown[],
  sentBack: [] as unknown[],
}));
vi.mock("sonner", async () => (await import("@/test/helpers/sonnerMock")).sonnerMock());
vi.mock("@/lib/declutter/managerMode", () => ({
  fetchWaitingDrafts: async () => st.rows,
  useMyManagerGrants: () => ({ data: [{ role: "seller", status: "active", manager_first_name: "Dana" }] }),
  approveManagerDraft: async (id: string, a: unknown) => { st.approved.push([id, a]); return null; },
  sendManagerDraftBack: async (id: string, note: string) => { st.sentBack.push([id, note]); return "sent_back"; },
}));
import ManagerWaitingForOk from "./ManagerWaitingForOk";

function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><ManagerWaitingForOk userId="k1" /></QueryClientProvider>);
}

beforeEach(() => {
  st.rows = [{ item_id: "i1", title: "Oak rocking chair", price_cents: 4000, submitted_at: "2026-11-01T10:00:00Z" }];
  st.approved = [];
  st.sentBack = [];
});

describe("manager mode: Waiting for your OK", () => {
  it("lists the draft with who wrote it and the next step; Approve waits for her tax statements, then posts as hers", async () => {
    mount();
    expect(await screen.findByText("Oak rocking chair")).toBeTruthy();
    expect(screen.getByText(/Dana wrote this listing for you\. Next: approve to put it on sale, or send it back with a note\./)).toBeTruthy();
    const approve = screen.getByRole("button", { name: "Approve" });
    expect((approve as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(approve);
    expect(st.approved).toHaveLength(0);
    expect(screen.getAllByRole("checkbox").length).toBeGreaterThan(0);
    for (const box of screen.getAllByRole("checkbox")) fireEvent.click(box);
    await waitFor(() => expect((screen.getByRole("button", { name: "Approve" }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    await waitFor(() => expect(st.approved).toEqual([["i1", { personalUse: true, notBusiness: true, notFrequent: true, keepsItem: true }]]));
  });

  it("Send back takes a note and sends the trimmed words", async () => {
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Send back" }));
    fireEvent.change(screen.getByLabelText("Note for Dana"), { target: { value: "  Lower the price to $30  " } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(st.sentBack).toEqual([["i1", "Lower the price to $30"]]));
  });

  it("two drafts: the plural next step; the buttons sit on the right, Approve last", async () => {
    st.rows = [...st.rows, { item_id: "i2", title: "Brass table lamp", price_cents: 1500, submitted_at: "2026-11-01T10:05:00Z" }];
    mount();
    expect(await screen.findByText(/Dana wrote these 2 listings for you\. Next: approve to put each on sale, or send it back with a note\./)).toBeTruthy();
    const row = document.querySelector('[data-waiting-draft="i1"] > div')!;
    expect(row.className.split(" ")).toContain("justify-end");
    const labels = [...row.querySelectorAll("button")].map((b) => b.textContent);
    expect(labels).toEqual(["Send back", "Approve"]);
  });

  it("nothing waiting: nothing shows", async () => {
    st.rows = [];
    const { container } = mount();
    await new Promise((r) => setTimeout(r, 20));
    expect(container.querySelector("[data-manager-waiting]")).toBeNull();
  });

  it("Selling mounts it lazily, only while the declutter_manager switch is on", () => {
    const gate = readFileSync(resolve(__dirname, "ManagerWaitingForOkGate.tsx"), "utf8");
    expect(gate).toContain('const ManagerWaitingForOk = lazy(() => import("./ManagerWaitingForOk"));');
    expect(gate).toContain('const on = useFeature("declutter_manager");\n  if (!on) return null;');
    const home = readFileSync(resolve(__dirname, "DeclutterHomeView.tsx"), "utf8");
    expect(home).toContain("<ManagerWaitingForOkGate userId={userId} />");
  });
});
