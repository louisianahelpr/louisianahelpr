/**
 * Q2478, owner decisions 2a/2b (2026-10-29 via lead): ONE trust line under the four profile tiles and on
 * applicant cards, "12 jobs done · 92% on time · 3 repeat customers", "New" under 3 jobs, and a rounded
 * public reply-speed bucket ("Usually replies in …") from get_reply_speed. The four tiles stay as they are.
 *
 * @mutate src/lib/trustLine.ts | const NEW_UNDER_JOBS = 3; | const NEW_UNDER_JOBS = 0;
 * @mutate src/lib/trustLine.ts |   if (s.onTimeRate != null && Number.isFinite(s.onTimeRate)) parts.push(`${Math.round(s.onTimeRate)}% on time`); |   parts.push(`${Math.round(s.onTimeRate ?? 0)}% on time`);
 * @mutate src/lib/trustLine.ts |   if (percent == null \|\| sample == null \|\| sample < 3) return 0; |   if (percent == null \|\| sample == null) return 0;
 * @mutate src/lib/trustLine.ts |       if (res.error && isMissingRpcNamed(res.error, "get_reply_speed")) return []; |       if (res.error) return [];
 * @mutate src/pages/user/AtAGlanceCard.tsx |       <TrustLine stats={trustStats} reply={replyBucket} className="mt-3" /> |       {null}
 * @mutate src/pages/user/UserProfile.tsx |                 replyBucket={replyBucket} |                 replyBucket={null}
 * @mutate src/pages/posts/postedJobs/ApplicantsPanel.tsx | <ApplicantTrustLine helperId={app.helper_id} helperIds={applications.map((a) => a.helper_id)} /> | {null}
 * @mutate src/pages/posts/postedJobs/applicantsPanel/ApplicantsDesktopTable.tsx | <ApplicantTrustLine helperId={app.helper_id} helperIds={applications.map((a) => a.helper_id)} /> | {null}
 *
 * LEAD-APPLICANT-TAG (owner 2026-10-31): a new member's "New" sits right of the name, never alone at the bottom
 * of the applicant card, and the distance sits under the name.
 * @mutate src/components/TrustLine.tsx |   const parts = isNewMember(t.stats) ? [] : trustLineParts(t.stats); |   const parts = trustLineParts(t.stats);
 * @mutate src/pages/posts/postedJobs/ApplicantsPanel.tsx |                               <ApplicantNewTag helperId={app.helper_id} helperIds={applications.map((a) => a.helper_id)} />\n | 
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";
import { blankComments } from "./helpers/blankNonCode";

const rpc = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a) } }));

import { REPLY_BUCKET_COPY, asReplyBucket, repeatCustomers, trustLineParts, useReplySpeed } from "@/lib/trustLine";
import { TrustLine } from "@/components/TrustLine";

const code = (f: string) => blankComments(readFileSync(join(process.cwd(), f), "utf8"));
const wrap = (ui: ReactElement) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>);

describe("the trust line (Q2478 2a)", () => {
  it("reads like the owner's example", () => {
    expect(trustLineParts({ completedJobs: 12, onTimeRate: 91.7, repeatHirePercent: 43, repeatClientSample: 7 }).join(" · "))
      .toBe("12 jobs done · 92% on time · 3 repeat customers");
  });
  it("says New under 3 jobs done, and nothing else", () => {
    for (const n of [0, 1, 2, null, undefined]) {
      expect(trustLineParts({ completedJobs: n, onTimeRate: 100, repeatHirePercent: 100, repeatClientSample: 3 }), String(n)).toEqual(["New"]);
    }
    expect(trustLineParts({ completedJobs: 3, onTimeRate: null, repeatHirePercent: null, repeatClientSample: 0 })).toEqual(["3 jobs done"]);
  });
  it("leaves out a rate the server withheld (below its floor), never shows it as 0", () => {
    const parts = trustLineParts({ completedJobs: 8, onTimeRate: null, repeatHirePercent: null, repeatClientSample: 2 });
    expect(parts.join(" ")).not.toMatch(/on time|repeat/);
  });
  it("repeat customers: recovered from the whole-number percent and its sample; none under 3 clients", () => {
    const cases: Array<[number | null, number | null, number]> = [[43, 7, 3], [100, 3, 3], [33, 3, 1], [0, 9, 0], [100, 2, 0], [null, 5, 0]];
    expect(cases.length).toBeGreaterThan(5);
    for (const [p, s, want] of cases) expect(repeatCustomers(p, s), `${p}% of ${s}`).toBe(want);
    expect(trustLineParts({ completedJobs: 5, onTimeRate: null, repeatHirePercent: 33, repeatClientSample: 3 })).toContain("1 repeat customer");
  });
});

describe("the public reply bucket (Q2478 2b)", () => {
  it("only the server's three buckets are shown, in plain words", () => {
    expect(asReplyBucket("under_1h")).toBe("under_1h");
    expect(asReplyBucket("slow")).toBeNull();
    expect(asReplyBucket(null)).toBeNull();
    expect(REPLY_BUCKET_COPY.few_hours).toBe("Usually replies in a few hours");
  });

  it("the hook keys buckets by member and skips members with none", async () => {
    rpc.mockResolvedValueOnce({ data: [{ user_id: "a", reply_bucket: "under_1h" }, { user_id: "b", reply_bucket: null }], error: null, status: 200 });
    let got: Map<string, string> = new Map();
    function Probe() { got = useReplySpeed(["b", "a", "a"]); return null; }
    wrap(<Probe />);
    await waitFor(() => expect(got.get("a")).toBe("under_1h"));
    expect(got.has("b")).toBe(false);
    expect(rpc).toHaveBeenCalledWith("get_reply_speed", { p_user_ids: ["a", "b"] });
  });

  it("before the migration is live (PGRST202 naming get_reply_speed) it shows nothing; any other error is not swallowed", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { code: "PGRST202", message: "Could not find the function public.get_reply_speed(p_user_ids) in the schema cache", hint: null }, status: 404 });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    let got: Map<string, string> | null = null;
    function Probe() { got = useReplySpeed(["z"]); return null; }
    render(<QueryClientProvider client={client}><Probe /></QueryClientProvider>);
    await waitFor(() => expect(client.getQueryState(["reply-speed", ["z"]])?.status).toBe("success"));
    expect(got!.size).toBe(0);
    rpc.mockResolvedValueOnce({ data: null, error: { code: "42501", message: "permission denied", hint: null }, status: 403 });
    const client2 = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    function Probe2() { useReplySpeed(["y"]); return null; }
    render(<QueryClientProvider client={client2}><Probe2 /></QueryClientProvider>);
    await waitFor(() => expect(client2.getQueryState(["reply-speed", ["y"]])?.status).toBe("error"));
  });

  it("TrustLine renders the line and the reply bucket", () => {
    render(<TrustLine stats={{ completedJobs: 12, onTimeRate: 92, repeatHirePercent: 43, repeatClientSample: 7 }} reply="few_hours" />);
    expect(screen.getByText("12 jobs done · 92% on time · 3 repeat customers")).toBeTruthy();
    expect(screen.getByText("Usually replies in a few hours")).toBeTruthy();
  });
});

describe("where it shows", () => {
  it("under the four tiles on the profile (the tiles themselves unchanged), fed the reply bucket", () => {
    const card = code("src/pages/user/AtAGlanceCard.tsx");
    expect(card).toContain('<TrustLine stats={trustStats} reply={replyBucket} className="mt-3" />');
    expect(card.indexOf("<TrustLine")).toBeGreaterThan(card.indexOf("cells.map((c) =>"));
    expect(code("src/pages/user/UserProfile.tsx")).toContain("replyBucket={replyBucket}");
  });
  it("on the applicant cards (phone and tablet) and the desktop applicants table", () => {
    const tag = "<ApplicantTrustLine helperId={app.helper_id} helperIds={applications.map((a) => a.helper_id)} />";
    expect(code("src/pages/posts/postedJobs/ApplicantsPanel.tsx")).toContain(tag);
    expect(code("src/pages/posts/postedJobs/applicantsPanel/ApplicantsDesktopTable.tsx")).toContain(tag);
  });

  it("ApplicantTrustLine draws its own member's line from one shared read", async () => {
    rpc.mockImplementation((fn: string) =>
      Promise.resolve(
        fn === "get_public_profile_stats"
          ? { data: [{ user_id: "h1", completed_jobs_as_helper: 4, on_time_rate: 80, repeat_hire_percent: null, repeat_client_sample: 1 }, { user_id: "h2", completed_jobs_as_helper: 1, on_time_rate: null, repeat_hire_percent: null, repeat_client_sample: 0 }], error: null, status: 200 }
          : { data: [{ user_id: "h1", reply_bucket: "under_1h" }], error: null, status: 200 },
      ),
    );
    const { ApplicantTrustLine } = await import("@/components/TrustLine");
    rpc.mockClear();
    wrap(<><ApplicantTrustLine helperId="h1" helperIds={["h1", "h2"]} /><ApplicantTrustLine helperId="h2" helperIds={["h1", "h2"]} /></>);
    expect(await screen.findByText("4 jobs done · 80% on time · Usually replies in under an hour")).toBeTruthy();
    // h2 is new (its fixture row is under the New threshold): nothing at the bottom of the card; "New" is the tag beside the name.
    await waitFor(() => expect(document.querySelectorAll("[data-trust-line]").length).toBe(1));
    expect(screen.queryByText("New")).toBeNull();
    expect(rpc.mock.calls.filter((c) => c[0] === "get_public_profile_stats").length).toBe(1);
  });

  it("ApplicantNewTag says New beside a new member's name only", async () => {
    rpc.mockImplementation((fn: string) =>
      Promise.resolve(
        fn === "get_public_profile_stats"
          ? { data: [{ user_id: "h1", completed_jobs_as_helper: 4, on_time_rate: 80, repeat_hire_percent: null, repeat_client_sample: 1 }, { user_id: "h2", completed_jobs_as_helper: 1, on_time_rate: null, repeat_hire_percent: null, repeat_client_sample: 0 }], error: null, status: 200 }
          : { data: [], error: null, status: 200 },
      ),
    );
    const { ApplicantNewTag } = await import("@/components/TrustLine");
    wrap(<><ApplicantNewTag helperId="h1" helperIds={["h1", "h2"]} /><ApplicantNewTag helperId="h2" helperIds={["h1", "h2"]} /></>);
    expect(await screen.findByText("New")).toBeTruthy();
    expect(document.querySelectorAll("[data-new-tag]").length).toBe(1);
  });

  it("on the phone card: the tag right after the name, the distance under the name above the details", () => {
    const panel = code("src/pages/posts/postedJobs/ApplicantsPanel.tsx");
    expect(panel).toMatch(/\{helperName\}\s*<\/a>\s*<ApplicantNewTag helperId=\{app\.helper_id\}/);
    expect(panel.indexOf("{distanceBand.label}")).toBeGreaterThan(0);
    expect(panel.indexOf("{distanceBand.label}")).toBeLessThan(panel.indexOf("data-applicant-details"));
  });
});
