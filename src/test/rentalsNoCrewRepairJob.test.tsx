/**
 * Q2081 (lead 11-06, OWNER-DECISIONS 6:25 PM): no crew (Group) job from a tenant's repair request.
 * Post a Job opened with ?maintenance= offers One-time and Repeats only, never sends is_group_job for it (even
 * from a draft that carried Group), and link_maintenance_request_job refuses a group job on the server.
 * Behaviour of the server half (real Postgres): src/test/pglite/rentalsNoCrewRepairJob.pglite.mjs.
 *
 * @mutate src/components/postjob/LogisticsSection.tsx |   const jobTypeOptions = crewAllowed ? JOB_TYPE_OPTIONS : JOB_TYPE_OPTIONS_NO_CREW; |   const jobTypeOptions = JOB_TYPE_OPTIONS;
 * @mutate src/components/postjob/LogisticsSection.tsx |   const isGroupJob = crewAllowed && isGroupJobProp; |   const isGroupJob = isGroupJobProp;
 * @mutate src/pages/post-job/usePostJobForm.ts |     crewAllowed: !searchParams.get("maintenance"), |     crewAllowed: true,
 * @mutate src/pages/post-job/FormStep.tsx |             crewAllowed={form.crewAllowed} |
 * @mutate src/pages/post-job/useJobSubmit.ts |         isGroupJob: isGroupJob && !maintenanceRequestId, |         isGroupJob,
 * @mutate supabase/migrations/20261107031822_rentals_no_crew_job_from_repair.sql |   IF v_group IS TRUE THEN |   IF false THEN
 */
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";

vi.mock("@/hooks/useMapKitJs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/hooks/useMapKitJs")>()),
  useMapKitJs: () => "missing-token" as const,
}));
vi.mock("@/components/postjob/CurrentLocationPill", () => ({ CurrentLocationPill: () => null }));
vi.mock("@/components/postjob/AppleMapPreview", () => ({ AppleMapPreview: () => null }));

import { LogisticsSection } from "@/components/postjob/LogisticsSection";

afterEach(cleanup);

function Host({ crewAllowed, isGroupJob = false }: { crewAllowed?: boolean; isGroupJob?: boolean }) {
  const noop = () => {};
  return (
    <LogisticsSection
      stepNumber={2}
      streetAddress="" setStreetAddress={noop} city="" setCity={noop} addrState="LA" setAddrState={noop}
      zipCode="" setZipCode={noop}
      dateNeeded="" setDateNeeded={noop}
      startTime="" setStartTime={noop}
      isFlexibleSchedule={false} setIsFlexibleSchedule={noop}
      specialRequirements="" setSpecialRequirements={noop}
      isRecurring={false} setIsRecurring={noop}
      recurrenceDays={[]} setRecurrenceDays={noop} recurrenceWeeks={4} setRecurrenceWeeks={noop}
      seriesSplitOk={false} setSeriesSplitOk={noop}
      isGroupJob={isGroupJob} setIsGroupJob={noop} crewAllowed={crewAllowed} helpersNeeded="2" setHelpersNeeded={noop}
      budgetNum={60} logisticsComplete={false}
    />
  );
}

const jobTypes = () =>
  within(screen.getByRole("radiogroup", { name: "Job type" }))
    .getAllByRole("radio")
    .map((r) => ({ label: r.textContent?.trim(), on: r.getAttribute("aria-checked") === "true" }));

const code = (p: string) => blankComments(readFileSync(p, "utf8"));

describe("Q2081: no crew job from a tenant's repair request", () => {
  it("a normal post still offers Group (the control the repair post narrows)", () => {
    render(<Host />);
    const types = jobTypes();
    expect(types.length).toBeGreaterThan(2);
    expect(types.map((t) => t.label)).toContain("Group");
  });

  it("a repair-request post offers no Group", () => {
    render(<Host crewAllowed={false} />);
    const labels = jobTypes().map((t) => t.label);
    expect(labels).toContain("One-time");
    expect(labels).not.toContain("Group");
  });

  it("a draft that carried Group reads One-time on a repair-request post", () => {
    render(<Host crewAllowed={false} isGroupJob />);
    expect(jobTypes().find((t) => t.on)?.label).toBe("One-time");
  });

  it("Post a Job wires the narrowing from ?maintenance= and never submits a crew job for it", () => {
    expect(code("src/pages/post-job/usePostJobForm.ts")).toContain('crewAllowed: !searchParams.get("maintenance"),');
    expect(code("src/pages/post-job/FormStep.tsx")).toContain("crewAllowed={form.crewAllowed}");
    expect(code("src/pages/post-job/useJobSubmit.ts")).toContain("isGroupJob: isGroupJob && !maintenanceRequestId,");
  });

  it("the newest link_maintenance_request_job refuses a group job", () => {
    const def = effectiveDefs("supabase/migrations").get("link_maintenance_request_job");
    expect(def, "link_maintenance_request_job is defined").toBeDefined();
    const body = blankSqlComments(def!.stmt);
    expect(body).toMatch(/SELECT j\.is_group_job INTO v_group FROM public\.jobs j\s+WHERE j\.id = p_job_id AND j\.customer_id = v_uid AND j\.status = 'open'\s+FOR UPDATE;/);
    expect(body).toMatch(/IF v_group IS TRUE THEN\s+RETURN false;/);
  });
});
