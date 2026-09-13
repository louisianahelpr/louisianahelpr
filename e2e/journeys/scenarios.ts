/**
 * The journey SCENARIO MATRIX (owner, 2026-09-12: "scenario variety, not single
 * fixed runs").
 *
 * Dimensions split into two kinds:
 *
 *  - ENUMERATED per journey: account state and outcome. A journey declares the
 *    ones it can reach; every one of them runs. A state the real backend cannot
 *    produce with the two shared accounts is listed in `REAL_BACKEND_UNREACHABLE`
 *    and runs as an explicit, annotated `uncovered` entry naming the mocked spec
 *    that owns it — never a silent pass and never a quiet omission.
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
 * Account states the two shared real accounts cannot be put into without
 * mutating a shared credential or an admin-only column, which CLAUDE.md
 * forbids doing silently. Each names where it IS covered.
 */
export const REAL_BACKEND_UNREACHABLE: Partial<Record<AccountState, string>> = {
  pending: "mocked: e2e/happy-path (AccountPending screen) — flipping a shared account to pending locks every other lane out",
  "idv-unverified": "mocked: e2e/happy-path apply gate — the shared helper is IDV-verified and un-verifying it is admin-only",
  "no-stripe": "mocked: e2e/happy-path payout-setup states — the shared helper's Connect account is required by the money loop",
  restricted: "mocked: e2e/happy-path — restriction is an admin action on a shared account",
  banned: "mocked: e2e/happy-path (AccountBanned screen) — banning a shared account breaks every other lane",
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
