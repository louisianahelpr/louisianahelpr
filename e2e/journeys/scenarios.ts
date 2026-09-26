/**
 * The journey SCENARIO MATRIX (owner, 2026-09-12: "scenario variety, not single
 * fixed runs").
 *
 * Dimensions split into two kinds:
 *
 *  - ENUMERATED per journey: account state and outcome. A journey declares the
 *    ones it can reach; every one of them runs. A state the real backend cannot
 *    produce with the two shared accounts is listed in `REAL_BACKEND_UNREACHABLE`
 *    and runs as an explicit, annotated `uncovered` entry saying what is missing
 *    to produce it for real. No mocks (owner decision).
 *
 *  - ROTATED nightly: device x network x data. All 6 x 3 x 3 = 54 triples are
 *    too many for one night, so each night takes a date-seeded slice of a
 *    PAIRWISE covering array. The array covers every (device, network),
 *    (device, data) and (network, data) pair; its rows are dealt across the 7
 *    weekdays so each ISO week covers every pair. `SCENARIO=<id>` pins one row
 *    for a reproducible re-run (the id is printed in every test title).
 */

export const PERSONAS = ["new", "returning", "poster-only", "helper-only", "both", "admin"] as const;
export const ACCOUNT_STATES = ["approved", "pending", "idv-unverified", "no-stripe", "restricted", "banned"] as const;
export const DATA_VOLUMES = ["empty", "normal", "heavy"] as const;
export const DEVICES = ["phone-375", "iphone-webkit", "tablet-768", "desktop-1440", "dark", "largest-text"] as const;
export const NETWORKS = ["fast", "slow", "drops"] as const;
export const JOB_TYPES = ["set-price", "hourly", "open-to-offers", "urgent", "recurring", "group", "instant-book", "photos", "no-photos"] as const;
export const OUTCOMES = ["smooth", "cancelled", "revision", "disputed", "refunded", "no-show"] as const;

export type Persona = (typeof PERSONAS)[number];
export type AccountState = (typeof ACCOUNT_STATES)[number];
export type DataVolume = (typeof DATA_VOLUMES)[number];
export type Device = (typeof DEVICES)[number];
export type Network = (typeof NETWORKS)[number];
export type JobType = (typeof JOB_TYPES)[number];
export type Outcome = (typeof OUTCOMES)[number];

/**
 * Account states NOT produced on the real backend yet, and why. Owner decision
 * (2026-09-12): no mock mode anywhere. These states must be created on prod on
 * a seed-flagged account that is NOT one of the two shared journey accounts
 * (flipping those locks every other lane out) and restored afterwards. No
 * existing tooling provisions such an account, so each journey reports these
 * as `uncovered` rather than mocking or silently omitting them.
 */
export const REAL_BACKEND_UNREACHABLE: Partial<Record<AccountState, string>> = {
  pending: "needs a dedicated seed account flipped to pending and restored; no provisioning tooling exists",
  "idv-unverified": "needs a dedicated seed account without IDV; the shared helper must stay verified for the money loop",
  "no-stripe": "needs a dedicated seed account without a Connect account; the shared helper's is load-bearing",
  restricted: "needs a dedicated seed account restricted via admin tooling and restored; none exists",
  banned: "needs a dedicated seed account banned via admin tooling and restored; banning a shared account breaks every lane",
};

/**
 * OUTCOMES no journey drives, and why (Q253). Every other OUTCOMES entry must be
 * the `outcome` of a real journey test (a `scenarioTitle({ … outcome: "x" })` or
 * 02-marketplace's `title(…, "x")`) — src/test/journeyOutcomesDriven.test.ts
 * holds the two sides to each other in both directions. Each entry here is
 * announced as `uncovered` at run time by 04-money-outcomes.spec.ts.
 *
 * `elsewhere` names the real-backend file that DOES drive the outcome outside
 * the journeys, and the door it calls there; the guard checks the door is still
 * in that file's code.
 */
