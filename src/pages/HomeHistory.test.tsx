/**
 * /home-history is sold as "your home's permanent service history — who came
 * out, what it cost, and when". These lock the three places it wasn't.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import HomeHistory from "./HomeHistory";

const USER = { id: "u-poster", email: "poster@helpr.test", user_metadata: { full_name: "Jane Boudreaux" } };
const HELPER = "u-helper";
const A2 = "u-renee";
const A3 = "u-dee";

vi.mock("@/hooks/useAuthReady", () => ({
  useAuthReady: () => ({ user: USER, isReady: true, session: null }),
}));
vi.mock("@/lib/errorLogger", () => ({ report: vi.fn() }));

const shareFileMock = vi.fn();
const shareNativeMock = vi.fn();
vi.mock("@/lib/nativeShare", () => ({
  shareFileNative: (...a: unknown[]) => shareFileMock(...a),
  shareNative: (...a: unknown[]) => shareNativeMock(...a),
}));

const toastMock = vi.fn();
vi.mock("sonner", () => ({ toast: Object.assign((...a: unknown[]) => toastMock(...a), { error: vi.fn() }) }));

interface SeedJob {
  id: string; title: string; description: string; category: string; status: string;
  budget: number; customer_fee_amount: number | null; urgent_fee: number | null;
  sales_tax_amount: number | null; location: string; parish: string; customer_id: string;
  helper_id: string; is_group_job: boolean; helpers_needed: number; created_at: string;
  poster_completed_at: string | null; helper_completed_at: string | null;
}

/** Three completed jobs, one per way a job acquires a helper. */
const JOBS: SeedJob[] = [
  {
    id: "hh-app", title: "Deep clean before move-out", description: "Kitchen, two baths.",
    category: "cleaning", status: "completed", budget: 180, customer_fee_amount: 19.8,
    urgent_fee: 0, sales_tax_amount: 0, location: "Baton Rouge, LA", parish: "East Baton Rouge",
    customer_id: USER.id, helper_id: HELPER, is_group_job: false, helpers_needed: 1,
    created_at: "2026-07-20T15:00:00Z", poster_completed_at: "2026-07-25T15:00:00Z", helper_completed_at: null,
  },
  {
    // INSTANT BOOK: helper_id stamped, no accepted application anywhere.
    id: "hh-instant", title: "Emergency water-heater swap", description: "Tank failed overnight.",
    category: "handyman", status: "completed", budget: 640, customer_fee_amount: 70.4,
    urgent_fee: 25, sales_tax_amount: 8.13, location: "Metairie, LA", parish: "Jefferson",
    customer_id: USER.id, helper_id: A2, is_group_job: false, helpers_needed: 1,
    created_at: "2026-08-10T15:00:00Z", poster_completed_at: "2026-08-13T15:00:00Z", helper_completed_at: null,
  },
  {
    // GROUP JOB: three on the roster, one in jobs.helper_id.
    id: "hh-group", title: "Post-storm debris haul", description: "Two trailers.",
    category: "storm_prep", status: "completed", budget: 900, customer_fee_amount: 99,
    urgent_fee: 0, sales_tax_amount: 0, location: "Houma, LA", parish: "Terrebonne",
    customer_id: USER.id, helper_id: HELPER, is_group_job: true, helpers_needed: 3,
    created_at: "2025-07-25T15:00:00Z", poster_completed_at: "2025-07-30T15:00:00Z", helper_completed_at: null,
  },
];

let jobs: SeedJob[] = JOBS;

