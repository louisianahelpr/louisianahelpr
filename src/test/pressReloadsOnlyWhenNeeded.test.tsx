/**
 * press-every-control reloads the screen between presses only when a press
 * needs it, and its claim queue starts at a different row each run.
 *
 * Run 43584967592 (2026-11-14) left 312 of 479 rows unreached. Its slowest row,
 * /profile?tab=receipts (customer), spent a whole 46.7-min leg on 277 presses:
 * 275 receipt rows opening IN PLACE, each followed by a full-screen reload
 * (~190 requests, ~14 of them backend calls), and 33.4 of those minutes were
 * the request-ceiling pace wait the reloads ran up
 * (~/.lh-shots/b1-press-1114/run-43584967592, coverage.md "Where the time went").
 *
 * This runs the harness's REAL main() (./helpers/pressFakeBrowser.ts) and holds:
 *   1. a list of rows that open in place is pressed whole on ONE load;
 *   2. when an in-place press shifts the DOM so a queued path now holds a
 *      different control, the screen is reloaded and the RIGHT control is
 *      pressed (never the one that moved under the path);
 *   3. navigation, writes, overlays, failures, gated writes and opener chains
 *      still reload (pressNeedsReload);
 *   4. the queue order is a rotation of every row, the same for every shard of
 *      a run, and the workflow passes the run number to every leg.
 *
 * @mutate scripts/audit/pressFailureClass.mjs | return !!(navigated \|\| wrote \|\| overlaysChanged \|\| failed \|\| mutating \|\| inChain); | return true;
 * @mutate scripts/audit/pressFailureClass.mjs | return !!at && at.sig === sig; | return true;
 * @mutate scripts/audit/pressFailureClass.mjs | return !!(navigated \|\| wrote \|\| overlaysChanged \|\| failed \|\| mutating \|\| inChain); | return !!(navigated \|\| overlaysChanged \|\| failed \|\| mutating \|\| inChain);
 * @mutate scripts/audit/pressFailureClass.mjs | return Array.from({ length: n }, (_, i) => (start + i) % n); | return Array.from({ length: n }, (_, i) => i);
 * @mutate scripts/audit/press-every-control.mjs | for (const routeIdx of rowOrder) { | for (const routeIdx of routeSet.keys()) {
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { clock, installLayoutShims, makeFakeBrowser, type Fixture } from "./helpers/pressFakeBrowser";
import { pressNeedsReload, pressTargetStillAt, rotatedRowOrder } from "../../scripts/audit/pressFailureClass.mjs";

const BASE = "http://127.0.0.1:4173";
const SCRIPT = resolve(__dirname, "../../scripts/audit/press-every-control.mjs");
const REPO = resolve(__dirname, "../..");

const fake = vi.hoisted(() => ({ browser: null as unknown }));
const clicks = vi.hoisted(() => ({ log: [] as string[] }));

vi.mock("@playwright/test", () => ({ chromium: { launch: async () => fake.browser } }));
vi.mock("../../scripts/audit/pressRouteProbe.mjs", () => ({
  routeProbePasses: () => [],
  recordRouteProbePasses: async () => ({ ok: true, recorded: 0 }),
}));
vi.mock("../../scripts/audit/pressProdSafety.mjs", async (orig) => {
  const real = await orig<Record<string, unknown>>();
  const session = { account: "fixture-poster", key: "sb-fixture-auth-token", value: "{}", userId: "fixture-user", accessToken: "x", at: Date.now() };
  return {
    ...real,
    mintAccounts: async () => ({ sessions: { customer: session }, unavailable: {} }),
    remintSession: async () => ({ ...session }),
    sessionStillAlive: async () => true,
    loadTestOwners: async () => ({ ids: ["fixture-user"], names: ["Fixture Owner"] }),
    urlOwnership: async () => ({ owned: false, why: "fixture route" }),
    makeStripeProbe: () => async () => ({ mode: "live", detail: "fixture" }),
    snapshotAccounts: async () => ({ profiles: {}, weeklyAvailability: {} }),
    createPressJob: async () => ({ id: "00000000-0000-4000-8000-000000000001" }),
    prodSelect: async () => [],
    cleanup: async () => ({ log: [], residue: [] }),
  };
});

const mounts: Record<string, number> = {};
/** Mount a component tree into the fake page's body, counting each (re)load of the route. */
const mount = (route: string, node: () => JSX.Element): Fixture => (body) => {
  mounts[route] = (mounts[route] ?? 0) + 1;
  const host = document.createElement("div");
  host.id = "root";
  body.appendChild(host);
  const root = createRoot(host);
  flushSync(() => root.render(node()));
  return () => root.unmount();
};

