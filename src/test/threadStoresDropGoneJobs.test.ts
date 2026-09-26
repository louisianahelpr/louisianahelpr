/*
 * CLASS GUARD: a device-cached thread row whose job was deleted is dropped,
 * not reported, and every other write error still reports.
 *
 * THE BUG (Sentry JAVASCRIPT-2K, 2026-09-25T03:04Z; error_logs also has three
 * rows from 2026-09-09, all the owner's real account, source
 * pinnedConversations.mergeLocalPins): the inbox keeps thread pins and
 * archives in a local mirror keyed by job id and replays them to the server.
 * Every thread_* table cascades on jobs delete, so a pin or archive cached for
 * a job that was later deleted fails `thread_*_job_id_fkey` (23503) on EVERY
 * inbox load, forever, and in a batch it also blocks the live rows from
 * syncing. loadPins was fixed in 9ae2f8e1e; togglePinned, loadArchives and
 * archiveConversation had the same hole.
 *
 * THE CLASS, from source: every non-test file under src/ that keeps a local
 * mirror (reads safeStorage / localStorage / sessionStorage back and
 * JSON.parses it) and upserts or inserts into a table
 * whose job_id REFERENCES public.jobs (derived from the migrations). Each such
 * file must route every one of those writes' errors through
 * `isGoneReference` (src/lib/goneReference.ts). Behaviour is checked below on
 * both stores, including that a non-23503 error still reaches report().
 *
 * @mutate src/lib/goneReference.ts | return (error as { code?: string }).code === "23503"; | return (error as { code?: string }).code === "never";
 * @mutate src/lib/goneReference.ts | return (error as { code?: string }).code === "23503"; | return true;
 * @mutate src/lib/archivedConversations.ts | for (const k of localOnlyKeys) if (!gone.has(k)) server[k] = local[k]; | for (const k of localOnlyKeys) server[k] = local[k];
 * @mutate src/lib/archivedConversations.ts | if (isGoneReference(error)) return; | if (false) return;
 * @mutate src/lib/pinnedConversations.ts | if (isGoneReference(error)) return; | if (false) return;
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { blankComments, blankSqlComments } from "@/test/helpers/blankNonCode";
import { walkSource, readSource } from "@/test/helpers/walkSource";
import { balanced } from "@/test/helpers/schemaConstraints";

const ROOT = join(__dirname, "..", "..");

// ── Inventory ────────────────────────────────────────────────────────────

/** Tables with a column that REFERENCES public.jobs, from every migration. */
function tablesReferencingJobs(): Set<string> {
  const dir = join(ROOT, "supabase", "migrations");
  const out = new Set<string>();
  const refJobs = /references\s+(?:public\.)?jobs\s*\(/i;
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".sql"))) {
    const sql = blankSqlComments(readFileSync(join(dir, f), "utf8"));
    for (const m of sql.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?"?(\w+)"?\s*\(/gi)) {
      const body = balanced(sql, m.index! + m[0].length - 1);
      if (body && refJobs.test(body)) out.add(m[1].toLowerCase());
    }
    for (const m of sql.matchAll(/alter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?(?:public\.)?"?(\w+)"?([^;]*);/gi)) {
      if (refJobs.test(m[2])) out.add(m[1].toLowerCase());
    }
  }
  out.delete("jobs"); // jobs.parent_job_id is not a device-cached thread row
  return out;
}

type Writer = { file: string; sites: number; checks: number };

