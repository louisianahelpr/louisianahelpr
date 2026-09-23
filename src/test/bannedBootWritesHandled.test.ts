import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve, relative, join } from "node:path";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";
import { walkSource, readSource } from "./helpers/walkSource";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";

/**
 * Q302 class guard: no client write fired on a BANNED account's boot path may
 * be refused by the ban gate without its caller treating that refusal as the
 * ban working (isAccountRestricted), not a fault.
 *
 * Why: a banned account still signs in (owner decision Q300) and briefly
 * mounts the app before ProtectedRoute sends it to /account-banned. On
 * 2026-09-23 the owner-path run saw that boot path mint a referral code
 * (usePrefetchUserData -> fetchReferralData -> referral_codes INSERT). Q281
 * ban-gates referral_codes INSERT, so every banned sign-in would have sent an
 * `account_restricted` error to Sentry.
 *
 * INVENTORY: scripts/probes/fixtures/banned-boot-writes.live.json, the write
 * list the Q300 owner-path run MEASURED on prod (every POST/PATCH/PUT/DELETE
 * from sign-in to Delete Forever). Each entry is classified from the repo's
 * own sources, never a hand list:
 *   table  <tbl> <op>  allowed while banned  <=> exempt in scripts/ci/ban-gate-coverage.sql
 *                      (that check, run live on every db-deploy, proves every
 *                      other authenticated-writable pair is ban-gated);
 *   rpc    <fn>        refused when its effective body calls is_caller_banned(),
 *                      or it is VOLATILE and exempted there only because a
 *                      table it writes is ban-gated; a STABLE/IMMUTABLE one reads;
 *   edge   <fn>        refused when its source checks the ban.
 * A refused write must have >=1 client writer in src/, and every writer must
 * call isAccountRestricted(). An entry that cannot be classified, or whose
 * writer no longer exists, fails (the inventory went stale).
 */
const ROOT = resolve(__dirname, "../..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");
const INV = JSON.parse(read("scripts/probes/fixtures/banned-boot-writes.live.json")) as { writes: string[] };
const CHECK = blankSqlComments(read("scripts/ci/ban-gate-coverage.sql"));
const DEFS = effectiveDefs(resolve(ROOT, "supabase/migrations"));