const RECEIPTS = ["Porch clean Nov 12 $25.00", "Yard work Nov 11 $40.00", "Moving help Nov 10 $60.00", "Gutter clean Nov 9 $35.00", "Pressure wash Nov 8 $50.00", "Dog walk Nov 7 $15.00"];

/** /profile?tab=receipts as run 43584967592 met it: rows that open in place. */
function ReceiptRow({ title }: { title: string }) {
  const [open, setOpen] = useState(false);
  return (
    <section>
      <button type="button" aria-expanded={open} onClick={() => { clicks.log.push(title); setOpen((o) => !o); }}>{title}</button>
      {open && <p>Paid by card. Receipt number 1234 for {title}.</p>}
    </section>
  );
}

/**
 * A press that inserts a block ABOVE the list, so the list's DOM paths shift by
 * one and the path queued for "Alpha" now holds the notice's "Hide notice".
 * Alpha is found again by its signature and pressed where it now is; Beta's
 * words changed too, so it cannot be found again and the screen is reloaded.
 */
function ShiftingList() {
  const [notice, setNotice] = useState(false);
  return (
    <main>
      <div><button type="button" aria-pressed={notice} onClick={() => { clicks.log.push("Show notice"); setNotice(true); }}>Show notice</button></div>
      {notice && <div><button type="button" onClick={() => clicks.log.push("Hide notice")}>Hide notice</button><p>Heads up, this list changed.</p></div>}
      <div>
        <button type="button" aria-expanded="false" onClick={(e) => { clicks.log.push("Alpha"); e.currentTarget.setAttribute("aria-expanded", "true"); }}>Alpha</button>
        <button type="button" aria-expanded="false" onClick={(e) => { clicks.log.push("Beta"); e.currentTarget.setAttribute("aria-expanded", "true"); }}>{notice ? "Beta, changed" : "Beta"}</button>
      </div>
    </main>
  );
}

const FIXTURES: Record<string, Fixture> = {
  "/fixture/receipts": mount("/fixture/receipts", () => <div>{RECEIPTS.map((t) => <ReceiptRow key={t} title={t} />)}</div>),
  "/fixture/shifting": mount("/fixture/shifting", () => <ShiftingList />),
};

type Entry = { label: string; result: string; why: string; outcome?: string };
type Row = { route: string; persona: string; status: string; notes: string[]; controls: Entry[] };
let rows: Row[] = [];
const logs: string[] = [];

beforeAll(async () => {
  const out = mkdtempSync(join(tmpdir(), "press-reloads-"));
  Object.assign(process.env, {
    BASE, OUT: out, PERSONAS: "customer", ROUTES: Object.keys(FIXTURES).join(","),
    SETTLE_MS: "0", PRESS_TIMEOUT: "200", OVERLAY_FILL_MS: "1000", MAX_DEPTH: "1", SAMPLE: "0",
    SELF_HEAL_MS: "100", LH_BROWSER_LOCK: "0", REQUEST_BUDGET_DIR: join(out, "budget"), RUN_ID: "fixture",
  });
  delete process.env.SHARD; delete process.env.SNAPSHOT_IN; delete process.env.SNAPSHOT_OUT;
  delete process.env.CLEANUP_SINCE; delete process.env.PRESS_QUEUE_DIR; delete process.env.TIME_BUDGET_MIN; delete process.env.PRESS_ROTATE;
  fake.browser = makeFakeBrowser({ base: BASE, fixtures: FIXTURES });
  const restoreShims = installLayoutShims();
  clock.now = Date.now();
  const nowSpy = vi.spyOn(Date, "now").mockImplementation(() => (clock.now += 1));
  const done = new Promise<void>((settle) => {
    vi.spyOn(process, "exit").mockImplementation(((code?: number) => { logs.push(`exit ${code}`); settle(); }) as never);
    vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => { const l = a.join(" "); logs.push(l); if (l.startsWith("\nfound=")) setTimeout(settle, 0); });
    vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => { logs.push("ERR " + a.map(String).join(" ")); });
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  const argv1 = process.argv[1];
  process.argv[1] = SCRIPT;
  try {
    await import(/* @vite-ignore */ SCRIPT);
    await done;
  } finally {
    process.argv[1] = argv1;
    nowSpy.mockRestore();
    restoreShims();
    vi.restoreAllMocks();
  }
  rows = JSON.parse(readFileSync(join(out, "results.json"), "utf8")).results;
}, 120_000);

afterAll(() => { document.body.innerHTML = ""; });

const row = (route: string) => {
  const r = rows.find((x) => x.route === route);
  expect(r, `${route}: no row; log tail: ${logs.slice(-8).join(" | ")}`).toBeTruthy();
  return r!;
};

