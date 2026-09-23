/**
 * CLASS GUARD: every problem a person reports becomes an ops alert ledger item
 * (docs/OPEN.md Q64). "Nothing a user reports can sit unseen."
 *
 * THE CLASS, derived from source, two-way:
 *   1. Every client or edge WRITE to a report-shaped table
 *      (`.from("<t>")...insert/upsert` where <t> names a report, support,
 *      ticket, feedback, complaint, bug or nps store), every invoke of a
 *      report-shaped edge function, and every `/support?topic=` entry point
 *      (shake-to-report, the ban-appeal link) is listed in SURFACES below with
 *      the channel that carries it — and every listed surface is still in
 *      its file. A new reporting surface fails here until someone says how it
 *      reaches the ledger.
 *   2. Each channel's routing is read from the NEWEST definitions:
 *      reports-table   — an AFTER INSERT trigger on public.reports whose
 *                        function calls ops_alert_record_user_report, which
 *                        records source_kind 'user-report' with sql_condition,
 *                        a link back to the admin queue and the report id; and
 *                        ops_alert_condition's 'user-report' branch re-asks
 *                        public.reports (closes only when the queue is done).
 *      contact-support — the edge function records a guest (no reports row)
 *                        straight into the ledger as 'user-report', and a
 *                        signed-in sender through the reports table.
 *      support-redirect — lands on a page registered as contact-support.
 *      not-a-report    — stated reason required (NPS scores are a survey).
 *   Behaviour is proven in src/test/pglite/userReportsLedger.pglite.mjs
 *   (ALL PASS on the fix; 31 FAIL with NEW_MIGRATION=skip; 5 FAIL with the
 *   flood cap removed).
 *
 * @mutate supabase/migrations/20260923171651_user_reports_reach_the_ledger.sql | AFTER INSERT ON public.reports | AFTER UPDATE ON public.reports
 * @mutate supabase/migrations/20260923171651_user_reports_reach_the_ledger.sql |     'user-report',\n    'user-report',\n    v_title, |     'error_logs',\n    'user-report',\n    v_title,
 * @mutate supabase/functions/contact-support/index.ts | sourceKind: 'user-report', | sourceKind: 'edge_slack',
 * @mutate src/lib/nps.ts | supabase.from("nps_responses").insert({ | supabase.from("feedback_reports").insert({
 * @mutate supabase/migrations/20260923171651_user_reports_reach_the_ledger.sql | IF v_mine >= 5 OR v_all >= 20 THEN | IF false THEN
 * @mutate supabase/functions/contact-support/index.ts | title: `Support (${userId ? 'queue insert failed' : 'guest'}) [${topicLabel}]`, | title: `Support [${topicLabel}] ${subject}`,
 * @mutate src/main.tsx | "/support?topic=report&from=shake" | "/help?topic=report&from=shake"
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";
import { latestFunctionDefs } from "./helpers/rpcErrorInventory";

const ROOT = process.cwd();
const MIGRATIONS = join(ROOT, "supabase", "migrations");

type Channel = "reports-table" | "contact-support" | "support-redirect" | "not-a-report";
type Surface = { file: string; kind: "write" | "invoke" | "entry"; target: string; channel: Channel; note: string };

/** Every reporting surface in the app. Two-way with the source scan below. */
export const SURFACES: Surface[] = [
  { file: "src/components/ReportDialog.tsx", kind: "write", target: "reports", channel: "reports-table",
    note: "report a job / message / user / review" },
  { file: "src/components/profile/SupportInline.tsx", kind: "write", target: "reports", channel: "reports-table",
    note: "Profile support tab: message, suggestion, issue report (+screenshot), other" },
  { file: "supabase/functions/contact-support/index.ts", kind: "write", target: "reports", channel: "reports-table",
    note: "/support signed in: the admin-queue row" },
  { file: "src/pages/Support.tsx", kind: "invoke", target: "contact-support", channel: "contact-support",
    note: "/support, signed in or guest" },
  { file: "src/main.tsx", kind: "entry", target: "/support?topic=", channel: "support-redirect",
    note: "shake-to-report opens /support?topic=report" },
  { file: "src/components/activity/appliedJobCard/DisputedSection.tsx", kind: "entry", target: "/support?topic=", channel: "support-redirect",
    note: "a disputed job's contact-support link (helper side)" },
  { file: "src/components/activity/postedJobCard/steps/DisputedStep.tsx", kind: "entry", target: "/support?topic=", channel: "support-redirect",
    note: "a disputed job's contact-support link (poster side)" },
  { file: "src/pages/AccountBanned.tsx", kind: "entry", target: "/support?topic=", channel: "support-redirect",
    note: "suspension appeal opens /support?topic=message" },
  { file: "src/lib/nps.ts", kind: "write", target: "nps_responses", channel: "not-a-report",
    note: "NPS is a 1-5 survey with an optional comment, not a problem report; read on /admin analytics" },
];

