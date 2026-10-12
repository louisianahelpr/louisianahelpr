// @mutate scripts/prune-stale-claims.mjs | export const STALE_CLAIM_HOURS = 6; | export const STALE_CLAIM_HOURS = 8;
// @mutate scripts/prune-stale-claims.mjs |     if (c.aheadBy > 0) return row("KEEP" |     if (false) return row("KEEP"
// @mutate scripts/prune-stale-claims.mjs |     const pr = openPrs.find((p) => mentions(p.title, token) \|\| mentions(p.body, token) \|\| mentions(p.head, token)); |     const pr = openPrs.find((p) => mentions(p.title, token));
// @mutate scripts/prune-stale-claims.mjs |   return new RegExp(`(^\|[^A-Za-z0-9])${esc}(?![A-Za-z0-9])`, "i").test(String(text ?? "")); |   return String(text ?? "").includes(token);
// @mutate scripts/prune-stale-claims.mjs |     const claimedMs = Math.max(Date.parse(c.tipDate) \|\| 0, Date.parse(c.lastActivity ?? "") \|\| 0); |     const claimedMs = Date.parse(c.tipDate) \|\| 0;
// @mutate .github/workflows/branch-prune.yml |         run: node scripts/prune-stale-claims.mjs --apply |         run: node scripts/prune-stale-claims.mjs
/*
 * Stale claims (owner, 2026-10-12: "make sure nothing can be messed up so we
 * can finish the open list smoothly"). A lane claims Q<n> by pushing
 * `claim/Q<n>`; one that dies leaves the item claimed for good.
 * scripts/prune-stale-claims.mjs (branch-prune.yml, every 6 h) deletes a claim
 * that is over 6 h old, that no open PR mentions, and that carries nothing
 * beyond main. Measured live 2026-10-12 ~04Z (dry run): 8 claim branches on
 * origin, all under 1 h old.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { decideClaims, mentions, STALE_CLAIM_HOURS } from "../../scripts/prune-stale-claims.mjs";

const ROOT = join(__dirname, "..", "..");
const NOW = Date.parse("2026-10-12T12:00:00Z");
const hoursAgo = (h: number) => new Date(NOW - h * 3_600_000).toISOString();
const claim = (name: string, h: number, extra: Partial<{ lastActivity: string | null; aheadBy: number; tipDate: string }> = {}) => ({
  name,
  sha: "a".repeat(40),
  tipDate: hoursAgo(h),
  lastActivity: hoursAgo(h),
  aheadBy: 0,
  ...extra,
});
const decide = (c: ReturnType<typeof claim>, prs: { number: number; title: string; body: string | null; head: string }[] = []) =>
  decideClaims([c], prs, NOW)[0];

describe("stale claim/* branches", () => {
  it("is six hours", () => {
    expect(STALE_CLAIM_HOURS).toBe(6);
  });

  it("deletes a 7-hour claim no open PR mentions", () => {
    expect(decide(claim("claim/Q1287", 7)).decision).toBe("DELETE");
  });

  it("keeps a 5-hour claim", () => {
    expect(decide(claim("claim/Q1287", 5)).decision).toBe("KEEP");
  });

  it("claim time is the newest of the tip date and the ref's last push (a claim at an old main commit is fresh)", () => {
    expect(decide(claim("claim/Q1287", 30, { lastActivity: hoursAgo(1) })).decision).toBe("KEEP");
    expect(decide(claim("claim/Q1287", 30, { lastActivity: null })).decision).toBe("DELETE");
  });

  it("keeps a stale claim an open PR mentions in its title, body or head branch", () => {
    const c = claim("claim/Q1287", 9);
    expect(decide(c, [{ number: 5, title: "fix(x): Q1287 lands", body: null, head: "agent/x" }]).decision).toBe("KEEP");
    expect(decide(c, [{ number: 5, title: "fix(x)", body: "Closes the work of q1287.", head: "agent/x" }]).decision).toBe("KEEP");
    expect(decide(c, [{ number: 5, title: "fix(x)", body: "", head: "lane/q1287-fix" }]).decision).toBe("KEEP");
  });

  it("a PR naming a different Q does not keep it (Q12 is not Q1287, Q1287 is not Q12870)", () => {
    expect(mentions("Q12870 and Q128", "Q1287")).toBe(false);
    expect(mentions("(Q1287)", "Q1287")).toBe(true);
    expect(decide(claim("claim/Q1287", 9), [{ number: 5, title: "Q12870", body: "Q128", head: "x" }]).decision).toBe("DELETE");
  });

  it("never deletes a claim branch that carries commits main does not have", () => {
    expect(decide(claim("claim/Q1287", 9, { aheadBy: 2 })).decision).toBe("KEEP");
  });

  it("an unreadable claim time is kept", () => {
    expect(decide(claim("claim/Q1287", 9, { tipDate: "", lastActivity: null })).decision).toBe("KEEP");
  });

  it("branch-prune runs it with --apply on every run", () => {
    const wf = parse(readFileSync(join(ROOT, ".github/workflows/branch-prune.yml"), "utf8"));
    const step = (wf.jobs.prune.steps as { run?: string; if?: string }[]).find((s) => String(s.run).includes("prune-stale-claims.mjs"));
    expect(step?.run).toBe("node scripts/prune-stale-claims.mjs --apply");
    expect(step?.if).toBe("always()");
  });
});
