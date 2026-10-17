/**
 * press-every-control's OWN press loop, run end to end (main(), not a copy of
 * any of it) against real app components in jsdom, through the Playwright
 * stand-in in ./helpers/pressFakeBrowser.ts.
 *
 * 1. THE GATE-APPROVED WRITE PATH RUNS (ready/reds-1017-9 review, 2026-10-17).
 *    -9 added a press-time check that a mutating press lands on the record its
 *    gate approved, and placed it where it read `target` before the loop
 *    body's `let target`: a TDZ ReferenceError on every gate-approved write,
 *    which the row's catch turns into "HARNESS ERROR: Cannot access 'target'
 *    before initialization". Every unit test of -9's helpers was green. Here a
 *    test-owned job card's backout "Got It" (a write: ack_backout_notice) must
 *    be pressed as a gated write and PASS, and no row may end in a harness
 *    error.
 *
 * 2. AN ACKNOWLEDGEMENT THAT CAN ONLY CLOSE ITS POPUP IS PRESSED; A "GOT IT"
 *    THAT WRITES STAYS GATED. -9 made "got it" a write (BackoutBanner acks a
 *    notice, Declutter's "I got it" pays the seller), which also gated
 *    PaymentHeldDialog's "Got it", a pure close: on a record that names no test
 *    entity it was skipped, never pressed. The label cannot tell those apart;
 *    the control's ACTION can. PaymentHeldDialog's "Got it" is now
 *    DialogAcknowledgeAction (dialog.tsx), a Radix Close that takes no event
 *    handler, so it can do nothing the dialog's own × does not; it carries
 *    `data-popup-dismiss`, and the harness exempts such a control from
 *    DESTRUCTIVE_RX inside an open popup. A "Got it" that is a plain
 *    DialogPrimaryAction (which may run any onClick), or a backout "Got It" on
 *    a card no test entity owns, is still gated.
 *
 * @mutate scripts/audit/press-every-control.mjs | if (entry.mutating) { | if (entry.mutating && false) {
 * @mutate scripts/audit/press-every-control.mjs | if ((DESTRUCTIVE_RX.test(label) && !meta.dismissOnly) \|\| | if (DESTRUCTIVE_RX.test(label) \|\|
 * @mutate scripts/audit/press-every-control.mjs | if ((DESTRUCTIVE_RX.test(label) && !meta.dismissOnly) \|\| | if ((DESTRUCTIVE_RX.test(label) && false) \|\|
 * @mutate src/components/job-card/PaymentHeldDialog.tsx | <DialogAcknowledgeAction>Got it</DialogAcknowledgeAction> | <DialogPrimaryAction onClick={onClose}>Got it</DialogPrimaryAction>
 * @mutate src/components/ui/dialogActions.tsx | data-popup-dismiss="" | data-x=""
 * @mutate src/components/ui/dialogActions.tsx | .filter(([k]) => !/^on[A-Z]/.test(k)) | .filter(() => true)
 * @mutate scripts/audit/press-every-control.mjs | dismissOnly: el.hasAttribute("data-popup-dismiss") && el.closest('[role="dialog"], [role="alertdialog"]') !== null, | dismissOnly: el.hasAttribute("data-popup-dismiss"),
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { clock, installLayoutShims, makeFakeBrowser, type Fixture } from "./helpers/pressFakeBrowser";
import { JobCardShell } from "@/components/job-card/JobCardShell";
import { BackoutBanner } from "@/components/job-card/BackoutBanner";
import { PaymentHeldDialog } from "@/components/job-card/PaymentHeldDialog";
import { Dialog, DialogContent, DialogHero, DialogBody, DialogFooter, DialogPrimaryAction, DialogAcknowledgeAction } from "@/components/ui/dialog";

const BASE = "http://127.0.0.1:4173";
const OWNER = "Fixture Owner";
const OWNED = [`${OWNER}'s porch A`, `${OWNER}'s porch B`, `${OWNER}'s porch C`];
const SCRIPT = resolve(__dirname, "../../scripts/audit/press-every-control.mjs");

const acked = vi.hoisted(() => ({ ids: [] as string[], listeners: new Set<(id: string) => void>() }));
const fake = vi.hoisted(() => ({ browser: null as unknown }));

vi.mock("@/lib/backoutNotices", async (orig) => ({
  ...(await orig<typeof import("@/lib/backoutNotices")>()),
  // The write itself never leaves the test: record it, and let the card drop its banner.
  ackBackoutNotice: async (id: string) => { acked.ids.push(id); for (const l of acked.listeners) l(id); },
}));
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
    loadTestOwners: async () => ({ ids: ["fixture-user"], names: [OWNER] }),
    urlOwnership: async () => ({ owned: false, why: "fixture route" }),
    makeStripeProbe: () => async () => ({ mode: "live", detail: "fixture" }),
    snapshotAccounts: async () => ({ profiles: {}, weeklyAvailability: {} }),
    createPressJob: async () => ({ id: "00000000-0000-4000-8000-000000000001" }),
    prodSelect: async () => [],
    cleanup: async () => ({ log: [], residue: [] }),
  };
});

/** Mount a component tree into the fake page's body; returns the unmount. */
const mount = (node: () => JSX.Element): Fixture => (body) => {
  const host = document.createElement("div");
  host.id = "root"; // the app's mount point: SNAPSHOT hashes #root
  body.appendChild(host);
  const root = createRoot(host);
  flushSync(() => root.render(<QueryClientProvider client={new QueryClient()}>{node()}</QueryClientProvider>));
  return () => root.unmount();
};

