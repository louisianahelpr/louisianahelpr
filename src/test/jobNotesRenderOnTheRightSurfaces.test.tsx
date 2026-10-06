/**
 * Q1438 (owner-reported 2026-10-06): Helprs never saw the poster's
 * "Materials I'll provide" or "Access & Parking" notes. Only the admin dialog,
 * the edit dialog and the poster's own card printed them (one string,
 * "Special Requirements").
 *
 * OWNER DECISION: materials -> EVERYONE viewing the job (job page and browse
 * card); access & parking -> only the BOOKED Helpr(s) and the poster.
 *
 * Pinned here:
 *   1. JobNotes, the one shared treatment, labels each note and renders
 *      nothing for none;
 *   2. the browse card shows the materials signal, and only when there is a
 *      note;
 *   3. the SURFACE INVENTORY, two ways: every file that renders <JobNotes> is
 *      listed with what it may pass, every listed file does pass it, the
 *      materials always come from the job row, and `access` only ever comes
 *      from useJobAccessNote (whose rows RLS limits to the poster and the
 *      booked Helprs; src/test/jobAccessNotesNeverBrowse.test.ts and the PGlite
 *      proof cover that half). The guest page asks for no access note.
 *
 * @mutate src/components/dashboard/JobDetailDialog.tsx |         <JobNotes materials={job.materials_note} access={accessNote} /> |         <JobNotes access={accessNote} />
 * @mutate src/pages/jobs/AppliedJobCard.tsx |             {showNotes && <JobNotes materials={job.materials_note} access={accessNote} />} |             {showNotes && <JobNotes materials={job.materials_note} />}
 * @mutate src/pages/posts/PostedJobCard.tsx |                 {hasRequirements && <JobNotes materials={job.materials_note} access={accessNote} />} |                 {hasRequirements && <JobNotes access={accessNote} />}
 * @mutate src/components/dashboard/JobCard.tsx |             {job.materials_note?.trim() && ( |             {false && (
 * @mutate src/components/job-card/JobNotes.tsx |       {a && <JobNote label={ACCESS_LABEL} | {false && <JobNote label={ACCESS_LABEL}
 * @mutate src/components/dashboard/JobDetailDialog.tsx |     !guest && !!job && !!viewerUserId && (viewerUserId === job.customer_id \|\| viewerUserId === job.helper_id), |     !!viewerUserId \|\| guest,
 */
import { readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/hooks/useFirstPayoutFee", () => ({ useFirstPayoutFeeDollars: () => 0, useFirstPayoutFeeCents: () => 0 }));
vi.mock("@/hooks/useMapKitJs", () => ({ useMapKitJs: () => "idle" }));
vi.mock("@/lib/haptics", () => ({ hapticLight: vi.fn() }));

import JobCard from "@/components/dashboard/JobCard";
import type { EnrichedJob } from "@/components/dashboard/types";
import { ACCESS_LABEL, JobNotes, MATERIALS_LABEL } from "@/components/job-card/JobNotes";
import { blankComments } from "./helpers/blankNonCode";
import { walkSource, readSource } from "./helpers/walkSource";
import { jobLocalDateISO } from "@/test/helpers/jobLocalDate";

const REPO = resolve(__dirname, "..", "..");

describe("JobNotes: one labelled treatment for both notes", () => {
  it("labels the materials note and prints nothing private when there is no access note", () => {
    render(<JobNotes materials="Paint and rollers by the door" access={null} />);
    expect(screen.getByRole("region", { name: MATERIALS_LABEL })).toHaveTextContent("Paint and rollers by the door");
    expect(screen.queryByRole("region", { name: ACCESS_LABEL })).toBeNull();
  });

  it("labels the access note when it is given", () => {
    render(<JobNotes materials="Paint" access={"Gate 4521\nPark on the left"} />);
    expect(screen.getByRole("region", { name: ACCESS_LABEL })).toHaveTextContent("Gate 4521");
    expect(screen.getByRole("region", { name: MATERIALS_LABEL })).toBeInTheDocument();
  });

  it("renders nothing for blank notes", () => {
    const { container } = render(<JobNotes materials="  " access="" />);
    expect(container).toBeEmptyDOMElement();
  });
});

function browseJob(overrides: Partial<EnrichedJob> = {}): EnrichedJob {
  return {
    id: "job-q1427",
    title: "Paint the hallway",
    description: "Two coats.",
    category: "painting",
    budget: 120,
    location: "Baton Rouge, LA",
    parish: "East Baton Rouge",
    date_needed: jobLocalDateISO(5),
    start_time: null,
    created_at: new Date("2026-10-06T12:00:00Z").toISOString(),
    expires_at: null,
    customer_id: "poster-1",
    is_urgent: false,
    urgent_fee: 0,
    is_group_job: false,
    helpers_needed: 1,
    is_recurring: false,
    ...overrides,
  } as unknown as EnrichedJob;
}
const renderCard = (job: EnrichedJob) =>
  render(<JobCard job={job} effectiveFee={0.15} onApply={vi.fn()} onReport={vi.fn()} onSelect={vi.fn()} userLat={null} userLng={null} />);

describe("the browse card says the poster provides materials", () => {
  it("shows the signal, with the note in its title, when there is a note", () => {
    renderCard(browseJob({ materials_note: "Paint and rollers" }));
    const chip = screen.getByTestId("job-card-materials");
    expect(chip).toHaveAttribute("title", "Materials provided: Paint and rollers");
    expect(chip).toHaveTextContent(/Materials/);
  });

  it("shows nothing when there is no note", () => {
    renderCard(browseJob({ materials_note: null }));
    expect(screen.queryByTestId("job-card-materials")).toBeNull();
  });
});

/**
 * Every surface that renders JobNotes, and what it may pass. `access: true`
 * means the surface shows the private note to the viewer the database hands it
 * to; it must then read it with useJobAccessNote and nothing else.
 */
const SURFACES: Record<string, { access: boolean; why: string }> = {
  "src/components/dashboard/JobDetailDialog.tsx": { access: true, why: "the job detail sheet (browse, map pin, shared link): materials for all; access for the poster / booked Helpr only" },
  "src/pages/jobs/AppliedJobCard.tsx": { access: true, why: "the Helpr's own card: materials while applied, access once hired" },
  "src/pages/posts/PostedJobCard.tsx": { access: true, why: "the poster's own card: both, labelled" },
  "src/components/admin/adminJobs/JobDetailDialog.tsx": { access: false, why: "admin: materials only; RLS gives admins no access note" },
};

describe("the surface inventory (two-way)", () => {
  const files = walkSource([join(REPO, "src")]).filter((f) => !/\.test\.tsx?$/.test(f) && !f.includes(`${join("src", "test")}/`));
  const code = (f: string) => blankComments(readSource(f) ?? "");
  const renderers = files.filter((f) => /<JobNotes\b/.test(code(f))).map((f) => relative(REPO, f)).sort();

  it("every file rendering <JobNotes> is listed, and every listed file renders it", () => {
    expect(files.length).toBeGreaterThan(500);
    expect(renderers.length).toBeGreaterThanOrEqual(4);
    expect(renderers).toEqual(Object.keys(SURFACES).sort());
  });

  it.each(Object.entries(SURFACES))("%s passes the materials from the job row, and access only as listed", (file, { access }) => {
    const src = code(join(REPO, file));
    const uses = [...src.matchAll(/<JobNotes\b([^>]*)\/>/g)].map((m) => m[1]);
    expect(uses.length, `${file}: no <JobNotes ... /> found`).toBeGreaterThan(0);
    for (const props of uses) {
      expect(props, `${file}: materials must come from the job row`).toMatch(/materials=\{\w+\.materials_note\}/);
      if (access) expect(props).toMatch(/access=\{accessNote\}/);
      else expect(props).not.toMatch(/access=/);
    }
    if (access) {
      expect(src, `${file}: accessNote must come from useJobAccessNote`).toMatch(/const accessNote = useJobAccessNote\(/);
    } else {
      expect(src).not.toMatch(/useJobAccessNote|job_access_notes/);
    }
  });

  it("the job detail sheet never asks for the access note on a guest view", () => {
    const src = code(join(REPO, "src/components/dashboard/JobDetailDialog.tsx"));
    const call = /const accessNote = useJobAccessNote\(([\s\S]*?)\);/.exec(src)?.[1] ?? "";
    expect(call).toMatch(/!guest && !!job &&/);
    expect(call).toMatch(/viewerUserId === job\.customer_id \|\| viewerUserId === job\.helper_id/);
  });

  it("the browse card carries materials only (no access note on a scan row)", () => {
    const src = code(join(REPO, "src/components/dashboard/JobCard.tsx"));
    expect(src).toMatch(/job\.materials_note\?\.trim\(\) &&/);
    expect(src).not.toMatch(/useJobAccessNote|job_access_notes|accessNote/);
  });

  it("the read itself goes through RLS: useJobAccessNote reads job_access_notes by job id, nothing wider", () => {
    const src = readFileSync(join(REPO, "src/hooks/useJobAccessNote.ts"), "utf8");
    expect(src).toContain('.from("job_access_notes").select("notes").eq("job_id", jobId).maybeSingle()');
  });
});
