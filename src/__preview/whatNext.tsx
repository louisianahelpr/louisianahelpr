// SCRATCH (builder2e, not committed): mounts a What-next sheet over the live page for shots.
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ApplicationSentDialog } from "@/components/dashboard/ApplicationSentDialog";
import { PaymentHeldDialog } from "@/components/job-card/PaymentHeldDialog";
import { MemoryRouter } from "react-router-dom";
import { OfferSentWhatNext } from "@/components/declutter/OfferSentWhatNext";
import { ListedWhatNext } from "@/components/declutter/ListedWhatNext";
import { supabase } from "@/integrations/supabase/client";
import { HelperDoneWhatNextHost, announceTransition } from "@/components/whatNext/HelperDoneWhatNext";
const job = { id: "x", title: "Fence repair", budget: 85, helper_fee_flat_cents: 70, category: "x", description: "", date_needed: "2026-10-31", location: "", customer_id: "p", status: "open", created_at: "" };
export function mount(which: string) {
  const el = document.createElement("div");
  document.body.appendChild(el);
  const qc = new QueryClient();
  if (which === "71" || which === "72") {
    void import("@/components/declutter/DeclutterHandoverViews").then(({ PaidOrdersSection }) => {
      const seller = which === "72";
      const cart = [{ line_id: "l1", item_id: "i1", item_title: seller ? "Patio chairs, set of 2" : "Cypress porch swing", my_side: seller ? "seller" : "buyer", seller_id: "s1", price_cents: seller ? 7200 : 5500, status: "paid", checkout_by: "2026-10-23T00:00:00Z", order_id: "o1", order_status: "paid", handover: "porch", premium_cents: 345, total_cents: seller ? 7630 : 5845, porch_ok: true }];
      el.style.cssText = "position:fixed;inset:72px 16px 96px 16px;max-width:520px;margin:0 auto;z-index:60;overflow:auto";
      createRoot(el).render(<QueryClientProvider client={qc}><MemoryRouter><div className="rounded-2xl bg-background p-2"><PaidOrdersSection cart={cart as never} /></div></MemoryRouter></QueryClientProvider>);
    });
    return;
  }
  if (which === "65") {
    void import("@/pages/posts/CompletionChoiceSheet").then(({ CompletionChoiceSheet }) => {
      createRoot(el).render(<QueryClientProvider client={qc}><MemoryRouter><CompletionChoiceSheet open jobId="x" jobTitle="Pressure wash driveway" helperId="h" helperName="Andre" userId="u" jobPrice={90} onClose={() => {}} onConfirm={() => {}} onRevisionSubmitted={() => {}} /></MemoryRouter></QueryClientProvider>);
    });
    return;
  }
  if (which === "58") {
    void import("@/components/dashboard/ApplyConfirmDialog").then(({ ApplyConfirmDialog }) => {
      const j = { ...job, title: "Detail my truck at home", budget: 85, posterName: "Travis Boudreaux", location: "Kaplan, LA", date_needed: "2026-10-24", start_time: "09:00", helpers_needed: 1 };
      createRoot(el).render(<QueryClientProvider client={qc}><MemoryRouter><ApplyConfirmDialog open onClose={() => {}} confirmApplyJob={j as never} platformFee={10} applyMessage="" setApplyMessage={() => {}} applyFiles={[]} setApplyFiles={() => {}} applyLoading={false} handleApplyConfirm={() => {}} /></MemoryRouter></QueryClientProvider>);
    });
    return;
  }
  if (which === "76") {
    void import("@/components/declutter/DeclutterDeliveryViews").then(({ OrderDeliveryPanel }) => {
      el.style.cssText = "position:fixed;inset:auto 16px 96px 16px;max-width:420px;margin:0 auto;z-index:60";
      createRoot(el).render(<QueryClientProvider client={qc}><div className="rounded-2xl border border-border bg-card p-4"><OrderDeliveryPanel taskId="t1" side="buyer" orderId="o1" /></div></QueryClientProvider>);
    });
    return;
  }
  if (which === "60") {
    createRoot(el).render(<PaymentHeldDialog side="helpr" who={{ name: "Travis Boudreaux", dateNeeded: "2026-10-24", jobId: "x" }} onClose={() => {}} />);
    return;
  }
  if (which === "79") {
    createRoot(el).render(<OfferSentWhatNext cents={5000} onClose={() => {}} onBrowse={() => {}} />);
    return;
  }
  if (which === "80") {
    void supabase.from("declutter_items").select("id, status").eq("status", "live").limit(1).then(({ data }) => {
      const id = data?.[0]?.id;
      createRoot(el).render(<QueryClientProvider client={new QueryClient()}><MemoryRouter initialEntries={[{ pathname: "/declutter", state: { justListed: { itemId: id, status: "live" } } }]}><ListedWhatNext /></MemoryRouter></QueryClientProvider>);
    });
    return;
  }
  if (which === "81") {
    createRoot(el).render(<MemoryRouter><HelperDoneWhatNextHost /></MemoryRouter>);
    setTimeout(() => announceTransition("done", "x", { jobId: "x", at: new Date().toISOString() }), 300);
    return;
  }
  const node = which === "77"
    ? <ApplicationSentDialog sent={{ jobId: "x", title: "Fence repair", noteWithheld: false, posterName: "Travis Boudreaux", dateNeeded: "2026-10-31", job: job as never }} platformFee={10} onClose={() => {}} onView={() => {}} />
    : <PaymentHeldDialog side="poster" who={{ name: "Andre Thibodeaux", dateNeeded: "2026-10-31" }} onClose={() => {}} />;
  createRoot(el).render(<QueryClientProvider client={qc}>{node}</QueryClientProvider>);
}
export async function liveItemId() {
  const { data } = await supabase.from("declutter_items").select("id").eq("status", "live").limit(1);
  return data?.[0]?.id as string;
}
export async function posterOpenJobs() {
  const { data: u } = await supabase.auth.getUser();
  const { data } = await supabase.from("jobs").select("id, title, status, payment_status").eq("customer_id", u.user?.id ?? "").eq("status", "open").limit(20);
  const ids = (data ?? []).map((j) => j.id);
  const { data: apps } = await supabase.from("applications").select("job_id").in("job_id", ids);
  return (data ?? []).map((j) => ({ ...j, apps: (apps ?? []).filter((a) => a.job_id === j.id).length }));
}