function BackoutCard({ title }: { title: string }) {
  const id = `notice-${title}`;
  return (
    <JobCardShell expandable={false} expanded={false} onToggle={() => {}} category="cleaning">
      <BackoutBanner job={{ backout_notice: { id, job_id: `job-${title}`, backout_kind: "offer_expired", actor_name: null } }} />
      <h3>{title}</h3>
    </JobCardShell>
  );
}

/**
 * /posts as run 39014836855 met it: identical "Got It"s on sibling cards, and
 * an acknowledged card LEAVES the list (server state: `acked.ids` outlives a
 * reload). After A is acked and the page reloaded, the path the sweep queued
 * for B's button holds C's.
 */
function BackoutList({ titles }: { titles: string[] }) {
  const [left, setLeft] = useState(() => titles.filter((t) => !acked.ids.includes(`notice-${t}`)));
  acked.listeners.add((n) => setLeft((cur) => cur.filter((t) => `notice-${t}` !== n)));
  if (!left.length) return <p>Nothing needs you right now.</p>;
  return <div>{left.map((t) => <BackoutCard key={t} title={t} />)}</div>;
}

function HeldDialog() {
  const [side, setSide] = useState<"helpr" | null>("helpr");
  return <PaymentHeldDialog side={side} onClose={() => setSide(null)} />;
}