const REPORT_SHAPED = /report|support|ticket|feedback|complaint|bug|nps/i;

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    if (e === "node_modules" || e.startsWith(".")) continue;
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(tsx?|mjs)$/.test(e) && !/\.(test|spec)\.tsx?$/.test(e) && !p.includes(`${join("src", "test")}`)) out.push(p);
  }
  return out;
}

/** What the tree actually has, as "file|kind|target". */
function scan(): Set<string> {
  const found = new Set<string>();
  const files = [...walk(join(ROOT, "src")), ...walk(join(ROOT, "supabase", "functions"))];
  for (const abs of files) {
    const file = relative(ROOT, abs);
    const src = blankComments(readFileSync(abs, "utf8"));
    for (const m of src.matchAll(/\.from\(\s*["'`]([\w-]+)["'`]\s*\)/g)) {
      const table = m[1];
      if (!REPORT_SHAPED.test(table)) continue;
      // The chain this .from() starts, up to its statement end.
      const tail = src.slice(m.index! + m[0].length, m.index! + m[0].length + 400).split(/;\s*\n/)[0];
      if (/^\s*(?:\.\w+\([^)]*\)\s*)*?\.(?:insert|upsert)\(/.test(tail) || /^\s*\.(?:insert|upsert)\(/.test(tail))
        found.add(`${file}|write|${table}`);
    }
    for (const m of src.matchAll(/functions\.invoke\(\s*["'`]([\w-]+)["'`]/g))
      if (REPORT_SHAPED.test(m[1])) found.add(`${file}|invoke|${m[1]}`);
    for (const m of src.matchAll(/functions\/v1\/([\w-]+)/g))
      if (REPORT_SHAPED.test(m[1])) found.add(`${file}|invoke|${m[1]}`);
    if (/["'`]\/support\?topic=/.test(src)) found.add(`${file}|entry|/support?topic=`);
  }
  return found;
}

const key = (s: Surface) => `${s.file}|${s.kind}|${s.target}`;

describe("every user-reported problem reaches the ops alert ledger (Q64)", () => {
  const found = scan();
  const listed = new Set(SURFACES.map(key));

  it("the scan sees a real inventory (floor)", () => {
    expect(found.size).toBeGreaterThan(5);
  });

  it("every reporting surface in source is listed with its channel", () => {
    const unlisted = [...found].filter((k) => !listed.has(k));
    expect(unlisted, "new reporting surface(s): add each to SURFACES with the channel that carries it to the ledger").toEqual([]);
  });

  it("every listed surface is still in its file (the list is exact)", () => {
    const stale = [...listed].filter((k) => !found.has(k));
    expect(stale, "listed surface(s) no longer in source: remove or fix them").toEqual([]);
  });

  it("not-a-report entries say why", () => {
    for (const s of SURFACES.filter((x) => x.channel === "not-a-report")) expect(s.note.length).toBeGreaterThan(30);
  });

  const defs = latestFunctionDefs(MIGRATIONS);

  it("reports-table: the newest trigger on public.reports records every INSERT into the ledger", () => {
    // Latest CREATE/DROP per trigger name on public.reports.
    const triggers = new Map<string, string | null>();
    for (const f of readdirSync(MIGRATIONS).filter((x) => x.endsWith(".sql")).sort()) {
      const sql = blankSqlComments(readFileSync(join(MIGRATIONS, f), "utf8"));
      for (const m of sql.matchAll(/(CREATE|DROP)\s+TRIGGER\s+(?:IF\s+EXISTS\s+)?(\w+)\s+([\s\S]*?);/gi)) {
        if (!/\bON\s+(?:public\.)?reports\b/i.test(m[3])) continue;
        if (m[1].toUpperCase() === "DROP") { triggers.set(m[2], null); continue; }
        if (!/AFTER\s+INSERT\b/i.test(m[3])) { triggers.set(m[2], null); continue; }
        triggers.set(m[2], /EXECUTE\s+(?:FUNCTION|PROCEDURE)\s+(?:public\.)?(\w+)/i.exec(m[3])?.[1]?.toLowerCase() ?? null);
      }
    }
    const routing = [...triggers.values()].filter((fn): fn is string =>
      !!fn && /ops_alert_record_user_report\s*\(/.test(defs.get(fn)?.body ?? ""));
    expect(routing, "no AFTER INSERT trigger on public.reports calls ops_alert_record_user_report").toHaveLength(1);
  });

  it("reports-table: ops_alert_record_user_report records a 'user-report' item with a link back and a close rule", () => {
    const body = (defs.get("ops_alert_record_user_report")?.body ?? "").replace(/\s+/g, " ");
    expect(body).toMatch(/ops_alert_record\( 'user-report', 'user-report',/);
    expect(body).toContain("'report_id'");
    expect(body).toContain("'link'");
    expect(body).toMatch(/'sql_condition', 'user-report'/);
    expect(body, "seed reporters are skipped, real ones never").toMatch(/user_report_is_real\(/);
    // Flood cap (authz review): a NEW item is refused past 5/reporter or 20
    // overall per hour and folded into ONE overflow item.
    expect(body).toMatch(/IF v_mine >= 5 OR v_all >= 20 THEN/);
    expect(body).toMatch(/'overflow', true/);
  });

  it("reports-table: the close rule re-asks the admin queue (public.reports), not the ledger", () => {
    const body = defs.get("ops_alert_condition")?.body ?? "";
    const at = body.indexOf("p_source = 'user-report'");
    expect(at, "ops_alert_condition has no 'user-report' branch").toBeGreaterThan(-1);
    const branch = body.slice(at, body.indexOf("ELSIF", at + 10));
    expect(branch).toMatch(/FROM public\.reports/);
    expect(branch).toMatch(/user_report_is_open\(/);
  });

  it("contact-support: a guest (no reports row) is recorded straight into the ledger as 'user-report'", () => {
    const src = blankComments(readFileSync(join(ROOT, "supabase/functions/contact-support/index.ts"), "utf8"));
    const guard = src.indexOf("if (!reportLogged)");
    expect(guard, "no ledger record for a submission that has no reports row").toBeGreaterThan(-1);
    const block = src.slice(guard, guard + 900);
    expect(block).toMatch(/recordOpsAlertLedger\(/);
    expect(block).toMatch(/sourceKind: 'user-report'/);
    // The endpoint is unauthenticated: the fingerprint (title) must not carry
    // caller text, or anyone can mint unbounded items. One item per topic.
    const title = /title: (`[^`]*`)/.exec(block)?.[1] ?? "";
    expect(title, "guest ledger title").toMatch(/topicLabel/);
    expect(title, "guest ledger title carries caller-typed text").not.toMatch(/subject|message|name|email/);
    expect(src.indexOf("from('reports').insert"), "signed-in senders still get the admin-queue row").toBeGreaterThan(-1);
    expect(src.indexOf("from('reports').insert")).toBeLessThan(guard);
  });

  it("support-redirect: every /support?topic= entry lands on the page that invokes contact-support", () => {
    const supportPage = SURFACES.find((s) => s.channel === "contact-support");
    expect(supportPage?.file).toBe("src/pages/Support.tsx");
    const app = readFileSync(join(ROOT, "src/App.tsx"), "utf8");
    expect(app).toMatch(/path="\/support"/);
  });
});
