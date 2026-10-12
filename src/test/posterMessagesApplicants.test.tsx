/**
 * Owner, 2026-10-11: "someone sent a question in their application and I
 * couldn't answer them. So add a message button for the poster to message
 * applicants."
 *
 * CLASS: every poster-side applicant list offers Message on each live
 * applicant, and the applicant side never gets a way to start a thread
 * (docs/JOB-LIFECYCLE.md rule 4: poster-first).
 *
 *  (a) INVENTORY FROM SOURCE: every non-test .tsx that renders a poster's
 *      per-applicant decision (Hire via onAcceptApplication, or a series'
 *      "Offer dates" via offerSeriesDates) is a poster applicant list, and
 *      must render <MessageApplicantButton>. Only those files may render it
 *      (no applicant-side surface).
 *  (b) The Message the Applicants screen draws, as a user sees it: one per live
 *      applicant, none for a rejected one, and it opens the job's thread with
 *      that applicant.
 *  (c) SERVER, read from each function's EFFECTIVE definition (newest CREATE,
 *      any dollar tag), which on 2026-10-11 matched prod's pg_get_functiondef:
 *      an applicant is a receiver only when the caller is the job's poster
 *      (can_send_message_to_in_job), and a sender only after the poster wrote
 *      to them (can_message_in_job); the client's messageable statuses are the
 *      server's live-application statuses.
 *
 * Shown red on the old code (the button removed) and on planted server holes:
 * @mutate src/pages/posts/postedJobs/ApplicantsPanel.tsx | <MessageApplicantButton jobId={selectedJob.id} | <span data-jobid={selectedJob.id}
 * @mutate src/components/series/SeriesDatesPanel.tsx | <MessageApplicantButton jobId={jobId} helperId={a.id} helperName={a.name} appearance="row" /> | {null}
 * @mutate src/pages/posts/postedJobs/ApplicantsPanel.tsx | {canMessageApplicant(app.status) && ( | {true && (
 * @mutate src/components/jobs/MessageApplicantButton.tsx | `/messages?jobId=${encodeURIComponent(jobId)}&userId=${encodeURIComponent(helperId)}` | `/messages?jobId=${encodeURIComponent(jobId)}`
 * @mutate src/components/jobs/MessageApplicantButton.tsx | ["pending", "accepted"] as const | ["pending", "accepted", "rejected"] as const
 * @mutate supabase/migrations/20260925230845_messaging_closes_both_ways_off_job.sql |             AND m.sender_id = j.customer_id\n            AND m.receiver_id = _sender | AND m.sender_id = _sender
 * @mutate supabase/migrations/20261004001242_messages_status_notices_and_sender_writes.sql |       OR (\n         EXISTS (\n           SELECT 1 FROM public.jobs j\n           WHERE j.id = _job_id AND j.customer_id = auth.uid()\n         )\n         AND ( |       OR (\n         (
 */
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { trackedFiles } from "./helpers/trackedFiles";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { MESSAGEABLE_APPLICATION_STATUSES } from "@/components/jobs/MessageApplicantButton";

