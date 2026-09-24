/**
 * ED-002: auth-email-hook failed silently to ops — no Slack alert on a missing
 * secret, a bad signature, a bad payload, an unknown email type, a failed
 * enqueue or a thrown handler. A systemic failure there blocks every signup
 * confirmation and password reset. Every console.error in the hook is a
 * failure branch, and each must raise an alert on the next line.
 *
 * @mutate supabase/functions/auth-email-hook/index.ts | await alertAuthEmail('enqueue failed', | void ('enqueue failed',
 * @mutate supabase/functions/auth-email-hook/index.ts | await alertAuthEmail('secret missing', | void ('secret missing',
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const lines = readFileSync("supabase/functions/auth-email-hook/index.ts", "utf8").split("\n");
const failures = lines.flatMap((l, i) => (/^\s*console\.error\(/.test(l) ? [i] : []));

describe("auth-email-hook alerts ops on every failure (ED-002)", () => {
  it("the inventory is real", () => expect(failures.length).toBeGreaterThanOrEqual(6));
  it("each console.error is followed by an alert", () => {
    const silent = failures.filter((i) => !/await alertAuthEmail\(/.test(lines[i + 1] ?? "")).map((i) => `line ${i + 1}`);
    expect(silent).toEqual([]);
  });
});
