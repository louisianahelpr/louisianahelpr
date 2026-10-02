// @mutate scripts/uptime-check.mjs | const status = !down ? "up" : onlyEmpty && EMPTY_IS_WARNING_BEFORE_LAUNCH ? "empty" : "down"; | const status = !down ? "up" : "empty";
// @mutate scripts/uptime-check.mjs | const status = !down ? "up" : onlyEmpty && EMPTY_IS_WARNING_BEFORE_LAUNCH ? "empty" : "down"; | const status = !down ? "up" : "down";
// @mutate scripts/uptime-check.mjs |         return { name, ok: false, empty: true, ms, detail: | return { name, ok: true, ms, detail:
// @mutate .github/workflows/uptime.yml |         if: steps.probe.outputs.status == 'empty' |         if: steps.probe.outputs.status == 'never'
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { execFile } from "node:child_process";
import { createServer, type Server } from "node:http";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse } from "yaml";

/**
 * Owner, 2026-10-02 ("Split the alert until launch"). Prod had no funded job,
 * so open_jobs_browse answered 200 with ZERO rows and the uptime check paged
 * "louisiana helpr is down" as CRITICAL while the site was up. The split:
 *   - a real outage (site or database not answering) stays `down`, critical;
 *   - zero rows from a database that DID answer is `empty`, its own WARNING
 *     ledger item — never folded into `up` (NO FALSE GREENS);
 *   - UPTIME_EMPTY_IS_DOWN=1 (the launch-day setting) makes empty `down` again.
 * Every verdict is driven here against a local stub, so each one is shown to be
 * reachable, and the mutations above show each assertion can fail.
 */

const ROOT = join(__dirname, "..", "..");
const SCRIPT = join(ROOT, "scripts", "uptime-check.mjs");

type Reply = { status: number; body: string };
let site: Reply = { status: 200, body: "<html></html>" };
let db: Reply = { status: 200, body: "[]" };
let server: Server;
let base = "";

