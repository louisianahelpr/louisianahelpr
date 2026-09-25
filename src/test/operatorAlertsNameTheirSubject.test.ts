// @mutate supabase/functions/process-scheduled-payouts/index.ts | payout cannot proceed. PI status: ${pi.status}.`,\n                  type: "admin_alert", link: `/admin?view=jobs&job=${job.id}`, | payout cannot proceed. PI status: ${pi.status}.`,\n                  type: "admin_alert", link: "/admin",
// @mutate supabase/functions/auto-resolve-disputes/index.ts |             link: `/admin?view=jobs&job=${job.id}`, |             link: "/admin",
// @mutate supabase/functions/auto-resolve-disputes/index.ts | `/admin?view=disputes&job=${job.id}`,\n        `unsettleable dispute reminder job | `/admin?view=disputes`,\n        `unsettleable dispute reminder job
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import ts from "typescript";
import { walkSource } from "./helpers/walkSource";

/**
 * Q2 follow-up: every operator alert (notifications.type admin_alert or
 * system_alert) written from TypeScript names its SUBJECT in its link.
 *
 * send-push-notification mirrors an operator alert to #ops-alerts when the
 * admin has no push token. It decides seed vs real from the subject the link
 * names (alertSubjectFromLink: `job=<uuid>`, `job_id=`, `/jobs/<uuid>`,
 * `user=<uuid>`), and a link naming none is treated as REAL, so an alert about
 * a seed (E2E) job pages the channel. Its once-per-day key is title + link, so
 * with a bare "/admin" link two DIFFERENT failed payouts on one day post once
 * and the second is swallowed. On 2026-09-25 six sites linked "/admin":
 * release-payout x3, process-scheduled-payouts x2 ("Scheduled payout failed",
 * "Payout blocked"), auto-resolve-disputes ("Dispute auto-resolved").
 *
 * INVENTORY: the TypeScript AST of every non-test file in src/ and
 * supabase/functions. An object literal with `type: "admin_alert"` or
 * `type: "system_alert"` is an operator alert. Its `link` must be a template
 * or string naming a subject. A link that is a bare identifier (a helper's
 * parameter, like auto-resolve-disputes' remindAdmins) passes only if every
 * call to that function in the same file passes a subject-bearing link at
 * that parameter's position.
 *
 * SQL producers are held by src/test/notificationProducersCarryTheirSubject
 * (Q139), not here.
 */

const ROOT = resolve(__dirname, "../..");
const SUBJECT = /[?&](?:job|job_id|user|user_id)=\$\{|\/jobs?\/\$\{/;

function namesSubject(e: ts.Expression | undefined, sf: ts.SourceFile): boolean {
  if (!e) return false;
  if (ts.isNoSubstitutionTemplateLiteral(e) || ts.isStringLiteral(e)) return false; // a constant names no row
  if (ts.isTemplateExpression(e)) return SUBJECT.test(e.getText(sf));
  return false;
}

interface Site { where: string; ok: boolean; why: string }

function operatorAlertSites(): Site[] {
  const sites: Site[] = [];
  for (const file of walkSource([resolve(ROOT, "src"), resolve(ROOT, "supabase/functions")])) {
    if (/\.test\.|__tests__|\/test\//.test(file)) continue;
    const text = readFileSync(file, "utf8");
    if (!/admin_alert|system_alert/.test(text)) continue;
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    const rel = relative(ROOT, file);
    const visit = (n: ts.Node) => {
      if (ts.isObjectLiteralExpression(n)) {
        const props = new Map<string, ts.Expression>();
        let shorthandLink = false;
        for (const p of n.properties) {
          if (ts.isPropertyAssignment(p) && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name))) props.set(p.name.text, p.initializer);
          if (ts.isShorthandPropertyAssignment(p) && p.name.text === "link") shorthandLink = true;
        }
        const type = props.get("type");
        if (type && ts.isStringLiteralLike(type) && /^(admin_alert|system_alert)$/.test(type.text)) {
          const where = `${rel}:${sf.getLineAndCharacterOfPosition(n.getStart()).line + 1}`;
          const link = props.get("link");
          if (namesSubject(link, sf)) sites.push({ where, ok: true, why: "link names a subject" });
          else if (shorthandLink || (link && ts.isIdentifier(link))) {
            sites.push({ where, ...passThrough(n, shorthandLink ? "link" : (link as ts.Identifier).text, sf) });
          } else sites.push({ where, ok: false, why: `link ${link ? link.getText(sf) : "(none)"} names no subject` });
        }
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
  }
  return sites;
}

/** `link` is a parameter of the enclosing function: every same-file call must pass a subject there. */
function passThrough(node: ts.Node, name: string, sf: ts.SourceFile): { ok: boolean; why: string } {
  let fn: ts.Node | undefined = node.parent;
  while (fn && !((ts.isFunctionDeclaration(fn) || ts.isFunctionExpression(fn) || ts.isArrowFunction(fn))
    && fn.parameters.some((p) => ts.isIdentifier(p.name) && p.name.text === name))) fn = fn.parent;
  if (!fn || !(ts.isFunctionDeclaration(fn) && fn.name)) return { ok: false, why: `link \`${name}\` is not a named function's parameter` };
  const fnName = fn.name.text;
  const index = fn.parameters.findIndex((p) => ts.isIdentifier(p.name) && p.name.text === name);
  const calls: ts.CallExpression[] = [];
  const visit = (n: ts.Node) => {
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === fnName) calls.push(n);
    ts.forEachChild(n, visit);
  };
  visit(sf);
  const bad = calls.filter((c) => !namesSubject(c.arguments[index], sf));
  if (calls.length === 0) return { ok: false, why: `${fnName} is never called` };
  return bad.length
    ? { ok: false, why: `${fnName} called without a subject link at ${bad.map((c) => sf.getLineAndCharacterOfPosition(c.getStart()).line + 1).join(", ")}` }
    : { ok: true, why: `all ${calls.length} ${fnName} calls pass a subject` };
}

describe("operator alerts name their subject (Q2)", () => {
  const sites = operatorAlertSites();

  it("the inventory is real", () => {
    // release-payout x3, process-scheduled-payouts x2, auto-resolve-disputes x2,
    // create-payment, void-cancelled-payments, complete-signup, stripe-idv-webhook.
    expect(sites.length).toBeGreaterThan(9);
  });

  it("every operator alert's link names the job or user it is about", () => {
    expect(sites.filter((s) => !s.ok).map((s) => `${s.where}: ${s.why}`)).toEqual([]);
  });
});
