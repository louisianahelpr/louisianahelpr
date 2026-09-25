import { describe, it, expect } from "vitest";
import {
  SCOPE_VIDEO_MAX_BYTES,
  SCOPE_VIDEO_MAX_SECONDS,
  scopeVideoDurationProblem,
  scopeVideoFileProblem,
} from "./scopeVideo";

// @mutate src/lib/scopeVideo.ts | if (file.size > SCOPE_VIDEO_MAX_BYTES) { | if (file.size > Infinity) {
// @mutate src/lib/scopeVideo.ts | if (!SCOPE_VIDEO_TYPES.includes(file.type)) { | if (!file.type.startsWith("video/")) {
// @mutate src/lib/scopeVideo.ts | if (seconds > SCOPE_VIDEO_MAX_SECONDS + DURATION_SLACK_SECONDS) { | if (seconds > Infinity) {
describe("scope video selection (archive L2889: no client-side size/duration guard)", () => {
  it("accepts a clip the job-photos bucket accepts", () => {
    expect(scopeVideoFileProblem({ type: "video/mp4", size: 12 * 1024 * 1024 })).toBeNull();
    expect(scopeVideoFileProblem({ type: "video/quicktime", size: SCOPE_VIDEO_MAX_BYTES })).toBeNull();
    expect(scopeVideoFileProblem({ type: "video/webm", size: 1 })).toBeNull();
  });

  it("refuses a file over the bucket's 50 MB limit, with the reason", () => {
    expect(scopeVideoFileProblem({ type: "video/mp4", size: SCOPE_VIDEO_MAX_BYTES + 1 })).toMatch(/too large \(max 50 MB\)/);
  });

  it("refuses a video type the bucket does not allow", () => {
    expect(scopeVideoFileProblem({ type: "video/x-msvideo", size: 1024 })).toMatch(/format isn't supported/);
    expect(scopeVideoFileProblem({ type: "image/png", size: 1024 })).toMatch(/format isn't supported/);
  });

  it("refuses a clip longer than the 30 s the picker promises; allows an unreadable length", () => {
    expect(scopeVideoDurationProblem(SCOPE_VIDEO_MAX_SECONDS)).toBeNull();
    expect(scopeVideoDurationProblem(30.4)).toBeNull();
    expect(scopeVideoDurationProblem(45)).toMatch(/45s long/);
    expect(scopeVideoDurationProblem(null)).toBeNull();
    expect(scopeVideoDurationProblem(Number.NaN)).toBeNull();
  });
});
