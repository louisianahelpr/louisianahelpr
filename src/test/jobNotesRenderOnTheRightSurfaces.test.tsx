/**
 * Q1461 (owner-reported 2026-10-06): Helprs never saw the poster's
 * "Materials I'll provide" or "Access & Parking" notes. Only the admin dialog,
 * the edit dialog and the poster's own card printed them (one string,
 * "Special Requirements").
 *
 * OWNER DECISION: materials -> EVERYONE viewing the job (job page and browse
 * card); access & parking -> only the BOOKED Helpr(s) (until the job ends),
 * the poster, and admins (owner answers, 2026-10-06).
 *
 * Pinned here:
 *   1. JobNotes, the one shared treatment, labels each note and renders
 *      nothing for none;
 *   2. the browse card shows the materials signal, and only when there is a
 *      note;
 *   3. the SURFACE INVENTORY, two ways. Every client file that shows the
 *      notes does it through one of the shared pieces in JobNotes.tsx
 *      (<JobDetailNotes>, useCardNotes, <JobNotes>), and is listed here with
 *      whether it asks for the access note. The materials always come from the
 *      job row; `access` only ever comes from useJobAccessNote (whose rows RLS
 *      limits: src/test/jobAccessNotesNeverBrowse.test.ts and the PGlite proof
 *      cover that half). A guest view asks for no access note, and an applied
 *      card asks only once hired and while the job is live.
 *
 * @mutate src/components/job-card/JobNotes.tsx |   return <JobNotes materials={job.materials_note} access={access} />;\n}\n\n/**\n * The browse | return <JobNotes access={access} />;\n}\n\n/**\n * The browse
 * @mutate src/components/job-card/JobNotes.tsx |   const access = useJobAccessNote(job?.id, open && askAccess); |   const access = useJobAccessNote(job?.id, open);
 * @mutate src/components/job-card/JobNotes.tsx |     !guest && !!viewerUserId && | !!viewerUserId &&
 * @mutate src/components/job-card/JobNotes.tsx |       {a && <JobNote label={ACCESS_LABEL} | {false && <JobNote label={ACCESS_LABEL}
 * @mutate src/components/job-card/JobNotes.tsx |   if (!text) return null; |   if (text) return null;
 * @mutate src/pages/jobs/AppliedJobCard.tsx | app.status === "accepted" && job?.status !== "cancelled" && job?.status !== "completed"); | true);
 * @mutate src/pages/posts/PostedJobCard.tsx |                 {notes}\n |                 {null}\n
 * @mutate src/components/dashboard/JobDetailDialog.tsx |         <JobDetailNotes job={job} guest={guest} viewerUserId={viewerUserId} />\n |
 * @mutate src/components/admin/adminJobs/JobDetailDialog.tsx |             <JobNotes materials={detailJob.materials_note} access={accessNote} /> |             <JobNotes materials={detailJob.materials_note} />
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

/** Every client file that shows the notes, through which shared piece, and whether it asks for the access note. */
const SURFACES: Record<string, { via: RegExp; renders?: RegExp; access: boolean; why: string }> = {
  "src/components/dashboard/JobDetailDialog.tsx": { via: /<JobDetailNotes job=\{job\} guest=\{guest\} viewerUserId=\{viewerUserId\} \/>/, access: true, why: "the job detail sheet (browse, map pin, shared link)" },
  "src/pages/jobs/AppliedJobCard.tsx": { via: /useCardNotes\(job, expandedJobIds\.has\(app\.job_id\), app\.status === "accepted" && job\?\.status !== "cancelled" && job\?\.status !== "completed"\)/, renders: /\{showNotes && notes\}/, access: true, why: "the Helpr's own card: materials while applied, access once hired, until the job ends" },
  "src/pages/posts/PostedJobCard.tsx": { via: /useCardNotes\(job, isExpanded, true\)/, renders: /\(hasDescription \|\| hasRequirements\) && \([\s\S]*?\{notes\}/, access: true, why: "the poster's own card: both, labelled" },
  "src/components/admin/adminJobs/JobDetailDialog.tsx": { via: /<JobNotes materials=\{detailJob\.materials_note\} access=\{accessNote\} \/>/, access: true, why: "admin: both; RLS gives admins the access note (owner answer 2)" },
  "src/components/dashboard/JobCard.tsx": { via: /<MaterialsChip note=\{job\.materials_note\} \/>/, access: false, why: "the browse card: the materials signal only" },
};
const SHARED = "src/components/job-card/JobNotes.tsx";

describe("the surface inventory (two-way)", () => {
  const files = walkSource([join(REPO, "src")]).filter((f) => !/\.test\.tsx?$/.test(f) && !f.includes(`${join("src", "test")}/`));
  const code = (f: string) => blankComments(readSource(f) ?? "");
  const users = files
    .map((f) => relative(REPO, f))
    .filter((f) => f !== SHARED && /<JobNotes\b|<JobDetailNotes\b|<MaterialsChip\b|\buseCardNotes\(/.test(code(join(REPO, f))))
    .sort();

  it("every file showing the notes is listed, and every listed file shows them", () => {
    expect(files.length).toBeGreaterThan(500);
    expect(users.length).toBeGreaterThanOrEqual(5);
    expect(users).toEqual(Object.keys(SURFACES).sort());
  });

  it.each(Object.entries(SURFACES))("%s shows them through its shared piece, asking for access only as listed", (file, { via, renders, access }) => {
    const src = code(join(REPO, file));
    expect(src, `${file}: not through its shared piece`).toMatch(via);
    // A card hook returns the block; the card must also put it on screen.
    if (renders) expect(src, `${file}: reads the notes but never renders them`).toMatch(renders);
    // Outside the shared module only the admin dialog reads the hook directly.
    if (file === "src/components/admin/adminJobs/JobDetailDialog.tsx") expect(src).toMatch(/const accessNote = useJobAccessNote\(/);
    else expect(src).not.toMatch(/useJobAccessNote|job_access_notes/);
    if (!access) expect(src).not.toMatch(/accessNote|useCardNotes|JobDetailNotes/);
  });

  it("the shared pieces take the materials from the job row and the access note only from useJobAccessNote", () => {
    const src = code(join(REPO, SHARED));
    const uses = [...src.matchAll(/<JobNotes\b([^>]*)\/>/g)].map((m) => m[1]);
    expect(uses.length).toBe(2);
    for (const props of uses) expect(props).toMatch(/materials=\{job\.materials_note\} access=\{access\}/);
    expect(src.match(/const access = useJobAccessNote\(/g)?.length).toBe(2);
    // A card asks only when open and when its caller says the viewer could be given it.
    expect(src).toContain("useJobAccessNote(job?.id, open && askAccess)");
  });

  it("the job detail sheet never asks for the access note on a guest view, and asks for crew and series jobs", () => {
    const src = code(join(REPO, SHARED));
    const ask = /const ask =([\s\S]*?);/.exec(src)?.[1].replace(/\s+/g, " ") ?? "";
    expect(ask).toMatch(/^ !guest && !!viewerUserId &&/);
    expect(ask).toMatch(/viewerUserId === job\.customer_id \|\| viewerUserId === job\.helper_id/);
    expect(ask).toMatch(/viewerUserId === job\.recurring_helper_id \|\| !!job\.is_group_job \|\| !!job\.is_recurring/);
  });

  it("the read itself goes through RLS: useJobAccessNote reads job_access_notes by job id, nothing wider", () => {
    const src = readFileSync(join(REPO, "src/hooks/useJobAccessNote.ts"), "utf8");
    expect(src).toContain('.from("job_access_notes").select("notes").eq("job_id", jobId).maybeSingle()');
  });
});