/** The same words on the primitive that runs whatever onClick it is given. */
function PlainGotItDialog() {
  const [open, setOpen] = useState(true);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent>
        <DialogHero title="Heads up" />
        <DialogBody><p>Something happened that you should know about here.</p></DialogBody>
        <DialogFooter><DialogPrimaryAction onClick={() => setOpen(false)}>Got it</DialogPrimaryAction></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** The marker hand-written onto a write that is NOT in a popup: not honoured. */
function ForgedDismissCard() {
  return (
    <JobCardShell expandable={false} expanded={false} onToggle={() => {}} category="cleaning">
      <h3>Someone else's yard</h3>
      <button type="button" data-popup-dismiss="" onClick={() => acked.ids.push("forged")}>Got it</button>
    </JobCardShell>
  );
}

const FIXTURES: Record<string, Fixture> = {
  "/fixture/owned-cards": mount(() => <BackoutList titles={OWNED} />),
  "/fixture/foreign-card": mount(() => <BackoutList titles={["Someone else's porch clean"]} />),
  "/fixture/payment-held": mount(() => <HeldDialog />),
  "/fixture/plain-got-it": mount(() => <PlainGotItDialog />),
  "/fixture/forged-dismiss": mount(() => <ForgedDismissCard />),
};

type Entry = { label: string; result: string; why: string; mutating?: boolean; outcome?: string };
type Row = { route: string; persona: string; status: string; notes: string[]; controls: Entry[] };
let rows: Row[] = [];
const logs: string[] = [];

beforeAll(async () => {
  const out = mkdtempSync(join(tmpdir(), "press-real-path-"));
  Object.assign(process.env, {
    BASE, OUT: out, PERSONAS: "customer", ROUTES: Object.keys(FIXTURES).join(","),
    SETTLE_MS: "0", PRESS_TIMEOUT: "200", OVERLAY_FILL_MS: "1000", MAX_DEPTH: "1", SAMPLE: "0",
    SELF_HEAL_MS: "100", LH_BROWSER_LOCK: "0", REQUEST_BUDGET_DIR: join(out, "budget"), RUN_ID: "fixture",
  });
  delete process.env.SHARD; delete process.env.SNAPSHOT_IN; delete process.env.SNAPSHOT_OUT;
  delete process.env.CLEANUP_SINCE; delete process.env.PRESS_QUEUE_DIR; delete process.env.TIME_BUDGET_MIN;
  fake.browser = makeFakeBrowser({ base: BASE, fixtures: FIXTURES });
  const restoreShims = installLayoutShims();
  // Virtual time: waitForTimeout advances it, and each read moves it on by 1ms
  // so no loop that polls the clock can spin forever.
  clock.now = Date.now();
  const nowSpy = vi.spyOn(Date, "now").mockImplementation(() => (clock.now += 1));
  const done = new Promise<void>((settle) => {
    vi.spyOn(process, "exit").mockImplementation(((code?: number) => { logs.push(`exit ${code}`); settle(); }) as never);
    vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => { const l = a.join(" "); logs.push(l); if (l.startsWith("\nfound=")) setTimeout(settle, 0); });
    vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => { logs.push("ERR " + a.map(String).join(" ")); });
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  const argv1 = process.argv[1];
  process.argv[1] = SCRIPT; // the script's own "run main() when executed" check
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

const control = (route: string, label: string) => {
  const row = rows.find((r) => r.route === route);
  expect(row, `${route}: no row in results.json; log tail: ${logs.slice(-8).join(" | ")}`).toBeTruthy();
  const entry = row!.controls.find((c) => c.label === label);
  expect(entry, `${route}: no "${label}" control; found ${JSON.stringify(row!.controls.map((c) => c.label))}; notes ${JSON.stringify(row!.notes)}`).toBeTruthy();
  return entry!;
};

describe("press-every-control main(): the real press loop", () => {
  it("walks every fixture row without a harness error", () => {
    // Floor: every fixture walked, and real controls found on them.
    expect(rows.length).toBeGreaterThan(4);
    expect(rows.reduce((n, r) => n + r.controls.length, 0)).toBeGreaterThan(6);
    expect(rows.map((r) => r.route).sort()).toEqual(Object.keys(FIXTURES).sort());
    for (const r of rows) expect(`${r.route}: ${r.status} ${r.notes.join(" | ")}`).toBe(`${r.route}: ok ${r.notes.join(" | ")}`);
  });

  it("presses each test-owned card's backout Got It as a gated write, ON THAT CARD, and passes", () => {
    const row = rows.find((r) => r.route === "/fixture/owned-cards")!;
    const gots = row.controls.filter((c) => c.label === "Got It");
    expect(gots.map((g) => `${g.mutating} ${g.result} ${g.why}`)).toEqual(["true PASS ", "true PASS ", "true PASS "]);
    // B's queued path pointed at C's button once A left the list; the press
    // must still ack B, then C. Without the press-time record check: A, C, B.
    expect(acked.ids).toEqual(OWNED.map((t) => `notice-${t}`));
  });

  it("never presses the same Got It on a card no test entity owns", () => {
    const got = control("/fixture/foreign-card", "Got It");
    expect(got.result).toBe("SKIP");
    expect(got.why).toMatch(/^not test-owned/);
  });

  it("presses PaymentHeldDialog's Got it (close-only) as a read, and it closes the dialog", () => {
    const got = control("/fixture/payment-held", "Got it");
    expect(got.mutating ?? false).toBe(false);
    expect(`${got.result} ${got.why}`).toBe("PASS ");
    expect(got.outcome).toBe("closed the overlay");
  });

  it("keeps a Got it gated when its primitive can run an arbitrary onClick", () => {
    const got = control("/fixture/plain-got-it", "Got it");
    expect(got.result).toBe("SKIP");
    expect(got.why).toMatch(/^not test-owned/);
  });

  it("does not honour the close-only marker outside a popup", () => {
    const got = control("/fixture/forged-dismiss", "Got it");
    expect(got.result).toBe("SKIP");
    expect(got.why).toMatch(/^not test-owned/);
    expect(acked.ids).not.toContain("forged");
  });
});

describe("DialogAcknowledgeAction can only close its dialog", () => {
  it("drops any event handler it is handed, and closes through the dialog's own onOpenChange", () => {
    const spy = vi.fn();
    const onOpenChange = vi.fn();
    // A caller that slips a handler past the type (plain JS, a cast) still gets none.
    const sneaky = { onClick: spy, onPointerDown: spy, onKeyDown: spy } as unknown as Record<string, never>;
    render(
      <Dialog open onOpenChange={onOpenChange}>
        <DialogContent>
          <DialogHero title="You're booked" />
          <DialogFooter><DialogAcknowledgeAction {...sneaky}>Got it</DialogAcknowledgeAction></DialogFooter>
        </DialogContent>
      </Dialog>,
    );
    const got = screen.getByRole("button", { name: "Got it" });
    expect(got.hasAttribute("data-popup-dismiss")).toBe(true);
    fireEvent.pointerDown(got);
    fireEvent.keyDown(got, { key: "Enter" });
    fireEvent.click(got);
    expect(spy).not.toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
