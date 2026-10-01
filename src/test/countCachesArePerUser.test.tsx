// @mutate src/hooks/useActivityBadgeCounts.ts | safeStorage.setItem(`${CACHE_KEYS[kind]}:${userId}`, | safeStorage.setItem(CACHE_KEYS[kind],
// @mutate src/components/mobileNav/mobileNavHelpers.ts | safeStorage.setItem(`${UNREAD_CACHE_KEY}:${userId}`, | safeStorage.setItem(UNREAD_CACHE_KEY,
// @mutate src/hooks/useActivityBadgeCounts.ts | function openStore(userId: string): BadgeStore {\n  clearLegacyGlobalCache(); | function openStore(userId: string): BadgeStore {
/**
 * CLASS CHECK: a badge / count / unread number cached on the device belongs to
 * ONE account, so its storage key carries that account's id.
 *
 * Owner report 2026-10-01: signed in as their own account (0 posted jobs,
 * prod returns 0 for the Posts badge query) the Posts nav badge read "1".
 * useActivityBadgeCounts cached both nav badges under the GLOBAL keys
 * "helpr_nav_posts_count" / "helpr_nav_jobs_count", and seeded the first frame
 * from them. A count written while a test account was signed in on the same
 * device painted on the next account, and stayed there whenever the live read
 * errored (an errored read never overwrites the cache, by design). The Messages
 * badge (mobileNavHelpers "helpr_nav_unread_count") had the same shape.
 *
 * Two halves:
 *  1. SOURCE: every *Storage.setItem in src/ whose key resolves to something
 *     count-like (count|badge|unread) must be scoped to a user — the key, or
 *     the value it stores (an owner-stamped "<userId>:<n>" that the reader
 *     checks), mentions the user id. Device-level counters that are not an
 *     account's data are listed in DEVICE_LEVEL, exactly (two-way).
 *  2. BEHAVIOUR: a count cached for user A never reaches user B's first frame,
 *     and an errored read for B leaves B at 0.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import ts from "typescript";
import { renderHook, cleanup, act } from "@testing-library/react";
import type { User } from "@supabase/supabase-js";
import { blankComments } from "./helpers/blankNonCode";

const ROOT = resolve(__dirname, "../..");
const SRC = join(ROOT, "src");

/* ---------------------------------------------------------------- rig ---- */

const rig = vi.hoisted(() => ({
  mode: "ok" as "ok" | "error",
  postsCount: 0,
  offers: 0,
  messageRows: 0,
}));

vi.mock("@/integrations/supabase/client", () => {
  const result = (table: string) => {
    if (rig.mode === "error") return { data: null, count: null, error: { code: "08006", message: "offline" } };
    if (table === "applications") return { data: null, count: rig.postsCount, error: null };
    if (table === "messages") {
      const rows = Array.from({ length: rig.messageRows }, (_, i) => ({
        job_id: `j${i}`, sender_id: `s${i}`, created_at: "2026-09-20T00:00:00Z",
      }));
      return { data: rows, count: null, error: null };
    }
    return { data: [], count: 0, error: null };
  };
  const chainFor = (table: string) => {
    const chain: Record<string, unknown> = {};
    for (const m of ["select", "eq", "is", "order", "limit", "not", "update", "in"]) chain[m] = () => chain;
    chain.then = (res: (v: unknown) => unknown) => res(result(table));
    return chain;
  };
  return {
    supabase: {
      from: (table: string) => chainFor(table),
      rpc: () => ({
        then: (res: (v: unknown) => unknown) =>
          res(rig.mode === "error"
            ? { data: null, error: { message: "offline" } }
            : { data: Array.from({ length: rig.offers }, (_, i) => ({ id: i })), error: null }),
      }),
    },
  };
});
vi.mock("@/lib/userRealtimeBus", () => ({ subscribeUserRealtime: () => () => {} }));
vi.mock("@/lib/userBlocks", () => ({ getBlockedUserIds: () => Promise.resolve(new Set<string>()) }));
vi.mock("@/lib/archivedConversations", () => ({ isArchived: () => false, ARCHIVE_CHANGED_EVENT: "lh-archive-test" }));
vi.mock("@/lib/appBadge", () => ({ setAppIconBadge: () => Promise.resolve() }));
vi.mock("@/components/notificationPanel/notificationFeed", () => ({ useNotificationFeed: () => {} }));

import { useActivityBadgeCounts } from "@/hooks/useActivityBadgeCounts";
import { useNavUnreadCount } from "@/components/mobileNav/useNavUnreadCount";
import {
  __resetNotificationStore,
  setNotificationUser,
  setUnreadTotal,
  getNotificationSnapshot,
  bellUnreadCount,
} from "@/components/notificationPanel/notificationStore";

const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

beforeEach(() => {
  localStorage.clear();
  rig.mode = "ok";
  __resetNotificationStore();
});
afterEach(() => cleanup());

