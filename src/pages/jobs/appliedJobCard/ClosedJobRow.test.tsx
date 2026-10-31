/**
 * JOBS-12: Not picked was a list of nameless rows. Proof of the read: src/test/pglite/closedApplicationJobLabels.pglite.mjs
 *
 * @mutate src/pages/jobs/AppliedJobCard.tsx | <ClosedJobCard cardRef={cardRef} label={app.closed_job_label} status={closedCardLabel(app)} /> | <ClosedJobCard cardRef={cardRef} status={closedCardLabel(app)} />
 * @mutate src/hooks/useActivityData.ts | closed_job_label: job ? null : closedLabels.get(a.job_id) ?? null } | closed_job_label: null }
 * @mutate supabase/migrations/20261031021424_closed_application_job_labels.sql |             WHERE a.job_id = j.id AND a.helper_id = v_uid |             WHERE a.job_id = j.id
 */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ClosedJobRow } from "./ClosedJobRow";
import { blankComments } from "@/test/helpers/blankNonCode";

const src = (p: string) => blankComments(readFileSync(join(process.cwd(), p), "utf8"));

describe("a closed job's row names the job", () => {
  it("title first, then the date and what happened", () => {
    render(<ClosedJobRow label={{ title: "Yard cleanup", date_needed: "2020-11-02" }} status="Offer expired" />);
    expect(screen.getByText("Yard cleanup")).toBeInTheDocument();
    expect(screen.getByText(/Offer expired$/).textContent).toMatch(/Nov.*· Offer expired/);
    expect(screen.queryByText(/details aren.t available/)).not.toBeInTheDocument();
  });

  it("no date: the status alone under the title", () => {
    render(<ClosedJobRow label={{ title: "Yard cleanup", date_needed: null }} status="Not selected" />);
    expect(screen.getByText("Not selected")).toBeInTheDocument();
  });

  it("a job with no row left keeps the plain line", () => {
    render(<ClosedJobRow label={null} status="Job no longer available" />);
    expect(screen.getByText("Job no longer available")).toBeInTheDocument();
    expect(screen.getByText(/details aren.t available/)).toBeInTheDocument();
  });

  it("the data path reaches the card, only when a row is missing, and never drops the error", () => {
    const hook = src("src/hooks/useActivityData.ts");
    expect(hook).toMatch(/fetchClosedJobLabels\(apps\.some\(\(a\) => !jobMap\.has\(a\.job_id\)\)\)/);
    expect(hook).toMatch(/closed_job_label: job \? null : closedLabels\.get\(a\.job_id\) \?\? null/);
    expect(src("src/pages/jobs/AppliedJobCard.tsx")).toContain("<ClosedJobCard cardRef={cardRef} label={app.closed_job_label}");
  });
});
