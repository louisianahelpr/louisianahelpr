/*
 * The owner-decision inbox (scripts/owner-needed.mjs): one question is filed
 * once per Q number, in plain words, with the recommended option first.
 *
 * @mutate scripts/owner-needed.mjs | return issues.find((i) => (i.body ?? "").includes(m)); | return undefined;
 * @mutate scripts/owner-needed.mjs | if (bad.length) return | if (false) return
 * @mutate scripts/owner-needed.mjs | "RLS", "RPC", "migration", "idempotent", "webhook", "digest", | "RLS",
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { checkQuestion, buildBody, findDuplicate, jargonIn, normalizeQ, JARGON } from "../../scripts/owner-needed.mjs";

const ROOT = resolve(__dirname, "..", "..");
const ok = { q: "Q12", title: "Should we refund the customer in full?", options: ["Refund in full", "Refund half"] };

describe("owner-needed inbox", () => {
  it("never files the same Q number twice, however it is written", () => {
    const filed = [{ number: 5, body: buildBody(ok) }];
    expect(findDuplicate(filed, "Q12")).toBeDefined();
    expect(findDuplicate(filed, "12")).toBeDefined();
    expect(findDuplicate(filed, "q12")).toBeDefined();
    expect(findDuplicate(filed, "Q120")).toBeUndefined();
    expect(findDuplicate([], "Q12")).toBeUndefined();
    expect(normalizeQ("nope")).toBeNull();
  });

  it("puts the recommended option first and names the Q", () => {
    const body = buildBody(ok);
    expect(body).toContain("Q12");
    expect(body.indexOf("**Recommended:** Refund in full")).toBeLessThan(body.indexOf("Refund half"));
  });

  it("accepts a plain question and rejects malformed ones", () => {
    expect(checkQuestion(ok)).toBeNull();
    expect(checkQuestion({ ...ok, q: "soon" })).toMatch(/Q number/);
    expect(checkQuestion({ ...ok, title: "Refund them" })).toMatch(/question/);
    expect(checkQuestion({ ...ok, options: ["only one"] })).toMatch(/2 or 3/);
  });

  it("rejects jargon unless it is explained in brackets right after", () => {
    expect(JARGON.length).toBeGreaterThan(10);
    for (const t of ["RLS", "RPC", "migration", "idempotent", "webhook", "digest"]) {
      expect(checkQuestion({ ...ok, title: `Is the ${t} safe to turn on?` })).toMatch(/plain words/);
      expect(checkQuestion({ ...ok, options: [`Use the ${t}`, "Skip"] })).toMatch(/plain words/);
    }
    expect(jargonIn("Send the daily digest (a once-a-day summary email) at 8am?")).toEqual([]);
    expect(jargonIn("Send the daily summary email at 8am?")).toEqual([]);
    expect(jargonIn("Is a digestive biscuit fine?")).toEqual([]);
  });

  it("the agent brief tells lanes to file here", () => {
    const brief = readFileSync(resolve(ROOT, ".claude/AGENT-BRIEF.md"), "utf8");
    expect(brief).toMatch(/node scripts\/owner-needed\.mjs file/);
  });
});