function block(name: string): string {
  const m = CHECK.match(new RegExp(`${name}\\([^)]*\\) AS \\(\\s*VALUES([\\s\\S]*?)\\n\\),`));
  return m?.[1] ?? "";
}
const tableExempt = new Set(
  [...block("table_exempt").matchAll(/\('([a-z0-9_]+)',\s*'(INSERT|UPDATE|DELETE)',\s*'[^']+'\)/g)].map(([, t, op]) => `${t}:${op}`),
);
const rpcExempt = new Map([...block("rpc_exempt").matchAll(/\('([a-z0-9_]+)',\s*'([^']+)'\)/g)].map(([, fn, why]) => [fn, why]));

// Client source, comments blanked, tests excluded.
const CLIENT = walkSource([resolve(ROOT, "src")])
  .filter((f) => !/\.test\.tsx?$/.test(f) && !f.includes(`${join("src", "test")}`) && !f.endsWith("integrations/supabase/types.ts"))
  .map((f) => ({ file: relative(ROOT, f), code: blankComments(readSource(f) ?? "") }));

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\-]/g, "\\$&");
const OP_METHODS: Record<string, string> = { INSERT: "insert|upsert", UPDATE: "update|upsert", DELETE: "delete" };

type Entry = { raw: string; kind: "table" | "rpc" | "edge"; name: string; op: string };
function parse(raw: string): Entry | null {
  const [method, path] = raw.split(" ");
  const op = method === "POST" ? "INSERT" : method === "PATCH" ? "UPDATE" : method === "DELETE" ? "DELETE" : "INSERT";
  let m = path.match(/^\/rest\/v1\/rpc\/([a-z0-9_]+)$/);
  if (m) return { raw, kind: "rpc", name: m[1], op: "EXECUTE" };
  m = path.match(/^\/rest\/v1\/([a-z0-9_]+)$/);
  if (m) return { raw, kind: "table", name: m[1], op };
  m = path.match(/^\/functions\/v1\/([a-z0-9-]+)$/);
  if (m) return { raw, kind: "edge", name: m[1], op: "INVOKE" };
  return null;
}
const ENTRIES = [...new Set(INV.writes)].map((raw) => ({ raw, e: parse(raw) }));

function edgeSource(fn: string): string | null {
  const dir = resolve(ROOT, "supabase/functions", fn);
  if (!existsSync(dir)) return null;
  return walkSource([dir])
    .map((f) => blankComments(readSource(f) ?? ""))
    .join("\n");
}

/** "refused" = the ban gate turns this write away for a banned caller; null = unclassifiable. */
function classify(e: Entry): { refused: boolean; why: string } | null {
  if (e.kind === "table") {
    return tableExempt.has(`${e.name}:${e.op}`)
      ? { refused: false, why: "exempt in ban-gate-coverage.sql" }
      : { refused: true, why: "not exempt, so ban-gated (live check proves it)" };
  }
  if (e.kind === "rpc") {
    const def = DEFS.get(e.name);
    if (!def) return null;
    const body = blankSqlComments(def.stmt);
    if (/is_caller_banned\s*\(/i.test(body)) return { refused: true, why: "body calls is_caller_banned()" };
    const attrs = body.replace(/\$(\w*)\$[\s\S]*?\$\1\$/, "");
    if (/\b(STABLE|IMMUTABLE)\b/i.test(attrs)) return { refused: false, why: "STABLE/IMMUTABLE read" };
    const why = rpcExempt.get(e.name);
    if (!why) return null; // a VOLATILE RPC the check has not classified
    return /ban-gated|profile lock|refused/i.test(why) ? { refused: true, why } : { refused: false, why };
  }
  const src = edgeSource(e.name);
  if (src === null) return null;
  return /isLockedOut|is_caller_banned|account_restricted|ban_status/.test(src)
    ? { refused: true, why: "edge function checks the ban" }
    : { refused: false, why: "edge function does not check the ban" };
}

function writers(e: Entry): string[] {
  const re =
    e.kind === "table"
      ? new RegExp(`\\.from\\(\\s*["'\`]${esc(e.name)}["'\`]\\s*\\)\\s*\\.(?:${OP_METHODS[e.op]})\\(`)
      : e.kind === "rpc"
        ? new RegExp(`\\.rpc\\(\\s*["'\`]${esc(e.name)}["'\`]`)
        : new RegExp(`["'\`]${esc(e.name)}["'\`]`);
  return CLIENT.filter((c) => re.test(c.code)).map((c) => c.file);
}

// @mutate src/hooks/useReferralData.ts | if (insertErr && !isAccountRestricted(insertErr)) { | if (insertErr) {
// @mutate scripts/ci/ban-gate-coverage.sql |   ('login_history', 'INSERT', 'security audit trail about the banned account itself; more of it helps enforcement'),\n |
// @mutate supabase/functions/check-pro-subscription/index.ts | serve(async (req) => { | serve(async (req) => { const _q302 = "account_restricted";

describe("Q302: every ban-gated write on the banned boot path is handled as the ban working", () => {
  it("reads a real inventory (floors)", () => {
    expect(ENTRIES.length).toBeGreaterThan(8);
    expect(tableExempt.size).toBeGreaterThan(40);
    expect(rpcExempt.size).toBeGreaterThan(30);
    expect(CLIENT.length).toBeGreaterThan(300);
    expect(ENTRIES.some(({ e }) => e?.kind === "table" && e.name === "referral_codes")).toBe(true);
  });

  it("every inventory entry parses and classifies", () => {
    const bad = ENTRIES.filter(({ e }) => !e || !classify(e)).map(({ raw }) => raw);
    expect(bad, "boot-path write the repo cannot classify (stale inventory or unclassified RPC)").toEqual([]);
  });

  it("the classification matches what prod measured for the reads and the delete path", () => {
    // Measured live 2026-09-23 (pg_proc.provolatile = 's' for all four).
    for (const fn of ["get_my_pending_direct_offers", "get_job_offer_targets", "get_jobs_for_my_applications", "get_user_credential_tier"]) {
      expect(classify({ raw: fn, kind: "rpc", name: fn, op: "EXECUTE" })?.refused, fn).toBe(false);
    }
    // A banned account deletes itself here (App Store 5.1.1(v)); it must never check the ban.
    expect(classify({ raw: "d", kind: "edge", name: "delete-own-account", op: "INVOKE" })?.refused).toBe(false);
    expect(classify({ raw: "r", kind: "table", name: "referral_codes", op: "INSERT" })?.refused).toBe(true);
  });

  it("every refused boot write has a client writer, and every writer treats account_restricted as expected", () => {
    const offenders: string[] = [];
    for (const { raw, e } of ENTRIES) {
      if (!e) continue;
      const c = classify(e);
      if (!c?.refused) continue;
      const ws = writers(e);
      if (ws.length === 0) offenders.push(`${raw}: refused (${c.why}) but no client writer found in src/`);
      for (const w of ws) {
        const code = CLIENT.find((x) => x.file === w)!.code;
        if (!/isAccountRestricted\s*\(/.test(code)) offenders.push(`${raw}: ${w} does not call isAccountRestricted() (${c.why})`);
      }
    }
    expect(offenders, "a banned sign-in would report the ban's own refusal as an error").toEqual([]);
  });

  it("the isAccountRestricted helper still matches enforce_ban_gate's refusal text", () => {
    const gate = DEFS.get("enforce_ban_gate");
    expect(gate, "enforce_ban_gate definition").toBeTruthy();
    expect(blankSqlComments(gate!.stmt)).toMatch(/RAISE EXCEPTION 'account_restricted'/);
    expect(blankComments(read("src/lib/banStatus.ts"))).toMatch(/=== "account_restricted"/);
  });
});

