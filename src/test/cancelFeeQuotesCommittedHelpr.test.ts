// Lead (2026-10-21, suspected money bug): the cancel dialog quotes the late-cancel fee from its `hasHelper`
// prop (CancellationDialog.tsx sharedCancellationFeePercent(hasHelper, ...)), while the server charges only
// when a Helpr is COMMITTED: helper_id AND helper_confirmed_at (_shared/cancellationFee.ts helperIsCommitted).
// Verified 2026-10-21: the one caller passes helperIsCommitted / crewMemberCommitted, so no quote is
// made for a chosen-but-unconfirmed Helpr. This guard holds that for every caller, now and later.
// @mutate src/components/job-card/ActivityDialogs.tsx |               : helperIsCommitted({ |               : !!props.cancelDialogJob.helper_id \|\| helperIsCommitted({
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { trackedFiles } from "./helpers/trackedFiles";
import { blankComments } from "./helpers/blankNonCode";

describe("the cancel dialog's fee is quoted only for a committed Helpr", () => {
  const callers = trackedFiles("src")
    .filter((f) => /\.tsx$/.test(f) && !/\.test\.tsx$/.test(f))
    .map((f) => ({ f, src: blankComments(readFileSync(f, "utf8")) }))
    .filter(({ src }) => /<CancellationDialog\b/.test(src));

  it("finds the callers", () => {
    expect(callers.length).toBeGreaterThan(0);
  });

  it("every caller derives hasHelper from the server's committed rule", () => {
    for (const { f, src } of callers) {
      const prop = src.match(/hasHelper=\{([\s\S]*?)\}\s*\n\s*crew=/)?.[1] ?? src.match(/hasHelper=\{([^}]*)\}/)?.[1] ?? "";
      expect(prop, f).toMatch(/helperIsCommitted\(/);
      expect(prop, f).not.toMatch(/helper_id\s*\|\|/);
    }
  });
});
