/**
 * Guard: nothing posts to Slack without also writing the ops alert ledger.
 *
 * Owner standing order (2026-09-23, CLAUDE.md): every alert, from anywhere, is
 * fixed AND verified fixed. "Posted is not handled." A Slack message scrolls
 * away; the ledger (`public.ops_alert_ledger`, docs/OPEN.md Q1) is what keeps
 * an alert OPEN until its own detector shows it cleared. So a path that posts
 * to Slack and skips the ledger is an alert nobody is tracking.
 *
 * The class, derived from the tree rather than listed from memory:
 *   1. supabase/functions — any file holding a Slack transport token
 *      (hooks.slack.com, slack.com/api, chat.postMessage, SLACK_WEBHOOK_URL,
 *      SLACK_API_KEY) must be one of the two TRANSPORTS, and each transport
 *      must call `recordOpsAlertLedger(` (_shared/opsAlertLedger.ts, which
 *      calls rpc/ops_alert_record). Every edge caller goes through
 *      postSlackOpsAlert, every SQL caller through the slack-ops-alert
 *      function, so recording there covers them all.
 *   2. supabase/migrations — no raw Slack URL in SQL (it would bypass both
 *      transports), and error_logs must feed the ledger: some migration puts
 *      an AFTER INSERT trigger on public.error_logs whose function calls
 *      ops_alert_record.
 *   3. .github/workflows — every step that reads secrets.SLACK_WEBHOOK_URL also
 *      runs `ops-alert-ledger.mjs record`, or runs a repo script that calls
 *      recordOpsAlert (EXEMPT: slack-test.yml, a manual delivery test that is
 *      not an alert).
 *   4. scripts — a script that posts to Slack calls recordOpsAlert.
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const SLACK_TOKEN = /hooks\.slack\.com|slack\.com\/api|chat\.postMessage|SLACK_WEBHOOK_URL|SLACK_API_KEY/;
const RAW_SLACK_URL = /hooks\.slack\.com|slack\.com\/api/;

export const TRANSPORTS = [
  "supabase/functions/_shared/slack-alerts.ts",
  "supabase/functions/slack-ops-alert/index.ts",
];
const LEDGER_HELPER = "supabase/functions/_shared/opsAlertLedger.ts";
const WORKFLOW_EXEMPT: Record<string, string> = {
  "slack-test.yml": "manual delivery test of the webhook; posts no alert",
};
const WORKFLOW_MARKER = /ops-alert-ledger\.mjs record/;

function walk(dir: string, keep: (f: string) => boolean): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (name === "node_modules") continue;
    if (statSync(p).isDirectory()) out.push(...walk(p, keep));
    else if (keep(p)) out.push(p);
  }
  return out;
}

/** Split a workflow into rough step blocks (same shape as slackAlertWorkflows.test.ts). */
function steps(src: string): string[] {
  const out: string[] = [];
  let cur: string[] | null = null;
  let indent = -1;
  for (const line of src.split("\n")) {
    const m = /^(\s*)- (name|uses|run|id|if):/.exec(line);
    if (m && (cur === null || m[1].length <= indent)) {
      if (cur) out.push(cur.join("\n"));
      cur = [line];
      indent = m[1].length;
    } else if (cur) cur.push(line);
  }
  if (cur) out.push(cur.join("\n"));
  return out;
}

export interface Tree {
  functions: Record<string, string>;
  migrations: Record<string, string>;
  workflows: Record<string, string>;
  scripts: Record<string, string>;
}

