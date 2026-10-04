/**
 * Q904 — the unrendered `<DisputeLink>` component stays deleted.
 *
 * It was rendered nowhere in app source from 2026-10-01 (the poster's Dispute
 * is a JobActionChip keyed "dispute"; trackerSafetyActionsInMore.test.tsx
 * fails any render of it outside More), so a second dispute entry point sat
 * in the tree, tested and unreachable. Deleted 2026-10-04; its live predicate
 * `shouldShowDisputeLink` stays in the same module. Red before: the module
 * exported the component and its own test rendered it.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import * as disputeLinkModule from "@/components/jobs/DisputeLink";
import { walkSource } from "./helpers/walkSource";
import { blankComments } from "./helpers/blankNonCode";

const SRC = join(resolve(__dirname, "..", ".."), "src");

describe("Q904: no unrendered DisputeLink component", () => {
  it("the module keeps only the live predicate", () => {
    expect(Object.keys(disputeLinkModule).sort()).toEqual(["shouldShowDisputeLink"]);
  });

  it("nothing in src renders <DisputeLink", () => {
    const files = walkSource([SRC]).filter((f) => /\.tsx$/.test(f));
    expect(files.length).toBeGreaterThan(400);
    const renders = files.filter((f) => /<DisputeLink\b/.test(blankComments(readFileSync(f, "utf8"))));
    expect(renders).toEqual([]);
  });
});

// @mutate src/components/jobs/DisputeLink.tsx | export function shouldShowDisputeLink( | export function DisputeLink() { return null; }\nexport function shouldShowDisputeLink(
