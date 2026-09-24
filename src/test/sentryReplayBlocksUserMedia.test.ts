/**
 * CS-001: Session Replay ran with blockAllMedia:false and nothing else, so ID
 * documents, credential uploads and job photos were recorded to Sentry. Every
 * replay integration must block img/video/picture (or all media).
 *
 * @mutate src/lib/sentry.ts | block: REPLAY_BLOCKED_MEDIA, | // block removed
 * @mutate src/lib/sentry.ts | export const REPLAY_BLOCKED_MEDIA = ["img", "video", "picture"]; | export const REPLAY_BLOCKED_MEDIA = ["video"];
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const src = readFileSync("src/lib/sentry.ts", "utf8");

describe("Sentry replay never records user media (CS-001)", () => {
  const calls = src.split("replayIntegration({").slice(1).map((c) => c.slice(0, c.indexOf("})")));
  it("there is at least one replay integration", () => expect(calls.length).toBeGreaterThan(0));
  it.each(calls.map((c, i) => [i, c]))("replayIntegration #%s blocks user media", (_i, call) => {
    expect(/blockAllMedia:\s*true/.test(call as string) || /block:\s*REPLAY_BLOCKED_MEDIA/.test(call as string)).toBe(true);
  });
  it("the blocked list covers every element that carries user images", () => {
    const list = src.match(/REPLAY_BLOCKED_MEDIA = (\[[^\]]*\])/)?.[1] ?? "[]";
    for (const tag of ["img", "video", "picture"]) expect(JSON.parse(list)).toContain(tag);
  });
});
