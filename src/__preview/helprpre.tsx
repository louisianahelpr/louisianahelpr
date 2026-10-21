// SCRATCH (builder2h, not committed): the Helpr's accepted card before and inside the confirm window, for shots.
import * as React from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { ConfirmedSection } from "@/pages/jobs/appliedJobCard/ConfirmedSection";
export function mount(which: string) {
  const el = document.createElement("div");
  el.style.cssText = "position:fixed;inset:0;z-index:60;overflow:auto";
  document.body.appendChild(el);
  const now = Date.now();
  const start = new Date(now + (which === "pre" ? 72 : 20) * 3600e3);
  const date = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" }).format(start);
  const ago = (h: number) => new Date(now - h * 3600e3).toISOString();
  const job = { id: "j1", title: "Mow two lawns", description: "Front and back", location: "Delcambre, LA", customer_id: "p", helper_id: "h", budget: 60, category: "yard_work",
    date_needed: date, start_time: "09:00", status: "accepted", payment_status: "escrow", helper_confirmed_at: ago(20), helper_dayof_confirmed_at: null, poster_confirmed_at: null,
    helper_on_the_way_at: null, helper_arrived_at: null, helper_completed_at: null, poster_completed_at: null, poster_confirmed_working_at: null, is_group_job: false, latitude: null, longitude: null };
  const app = { id: "a1", job_id: "j1", helper_id: "h", status: "accepted", created_at: ago(30), job, posterName: "Ben K." };
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  qc.setQueryData(["job-rescheduled", "j1"], false);
  createRoot(el).render(
    <QueryClientProvider client={qc}><MemoryRouter>
      <div className="min-h-screen bg-background px-4 py-6 lg:max-w-[720px] lg:mx-auto">
        <div className="rounded-2xl border border-border bg-card p-4 space-y-3">
          <p className="font-semibold">Mow two lawns · Ben K.</p>
          <ConfirmedSection app={app as never} job={job as never} userId="h" initialTracking={null} navigate={() => {}} />
        </div>
      </div>
    </MemoryRouter></QueryClientProvider>,
  );
}