export const OUTCOME_UNDRIVEN: Partial<Record<Outcome, { why: string; elsewhere?: { file: string; door: string } }>> = {
  "no-show": {
    why:
      "report_helper_no_show strikes the Helpr it names: apply_consequence_ladder writes a user_violations 'no_show' row and sets " +
      "ban_status = 'final_warning' (pg_get_functiondef on prod, 2026-09-26), undoable only by an admin, and " +
      "auto_restrict_repeat_violators counts that row, so the next counted violation temp-bans the account for 7 days. " +
      "The only Helpr a journey has is the shared helper, whose lock-out breaks every lane. It also needs a funded, hired " +
      "job whose scheduled start has PASSED with no arrival. Needs a dedicated seed Helpr the run may strike and an " +
      "admin reversal after (owner: credentials).",
  },
  disputed: {
    why:
      "every rpc_open_dispute pages #ops-alerts (open_dispute_as -> notify_ops_dispute_filed) and freezes the escrow for " +
      "an admin decision, so a nightly journey does not open a fresh one; prod-audit keeps ONE disputed fixture instead " +
      "and drives the disputed screens against it.",
    elsewhere: { file: "e2e/prod-audit/fundedOpenJob.ts", door: '"rpc_open_dispute"' },
  },
};

export type Rotation = { device: Device; network: Network; data: DataVolume };

/** A pairwise covering array over device x network x data (18 rows, every pair at least once). */
export function pairwiseRows(): Rotation[] {
  const rows: Rotation[] = [];
  // device x network is the widest pair (6x3=18); assign data by a Latin offset so
  // every (device,data) and (network,data) pair also appears.
  DEVICES.forEach((device, d) => {
    NETWORKS.forEach((network, n) => {
      rows.push({ device, network, data: DATA_VOLUMES[(d + n) % DATA_VOLUMES.length] });
    });
  });
  return rows;
}

export function rotationId(r: Rotation) {
  return `${r.device}.${r.network}.${r.data}`;
}

function isoWeekday(date: Date) {
  return (date.getUTCDay() + 6) % 7; // Mon=0
}

/**
 * Tonight's rotation for one journey. Rows are dealt round-robin over the week
 * (18 rows / 7 days -> 2-3 per night), offset per journey so journeys do not all
 * take the same device on the same night. Pinned by SCENARIO / SCENARIO_ROTATION.
 */
export function rotationFor(journeyIndex: number, date = new Date()): Rotation {
  const rows = pairwiseRows();
  const pinned = process.env.SCENARIO_ROTATION || (process.env.SCENARIO?.split(" · ").slice(-2, -1)[0] ?? "");
  if (pinned) {
    const hit = rows.find((r) => rotationId(r) === pinned);
    if (hit) return hit;
  }
  const day = isoWeekday(date);
  const perDay = rows.filter((_, i) => i % 7 === day);
  return perDay[journeyIndex % perDay.length];
}

export type Scenario = {
  journey: string;
  persona: Persona;
  state: AccountState;
  rotation: Rotation;
  jobType?: JobType;
  outcome: Outcome;
};

/** "helper · idv-unverified · heavy · slow · disputed" style, plus the rotation id so SCENARIO=<title> reproduces it. */
export function scenarioTitle(s: Scenario) {
  return [
    s.journey,
    s.persona,
    s.state,
    s.rotation.data,
    s.rotation.network,
    s.rotation.device,
    ...(s.jobType ? [s.jobType] : []),
    s.outcome,
    rotationId(s.rotation),
  ].join(" · ");
}

/** True when SCENARIO pins a different scenario, so this one should not run. */
export function filteredOut(title: string) {
  const pin = process.env.SCENARIO;
  return !!pin && !title.includes(pin);
}

export type DeviceProfile = {
  viewport: { width: number; height: number };
  hasTouch: boolean;
  colorScheme: "light" | "dark";
  /** CSS applied to <html> to emulate the largest OS text size. */
  textScale?: number;
  webkitOnly?: boolean;
};

export function deviceProfile(device: Device): DeviceProfile {
  switch (device) {
    case "phone-375":
      return { viewport: { width: 375, height: 812 }, hasTouch: true, colorScheme: "light" };
    case "iphone-webkit":
      return { viewport: { width: 390, height: 844 }, hasTouch: true, colorScheme: "light", webkitOnly: true };
    case "tablet-768":
      return { viewport: { width: 768, height: 1024 }, hasTouch: true, colorScheme: "light" };
    case "desktop-1440":
      return { viewport: { width: 1440, height: 900 }, hasTouch: false, colorScheme: "light" };
    case "dark":
      return { viewport: { width: 390, height: 844 }, hasTouch: true, colorScheme: "dark" };
    case "largest-text":
      return { viewport: { width: 390, height: 844 }, hasTouch: true, colorScheme: "light", textScale: 1.35 };
  }
}
