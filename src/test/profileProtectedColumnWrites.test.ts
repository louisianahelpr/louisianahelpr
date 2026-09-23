/*
 * CLASS CHECK — a client write to a `profiles` column that the database
 * silently puts back.
 *
 * FOUND 2026-09-23 (Q99). The "I Am Licensed" / "I Am Insured" switches on
 * /profile?tab=credentials sent `PATCH profiles {is_licensed: true}`. PostgREST
 * answered 200 with one row, so `unwrapMutation` was satisfied — but the BEFORE
 * UPDATE trigger `tr_prevent_self_escalation` (public.prevent_self_escalation)
 * had already reset the column to OLD for this non-admin caller. The row came
 * back `is_licensed: false`; the client patched its persisted cache from the
 * REQUEST, so the switch still showed ON after a reload.
 *
 * `unwrapMutation` cannot see this: the write is not refused, it is quietly
 * rewritten. So the class is decided statically, from the trigger itself:
 *
 *   PROTECTED = every `NEW.<col> := OLD.<col>` in the NEWEST migration that
 *               defines prevent_self_escalation (any dollar-quote tag). Never
 *               hand-typed: a column added to the trigger joins this check the
 *               day its migration lands.
 *   OFFENDERS = every `.from("profiles").update|upsert|insert(...)` in src/
 *               (comments blanked, tests excluded) whose payload names one of
 *               PROTECTED, outside the admin surface.
 *
 * The admin surface (src/components/admin/**, src/pages/Admin*) is exempt
 * because the trigger's first line returns NEW unchanged for
 * `has_role(auth.uid(), 'admin')` — those writes land.
 *
 * KNOWN_OFFENDERS is EXACT and fails in BOTH directions: a new offender fails,
 * and so does a fixed one still listed (lower the list in the same commit).
 *
 * @mutate src/components/profile/CredentialsTab.tsx | if (kind === "license") update.license_url = path; | if (kind === "license") { update.license_url = path; update.is_licensed = true; }
 * @mutate src/components/profile/CredentialsTab.tsx | setIntent((prev) => ({ ...prev, [kind]: v })); | void supabase.from("profiles").update({ is_insured: v }).eq("user_id", userId);
 * @mutate src/pages/Profile.tsx | .update({ id_document_url: path, idv_status: "pending" }) | .update({ id_document_url: path })
 */
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { resolve, join } from "node:path";
import { blankComments } from "./helpers/blankNonCode";

const REPO = resolve(__dirname, "..", "..");
const MIGRATIONS = join(REPO, "supabase", "migrations");

/**
 * The current offenders, `file :: sorted protected columns`, one entry per
 * write site. Only an owner decision (Q99, MORNING QUESTIONS in docs/OPEN.md)
 * should take this to zero.
 */
// @two-way src/test/profileProtectedColumnWrites.test.ts:const staleOffenders =
const KNOWN_OFFENDERS: string[] = [
  // handleIdUpload — unreachable since the manual ID card was removed
  // (ProfileEditForm reads `onIdUpload` as `_onIdUpload`). Reported, not
  // touched: dead code is a report (CLAUDE.md, UI).
  "src/pages/Profile.tsx :: idv_status",
];

const ADMIN_SURFACE = /^src\/(components\/admin\/|pages\/Admin)/;