vi.mock("@/integrations/supabase/client", () => {
  const chain: Record<string, unknown> = {};
  for (const m of ["select", "eq", "in", "or", "order", "limit", "maybeSingle", "single"]) chain[m] = () => chain;
  chain.then = (res: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(res);
  return {
    supabase: {
      from: () => chain,
      rpc: () => Promise.resolve({ data: [], error: null }),
      auth: { getSession: () => Promise.resolve({ data: { session: null }, error: null }) },
      storage: { from: () => ({ getPublicUrl: () => ({ data: { publicUrl: "" } }) }) },
    },
  };
});

import { ApplicantsPanel } from "@/pages/posts/postedJobs/ApplicantsPanel";
import type { EnrichedApplication, Job } from "@/components/job-card/activityConstants";

const ROOT = resolve(__dirname, "..", "..");
const read = (f: string) => readFileSync(join(ROOT, f), "utf8");

/** A poster's per-applicant decision: Hire (an offer) or a series' "Offer dates". */
const POSTER_APPLICANT_DECISION = /\bonAcceptApplication\(|\bofferSeriesDates\(/;

const tsx = trackedFiles("src").filter((f) => f.endsWith(".tsx") && !/\.test\.tsx$/.test(f));
const code = new Map(tsx.map((f) => [f, blankComments(read(f))]));
const posterLists = tsx.filter((f) => POSTER_APPLICANT_DECISION.test(code.get(f)!));
const rendersMessage = (f: string) => /<MessageApplicantButton\b/.test(code.get(f)!);

describe("(a) every poster-side applicant list offers Message, and only those do", () => {
  it("finds the poster's applicant lists from source", () => {
    expect(tsx.length).toBeGreaterThan(500);
    expect(posterLists).toEqual(
      expect.arrayContaining(["src/pages/posts/postedJobs/ApplicantsPanel.tsx", "src/components/series/SeriesDatesPanel.tsx"]),
    );
    expect(posterLists.length).toBeGreaterThan(1);
  });

  it("each one renders <MessageApplicantButton>", () => {
    const missing = posterLists.filter((f) => !rendersMessage(f));
    expect(missing, "a poster applicant list with no Message: the poster cannot answer an applicant's question").toEqual([]);
  });

  it("no other surface renders it (the applicant side never starts a thread)", () => {
    const elsewhere = tsx.filter((f) => rendersMessage(f) && !posterLists.includes(f));
    expect(elsewhere).toEqual([]);
  });
});

function LocationProbe() {
  const loc = useLocation();
  return <output data-testid="location">{loc.pathname + loc.search}</output>;
}

const JOB = { id: "job-1", title: "Rake the front yard", status: "open", created_at: new Date().toISOString() } as unknown as Job;
const app = (id: string, helper: string, name: string, status: string, message: string | null): EnrichedApplication =>
  ({
    id,
    job_id: JOB.id,
    helper_id: helper,
    status,
    message,
    created_at: new Date().toISOString(),
    profiles: { full_name: name, skills: null, user_id: helper },
  }) as unknown as EnrichedApplication;

describe("(b) the Applicants screen: Message on each live applicant opens their thread", () => {
  it("one Message per pending/accepted applicant, none for a rejected one; it opens /messages for that job and person", () => {
    const empty = new Map();
    render(
      <MemoryRouter initialEntries={["/activity"]}>
        <LocationProbe />
        <ApplicantsPanel
          selectedJob={JOB}
          setSelectedJob={() => {}}
          applications={[
            app("a1", "helper-ann", "Ann Boudreaux", "pending", "Do you have a rake or should I bring one?"),
            app("a2", "helper-bea", "Bea Guidry", "accepted", null),
            app("a3", "helper-cal", "Cal Thibodeaux", "rejected", null),
          ]}
          applicationsLoading={false}
          applicationsError={false}
          onLoadApplications={() => {}}
          onAcceptApplication={() => {}}
          onDeclineApplication={() => {}}
          neighborCountMap={empty}
          completedCountsMap={empty}
          repeatHireMap={empty}
          onTimeMap={empty}
          distanceBandMap={empty}
        />
      </MemoryRouter>,
    );
    const region = screen.getByRole("region", { name: /Applicants for Rake the front yard/ });
    const buttons = within(region).getAllByRole("button", { name: /^Message / });
    expect(buttons.map((b) => b.getAttribute("aria-label"))).toEqual(["Message Ann B.", "Message Bea G."]);
    fireEvent.click(buttons[0]);
    expect(screen.getByTestId("location").textContent).toBe("/messages?jobId=job-1&userId=helper-ann");
  });
});

describe("(c) the server keeps it poster-first (effective definitions)", () => {
  const defs = effectiveDefs(join(ROOT, "supabase", "migrations"));
  const body = (fn: string) => {
    const d = defs.get(fn);
    expect(d, `no migration defines ${fn}`).toBeDefined();
    return blankSqlComments(d!.stmt).replace(/\s+/g, " ");
  };

  it("an applicant is a receiver only when the caller is the job's poster", () => {
    const recv = body("can_send_message_to_in_job");
    expect(recv).toMatch(
      /OR \( EXISTS \( SELECT 1 FROM public\.jobs j WHERE j\.id = _job_id AND j\.customer_id = auth\.uid\(\) \) AND \( EXISTS \( SELECT 1 FROM public\.jobs j WHERE j\.id = _job_id AND j\.offered_to_helper_id = _receiver \) OR EXISTS \( SELECT 1 FROM public\.applications a WHERE a\.job_id = _job_id AND a\.helper_id = _receiver \) \) \)/,
    );
    // ...and that is the only place an application makes someone a receiver.
    expect(recv.match(/FROM public\.applications a WHERE a\.job_id = _job_id AND a\.helper_id = _receiver/g)).toHaveLength(1);
  });

  it("an applicant is a sender only after the POSTER wrote TO THEM, while still on the job", () => {
    const send = body("can_message_in_job");
    const apps = send.match(/FROM public\.applications a/g) ?? [];
    expect(apps.length, "re-read this guard: the gate's application reads changed").toBe(1);
    expect(send).toMatch(
      /EXISTS \( SELECT 1 FROM public\.messages m JOIN public\.jobs j ON j\.id = m\.job_id WHERE m\.job_id = _job_id AND m\.sender_id = j\.customer_id AND m\.receiver_id = _sender \) AND EXISTS \( SELECT 1 FROM public\.applications a WHERE a\.job_id = _job_id AND a\.helper_id = _sender AND a\.status IN \(([^)]*)\) \)/,
    );
  });

  it("the client's messageable statuses are exactly the server's live-application statuses", () => {
    const statuses = (sql: string, who: string) => {
      const m = new RegExp(`a\\.helper_id = ${who} AND a\\.status IN \\(([^)]*)\\)`).exec(sql);
      expect(m, `no live-application clause for ${who}`).not.toBeNull();
      return m![1].split(",").map((s) => s.trim().replace(/'/g, "")).sort();
    };
    const client = [...MESSAGEABLE_APPLICATION_STATUSES].sort();
    expect(statuses(body("is_off_job"), "_user")).toEqual(client);
    expect(statuses(body("can_message_in_job"), "_sender")).toEqual(client);
  });
});