vi.mock("@/integrations/supabase/client", () => {
  function builder(pick: () => unknown) {
    const self: Record<string, unknown> = {};
    for (const m of ["select", "eq", "in", "order", "gte", "lte", "neq"]) self[m] = () => self;
    self.then = (res: (v: unknown) => unknown) =>
      Promise.resolve({ data: pick(), error: null }).then(res);
    return self;
  }
  return {
    supabase: {
      from: (table: string) =>
        builder(() => {
          if (table === "jobs") return jobs;
          // Only the FIRST job ever had an accepted application.
          if (table === "applications") return [{ job_id: "hh-app", helper_id: HELPER }];
          if (table === "group_job_helpers")
            return [
              { job_id: "hh-group", helper_id: HELPER, joined_at: "2025-07-26T00:00:00Z" },
              { job_id: "hh-group", helper_id: A2, joined_at: "2025-07-26T01:00:00Z" },
              { job_id: "hh-group", helper_id: A3, joined_at: "2025-07-26T02:00:00Z" },
            ];
          if (table === "profiles")
            return [
              { user_id: USER.id, full_name: "Jane Boudreaux" },
              { user_id: HELPER, full_name: "Marcus Thibodeaux" },
              { user_id: A2, full_name: "Renée Beauchêne-Landry" },
              { user_id: A3, full_name: "Dee Guidry" },
            ];
          return [];
        }),
      auth: { onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }) },
    },
  };
});

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/home-history"]}>
        <HomeHistory />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("/home-history says who came out", () => {
  beforeEach(() => {
    jobs = JOBS;
    shareFileMock.mockReset().mockResolvedValue("downloaded");
    shareNativeMock.mockReset().mockResolvedValue("shared");
    toastMock.mockReset();
  });

  it("names the helper on an instant-book job, which has no accepted application", async () => {
    renderPage();
    await screen.findByText("Emergency water-heater swap");
    // Read off `jobs.helper_id`. The old applications-only lookup rendered
    // NOTHING here — the "done by" line simply vanished.
    expect(screen.getByText("Renée Beauchêne-Landry")).toBeTruthy();
  });

  it("names the WHOLE roster on a group job, not just the lead", async () => {
    renderPage();
    await screen.findByText("Post-storm debris haul");
    expect(screen.getByText("Marcus Thibodeaux, Renée Beauchêne-Landry and Dee Guidry")).toBeTruthy();
  });

  it("gives every completed job a 'done by' line", async () => {
    renderPage();
    await screen.findByText("Deep clean before move-out");
    await waitFor(() => expect(screen.getAllByText(/done by/).length).toBe(3));
  });
});

describe("/home-history says what it cost", () => {
  beforeEach(() => { jobs = JOBS; });

  it("prints the total charged, not the job's budget", async () => {
    renderPage();
    await screen.findByText("Emergency water-heater swap");
    // 640 budget + 70.40 fee + 25 urgent + 8.13 tax = 743.53. The old line
    // printed "$640" under a page that promises "what it cost".
    expect(screen.getByText("$743.53")).toBeTruthy();
    expect(screen.queryByText("$640")).toBeNull();
  });

  it("labels the figure so it cannot be read as the listing price", async () => {
    renderPage();
    await screen.findByText("Emergency water-heater swap");
    expect(screen.getAllByText("paid").length).toBe(3);
  });

  it("a legacy job with no fee columns still shows exactly its budget", async () => {
    jobs = [{ ...JOBS[0], customer_fee_amount: null, urgent_fee: null, sales_tax_amount: null }];
    renderPage();
    await screen.findByText("Deep clean before move-out");
    expect(screen.getByText("$180")).toBeTruthy();
  });
});

describe("/home-history can leave the app", () => {
  beforeEach(() => {
    jobs = JOBS;
    shareFileMock.mockReset().mockResolvedValue("downloaded");
    toastMock.mockReset();
  });

  it("offers an export at all — the page shipped with none", async () => {
    renderPage();
    expect(await screen.findByRole("button", { name: /Share Record \(PDF\)/i })).toBeTruthy();
  });

  it("hands a real .pdf FILE to the share path, not a blob link or window.print", async () => {
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: /Share Record \(PDF\)/i }));
    await waitFor(() => expect(shareFileMock).toHaveBeenCalled());
    const payload = shareFileMock.mock.calls[0][0] as { fileName: string; base64: string; source: string };
    expect(payload.fileName.endsWith(".pdf")).toBe(true);
    expect(payload.base64.startsWith("JVBER")).toBe(true); // "%PDF"
    expect(payload.source).toBe("homeHistory");
    // The owner's name comes from `profiles`, not the signup-time copy in
    // `user_metadata` that a profile rename never updates.
    expect(payload.fileName).toContain("jane-boudreaux");
  });

  it("confirms the web download, which changes nothing on screen by itself", async () => {
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: /Share Record \(PDF\)/i }));
    await waitFor(() => expect(toastMock).toHaveBeenCalled());
    expect(String(toastMock.mock.calls[0][0])).toMatch(/Home record saved/);
  });

  it("cannot stage two files from a double tap", async () => {
    let release: (v: string) => void = () => {};
    shareFileMock.mockImplementation(() => new Promise<string>((r) => { release = r; }));
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: /Share Record \(PDF\)/i }));
    const busy = await screen.findByRole("button", { name: /Preparing record/i });
    fireEvent.click(busy);
    expect(shareFileMock).toHaveBeenCalledTimes(1);
    release("downloaded");
  });

  it("hides the export when there is no record to export", async () => {
    jobs = [];
    renderPage();
    await screen.findByText("No finished jobs yet");
    expect(screen.queryByRole("button", { name: /Share Record/i })).toBeNull();
  });
});