/** Mirror-backed src files that write to a table referencing jobs. */
function mirrorWriters(fkTables: Set<string>): Writer[] {
  const out: Writer[] = [];
  for (const abs of walkSource([join(ROOT, "src")])) {
    const file = relative(ROOT, abs);
    if (/\.test\.tsx?$/.test(file) || file.startsWith("src/test/")) continue;
    const raw = readSource(abs);
    if (raw === null) continue;
    const code = blankComments(raw);
    // A mirror is a stored collection read back and parsed. A scalar flag
    // (useJobSubmit's post cooldown timestamp) replays no ids.
    if (!/\b(safeStorage|localStorage|sessionStorage)\??\.getItem\(/.test(code) || !/\bJSON\.parse\(/.test(code)) continue;
    let sites = 0;
    const froms = [...code.matchAll(/\.from\(\s*"(\w+)"/g)];
    froms.forEach((m, i) => {
      if (!fkTables.has(m[1])) return;
      const end = i + 1 < froms.length ? froms[i + 1].index! : code.length;
      const chain = code.slice(m.index!, Math.min(end, m.index! + 400));
      if (/\.(upsert|insert)\(/.test(chain)) sites++;
    });
    if (sites === 0) continue;
    out.push({ file, sites, checks: (code.match(/\bisGoneReference\(/g) ?? []).length });
  }
  return out;
}

describe("thread stores: the class, from source", () => {
  const fk = tablesReferencingJobs();
  const writers = mirrorWriters(fk);

  it("the inventory is real (cannot pass vacuously)", () => {
    // Live pg_constraint on 2026-09-26: 32 tables other than jobs hold an FK to public.jobs.
    expect(fk.size).toBeGreaterThan(20);
    for (const t of ["thread_pins", "thread_archives", "thread_mutes", "message_reactions"]) expect(fk).toContain(t);
    expect(writers.map((w) => w.file).sort()).toEqual(
      expect.arrayContaining(["src/lib/archivedConversations.ts", "src/lib/pinnedConversations.ts"]),
    );
    expect(writers.length).toBeGreaterThan(1);
  });

  it("every mirror-backed write to a job-referencing table handles a gone job", () => {
    const offenders = writers
      .filter((w) => w.checks < w.sites)
      .map((w) => `${w.file}: ${w.sites} write(s), ${w.checks} isGoneReference() check(s)`);
    expect(
      offenders,
      "A local mirror replays job ids the server may have deleted. Route each write's error " +
        "through isGoneReference (src/lib/goneReference.ts): drop the cached row, do not report it.",
    ).toEqual([]);
  });
});

// ── Behaviour ────────────────────────────────────────────────────────────

const LIVE_JOB = "11111111-aaaa-4aaa-8aaa-000000000001";
const GONE_JOB = "11111111-aaaa-4aaa-8aaa-000000000002";
const OTHER = "22222222-bbbb-4bbb-8bbb-000000000001";
const ME = "33333333-cccc-4ccc-8ccc-000000000001";

const FK_ERROR = { code: "23503", message: 'insert or update on table violates foreign key constraint "..._job_id_fkey"' };
const RLS_ERROR = { code: "42501", message: "new row violates row-level security policy" };

const reportMock = vi.fn();
let failWith: typeof FK_ERROR | typeof RLS_ERROR = FK_ERROR;
const upserts: Array<{ table: string; rows: Array<{ job_id: string }> }> = [];

vi.mock("@/lib/errorLogger", () => ({ report: (...a: unknown[]) => reportMock(...a) }));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => ({
      select: () => ({ eq: async () => ({ data: [], error: null }) }),
      upsert: async (input: { job_id: string } | Array<{ job_id: string }>) => {
        const rows = Array.isArray(input) ? input : [input];
        upserts.push({ table, rows });
        return { error: rows.some((r) => r.job_id === GONE_JOB) ? failWith : null };
      },
    }),
  },
}));

const settle = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  upserts.length = 0;
  reportMock.mockReset();
  failWith = FK_ERROR;
  localStorage.clear();
  vi.resetModules();
});

describe("thread stores: a gone job is dropped, anything else still reports", () => {
  it("loadArchives syncs the live archive, drops the gone one, reports nothing", async () => {
    const { loadArchives } = await import("@/lib/archivedConversations");
    const at = "2026-09-25T00:00:00.000Z";
    localStorage.setItem(
      `helpr_archived_conversations_${ME}`,
      JSON.stringify({ [`${LIVE_JOB}_${OTHER}`]: at, [`${GONE_JOB}_${OTHER}`]: at }),
    );
    const map = await loadArchives(ME);
    expect(Object.keys(map)).toEqual([`${LIVE_JOB}_${OTHER}`]);
    expect(upserts.some((u) => u.rows.length === 1 && u.rows[0].job_id === LIVE_JOB)).toBe(true);
    expect(reportMock).not.toHaveBeenCalled();
  });

  it("loadArchives still reports a non-23503 failure and keeps the entry", async () => {
    failWith = RLS_ERROR;
    const { loadArchives } = await import("@/lib/archivedConversations");
    localStorage.setItem(`helpr_archived_conversations_${ME}`, JSON.stringify({ [`${GONE_JOB}_${OTHER}`]: "2026-09-25T00:00:00.000Z" }));
    const map = await loadArchives(ME);
    expect(Object.keys(map)).toEqual([`${GONE_JOB}_${OTHER}`]);
    expect(reportMock).toHaveBeenCalledTimes(1);
  });

  it("archiveConversation on a gone job rolls back without reporting; another error reports", async () => {
    const mod = await import("@/lib/archivedConversations");
    mod.archiveConversation(ME, GONE_JOB, OTHER);
    await settle();
    expect(mod.isArchived(ME, GONE_JOB, OTHER, "2026-01-01T00:00:00.000Z")).toBe(false);
    expect(reportMock).not.toHaveBeenCalled();

    failWith = RLS_ERROR;
    mod.archiveConversation(ME, GONE_JOB, OTHER);
    await settle();
    expect(reportMock).toHaveBeenCalledTimes(1);
  });

  it("togglePinned on a gone job rolls back without reporting; another error reports", async () => {
    const mod = await import("@/lib/pinnedConversations");
    expect(mod.togglePinned(ME, GONE_JOB, OTHER)).toBe(true);
    await settle();
    expect(mod.getPinnedSet(ME).has(mod.pinnedKey(GONE_JOB, OTHER))).toBe(false);
    expect(reportMock).not.toHaveBeenCalled();

    failWith = RLS_ERROR;
    mod.togglePinned(ME, GONE_JOB, OTHER);
    await settle();
    expect(reportMock).toHaveBeenCalledTimes(1);
  });

  it("loadPins still reports a non-23503 merge failure and keeps the pin", async () => {
    failWith = RLS_ERROR;
    const { loadPins, pinnedKey } = await import("@/lib/pinnedConversations");
    localStorage.setItem(`helpr_pinned_threads_v2_${ME}`, JSON.stringify([pinnedKey(GONE_JOB, OTHER)]));
    const pins = await loadPins(ME);
    expect([...pins]).toEqual([pinnedKey(GONE_JOB, OTHER)]);
    expect(reportMock).toHaveBeenCalledTimes(1);
  });
});
