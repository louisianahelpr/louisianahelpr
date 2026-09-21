/**
 * A person asking for help must not wait for tomorrow's digest.
 *
 * 20260914183932 made #ops-alerts critical-only: anything not critical is
 * recorded in error_logs and summarised once a day at 14:40 UTC. `contact-support`
 * posted its alert as `kind: 'custom', severity: 'info'`, so from that commit a
 * support request sent at 15:00 reached the channel almost 24 hours later. The
 * support email still went out immediately — this is about the channel the owner
 * actually watches.
 *
 * The fix is a kind of its own: `support_request` is in ALWAYS_POST_KINDS (posts
 * now) and deliberately NOT in CRITICAL_KINDS (keeps ℹ️ wording and colour, so a
 * page still means something is broken), deduped per request.
 *
 * RED before the fix: with contact-support at `kind: 'custom', severity: 'info'`,
 * "the support alert posts immediately" fails — postsImmediately('info','custom')
 * is false. Reproduced by pointing SUPPORT_ALERT_FUNCTIONS_DIR at a pre-fix
 * checkout, exactly as alertPolicy.test.ts does with ALERT_POLICY_FUNCTIONS_DIR.
 */
// The registered mutation is the COMMENT shape, not the plain one: downgrading
// the alert to `custom` while the original survives as a comment is what the
// old regex reader could not see. Killing this kills the plain form too.
// @mutate supabase/functions/contact-support/index.ts | kind: 'support_request', | // kind: 'support_request',\n      kind: 'custom',
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import {
  ALWAYS_POST_KINDS,
  CRITICAL_KINDS,
  effectiveSeverity,
  postsImmediately,
  supportRequestKey,
} from "../../supabase/functions/_shared/alertPolicy";

const FUNCTIONS = process.env.SUPPORT_ALERT_FUNCTIONS_DIR ?? join(process.cwd(), "supabase", "functions");
const CONTACT_SUPPORT = join(FUNCTIONS, "contact-support", "index.ts");

/**
 * The literal `kind`/`severity` of contact-support's ops alert, read from its
 * source. Deliberately a local reader rather than an import from
 * alertPolicy.test.ts: importing that file would re-run its whole suite here.
 *
 * READ THROUGH THE AST, NOT A REGEX OVER TEXT. This was
 * `/kind:\s*["']([\w_]+)["']/` over the call's brace-matched body, and it was
 * HOLLOW (proved 2026-09-21): downgrading the live call to `kind: 'custom'`
 * while leaving `// kind: 'support_request',` above it passed 5/5 — a support
 * request silently back on the once-a-day digest, green. The comment supplied
 * the first match. A property assignment in the object literal cannot be a
 * comment.
 */
function supportCall(): { kind: string | null; severity: string | null; oncePerDayKey: string | null } {
  const s = readFileSync(CONTACT_SUPPORT, "utf8");
  const sf = ts.createSourceFile(CONTACT_SUPPORT, s, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const calls: ts.CallExpression[] = [];
  const visit = (n: ts.Node) => {
    if (ts.isCallExpression(n) && n.expression.getText() === "postSlackOpsAlert") calls.push(n);
    ts.forEachChild(n, visit);
  };
  visit(sf);
  expect(calls.length, "contact-support posts exactly one ops alert").toBe(1);
  const arg = calls[0].arguments[0];
  expect(!!arg && ts.isObjectLiteralExpression(arg), "the ops alert is not called with an object literal").toBe(true);
  const props = (arg as ts.ObjectLiteralExpression).properties;
  const prop = (key: string) =>
    props.find((p): p is ts.PropertyAssignment => ts.isPropertyAssignment(p) && p.name.getText() === key);
  const lit = (key: string) => {
    const init = prop(key)?.initializer;
    if (!init) return null;
    return ts.isStringLiteral(init) || ts.isNoSubstitutionTemplateLiteral(init) ? init.text : null;
  };
  return { kind: lit("kind"), severity: lit("severity"), oncePerDayKey: prop("oncePerDayKey")?.initializer.getText() ?? null };
}

describe("support requests reach #ops-alerts the same day", () => {
  it("the support alert posts immediately", () => {
    const call = supportCall();
    const severity = effectiveSeverity(call.kind ?? undefined, call.severity ?? undefined);
    expect(postsImmediately(severity, call.kind ?? undefined), `${call.kind}/${call.severity} waits for the digest`).toBe(true);
  });

  it("…without being dressed as a page", () => {
    const call = supportCall();
    expect(call.kind).toBe("support_request");
    expect([...CRITICAL_KINDS]).not.toContain("support_request");
    expect(effectiveSeverity(call.kind!, call.severity ?? undefined)).toBe("info");
  });

  it("…and is deduped per request", () => {
    // The AST's own initializer text, so a commented-out `oncePerDayKey:` line
    // cannot stand in for a live one (see supportCall's note).
    expect(supportCall().oncePerDayKey, "the alert does not dedupe on the request").toMatch(/^supportRequestKey\(/);
  });

  it("only these kinds bypass the critical-only rule", () => {
    expect([...ALWAYS_POST_KINDS].sort()).toEqual(["digest", "support_request"]);
    expect(postsImmediately("info", "support_request")).toBe(true);
    expect(postsImmediately("info", "custom")).toBe(false);
    expect(postsImmediately("warning", "custom")).toBe(false);
  });

  it("the dedupe key is the request, not the sender and not the day", () => {
    const req = { email: "Ada@example.com", subject: "Payout missing", message: "I finished a job on Tuesday." };
    // A double-tapped Send: identical content, incidental whitespace and case.
    expect(supportRequestKey(req)).toBe(
      supportRequestKey({ email: "ada@example.com ", subject: "  Payout missing", message: "I finished a job on   Tuesday." }),
    );
    // Same person, a second, different problem: a different request.
    expect(supportRequestKey(req)).not.toBe(supportRequestKey({ ...req, message: "Also my photos will not upload." }));
    // Same text from someone else: also a different request.
    expect(supportRequestKey(req)).not.toBe(supportRequestKey({ ...req, email: "rex@example.com" }));
    // A guest sends no account: still a stable key, never a throw.
    expect(supportRequestKey({ email: null, subject: null, message: null })).toMatch(/^support-request:[0-9a-f]{8}$/);
  });
});
