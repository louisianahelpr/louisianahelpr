/**
 * ACTIVE SESSIONS: THE DEVICE IN USE SAYS "ACTIVE NOW", AND THE PARTS ARE SPACED (Q2649).
 *
 * Account audit 1102d row 8 (~/.lh-shots/audit-1102d-findings.md, h-security-375.png): the row badged
 * "This device" read "Last seen Oct 20" while signed in right then, and its parts were joined by a CSS
 * margin, so the text itself read "Oct 20· 22 sign-ins". SecurityTab builds the line with sessionSeenWords.
 */
// @mutate src/components/profile/sessionSeenWords.ts |   const parts = [opts.isThisDevice ? "Active now" : `Last seen ${when}`]; |   const parts = [`Last seen ${when}`];
// @mutate src/components/profile/sessionSeenWords.ts |   return parts.join(" · "); |   return parts.join("· ");
// @mutate src/components/profile/SecurityTab.tsx | {sessionSeenWords({ isThisDevice, lastSeenAt | {sessionSeenWords({ isThisDevice: false, lastSeenAt
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "@/test/helpers/blankNonCode";
import { sessionSeenWords } from "./sessionSeenWords";

const NOW = Date.parse("2026-11-02T12:00:00Z");
const OCT20 = "2026-10-20T15:00:00Z";

describe("sessionSeenWords (Q2649)", () => {
  it("the device in use reads Active now, however old its last sign-in", () => {
    expect(sessionSeenWords({ isThisDevice: true, lastSeenAt: OCT20, count: 22, now: NOW })).toBe("Active now · 22 sign-ins");
  });
  it("another device keeps its last-seen time", () => {
    expect(sessionSeenWords({ isThisDevice: false, lastSeenAt: OCT20, count: 1, now: NOW })).toBe("Last seen Oct 20");
    expect(sessionSeenWords({ isThisDevice: false, lastSeenAt: NOW - 3 * 86_400_000, count: 2, now: NOW })).toBe("Last seen 3d ago · 2 sign-ins");
  });
  it("every part is joined by a real space on both sides of the dot", () => {
    const line = sessionSeenWords({ isThisDevice: false, lastSeenAt: OCT20, ipAddress: "10.0.0.1", count: 22, now: NOW });
    expect(line).toBe("Last seen Oct 20 · 10.0.0.1 · 22 sign-ins");
    expect(line).not.toMatch(/\S·|·\S/);
  });
  it("SecurityTab builds the line with it, passing whether the row is this device", () => {
    const src = blankComments(readFileSync(resolve(__dirname, "SecurityTab.tsx"), "utf8"));
    expect(src).toMatch(/sessionSeenWords\(\{\s*isThisDevice,/);
    expect(src).not.toMatch(/Last seen \{/);
    expect(src.match(/sessionSeenWords\(/g)?.length ?? 0).toBeGreaterThan(0);
  });
});
