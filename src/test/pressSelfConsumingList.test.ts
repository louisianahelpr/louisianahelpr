/**
 * A LIST THAT THE SWEEP CONSUMES AS IT PRESSES IT MUST STILL BE WALKABLE.
 *
 * Run 35660182220 (2026-09-21) failed 228 presses. 193 of them were "control
 * not found on a freshly loaded page", and 183 of those 193 were children of
 * ONE overlay: the notification panel behind the bell. Nine days of
 * `nightly-red: press-every-control` (#1582) were that single class.
 *
 * The mechanism, read off the app rather than guessed:
 *   - `NotificationPanel.handleClick` marks the row read (NotificationPanel.tsx),
 *     and the panel's filter resolves to "unread" whenever anything is unread,
 *     so pressing a row DELETES it from the list the sweep is walking;
 *   - every row after it then shifts one `nth-of-type` and one ordinal;
 *   - and the identity fallback compared `tag | label | ordinal`, where `label`
 *     is truncated at 60 characters — 57 rows in that run shared the label
 *     `Payment secured in escrow Your payment for "[E2E DO NOT ACCE`, leaving
 *     the ordinal as the only discriminator, which is exactly what had shifted.
 *
 * THE CLASS, not the instance: any live feed behaves this way. So the guard is
 * on the two pure functions the harness now re-addresses with —
 * `controlSignature` (identity that survives re-order, truncation and clock
 * drift) and `consumedByEarlierPress` (the NARROW excuse, which may only fire
 * when the run can point at a control IT pressed that is also gone).
 *
 * The strings below are the real ones from that run's results.json.
 *
 * @mutate scripts/audit/press-every-control.mjs | String(c.sigText ?? c.label ?? "") | String(c.label ?? "")
 * @mutate scripts/audit/press-every-control.mjs | .replace(RELATIVE_TIME_RX, "<rel>") | .replace(/(?!)/g, "<rel>")
 * @mutate scripts/audit/press-every-control.mjs | const gone = [...(pressed ?? [])].filter((s) => s !== sig && !present.has(s) && !loose.has(looseSignature(s))); | const gone = ["anything"];
 * @mutate scripts/audit/press-every-control.mjs | if (!sig || present.has(sig)) return null; | if (!sig) return null;
 * @mutate scripts/audit/press-every-control.mjs | return String(sig).replace(/\d+/g, "#"); | return String(sig);
 */
import { describe, it, expect } from "vitest";
// @ts-expect-error - plain .mjs tool script, no types
import * as harness from "../../scripts/audit/press-every-control.mjs";

interface Control { tag?: string; type?: string; href?: string; label?: string; sigText?: string }
const controlSignature = harness.controlSignature as (c: Control) => string;
const withSignatures = harness.withSignatures as <T extends Control>(l: T[]) => (T & { sig: string; sigOrdinal: number })[];
const consumedByEarlierPress = harness.consumedByEarlierPress as (a: {
  sig: string; present: Set<string>; pressed: Set<string>;
}) => string[] | null;
const CONSUMED_SKIP = harness.CONSUMED_SKIP as string;
const BOUNCED_SKIP = harness.BOUNCED_SKIP as string;
const DOCUMENTED_SKIPS = harness.DOCUMENTED_SKIPS as Set<string>;

/** Two real rows from run 35660182220 — identical for the first 60 characters. */
const LABEL_60 = 'Payment secured in escrow Your payment for "[E2E DO NOT ACCE';
const rowA = {
  tag: "div",
  label: LABEL_60,
  sigText:
    'Payment secured in escrow Your payment for "[E2E DO NOT ACCEPT] automated lifecycle 1788817626985-34164281218" is safely held in escrow and will release after the job is completed. 3d ago',
};
const rowB = {
  tag: "div",
  label: LABEL_60,
  sigText:
    'Payment secured in escrow Your payment for "[E2E DO NOT ACCEPT] automated lifecycle 1788811154409-34157545717" is safely held in escrow and will release after the job is completed. 3d ago',
};

