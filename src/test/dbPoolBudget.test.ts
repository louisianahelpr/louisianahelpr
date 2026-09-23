/**
 * Q317: scripts/check-db-pool-budget.mjs grades the connection arithmetic,
 * not only its reads (liveCheckScriptsFailClosed.test.ts proves the reads fail
 * closed). Served the measured prod shape (max_connections 60, 3 superuser
 * slots, 8 other backends, a 10-job cron minute), pools that overflow 57 must
 * be red and pools that fit must be green.
 *
 * @mutate scripts/check-db-pool-budget.mjs | if (demand > usable) die( | if (false) die(
 * @mutate scripts/check-db-pool-budget.mjs | const cronReserve = Math.max(CRON_RESERVE_FLOOR, r.cron_peak_minute); | const cronReserve = 0;
 * @mutate scripts/check-db-pool-budget.mjs | const poolerTotal = poolSizes.reduce((a, b) => a + b, 0); | const poolerTotal = 0;
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { createServer, type Server } from "node:http";
import { resolve } from "node:path";

const ROOT = resolve(__dirname, "../..");
const SCRIPT = resolve(ROOT, "scripts/check-db-pool-budget.mjs");
const SQL_ROW = { max_conns: 60, su_reserved: 3, reserved: 0, other_conns: 8, cron_peak_minute: 10 };

let server: Server;
let base = "";
let shape: { dbPool: number | null; pools: number[] } = { dbPool: 0, pools: [] };

beforeAll(async () => {
  server = createServer((req, res) => {
    res.setHeader("Content-Type", "application/json");
    const url = req.url ?? "";
    if (url.endsWith("/database/query")) return void res.end(JSON.stringify([SQL_ROW]));
    if (url.endsWith("/postgrest")) return void res.end(JSON.stringify({ db_pool: shape.dbPool, max_rows: 1000 }));
    if (url.endsWith("/config/database/pooler")) {
      return void res.end(JSON.stringify(shape.pools.map((n) => ({ database_type: "PRIMARY", default_pool_size: n }))));
    }
    if (url.endsWith("/config/auth")) return void res.end(JSON.stringify({ db_max_pool_size: null }));
    res.statusCode = 404;
    res.end("{}");
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const a = server.address();
  base = `http://127.0.0.1:${typeof a === "object" && a ? a.port : 0}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

function run(dbPool: number | null, pools: number[]): Promise<{ code: number; out: string }> {
  shape = { dbPool, pools };
  const env = { PATH: process.env.PATH ?? "", SUPABASE_ACCESS_TOKEN: "stub", SUPABASE_PROJECT_REF: "stub", LH_SUPABASE_API_BASE: base };
  return new Promise((done) =>
    execFile(process.execPath, [SCRIPT], { cwd: ROOT, env, timeout: 30_000 }, (err, stdout, stderr) =>
      done({ code: err ? Number((err as NodeJS.ErrnoException).code ?? 1) : 0, out: `${stdout}\n${stderr}` }),
    ),
  );
}

describe("Q317: the pool budget is graded", () => {
  it("pools that overflow the 57 usable slots are red", async () => {
    // 30 + 20 + 8 other + 10 cron = 68 > 57
    const r = await run(30, [20]);
    expect(r.code).not.toBe(0);
    expect(r.out).toMatch(/pools may hold 68 connections but only 57 are usable/);
  });
  it("a cron reserve is part of the demand: 20 + 20 + 8 + 10 = 58 > 57 is red", async () => {
    const r = await run(20, [20]);
    expect(r.code).not.toBe(0);
    expect(r.out).toMatch(/= 58/);
  });
  it("pools that fit are green, with the arithmetic printed", async () => {
    // 15 + 15 + 8 + 10 = 48 <= 57
    const r = await run(15, [15]);
    expect(r.out).toMatch(/usable {2}= max_connections 60 - superuser_reserved 3 - reserved 0 = 57/);
    expect(r.out).toMatch(/OK: 9 connection\(s\) of headroom/);
    expect(r.code).toBe(0);
  });
  it("an unset PostgREST db_pool is red, never assumed", async () => {
    const r = await run(null, [15]);
    expect(r.code).not.toBe(0);
    expect(r.out).toMatch(/PostgREST db_pool is null/);
  });
});