describe("a cached count for one account never paints on another (owner 2026-10-01)", () => {
  it("Posts / Jobs nav badges: A's cached counts do not seed B, and B's errored read leaves 0", async () => {
    rig.postsCount = 1;
    rig.offers = 2;
    const a = renderHook(() => useActivityBadgeCounts("user-a"));
    await flush();
    expect(a.result.current).toEqual({ postsCount: 1, jobsCount: 2 });
    a.unmount();

    rig.mode = "error";
    const b = renderHook(() => useActivityBadgeCounts("user-b"));
    // The first frame (useState seed) and the store seed are both B's own.
    expect(b.result.current, "user B's first frame showed user A's cached badge counts").toEqual({ postsCount: 0, jobsCount: 0 });
    await flush();
    expect(b.result.current, "an errored read for B kept A's cached counts").toEqual({ postsCount: 0, jobsCount: 0 });
    b.unmount();

    // A coming back still gets A's own last-known counts on the first frame.
    const a2 = renderHook(() => useActivityBadgeCounts("user-a"));
    expect(a2.result.current).toEqual({ postsCount: 1, jobsCount: 2 });
    a2.unmount();
  });

  it("no user: badges are 0 even when some account has a cached count", async () => {
    rig.postsCount = 4;
    const a = renderHook(() => useActivityBadgeCounts("user-a"));
    await flush();
    a.unmount();
    const none = renderHook(() => useActivityBadgeCounts(undefined));
    expect(none.result.current).toEqual({ postsCount: 0, jobsCount: 0 });
  });

  it("Messages nav badge: A's cached unread does not seed B", async () => {
    rig.messageRows = 3;
    const a = renderHook(() => useNavUnreadCount({ id: "user-a" } as User));
    await flush();
    expect(a.result.current.unreadCount).toBe(3);
    a.unmount();

    rig.mode = "error";
    const b = renderHook(() => useNavUnreadCount({ id: "user-b" } as User));
    expect(b.result.current.unreadCount, "user B's first frame showed user A's cached unread count").toBe(0);
    await flush();
    expect(b.result.current.unreadCount).toBe(0);
    b.unmount();
  });

  it("the old global keys are removed on load", async () => {
    localStorage.setItem("helpr_nav_posts_count", "1");
    localStorage.setItem("helpr_nav_jobs_count", "1");
    localStorage.setItem("helpr_nav_unread_count", "25");
    rig.mode = "error";
    const b = renderHook(() => useActivityBadgeCounts("user-b"));
    const m = renderHook(() => useNavUnreadCount({ id: "user-b" } as User));
    expect(b.result.current).toEqual({ postsCount: 0, jobsCount: 0 });
    expect(m.result.current.unreadCount).toBe(0);
    await flush();
    expect(localStorage.getItem("helpr_nav_posts_count")).toBeNull();
    expect(localStorage.getItem("helpr_nav_jobs_count")).toBeNull();
    expect(localStorage.getItem("helpr_nav_unread_count")).toBeNull();
  });

  it("bell: the in-memory store drops A's unread total the moment B binds (no persisted bell count exists)", () => {
    setNotificationUser("user-a");
    setUnreadTotal(25);
    expect(bellUnreadCount(getNotificationSnapshot())).toBe(25);
    setNotificationUser("user-b");
    expect(bellUnreadCount(getNotificationSnapshot())).toBe(0);
    expect(getNotificationSnapshot().unreadTotal).toBeNull();
  });
});

/* ------------------------------------------------------- source class ---- */

/** Device-level counters: not one account's data, deliberately one per device.
 *  Keyed "<file>::<key expression>". Exact both ways. */
const DEVICE_LEVEL: Record<string, string> = {
  "src/lib/chunkReload.ts::RELOAD_COUNT": "sessionStorage reload-attempt counter for a stale chunk; per tab, not per account",
  "src/hooks/useNotificationPermissionPrompt.ts::SESSION_COUNT_KEY": "app-session count that times the OS push-permission prompt, which is itself per device",
  "src/lib/celebrate.ts::key": "how many times this device fired a celebration confetti; never displayed",
  "src/pages/post-job/firstPostConfetti.ts::key": "how many times this device fired first-post confetti; never displayed (per-device by stated design)",
};

const STORAGE_OBJECTS = /^(safeStorage|localStorage|sessionStorage|window\.localStorage|window\.sessionStorage)$/;
const COUNT_LIKE = /count|badge|unread/i;
const USER_SCOPED = /\buserId\b|\buser\??\.id\b|\buid\b|\bownerId\b/;

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name === "test" || name === "__tests__" || name === "integrations") continue;
      walk(p, out);
    } else if (/\.(ts|tsx)$/.test(name) && !/\.(test|spec)\.(ts|tsx)$/.test(name) && !name.endsWith(".d.ts")) {
      out.push(p);
    }
  }
  return out;
}