describe("press-every-control: addressing a control in a self-consuming list", () => {
  it("tells two feed rows apart even though their 60-char labels are identical", () => {
    // The precondition the old identity died on.
    expect(rowA.label).toBe(rowB.label);
    expect(controlSignature(rowA)).not.toBe(controlSignature(rowB));
  });

  it("keeps a row's identity when only its relative timestamp has moved", () => {
    // A shard runs ~20 minutes; "7h ago" becomes "8h ago" inside one.
    const before = { tag: "div", sigText: 'We\'ve asked support to step in "Clear leaves and clean gutters" 7h ago' };
    const after = { tag: "div", sigText: 'We\'ve asked support to step in "Clear leaves and clean gutters" 8h ago' };
    expect(controlSignature(after)).toBe(controlSignature(before));
    // …and "just now" is a timestamp too, not part of the row's name.
    expect(controlSignature({ tag: "div", sigText: "New application just now" }))
      .toBe(controlSignature({ tag: "div", sigText: "New application 3 minutes ago" }));
  });

  it("still separates controls that differ only in where they lead", () => {
    const a = { tag: "a", href: "/jobs/1", sigText: "View" };
    const b = { tag: "a", href: "/jobs/2", sigText: "View" };
    expect(controlSignature(a)).not.toBe(controlSignature(b));
  });

  it("ordinals identical signatures so repeated controls stay individually addressable", () => {
    const list = withSignatures([
      { tag: "button", sigText: "Apply" },
      { tag: "button", sigText: "Apply" },
      { tag: "button", sigText: "Save" },
    ]);
    expect(list.map((c) => c.sigOrdinal)).toEqual([0, 1, 0]);
    expect(list[0].sig).toBe(list[1].sig);
  });

  it("excuses a vanished row ONLY when a row this run pressed has vanished too", () => {
    const missing = controlSignature(rowA);
    const present = new Set([controlSignature(rowB)]);

    // The run pressed rowB's neighbour and it is gone → the list ate it.
    const neighbour = controlSignature({ tag: "div", sigText: 'Job completed! "[E2E DO NOT ACCEPT] J c80dii" 1d ago' });
    expect(present.has(neighbour)).toBe(false);
    expect(consumedByEarlierPress({ sig: missing, present, pressed: new Set([neighbour]) })).toEqual([neighbour]);

    // Nothing this run pressed is missing → NO excuse. A control that simply
    // is not there is still a failed press, which is the whole point of the
    // sweep; widening this is how a guard stops guarding.
    expect(consumedByEarlierPress({ sig: missing, present, pressed: new Set([controlSignature(rowB)]) })).toBeNull();
    expect(consumedByEarlierPress({ sig: missing, present, pressed: new Set() })).toBeNull();
  });

  it("does not mistake a badge that ticked for a control that vanished", () => {
    // "Unread 103" → "Unread 46" while the sweep reads rows, and the bottom-nav
    // "Posts" tab carries its badge inside its accessible name. Counting those
    // as gone would hand a free excuse to anything that went missing beside
    // them — the exact way a narrow allow turns into a blanket one.
    const pressedTab = controlSignature({ tag: "button", sigText: "Unread 103" });
    const presentNow = new Set([controlSignature({ tag: "button", sigText: "Unread 46" })]);
    const missing = controlSignature(rowA);
    expect(presentNow.has(pressedTab)).toBe(false);
    expect(consumedByEarlierPress({ sig: missing, present: presentNow, pressed: new Set([pressedTab]) })).toBeNull();
  });

  it("never excuses a control that is right there", () => {
    const sig = controlSignature(rowA);
    expect(consumedByEarlierPress({ sig, present: new Set([sig]), pressed: new Set(["gone"]) })).toBeNull();
  });

  it("registers both new skip reasons, or the coverage gate counts them undocumented", () => {
    // The gate fails on ANY skip whose reason is not in DOCUMENTED_SKIPS, so an
    // unregistered reason turns a fixed red into a different red.
    expect(DOCUMENTED_SKIPS.has(CONSUMED_SKIP)).toBe(true);
    expect(DOCUMENTED_SKIPS.has(BOUNCED_SKIP)).toBe(true);
  });
});
