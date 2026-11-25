/**
 * App audit 11-24, same class as deep audit 11-22 #139: a hide or restore that failed to save rolled back silently.
 *
 * Swiping a thread away hid it at once (optimistic); the upsert to thread_archives was refused, and archiveConversation
 * rolled back its cache and mirror, so the thread reappeared with no message. Restore toasted "Restored conversation"
 * and, when the delete was refused, the thread went back into Recently Deleted, again with no word.
 *
 * Fix: both rollbacks fire ARCHIVE_ROLLED_BACK_EVENT ({ archived, gone }); the inbox (useConversationListState) shows an
 * error toast unless the thread's job or person is gone (23503). Every write also bumps a load generation, so a
 * loadArchives already in flight cannot write its older snapshot back over a hide, a restore or a rollback.
 *
 * CLASS GUARD: every detached background write in src/ (`void (async () => { ... })()`, the caller already returned, so
 * it cannot report a failure) that rolls state back (`const roll... =`) must dispatch a `*_ROLLED_BACK_EVENT`, and every
 * such event must have a window listener that calls toast.error. Inventory from source via walkSource.
 *
 * @mutate src/lib/archivedConversations.ts |       emitArchiveRolledBack({ archived: true, gone }); |       void gone;
 * @mutate src/lib/archivedConversations.ts |         emitArchiveRolledBack({ archived: false, gone: isGoneReference(error) }); |         void 0;
 * @mutate src/lib/archivedConversations.ts |   if (loadGen.get(userId) !== gen) return getArchiveMap(userId); |   void gen;
 * @mutate src/components/messages/useConversationListState.ts |       if (detail && !detail.gone) toast.error(detail.archived |       if (false) toast.error(detail.archived
 */
import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { blankComments } from "./helpers/blankNonCode";
import { walkSource } from "./helpers/walkSource";

const ME = "00000000-0000-4000-8000-000000000001";
const OTHER = "00000000-0000-4000-8000-000000000002";
const JOB = "00000000-0000-4000-8000-000000000003";

let failWith: { code: string; message: string } | null = null;
let releaseSelect: (() => void) | null = null;
let selectRows: { job_id: string; other_user_id: string | null; archived_at: string }[] = [];
vi.mock("@/lib/errorLogger", () => ({ report: () => {} }));
vi.mock("@/integrations/supabase/client", () => {
  const terminal = () => {
    const p = { eq: () => p, is: () => p, then: (r: (v: unknown) => void) => r({ error: failWith }) };
    return p;
  };
  return {
    supabase: {
      from: () => ({
        upsert: async () => ({ error: failWith }),
        delete: () => terminal(),
        update: () => terminal(),
        select: () => ({
          eq: () =>
            new Promise((resolve) => {
              const done = () => resolve({ data: selectRows, error: null });
              if (releaseSelect === null) done();
              else releaseSelect = done;
            }),
        }),
      }),
    },
  };
});

const settle = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  failWith = null;
  releaseSelect = null;
  selectRows = [];
  localStorage.clear();
  vi.resetModules();
});

async function collect(run: (mod: typeof import("@/lib/archivedConversations")) => void | Promise<void>) {
  const mod = await import("@/lib/archivedConversations");
  const details: unknown[] = [];
  const on = (e: Event) => details.push((e as CustomEvent).detail);
  window.addEventListener(mod.ARCHIVE_ROLLED_BACK_EVENT, on);
  try {
    await run(mod);
    await settle();
    return { mod, details };
  } finally {
    window.removeEventListener(mod.ARCHIVE_ROLLED_BACK_EVENT, on);
  }
}