/** The body of the newest `CREATE [OR REPLACE] FUNCTION public.prevent_self_escalation`. */
function newestTriggerBody(): { file: string; body: string } {
  const head = /create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?"?prevent_self_escalation"?\s*\(/gi;
  let found: { file: string; body: string } | null = null;
  for (const f of readdirSync(MIGRATIONS).filter((x) => x.endsWith(".sql")).sort()) {
    const sql = readFileSync(join(MIGRATIONS, f), "utf8");
    for (const m of sql.matchAll(head)) {
      const rest = sql.slice(m.index!);
      const open = /\bAS\s+(\$[A-Za-z_]*\$)/i.exec(rest);
      if (!open) continue;
      const start = open.index + open[0].length;
      const end = rest.indexOf(open[1], start);
      if (end < 0) continue;
      found = { file: f, body: rest.slice(start, end) };
    }
  }
  if (!found) throw new Error("no migration defines prevent_self_escalation");
  return found;
}

function protectedColumns(body: string): string[] {
  const code = body.replace(/--[^\n]*/g, "");
  const cols = new Set<string>();
  for (const m of code.matchAll(/\bNEW\.(\w+)\s*:=\s*OLD\.(\w+)/gi)) {
    if (m[1] === m[2]) cols.add(m[1]);
  }
  return [...cols].sort();
}

/** Index of the paren that closes the one opening at `open`. */
function closeParen(src: string, open: number): number {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const ch = src[i];
    if (ch === "(") depth++;
    else if (ch === ")") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

interface Write { file: string; line: number; method: string; cols: string[]; unresolved?: string }

function keysIn(text: string, file: string, src: string): string[] {
  const keys = new Set<string>();
  for (const m of text.matchAll(/(\w+)\s*:(?!:)/g)) keys.add(m[1]);
  for (const m of text.matchAll(/[{,]\s*(\w+)\s*(?=[,}])/g)) keys.add(m[1]);
  // Computed key `[IDENT]` resolved against a string constant in the file.
  for (const m of text.matchAll(/\[\s*(\w+)\s*\]\s*:/g)) {
    const c = new RegExp(`(?:const|let)\\s+${m[1]}\\b[^=]*=\\s*["'\`](\\w+)["'\`]`).exec(src);
    if (c) keys.add(c[1]);
    else keys.add(`?${m[1]}@${file}`);
  }
  return [...keys];
}

function profileWrites(files: string[]): Write[] {
  const out: Write[] = [];
  for (const file of files) {
    const raw = readFileSync(join(REPO, file), "utf8");
    const src = blankComments(raw);
    for (const m of src.matchAll(/\.from\(\s*["'`]profiles["'`]\s*\)/g)) {
      const after = m.index! + m[0].length;
      const call = /^\s*\.(\w+)\s*\(/.exec(src.slice(after));
      if (!call || !["update", "upsert", "insert"].includes(call[1])) continue;
      const open = after + call[0].length - 1;
      const close = closeParen(src, open);
      const arg = src.slice(open + 1, close).trim();
      const line = src.slice(0, m.index!).split("\n").length;
      let text: string;
      let unresolved: string | undefined;
      if (arg.startsWith("{")) {
        text = arg;
      } else if (/^\w+$/.test(arg)) {
        // The payload is a variable: read from its nearest preceding
        // declaration down to the call, which covers `x.col = ...` too.
        const decl = [...src.slice(0, m.index!).matchAll(new RegExp(`(?:const|let|var)\\s+${arg}\\b`, "g"))].pop();
        if (!decl) { text = ""; unresolved = arg; }
        else {
          const region = src.slice(decl.index!, m.index!);
          const assigned = [...region.matchAll(new RegExp(`\\b${arg}\\.(\\w+)\\s*=(?!=)`, "g"))].map((a) => `${a[1]}:`);
          text = region + "\n" + assigned.join(",");
        }
      } else {
        text = arg;
        unresolved = arg.slice(0, 60);
      }
      out.push({ file, line, method: call[1], cols: keysIn(text, file, src), unresolved });
    }
  }
  return out;
}

function sourceFiles(): string[] {
  return execFileSync("git", ["ls-files", "--", "src/*.ts", "src/*.tsx"], { cwd: REPO, encoding: "utf8" })
    .split("\n")
    .filter((f) => f && !/\.test\.tsx?$/.test(f) && !f.startsWith("src/test/") && !f.endsWith("integrations/supabase/types.ts"));
}

describe("client writes to profiles columns that prevent_self_escalation resets", () => {
  const { file: trigFile, body } = newestTriggerBody();
  const PROTECTED = protectedColumns(body);
  const writes = profileWrites(sourceFiles());

  it("reads the protected list from the newest trigger definition", () => {
    // 52 columns in 20260915101102, matching live pg_get_functiondef on 2026-09-23.
    expect(PROTECTED.length).toBeGreaterThan(40);
    expect(PROTECTED).toContain("is_licensed");
    expect(PROTECTED).toContain("license_status");
    expect(trigFile >= "20260915101102").toBe(true);
  });

  it("finds the profiles writes it claims to check (inventory floor)", () => {
    expect(writes.length).toBeGreaterThan(15);
    expect(writes.filter((w) => !ADMIN_SURFACE.test(w.file)).length).toBeGreaterThan(8);
  });

  it("resolves every payload it inspects", () => {
    expect(writes.filter((w) => w.unresolved || w.cols.some((c) => c.startsWith("?")))).toEqual([]);
  });

  it("has exactly the known offenders — no new ones, no stale entries", () => {
    const set = new Set(PROTECTED);
    const offenders = writes
      .filter((w) => !ADMIN_SURFACE.test(w.file))
      .map((w) => ({ w, hit: w.cols.filter((c) => set.has(c)).sort() }))
      .filter((x) => x.hit.length > 0)
      .map((x) => `${x.w.file} :: ${x.hit.join(",")}`)
      .sort();
    const staleOffenders = KNOWN_OFFENDERS.filter((k) => !offenders.includes(k));
    expect(staleOffenders.map((k) => `stale baseline entry ${k} — remove it (lower the baseline)`)).toEqual([]);
    expect(
      offenders,
      "A client write names a column the trigger resets for non-admins, so it can return 200 " +
        "and change nothing. Write through a server path, drop the column, or (if the list shrank) " +
        "lower KNOWN_OFFENDERS in the same commit.",
    ).toEqual([...KNOWN_OFFENDERS].sort());
  });
});