describe("press-every-control reloads only when a press needs it", () => {
  it("presses every receipt row, on one load of the screen", () => {
    const r = row("/fixture/receipts");
    const pressed = r.controls.filter((c) => RECEIPTS.includes(c.label));
    // Floor: every row was found and pressed, and each opened in place.
    expect(pressed.length).toBeGreaterThan(5);
    expect(pressed.map((c) => `${c.label}: ${c.result} ${c.outcome}`)).toEqual(RECEIPTS.map((t) => `${t}: PASS changed a toggle/field`));
    expect(clicks.log.filter((l) => RECEIPTS.includes(l))).toEqual(RECEIPTS);
    // One load for the whole row; before, one more per in-place press (7).
    expect(mounts["/fixture/receipts"]).toBe(1);
  });

  it("presses a moved control where it now is, reloads when it cannot be found again, and never presses the one under its old path", () => {
    const r = row("/fixture/shifting");
    expect(r.controls.map((c) => `${c.label}: ${c.result}`)).toEqual(["Show notice: PASS", "Alpha: PASS", "Beta: PASS"]);
    // Alpha's queued path held "Hide notice" after the notice appeared: it must never be clicked.
    expect(clicks.log.filter((l) => !RECEIPTS.includes(l))).toEqual(["Show notice", "Alpha", "Beta"]);
    expect((r.controls.find((c) => c.label === "Alpha") as Entry & { relocated?: boolean }).relocated).toBe(true);
    // Beta's words changed with the notice, so the screen was reloaded once for it.
    expect(mounts["/fixture/shifting"]).toBe(2);
    expect((r as Row & { reloadReasons?: Record<string, number> }).reloadReasons).toEqual({ moved: 1 });
  });

  it("still reloads after navigation, a write, an overlay change, a failure, a gated write or an opener chain", () => {
    const quiet = { navigated: false, wrote: false, overlaysChanged: false, failed: false, mutating: false, inChain: false };
    expect(pressNeedsReload(quiet)).toBe(false);
    for (const k of Object.keys(quiet) as (keyof typeof quiet)[]) expect(pressNeedsReload({ ...quiet, [k]: true }), k).toBe(true);
  });

  it("presses on a kept page only while the queued path holds the same control", () => {
    const now = [{ path: "div:nth-of-type(2) > button", sig: "a" }, { path: "div:nth-of-type(3) > button", sig: "b" }];
    expect(pressTargetStillAt({ now, path: "div:nth-of-type(2) > button", sig: "a" })).toBe(true);
    expect(pressTargetStillAt({ now, path: "div:nth-of-type(2) > button", sig: "b" })).toBe(false);
    expect(pressTargetStillAt({ now, path: "div:nth-of-type(9) > button", sig: "a" })).toBe(false);
  });
});

describe("the claim queue starts at a different row each run", () => {
  it("is a rotation of every row, unrotated without PRESS_ROTATE", () => {
    expect(rotatedRowOrder({ length: 5, rotate: "" })).toEqual([0, 1, 2, 3, 4]);
    expect(rotatedRowOrder({ length: 0, rotate: "7" })).toEqual([]);
    for (const rotate of ["1", "2", "3", "500", "1234"]) {
      const order = rotatedRowOrder({ length: 479, rotate });
      expect([...order].sort((a, b) => a - b)).toEqual([...Array(479).keys()]);
      for (let i = 1; i < order.length; i++) expect(order[i]).toBe((order[i - 1] + 1) % 479);
    }
  });

  it("consecutive runs start far apart, so the same tail is not left every run", () => {
    const starts = [1, 2, 3, 4, 5, 6].map((r) => rotatedRowOrder({ length: 479, rotate: String(r) })[0]);
    expect(new Set(starts).size).toBe(6);
    // Three consecutive runs each reaching the first 35% of the order cover every row.
    const covered = new Set<number>();
    for (const r of [10, 11, 12]) rotatedRowOrder({ length: 479, rotate: String(r) }).slice(0, Math.ceil(479 * 0.35)).forEach((i) => covered.add(i));
    expect(covered.size).toBeGreaterThan(400);
  });

  it("the harness walks rows in the rotated order, and every leg passes the run number", () => {
    const src = readFileSync(join(REPO, "scripts/audit/press-every-control.mjs"), "utf8");
    expect(src).toContain('const rowOrder = rotatedRowOrder({ length: routeSet.length, rotate: QUEUE_DIR ? process.env.PRESS_ROTATE : "" });');
    expect(src).toContain("for (const routeIdx of rowOrder) {");
    const wf = readFileSync(join(REPO, ".github/workflows/press-every-control.yml"), "utf8");
    const legs = wf.match(/RUN_BASE: \$\{\{ github\.run_id \}\}/g) ?? [];
    expect(legs.length).toBeGreaterThan(5);
    expect((wf.match(/PRESS_ROTATE: \$\{\{ github\.run_number \}\}/g) ?? []).length).toBe(legs.length);
  });
});
