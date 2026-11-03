/*
 * scripts/e2e/settle-job-by-email.mjs settles ONE test job held by two named
 * test accounts (Q2073: 6e7dd687, between two journey throwaway seats that
 * settle-stranded-escrow.mjs never holds). This runs the REAL script against a
 * local stand-in for auth + PostgREST (never prod) and proves:
 *   - --dry-run mints the two sessions, reads the row, and calls NOTHING else;
 *   - a row the gate refuses (not these seats) is never walked, exit 1;
 *   - without --dry-run the walk starts on the product's first door.
 */
// @mutate scripts/e2e/settle-job-by-email.mjs | if (DRY) { | if (false) {
// @mutate scripts/e2e/settle-job-by-email.mjs | process.exit(refusal === "already settled" ? 0 : 1); | process.exit(0);
// @mutate scripts/e2e/settle-job-by-email.mjs | const seats = { posterId: poster.user.id, helperId: helper.user.id }; | const seats = { posterId: poster.user.id, helperId: poster.user.id };
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer, type IncomingMessage, type Server } from "node:http";
import { spawn } from "node:child_process";
import { join } from "node:path";

const root = join(__dirname, "..", "..");
const SCRIPT = join(root, "scripts/e2e/settle-job-by-email.mjs");

const JOB = "6e7dd687-92fe-475b-826d-01b2c6f18b66";
const POSTER = { id: "b08c7972-e10d-47c0-8342-a4cffbca1e88", email: "helpr-journey-throwaway-mvvl3zu5d74927@mailinator.com" };
const HELPER = { id: "5955bc9f-43e5-40b1-badf-303559bde928", email: "helpr-journey-throwaway-mvvl42gd59f842@mailinator.com" };

type Row = Record<string, unknown>;
const row = (over: Row = {}): Row => ({
  id: JOB,
  title: "[E2E DO NOT ACCEPT] fa l3zlb",
  status: "in_progress",
  payment_status: "escrow",
  stripe_session_id: "cs_test_abc",
  customer_id: POSTER.id,
  helper_id: HELPER.id,
  is_seed: true,
  disputed_at: null,
  has_active_dispute: false,
  helper_confirmed_at: "2026-10-30T23:00:00Z",
  helper_arrived_at: "2026-10-30T23:10:00Z",
  ...over,
});

interface Seen { method: string; url: string }
let server: Server;
let base = "";
let jobRow: Row = row();
let seen: Seen[] = [];
let lastEmail = "";

function body(req: IncomingMessage): Promise<string> {
  return new Promise((res) => {
    let b = "";
    req.on("data", (c) => (b += c));
    req.on("end", () => res(b));
  });
}

beforeAll(async () => {
  server = createServer(async (req, res) => {
    const text = await body(req);
    const url = req.url ?? "";
    seen.push({ method: req.method ?? "", url });
    const json = (code: number, v: unknown) => {
      res.writeHead(code, { "Content-Type": "application/json" });
      res.end(JSON.stringify(v));
    };
    const who = (email: string) => (email === POSTER.email ? POSTER : HELPER);
    if (url.startsWith("/rest/v1/profiles") && req.method === "GET") {
      const email = decodeURIComponent(/email=eq\.([^&]+)/.exec(url)?.[1] ?? "");
      return json(200, [{ user_id: who(email).id, is_seed: true }]);
    }
    if (url.startsWith("/auth/v1/admin/generate_link")) {
      lastEmail = JSON.parse(text).email;
      return json(200, { hashed_token: `h-${lastEmail}` });
    }
    if (url.startsWith("/auth/v1/verify")) {
      const email = String(JSON.parse(text).token_hash).slice(2);
      const u = who(email);
      return json(200, { access_token: `tok-${u.id}`, refresh_token: "r", user: { id: u.id, email } });
    }
    if (url.startsWith("/rest/v1/jobs") && req.method === "GET") return json(200, [jobRow]);
    // Every walk leg is refused: the walk stops on its first door.
    return json(500, { message: `stand-in refuses ${req.method} ${url}` });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

function run(args: string[], r: Row): Promise<{ code: number; out: string }> {
  jobRow = r;
  seen = [];
  return new Promise((resolve) => {
    const child = spawn("node", [SCRIPT, ...args], {
      env: {
        PATH: process.env.PATH ?? "",
        HOME: process.env.HOME ?? "",
        VITEST: "true",
        PLAYWRIGHT_SUPABASE_URL: base,
        SUPABASE_SERVICE_ROLE_KEY: "svc-stand-in",
      },
      cwd: root,
    });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    child.on("close", (code) => resolve({ code: code ?? -1, out }));
  });
}

const ARGS = ["--job", JOB, "--poster-email", POSTER.email, "--helper-email", HELPER.email];
/** Anything beyond the two mints (eligibility reads, generate_link, verify) and the job read. */
const beyondMintAndRead = () =>
  seen.filter(
    (s) =>
      !s.url.startsWith("/rest/v1/profiles") &&
      !s.url.startsWith("/rest/v1/test_accounts") &&
      !s.url.startsWith("/auth/v1/") &&
      !(s.method === "GET" && s.url.startsWith("/rest/v1/jobs")),
  );

describe("settle-job-by-email.mjs (Q2073)", () => {
  it("--dry-run mints both seats, reads the row and calls nothing else", async () => {
    const r = await run([...ARGS, "--dry-run"], row());
    expect(r.code, r.out).toBe(0);
    expect(r.out).toContain(`${JOB}  in_progress/escrow`);
    expect(r.out).toContain("→ settle forward");
    expect(r.out).toContain("DRY RUN: nothing called");
    // Inventory floor: both mints happened, so the seats were really resolved.
    expect(seen.filter((s) => s.url.startsWith("/auth/v1/verify")).length).toBeGreaterThan(1);
    expect(beyondMintAndRead(), r.out).toEqual([]);
  }, 30_000);

  it("a row that is not these two seats' is refused and never walked", async () => {
    const r = await run(ARGS, row({ helper_id: "99999999-9999-4999-8999-999999999999" }));
    expect(r.code, r.out).toBe(1);
    expect(r.out).toMatch(/REFUSED — helper_id .* is not the calling helper/);
    expect(beyondMintAndRead(), r.out).toEqual([]);
  }, 30_000);

  it("without --dry-run the walk starts on the product's doors (and a refused leg fails the run)", async () => {
    const r = await run(ARGS, row());
    expect(r.code, r.out).toBe(1);
    expect(beyondMintAndRead().length, r.out).toBeGreaterThan(0);
  }, 30_000);
});
