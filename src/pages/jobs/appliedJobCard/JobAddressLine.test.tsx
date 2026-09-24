import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { hasStreetAddress } from "./JobAddressLine";
import { JobCardMetaRow } from "../../../components/job-card/JobCardMetaRow";

/**
 * VN-55, ON THE ROW IT NOW LIVES IN.
 *
 * `JobAddressLine` — a whole card row printing the street address under the
 * meta row — is gone (owner, 2026-09-19, with a screenshot of /my-jobs: "this
 * shouldnt show 2 addresses… the full address needs to go where the city place
 * is. not be on a whole nother line"). The address moved INTO the meta row's
 * location slot, so these cases moved with it: same two claims, same predicate,
 * against the component that actually paints it now.
 *
 * `hasStreetAddress` stays where it was, at the same import path, because the
 * seed-fixture guard holds the scripts' own transcription of it to this exact
 * answer (src/test/seedFixtureAddressRealism.test.ts).
 *
 * @mutate src/components/job-card/JobCardMetaRow.tsx | const fullAddress = showFullAddress && hasStreetAddress(location); | const fullAddress = showFullAddress;
 * @mutate src/pages/jobs/appliedJobCard/JobAddressLine.tsx | return /\d/.test(first) && (location ?? "").includes(","); | return (location ?? "").includes(",");
 */
describe("the full street address, in the meta row (VN-55)", () => {
  const ADDRESS = "2217 Magazine St, New Orleans, LA 70130";

  it("prints the whole address, not the city, when the caller allows it", () => {
    const { container } = render(
      <JobCardMetaRow dateNeeded="2026-09-15" startTime="09:00" location={ADDRESS} showFullAddress />,
    );
    expect(container.textContent).toContain(ADDRESS);
    // And it is ANNOUNCED as an address, which the deleted row's `sr-only`
    // prefix used to carry: a street address read aloud unlabelled is a string
    // of digits.
    expect(container.textContent).toContain("Job address:");
  });

  it("falls back to the city when the location carries no street part", () => {
    // A masked location is UNDETECTABLE by comparison — mask("New Orleans, LA")
    // returns "New Orleans, LA" — so the digit test is the only workable one.
    const { container } = render(
      <JobCardMetaRow dateNeeded="2026-09-15" startTime="09:00" location="New Orleans, LA" showFullAddress />,
    );
    expect(container.textContent).toContain("New Orleans");
    expect(container.textContent, "a city was labelled as a street address").not.toContain("Job address:");
  });

  it("prints only the city when the caller does NOT allow the address", () => {
    // The second lock. The server masks first; this is what stops a leak
    // through the row if it ever stopped.
    const { container } = render(
      <JobCardMetaRow dateNeeded="2026-09-15" startTime="09:00" location={ADDRESS} />,
    );
    expect(container.textContent).not.toContain("2217 Magazine St");
    expect(container.textContent).toContain("New Orleans");
  });

  it("the predicate itself", () => {
    expect(hasStreetAddress(ADDRESS)).toBe(true);
    expect(hasStreetAddress("Garden District, New Orleans")).toBe(false);
    expect(hasStreetAddress("New Orleans")).toBe(false);
    expect(hasStreetAddress(null)).toBe(false);
  });
});