function visit(node: ts.Node, fn: (n: ts.Node) => void) {
  fn(node);
  ts.forEachChild(node, (c) => visit(c, fn));
}

/** The text a key expression stands for: the expression plus whatever an
 *  identifier / element access / parameter resolves to inside the file. */
function resolveText(sf: ts.SourceFile, expr: ts.Expression, depth = 0): string {
  const own = expr.getText(sf);
  if (depth > 3) return own;
  if (ts.isTemplateExpression(expr)) {
    return [own, ...expr.templateSpans.map((s) => resolveText(sf, s.expression, depth + 1))].join(" ");
  }
  let target: ts.Expression | null = expr;
  if (ts.isElementAccessExpression(expr)) target = expr.expression;
  if (!target || !ts.isIdentifier(target)) return own;
  const name = target.text;
  const parts = [own];
  visit(sf, (n) => {
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === name && n.initializer) {
      parts.push(resolveText(sf, n.initializer, depth + 1));
    }
    // A parameter: resolve the matching argument at every call of the function in this file.
    if (ts.isParameter(n) && ts.isIdentifier(n.name) && n.name.text === name) {
      const fnNode = n.parent;
      const idx = (fnNode as ts.FunctionLikeDeclaration).parameters.indexOf(n);
      let fnName: string | null = null;
      if (ts.isFunctionDeclaration(fnNode) && fnNode.name) fnName = fnNode.name.text;
      else if ((ts.isArrowFunction(fnNode) || ts.isFunctionExpression(fnNode)) && ts.isVariableDeclaration(fnNode.parent) && ts.isIdentifier(fnNode.parent.name)) fnName = fnNode.parent.name.text;
      if (!fnName) return;
      visit(sf, (c) => {
        if (ts.isCallExpression(c) && ts.isIdentifier(c.expression) && c.expression.text === fnName && c.arguments[idx]) {
          parts.push(resolveText(sf, c.arguments[idx], depth + 1));
        }
      });
    }
  });
  return parts.join(" ");
}

type Hit = { id: string; file: string; line: number; keyText: string; scoped: boolean };

function scanFile(file: string, text: string): Hit[] {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const hits: Hit[] = [];
  visit(sf, (n) => {
    if (!ts.isCallExpression(n) || !ts.isPropertyAccessExpression(n.expression)) return;
    if (n.expression.name.text !== "setItem" || !STORAGE_OBJECTS.test(n.expression.expression.getText(sf))) return;
    const [keyArg, valueArg] = n.arguments;
    if (!keyArg) return;
    const keyText = resolveText(sf, keyArg);
    if (!COUNT_LIKE.test(keyText)) return;
    const valueText = valueArg ? resolveText(sf, valueArg) : "";
    hits.push({
      id: `${relative(ROOT, file)}::${keyArg.getText(sf)}`,
      file: relative(ROOT, file),
      line: sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1,
      keyText,
      scoped: USER_SCOPED.test(keyText) || USER_SCOPED.test(valueText),
    });
  });
  return hits;
}

describe("every count / badge / unread cache in src/ is keyed to a user", () => {
  // blankComments keeps code + strings and offsets, so the AST parse of the
  // blanked text sees no commented-out setItem calls.
  const hits = walk(SRC).flatMap((f) => scanFile(f, blankComments(readFileSync(f, "utf8"))));

  it("inventory floor: the scan finds the count caches it exists for", () => {
    expect(hits.length).toBeGreaterThan(5);
    expect(hits.some((h) => h.file === "src/hooks/useActivityBadgeCounts.ts")).toBe(true);
    expect(hits.some((h) => h.file === "src/components/mobileNav/mobileNavHelpers.ts")).toBe(true);
  });

  it("no globally keyed count cache outside the device-level list", () => {
    const bad = hits.filter((h) => !h.scoped && !(h.id in DEVICE_LEVEL)).map((h) => `${h.file}:${h.line} ${h.id}`);
    expect(bad, "a count/badge/unread cache keyed per device paints one account's number on the next account — key it by userId").toEqual([]);
  });

  it("DEVICE_LEVEL is exact: every entry still matches an unscoped count cache", () => {
    const unscoped = new Set(hits.filter((h) => !h.scoped).map((h) => h.id));
    expect(Object.keys(DEVICE_LEVEL).filter((k) => !unscoped.has(k))).toEqual([]);
  });

  it("the scanner itself flags the original defect", () => {
    const planted = [
      'import { safeStorage } from "@/lib/safeStorage";',
      'const POSTS_CACHE_KEY = "helpr_nav_posts_count";',
      "function writeCached(key: string, n: number) { safeStorage.setItem(key, String(n)); }",
      "export function f(userId: string) { writeCached(POSTS_CACHE_KEY, 1); }",
    ].join("\n");
    const h = scanFile(join(SRC, "planted.ts"), planted);
    expect(h).toHaveLength(1);
    expect(h[0].scoped).toBe(false);
  });
});