beforeAll(async () => {
  server = createServer((req, res) => {
    const r = req.url?.startsWith("/rest/") ? db : site;
    res.writeHead(r.status, { "content-type": req.url?.startsWith("/rest/") ? "application/json" : "text/html" });
    res.end(r.body);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("no port");
  base = `http://127.0.0.1:${addr.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

async function verdict(extra: Record<string, string> = {}): Promise<{ status: string; summary: string }> {
  const dir = mkdtempSync(join(tmpdir(), "uptime-"));
  const out = join(dir, "out");
  try {
    await new Promise<void>((resolve, reject) => {
      execFile(
        process.execPath,
        [SCRIPT],
        {
          cwd: dir,
          env: {
            PATH: process.env.PATH ?? "",
            SITE_URL: `${base}/`,
            SUPABASE_URL: base,
            SUPABASE_PUBLISHABLE_KEY: "test-key",
            ROUNDS: "3",
            ROUND_GAP_MS: "0",
            TIMEOUT_MS: "5000",
            GITHUB_OUTPUT: out,
            ...extra,
          },
        },
        (err) => (err ? reject(err) : resolve()),
      );
    });
    const text = readFileSync(out, "utf8");
    return {
      status: /^status=(.*)$/m.exec(text)?.[1] ?? "",
      summary: /^summary=(.*)$/m.exec(text)?.[1] ?? "",
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("uptime-check.mjs: three verdicts", () => {
  it("rows from the database and a 200 site: up", async () => {
    site = { status: 200, body: "<html></html>" };
    db = { status: 200, body: '[{"id":"x"}]' };
    expect((await verdict()).status).toBe("up");
  });

  it("zero rows from a database that answered: empty (a warning, not up, not down)", async () => {
    site = { status: 200, body: "<html></html>" };
    db = { status: 200, body: "[]" };
    const v = await verdict();
    expect(v.status).toBe("empty");
    expect(v.summary).toMatch(/ZERO rows/);
  });

  it("zero rows with the launch-day setting: down again", async () => {
    site = { status: 200, body: "<html></html>" };
    db = { status: 200, body: "[]" };
    expect((await verdict({ UPTIME_EMPTY_IS_DOWN: "1" })).status).toBe("down");
  });

  it("a database error is an outage: down", async () => {
    site = { status: 200, body: "<html></html>" };
    db = { status: 500, body: '{"message":"boom"}' };
    expect((await verdict()).status).toBe("down");
  });

  it("a dead site with an empty database is still an outage: down", async () => {
    site = { status: 503, body: "" };
    db = { status: 200, body: "[]" };
    expect((await verdict()).status).toBe("down");
  });
});

describe("uptime.yml: empty gets its own warning, down stays critical", () => {
  const wf = parse(readFileSync(join(ROOT, ".github", "workflows", "uptime.yml"), "utf8"));
  const steps: Array<{ name?: string; if?: string; run?: string; with?: Record<string, string> }> =
    Object.values(wf.jobs as Record<string, { steps: unknown[] }>).flatMap((j) => j.steps as never[]);
  const byIf = (cond: string) => steps.filter((s) => (s.if ?? "").replace(/\s+/g, " ").trim() === cond);

  it("empty records a WARNING ledger item that names the pre-launch cause", () => {
    const empty = byIf("steps.probe.outputs.status == 'empty'");
    expect(empty).toHaveLength(1);
    expect(empty[0].run).toMatch(/ops-alert-ledger\.mjs record/);
    expect(empty[0].run).toMatch(/--severity warning/);
    expect(empty[0].run).toMatch(/--strict\b/);
    expect(empty[0].run).not.toMatch(/\|\|\s*true/);
    expect(empty[0].run).toMatch(/no funded jobs \(pre-launch\)/);
  });

  it("down still fails the run (the critical path is untouched)", () => {
    const down = byIf("steps.probe.outputs.status == 'down'");
    expect(down.some((s) => /exit 1/.test(s.run ?? ""))).toBe(true);
  });

  it("the prod-down issue closes only on an explicit up or empty (fail-closed on an unset verdict)", () => {
    const sync = steps.find((s) => typeof s.with?.status === "string" && s.with.status.includes("steps.probe.outputs.status"));
    expect(sync?.with?.status).toBe(
      "${{ (steps.probe.outputs.status == 'up' || steps.probe.outputs.status == 'empty') && 'success' || 'failure' }}",
    );
  });
});

describe("ops-alert-ledger.mjs: strict record mode", () => {
  // @mutate scripts/ops-alert-ledger.mjs | if (!recorded && flag("strict")) process.exitCode = 1; | if (false) process.exitCode = 1;
  it("is non-zero on a rejected write only when strict mode is requested", async () => {
    const failureServer = createServer((_req, res) => {
      res.writeHead(503);
      res.end("unavailable");
    });
    await new Promise<void>((resolve) => failureServer.listen(0, "127.0.0.1", resolve));
    const addr = failureServer.address();
    if (!addr || typeof addr === "string") throw new Error("no ledger test port");
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      SUPABASE_URL: `http://127.0.0.1:${addr.port}`,
      SUPABASE_SERVICE_ROLE_KEY: "test-service-role",
    };
    delete env.SUPABASE_ACCESS_TOKEN;
    delete env.SUPABASE_PROJECT_REF;

    try {
      const recordExitCode = (strict: boolean) => new Promise<number>((resolve) => {
        execFile(
          process.execPath,
          [
            join(ROOT, "scripts", "ops-alert-ledger.mjs"),
            "record",
            "--source",
            "uptime",
            "--title",
            "Guest marketplace is empty",
            ...(strict ? ["--strict"] : []),
          ],
          { env },
          (err) => resolve(err ? Number(err.code) : 0),
        );
      });
      expect(await recordExitCode(true)).toBe(1);
      expect(await recordExitCode(false)).toBe(0);
    } finally {
      await new Promise<void>((resolve, reject) =>
        failureServer.close((err) => (err ? reject(err) : resolve())),
      );
    }
  });
});