describe("app audit 11-24: a refused hide or restore tells the inbox", () => {
  it("a refused hide rolls back AND fires the rolled-back event", async () => {
    failWith = { code: "42501", message: "new row violates row-level security policy" };
    const { mod, details } = await collect((m) => m.archiveConversation(ME, JOB, OTHER));
    expect(mod.isArchived(ME, JOB, OTHER, "2020-01-01T00:00:00Z")).toBe(false);
    expect(details).toEqual([{ archived: true, gone: false }]);
  });

  it("a hide of a gone thread (23503) rolls back, marked gone so no toast is shown", async () => {
    failWith = { code: "23503", message: 'violates foreign key constraint "thread_archives_job_id_fkey"' };
    const { details } = await collect((m) => m.archiveConversation(ME, JOB, OTHER));
    expect(details).toEqual([{ archived: true, gone: true }]);
  });

  it("a refused restore puts the thread back AND fires the event", async () => {
    const { mod, details } = await collect(async (m) => {
      m.archiveConversation(ME, JOB, OTHER);
      await settle();
      failWith = { code: "42501", message: "permission denied" };
      m.unarchiveConversation(ME, JOB, OTHER);
    });
    expect(mod.isArchived(ME, JOB, OTHER, "2020-01-01T00:00:00Z")).toBe(true);
    expect(details).toEqual([{ archived: false, gone: false }]);
  });

  it("a saved hide fires nothing", async () => {
    const { mod, details } = await collect((m) => m.archiveConversation(ME, JOB, OTHER));
    expect(mod.isArchived(ME, JOB, OTHER, "2020-01-01T00:00:00Z")).toBe(true);
    expect(details).toEqual([]);
  });

  it("a load in flight does not write its older snapshot back over a hide made meanwhile", async () => {
    const mod = await import("@/lib/archivedConversations");
    releaseSelect = () => {};
    const load = mod.loadArchives(ME);
    await settle();
    mod.archiveConversation(ME, JOB, OTHER);
    await settle();
    releaseSelect();
    await load;
    expect(mod.isArchived(ME, JOB, OTHER, "2020-01-01T00:00:00Z")).toBe(true);
  });

  it("the inbox listens and toasts unless gone", () => {
    const hook = blankComments(readFileSync(join(process.cwd(), "src/components/messages/useConversationListState.ts"), "utf8"));
    const at = hook.indexOf("const onArchiveRolledBack = (e: Event) => {");
    expect(at).toBeGreaterThan(0);
    expect(hook.slice(at, at + 400)).toContain("if (detail && !detail.gone) toast.error(detail.archived");
    expect(hook).toContain("window.addEventListener(ARCHIVE_ROLLED_BACK_EVENT, onArchiveRolledBack);");
    expect(hook).toContain("window.removeEventListener(ARCHIVE_ROLLED_BACK_EVENT, onArchiveRolledBack);");
  });
});

/** Body of each `void (async () => { ... })` block, by brace matching on comment-blanked source. */
export function detachedBlocks(code: string): string[] {
  const out: string[] = [];
  const re = /void\s*\(\s*async\s*\(\s*\)\s*=>\s*\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code))) {
    let depth = 1;
    let i = m.index + m[0].length;
    for (; i < code.length && depth > 0; i++) {
      if (code[i] === "{") depth++;
      else if (code[i] === "}") depth--;
    }
    out.push(code.slice(m.index + m[0].length, i - 1));
  }
  return out;
}
const ROLLS_BACK = /\b(?:const|let)\s+roll\w*\s*=/i;
const SPEAKS_UP = /\b[A-Z_]+_ROLLED_BACK_EVENT\b|\bemit\w*RolledBack\(/;

describe("CLASS: a detached background write that rolls back speaks up", () => {
  const ROOT = process.cwd();
  const files = walkSource([join(ROOT, "src")]).filter((f) => !/\/src\/test\/|\.test\.tsx?$/.test(f));

  it("the fixture parser finds blocks and tells a silent rollback from a loud one", () => {
    const silent = "void (async () => { const { error } = await w(); if (error) { const rollback = 1; set(rollback); } })();";
    const loud = "void (async () => { if (e) { const rollback = 1; window.dispatchEvent(new CustomEvent(X_ROLLED_BACK_EVENT)); } })();";
    expect(detachedBlocks(silent).some((b) => ROLLS_BACK.test(b) && !SPEAKS_UP.test(b))).toBe(true);
    expect(detachedBlocks(loud).some((b) => ROLLS_BACK.test(b) && !SPEAKS_UP.test(b))).toBe(false);
  });

  it("every rolling-back detached block dispatches a *_ROLLED_BACK_EVENT", () => {
    const rolling: string[] = [];
    const offenders: string[] = [];
    for (const f of files) {
      const code = blankComments(readFileSync(f, "utf8"));
      for (const b of detachedBlocks(code)) {
        if (!ROLLS_BACK.test(b)) continue;
        rolling.push(relative(ROOT, f));
        if (!SPEAKS_UP.test(b)) offenders.push(relative(ROOT, f));
      }
    }
    // pinnedConversations togglePinned, archivedConversations archive + restore.
    expect(rolling.length).toBeGreaterThan(2);
    expect(offenders).toEqual([]);
  });

  it("every *_ROLLED_BACK_EVENT has a window listener whose handler calls toast.error", () => {
    const sources = files.map((f) => blankComments(readFileSync(f, "utf8")));
    const events = new Set<string>();
    for (const s of sources) for (const m of s.matchAll(/export const ([A-Z_]+_ROLLED_BACK_EVENT)\s*=/g)) events.add(m[1]);
    expect(events.size).toBeGreaterThan(1);
    const unheard: string[] = [];
    for (const ev of events) {
      const heard = sources.some((s) => {
        const add = new RegExp(`addEventListener\\(${ev},\\s*(\\w+)\\)`).exec(s);
        if (!add) return false;
        const at = s.indexOf(`const ${add[1]} =`);
        return at >= 0 && s.slice(at, at + 500).includes("toast.error(");
      });
      if (!heard) unheard.push(ev);
    }
    expect(unheard).toEqual([]);
  });
});