export function ledgerBypasses(t: Tree): string[] {
  const v: string[] = [];

  // 1. edge functions
  for (const [file, src] of Object.entries(t.functions)) {
    if (!SLACK_TOKEN.test(src)) continue;
    if (!TRANSPORTS.includes(file)) {
      v.push(`${file}: talks to Slack directly; route it through postSlackOpsAlert (which records the ledger)`);
    }
  }
  for (const tr of TRANSPORTS) {
    const src = t.functions[tr];
    if (src === undefined) v.push(`${tr}: Slack transport is missing — update TRANSPORTS`);
    else if (!/recordOpsAlertLedger\(/.test(src)) v.push(`${tr}: posts to Slack but never calls ops_alert_record (recordOpsAlertLedger)`);
  }
  const helper = t.functions[LEDGER_HELPER];
  if (helper === undefined || !/rpc\/ops_alert_record/.test(helper)) {
    v.push(`${LEDGER_HELPER}: missing, or no longer calls rpc/ops_alert_record`);
  }

  // 2. migrations
  for (const [file, src] of Object.entries(t.migrations)) {
    if (RAW_SLACK_URL.test(src)) v.push(`${file}: SQL posts to a raw Slack URL, bypassing slack-ops-alert and the ledger`);
  }
  const all = Object.keys(t.migrations).sort().map((f) => t.migrations[f]).join("\n");
  const trg = [...all.matchAll(/AFTER\s+INSERT\s+ON\s+public\.error_logs[\s\S]{0,200}?EXECUTE\s+(?:FUNCTION|PROCEDURE)\s+public\.(\w+)/gi)];
  const feeds = trg.some((m) => {
    const fn = m[1];
    const defs = [...all.matchAll(new RegExp(`CREATE\\s+OR\\s+REPLACE\\s+FUNCTION\\s+public\\.${fn}\\s*\\([\\s\\S]*?\\$(\\w*)\\$([\\s\\S]*?)\\$\\1\\$`, "gi"))];
    const newest = defs[defs.length - 1];
    return !!newest && /ops_alert_record/.test(newest[2]);
  });
  if (!feeds) v.push("supabase/migrations: no AFTER INSERT trigger on public.error_logs calls ops_alert_record — error_logs rows never reach the ledger");

  // 3. workflows
  for (const [file, src] of Object.entries(t.workflows)) {
    if (WORKFLOW_EXEMPT[file]) continue;
    for (const st of steps(src)) {
      // A step passes by recording itself, or by running a repo script that
      // records (rule 4 checks the script).
      const runsRecorder = [...st.matchAll(/node\s+(scripts\/[\w./-]+\.mjs)/g)].some(
        (m) => m[1] !== "scripts/ops-alert-ledger.mjs" && /recordOpsAlert\(/.test(t.scripts[m[1]] ?? ""),
      );
      if (/secrets\.SLACK_WEBHOOK_URL/.test(st) && !WORKFLOW_MARKER.test(st) && !runsRecorder) {
        const name = /- name:\s*(.*)/.exec(st)?.[1] ?? "(unnamed step)";
        v.push(`${file}: step "${name}" posts to Slack without \`node scripts/ops-alert-ledger.mjs record\``);
      }
    }
  }

  // 4. scripts
  for (const [file, src] of Object.entries(t.scripts)) {
    if (!/SLACK_WEBHOOK_URL|hooks\.slack\.com/.test(src)) continue;
    if (file.endsWith("ops-alert-ledger.mjs") || file.endsWith("opsAlertLedger.mjs")) continue;
    if (!/recordOpsAlert\(/.test(src)) v.push(`${file}: posts to Slack without recordOpsAlert()`);
  }
  return v;
}

function read(dir: string, keep: (f: string) => boolean): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of walk(join(ROOT, dir), keep)) out[relative(ROOT, p)] = readFileSync(p, "utf8");
  return out;
}

function realTree(): Tree {
  const wf: Record<string, string> = {};
  for (const f of readdirSync(join(ROOT, ".github/workflows"))) {
    if (/\.ya?ml$/.test(f)) wf[f] = readFileSync(join(ROOT, ".github/workflows", f), "utf8");
  }
  return {
    functions: read("supabase/functions", (f) => f.endsWith(".ts") && !f.endsWith(".test.ts")),
    migrations: read("supabase/migrations", (f) => f.endsWith(".sql")),
    workflows: wf,
    scripts: read("scripts", (f) => /\.(mjs|js|ts|sh)$/.test(f)),
  };
}

describe("every Slack post also writes the ops alert ledger", () => {
  it("the real tree has no bypass", () => {
    const t = realTree();
    // Floors so an empty inventory cannot pass vacuously.
    expect(Object.keys(t.functions).length).toBeGreaterThanOrEqual(60);
    expect(Object.keys(t.migrations).length).toBeGreaterThanOrEqual(300);
    const slackSteps = Object.values(t.workflows).flatMap((s) => steps(s).filter((st) => /secrets\.SLACK_WEBHOOK_URL/.test(st)));
    expect(slackSteps.length).toBeGreaterThanOrEqual(8);
    expect(ledgerBypasses(t)).toEqual([]);
  });

  it("is able to fail on every rule", () => {
    const base = realTree();
    const t: Tree = {
      functions: {
        ...base.functions,
        "supabase/functions/rogue/index.ts": "await fetch('https://hooks.slack.com/services/x')",
        "supabase/functions/slack-ops-alert/index.ts": "fetch(`${SLACK_API_URL}/chat.postMessage`)",
      },
      migrations: {
        "20990101000000_rogue.sql": "PERFORM net.http_post(url := 'https://hooks.slack.com/services/x');",
      },
      workflows: {
        "rogue.yml": `
jobs:
  a:
    steps:
      - name: Tell Slack
        env:
          SLACK_WEBHOOK_URL: \${{ secrets.SLACK_WEBHOOK_URL }}
        run: curl -X POST "$SLACK_WEBHOOK_URL" || echo "::warning::x"
`,
      },
      scripts: { "scripts/rogue.mjs": "await fetch(process.env.SLACK_WEBHOOK_URL, {method:'POST'})" },
    };
    const v = ledgerBypasses(t);
    expect(v.some((x) => x.startsWith("supabase/functions/rogue/index.ts"))).toBe(true);
    expect(v.some((x) => x.includes("slack-ops-alert/index.ts: posts to Slack but never calls ops_alert_record"))).toBe(true);
    expect(v.some((x) => x.startsWith("20990101000000_rogue.sql"))).toBe(true);
    expect(v.some((x) => x.includes("no AFTER INSERT trigger on public.error_logs"))).toBe(true);
    expect(v.some((x) => x.startsWith('rogue.yml: step "Tell Slack"'))).toBe(true);
    expect(v.some((x) => x.startsWith("scripts/rogue.mjs"))).toBe(true);
  });
});

// PROVEN RED 2026-09-23 on the pre-ledger tree (12 bypasses): both transports
// ("posts to Slack but never calls ops_alert_record"), no error_logs trigger
// feeding the ledger, 8 workflow Slack steps (db-deploy, deploy,
// functions-deploy, main-red-watch, supabase-usage x3, uptime) and
// scripts/storage-orphan-sweep.mjs.
// SOURCE-TEXT PIN: it reads files, never prod. Whether the RPC exists live is
// `to_regprocedure('public.ops_alert_record(text,text,text,text,text,jsonb,text,text,timestamptz)')`.
// @mutate supabase/functions/slack-ops-alert/index.ts | await recordOpsAlertLedger({ | await noLedger({
// @mutate .github/workflows/uptime.yml | node scripts/ops-alert-ledger.mjs record | node scripts/ops-alert-ledger.mjs rec
